import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { applications, deploymentQueue } from "@/server/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { deploymentQueue as queue } from "@/server/queue";
import { createId } from "@paralleldrive/cuid2";
import { logger } from "@/lib/logger";
import crypto from "crypto";

interface BitbucketPushEvent {
  push: {
    changes: {
      new: {
        type: string;
        name: string;
        target: {
          hash: string;
          message: string;
          author: {
            raw: string;
            user?: {
              display_name: string;
            };
          };
        };
      };
      commits: {
        hash: string;
        message: string;
        author: {
          raw: string;
        };
        links: {
          diff: { href: string };
        };
      }[];
    }[];
  };
  repository: {
    uuid: string;
    full_name: string;
    name: string;
  };
  actor: {
    display_name: string;
    uuid: string;
  };
}

interface BitbucketPullRequestEvent {
  pullrequest: {
    id: number;
    title: string;
    state: string;
    source: {
      branch: {
        name: string;
      };
      commit: {
        hash: string;
      };
    };
    destination: {
      branch: {
        name: string;
      };
    };
  };
  repository: {
    uuid: string;
    full_name: string;
  };
}

// POST /api/webhooks/bitbucket
export async function POST(request: NextRequest) {
  const event = request.headers.get("X-Event-Key");
  const hookUuid = request.headers.get("X-Hook-UUID");

  logger.info("Bitbucket webhook received", { event, hookUuid });

  const rawBody = await request.text();

  let payload: BitbucketPushEvent | BitbucketPullRequestEvent;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  switch (event) {
    case "repo:push":
      return handlePushEvent(payload as BitbucketPushEvent, rawBody, request);
    case "pullrequest:created":
    case "pullrequest:updated":
      return handlePullRequestEvent(
        payload as BitbucketPullRequestEvent,
        event
      );
    case "pullrequest:fulfilled":
    case "pullrequest:rejected":
      return handlePullRequestClosed(payload as BitbucketPullRequestEvent);
    default:
      logger.info("Unhandled Bitbucket event", { event });
      return NextResponse.json({ message: "Event ignored" });
  }
}

async function handlePushEvent(
  payload: BitbucketPushEvent,
  rawBody: string,
  request: NextRequest
) {
  const { push, repository } = payload;

  // Get the most recent change
  const change = push.changes[0];
  if (!change?.new) {
    return NextResponse.json({ message: "No branch changes" });
  }

  const branch = change.new.name;
  const commit = change.new.target.hash;
  const repoName = repository.full_name;

  logger.info("Processing Bitbucket push event", {
    repo: repoName,
    branch,
    commit,
  });

  // Find applications using this repository
  const apps = await db.query.applications.findMany({
    where: and(
      eq(applications.gitRepository, repoName),
      eq(applications.branch, branch),
      eq(applications.autoDeploy, true),
      isNull(applications.deletedAt)
    ),
    with: {
      server: true,
    },
  });

  if (apps.length === 0) {
    return NextResponse.json({
      message: "No applications found",
      repository: repoName,
      branch,
    });
  }

  const deployments = [];

  for (const app of apps) {
    // Verify webhook secret if configured
    if (app.webhookSecret) {
      const signature = request.headers.get("X-Hub-Signature");
      if (signature) {
        const expectedSig = crypto
          .createHmac("sha256", app.webhookSecret)
          .update(rawBody)
          .digest("hex");

        if (!crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(`sha256=${expectedSig}`)
        )) {
          logger.warn("Invalid Bitbucket webhook signature", { appId: app.id });
          continue;
        }
      }
    }

    const deploymentId = createId();

    const [deployment] = await db
      .insert(deploymentQueue)
      .values({
        id: deploymentId,
        applicationId: app.id,
        status: "queued",
        triggeredBy: "webhook",
        commit,
        branch,
        commitMessage: change.new.target.message,
        commitAuthor: change.new.target.author.user?.display_name ??
                      change.new.target.author.raw,
      })
      .returning();

    await queue.add("deployment", {
      deploymentId: deployment.id,
      applicationId: app.id,
      serverId: app.serverId,
    });

    deployments.push({
      deploymentId: deployment.id,
      applicationId: app.id,
      applicationName: app.name,
    });

    logger.info("Bitbucket deployment queued", {
      deploymentId: deployment.id,
      appId: app.id,
    });
  }

  return NextResponse.json({
    message: `Queued ${deployments.length} deployment(s)`,
    deployments,
  });
}

async function handlePullRequestEvent(
  payload: BitbucketPullRequestEvent,
  event: string
) {
  const { pullrequest, repository } = payload;

  logger.info("Processing Bitbucket pull request event", {
    repo: repository.full_name,
    event,
    prId: pullrequest.id,
  });

  // Find applications with preview deployments enabled
  const apps = await db.query.applications.findMany({
    where: and(
      eq(applications.gitRepository, repository.full_name),
      eq(applications.branch, pullrequest.destination.branch.name),
      eq(applications.previewDeploymentsEnabled, true),
      isNull(applications.deletedAt)
    ),
    with: {
      server: true,
    },
  });

  if (apps.length === 0) {
    return NextResponse.json({
      message: "No applications with preview deployments enabled",
    });
  }

  const deployments = [];

  for (const app of apps) {
    const deploymentId = createId();

    const [deployment] = await db
      .insert(deploymentQueue)
      .values({
        id: deploymentId,
        applicationId: app.id,
        status: "queued",
        triggeredBy: "webhook",
        commit: pullrequest.source.commit.hash,
        branch: pullrequest.source.branch.name,
        isPullRequest: true,
        pullRequestNumber: pullrequest.id,
      })
      .returning();

    await queue.add("deployment", {
      deploymentId: deployment.id,
      applicationId: app.id,
      serverId: app.serverId,
      isPreview: true,
      prNumber: pullrequest.id,
    });

    deployments.push({
      deploymentId: deployment.id,
      applicationId: app.id,
      pullRequest: pullrequest.id,
    });
  }

  return NextResponse.json({
    message: `Queued ${deployments.length} PR preview deployment(s)`,
    deployments,
  });
}

async function handlePullRequestClosed(payload: BitbucketPullRequestEvent) {
  const { pullrequest, repository } = payload;

  logger.info("Handling Bitbucket PR closure", {
    repo: repository.full_name,
    prId: pullrequest.id,
  });

  // TODO: Queue cleanup jobs for preview environments

  return NextResponse.json({
    message: "PR closed, cleanup initiated",
    pullRequest: pullrequest.id,
  });
}
