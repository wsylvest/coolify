import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { applications, githubApps, deploymentQueue } from "@/server/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { verifyGitHubSignature } from "@/lib/api-auth";
import { deploymentQueue as queue } from "@/server/queue";
import { queuePreviewCleanup } from "@/server/queue/jobs/preview-cleanup";
import { createId } from "@paralleldrive/cuid2";
import { logger } from "@/lib/logger";

interface GitHubPushEvent {
  ref: string;
  before: string;
  after: string;
  repository: {
    id: number;
    full_name: string;
    html_url: string;
    default_branch: string;
  };
  pusher: {
    name: string;
    email: string;
  };
  head_commit: {
    id: string;
    message: string;
    author: {
      name: string;
      email: string;
    };
  } | null;
  commits: {
    id: string;
    message: string;
    added: string[];
    removed: string[];
    modified: string[];
  }[];
}

interface GitHubPullRequestEvent {
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

// POST /api/webhooks/github - Handle GitHub webhooks
export async function POST(request: NextRequest) {
  const signature = request.headers.get("X-Hub-Signature-256");
  const event = request.headers.get("X-GitHub-Event");
  const deliveryId = request.headers.get("X-GitHub-Delivery");

  logger.info("GitHub webhook received", { event, deliveryId });

  // Get raw body for signature verification
  const rawBody = await request.text();

  // Find applications that match this webhook
  let payload: GitHubPushEvent | GitHubPullRequestEvent;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  // Handle different event types
  switch (event) {
    case "push":
      return handlePushEvent(payload as GitHubPushEvent, rawBody, signature);
    case "pull_request":
      return handlePullRequestEvent(
        payload as GitHubPullRequestEvent,
        rawBody,
        signature
      );
    case "ping":
      return NextResponse.json({ message: "pong" });
    default:
      logger.info("Unhandled GitHub event", { event });
      return NextResponse.json({ message: "Event ignored" });
  }
}

async function handlePushEvent(
  payload: GitHubPushEvent,
  rawBody: string,
  signature: string | null
) {
  const { ref, after, repository, head_commit, commits } = payload;

  // Extract branch name from ref
  const branch = ref.replace("refs/heads/", "");

  logger.info("Processing push event", {
    repo: repository.full_name,
    branch,
    commit: after,
  });

  // Find applications that use this repository and branch
  const apps = await db.query.applications.findMany({
    where: and(
      eq(applications.gitRepository, repository.full_name),
      eq(applications.branch, branch),
      eq(applications.autoDeploy, true),
      isNull(applications.deletedAt)
    ),
    with: {
      server: true,
      githubApp: true,
    },
  });

  if (apps.length === 0) {
    logger.info("No applications found for repository/branch", {
      repo: repository.full_name,
      branch,
    });
    return NextResponse.json({
      message: "No applications found",
      repository: repository.full_name,
      branch,
    });
  }

  const deployments = [];

  for (const app of apps) {
    // Verify signature if webhook secret is configured
    if (app.githubApp?.webhookSecret) {
      const isValid = verifyGitHubSignature(
        rawBody,
        signature,
        app.githubApp.webhookSecret
      );

      if (!isValid) {
        logger.warn("Invalid webhook signature", { appId: app.id });
        continue;
      }
    }

    // Check watch paths if configured
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

    // Create deployment
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

    // Queue the deployment
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

    logger.info("Deployment queued", {
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
  payload: GitHubPullRequestEvent,
  rawBody: string,
  signature: string | null
) {
  const { action, pull_request, repository } = payload;

  logger.info("Processing pull request event", {
    repo: repository.full_name,
    action,
    prNumber: pull_request.number,
  });

  // Only handle opened, synchronize (new commits), and reopened events
  if (!["opened", "synchronize", "reopened"].includes(action)) {
    if (action === "closed") {
      // Handle PR closure - clean up preview environments
      return handlePullRequestClosed(payload);
    }
    return NextResponse.json({ message: "Action ignored" });
  }

  // Find applications that have PR previews enabled for this repository
  const apps = await db.query.applications.findMany({
    where: and(
      eq(applications.gitRepository, repository.full_name),
      eq(applications.branch, pull_request.base.ref),
      eq(applications.previewDeploymentsEnabled, true),
      isNull(applications.deletedAt)
    ),
    with: {
      server: true,
      githubApp: true,
    },
  });

  if (apps.length === 0) {
    return NextResponse.json({
      message: "No applications with preview deployments enabled",
    });
  }

  const deployments = [];

  for (const app of apps) {
    // Verify signature if configured
    if (app.githubApp?.webhookSecret) {
      const isValid = verifyGitHubSignature(
        rawBody,
        signature,
        app.githubApp.webhookSecret
      );

      if (!isValid) {
        logger.warn("Invalid webhook signature for PR", { appId: app.id });
        continue;
      }
    }

    // Create or update preview deployment
    const deploymentId = createId();
    const previewBranch = pull_request.head.ref;

    const [deployment] = await db
      .insert(deploymentQueue)
      .values({
        id: deploymentId,
        applicationId: app.id,
        status: "queued",
        triggeredBy: "webhook",
        commit: pull_request.head.sha,
        branch: previewBranch,
        isPullRequest: true,
        pullRequestNumber: pull_request.number,
      })
      .returning();

    // Queue the deployment
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

    logger.info("PR preview deployment queued", {
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

async function handlePullRequestClosed(payload: GitHubPullRequestEvent) {
  const { pull_request, repository } = payload;

  logger.info("Handling PR closure", {
    repo: repository.full_name,
    prNumber: pull_request.number,
  });

  // Find applications and clean up preview environments
  const apps = await db.query.applications.findMany({
    where: and(
      eq(applications.gitRepository, repository.full_name),
      eq(applications.previewDeploymentsEnabled, true),
      isNull(applications.deletedAt)
    ),
  });

  // Queue cleanup jobs for each application with preview deployments
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
