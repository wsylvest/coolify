import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { applications, deploymentQueue } from "@/server/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { deploymentQueue as queue } from "@/server/queue";
import { queuePreviewCleanup } from "@/server/queue/jobs/preview-cleanup";
import { createId } from "@paralleldrive/cuid2";
import { logger } from "@/lib/logger";
import crypto from "crypto";

interface GiteaPushEvent {
  ref: string;
  before: string;
  after: string;
  compare_url: string;
  commits: {
    id: string;
    message: string;
    url: string;
    author: {
      name: string;
      email: string;
      username: string;
    };
    added: string[];
    removed: string[];
    modified: string[];
  }[];
  head_commit: {
    id: string;
    message: string;
    author: {
      name: string;
      email: string;
    };
  } | null;
  repository: {
    id: number;
    full_name: string;
    html_url: string;
    default_branch: string;
  };
  pusher: {
    id: number;
    login: string;
    full_name: string;
  };
  sender: {
    id: number;
    login: string;
    full_name: string;
  };
}

interface GiteaPullRequestEvent {
  action: string;
  number: number;
  pull_request: {
    id: number;
    number: number;
    state: string;
    title: string;
    head: {
      ref: string;
      sha: string;
    };
    base: {
      ref: string;
    };
    merged: boolean;
  };
  repository: {
    id: number;
    full_name: string;
  };
}

// POST /api/webhooks/gitea
export async function POST(request: NextRequest) {
  const event = request.headers.get("X-Gitea-Event");
  const signature = request.headers.get("X-Gitea-Signature");
  const deliveryId = request.headers.get("X-Gitea-Delivery");

  logger.info("Gitea webhook received", { event, deliveryId });

  const rawBody = await request.text();

  let payload: GiteaPushEvent | GiteaPullRequestEvent;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  switch (event) {
    case "push":
      return handlePushEvent(payload as GiteaPushEvent, rawBody, signature);
    case "pull_request":
      return handlePullRequestEvent(
        payload as GiteaPullRequestEvent,
        rawBody,
        signature
      );
    default:
      logger.info("Unhandled Gitea event", { event });
      return NextResponse.json({ message: "Event ignored" });
  }
}

function verifySignature(
  rawBody: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSig)
  );
}

async function handlePushEvent(
  payload: GiteaPushEvent,
  rawBody: string,
  signature: string | null
) {
  const { ref, after, repository, head_commit, commits } = payload;

  // Extract branch name
  const branch = ref.replace("refs/heads/", "");

  logger.info("Processing Gitea push event", {
    repo: repository.full_name,
    branch,
    commit: after,
  });

  // Find applications using this repository
  const apps = await db.query.applications.findMany({
    where: and(
      eq(applications.gitRepository, repository.full_name),
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
      repository: repository.full_name,
      branch,
    });
  }

  const deployments = [];

  for (const app of apps) {
    // Verify signature if secret is configured
    if (app.webhookSecret) {
      if (!verifySignature(rawBody, signature, app.webhookSecret)) {
        logger.warn("Invalid Gitea webhook signature", { appId: app.id });
        continue;
      }
    }

    // Check watch paths
    if (app.watchPaths) {
      const watchPaths = JSON.parse(app.watchPaths) as string[];
      const changedFiles = commits.flatMap((c) => [
        ...c.added,
        ...c.modified,
        ...c.removed,
      ]);

      const shouldDeploy = changedFiles.some((file) =>
        watchPaths.some((path) => {
          if (path.endsWith("*")) {
            return file.startsWith(path.slice(0, -1));
          }
          return file === path || file.startsWith(path + "/");
        })
      );

      if (!shouldDeploy) {
        logger.info("No matching watch paths", { appId: app.id });
        continue;
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
        commit: after,
        branch,
        commitMessage: head_commit?.message,
        commitAuthor: head_commit?.author.name,
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

    logger.info("Gitea deployment queued", {
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
  payload: GiteaPullRequestEvent,
  rawBody: string,
  signature: string | null
) {
  const { action, pull_request, repository } = payload;

  logger.info("Processing Gitea pull request event", {
    repo: repository.full_name,
    action,
    prNumber: pull_request.number,
  });

  // Handle opened, synchronized, and reopened
  if (!["opened", "synchronized", "reopened"].includes(action)) {
    if (action === "closed") {
      return handlePullRequestClosed(payload);
    }
    return NextResponse.json({ message: "Action ignored" });
  }

  // Find applications with preview deployments enabled
  const apps = await db.query.applications.findMany({
    where: and(
      eq(applications.gitRepository, repository.full_name),
      eq(applications.branch, pull_request.base.ref),
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
    // Verify signature
    if (app.webhookSecret) {
      if (!verifySignature(rawBody, signature, app.webhookSecret)) {
        logger.warn("Invalid Gitea webhook signature for PR", { appId: app.id });
        continue;
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
        commit: pull_request.head.sha,
        branch: pull_request.head.ref,
        isPullRequest: true,
        pullRequestNumber: pull_request.number,
      })
      .returning();

    await queue.add("deployment", {
      deploymentId: deployment.id,
      applicationId: app.id,
      serverId: app.serverId,
      isPreview: true,
      prNumber: pull_request.number,
    });

    deployments.push({
      deploymentId: deployment.id,
      applicationId: app.id,
      pullRequest: pull_request.number,
    });

    logger.info("Gitea PR preview deployment queued", {
      deploymentId: deployment.id,
      appId: app.id,
      prNumber: pull_request.number,
    });
  }

  return NextResponse.json({
    message: `Queued ${deployments.length} PR preview deployment(s)`,
    deployments,
  });
}

async function handlePullRequestClosed(payload: GiteaPullRequestEvent) {
  const { pull_request, repository } = payload;

  logger.info("Handling Gitea PR closure", {
    repo: repository.full_name,
    prNumber: pull_request.number,
  });

  // Find applications with preview deployments enabled
  const apps = await db.query.applications.findMany({
    where: and(
      eq(applications.gitRepository, repository.full_name),
      eq(applications.previewDeploymentsEnabled, true),
      isNull(applications.deletedAt)
    ),
  });

  // Queue cleanup jobs for each application
  const cleanupJobs = await Promise.all(
    apps.map((app) =>
      queuePreviewCleanup({
        applicationId: app.id,
        pullRequestId: pull_request.number,
        repositoryFullName: repository.full_name,
      })
    )
  );

  logger.info("Queued preview cleanup jobs", {
    repo: repository.full_name,
    prNumber: pull_request.number,
    jobCount: cleanupJobs.length,
  });

  return NextResponse.json({
    message: "PR closed, cleanup initiated",
    pullRequest: pull_request.number,
    applicationsAffected: apps.length,
    cleanupJobIds: cleanupJobs,
  });
}
