import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { applications, gitlabApps, deploymentQueue } from "@/server/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { verifyGitLabSignature } from "@/lib/api-auth";
import { deploymentQueue as queue } from "@/server/queue";
import { createId } from "@paralleldrive/cuid2";
import { logger } from "@/lib/logger";

interface GitLabPushEvent {
  object_kind: "push";
  ref: string;
  before: string;
  after: string;
  checkout_sha: string;
  project: {
    id: number;
    path_with_namespace: string;
    web_url: string;
    default_branch: string;
  };
  commits: {
    id: string;
    message: string;
    author: {
      name: string;
      email: string;
    };
    added: string[];
    modified: string[];
    removed: string[];
  }[];
  total_commits_count: number;
  user_name: string;
  user_email: string;
}

interface GitLabMergeRequestEvent {
  object_kind: "merge_request";
  event_type: string;
  object_attributes: {
    id: number;
    iid: number;
    title: string;
    state: string;
    action: string;
    source_branch: string;
    target_branch: string;
    last_commit: {
      id: string;
      message: string;
    };
  };
  project: {
    id: number;
    path_with_namespace: string;
  };
}

// POST /api/webhooks/gitlab - Handle GitLab webhooks
export async function POST(request: NextRequest) {
  const token = request.headers.get("X-Gitlab-Token");
  const event = request.headers.get("X-Gitlab-Event");

  logger.info("GitLab webhook received", { event });

  const rawBody = await request.text();

  let payload: GitLabPushEvent | GitLabMergeRequestEvent;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  // Handle different event types
  switch (payload.object_kind) {
    case "push":
      return handlePushEvent(payload as GitLabPushEvent, token);
    case "merge_request":
      return handleMergeRequestEvent(
        payload as GitLabMergeRequestEvent,
        token
      );
    default:
      logger.info("Unhandled GitLab event", { event: payload.object_kind });
      return NextResponse.json({ message: "Event ignored" });
  }
}

async function handlePushEvent(payload: GitLabPushEvent, token: string | null) {
  const { ref, after, project, commits } = payload;

  // Extract branch name from ref
  const branch = ref.replace("refs/heads/", "");

  logger.info("Processing GitLab push event", {
    repo: project.path_with_namespace,
    branch,
    commit: after,
  });

  // Find applications that use this repository and branch
  const apps = await db.query.applications.findMany({
    where: and(
      eq(applications.gitRepository, project.path_with_namespace),
      eq(applications.branch, branch),
      eq(applications.autoDeploy, true),
      isNull(applications.deletedAt)
    ),
    with: {
      server: true,
      gitlabApp: true,
    },
  });

  if (apps.length === 0) {
    logger.info("No applications found for GitLab repository/branch", {
      repo: project.path_with_namespace,
      branch,
    });
    return NextResponse.json({
      message: "No applications found",
      repository: project.path_with_namespace,
      branch,
    });
  }

  const deployments = [];

  for (const app of apps) {
    // Verify token if configured
    if (app.gitlabApp?.webhookSecret) {
      const isValid = verifyGitLabSignature(token, app.gitlabApp.webhookSecret);

      if (!isValid) {
        logger.warn("Invalid GitLab webhook token", { appId: app.id });
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
    const lastCommit = commits[0];

    const [deployment] = await db
      .insert(deploymentQueue)
      .values({
        id: deploymentId,
        applicationId: app.id,
        status: "queued",
        triggeredBy: "webhook",
        commit: after,
        branch,
        commitMessage: lastCommit?.message,
        commitAuthor: lastCommit?.author.name,
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

    logger.info("GitLab deployment queued", {
      deploymentId: deployment.id,
      appId: app.id,
    });
  }

  return NextResponse.json({
    message: `Queued ${deployments.length} deployment(s)`,
    deployments,
  });
}

async function handleMergeRequestEvent(
  payload: GitLabMergeRequestEvent,
  token: string | null
) {
  const { object_attributes, project } = payload;
  const { action, source_branch, target_branch, iid, last_commit } =
    object_attributes;

  logger.info("Processing GitLab merge request event", {
    repo: project.path_with_namespace,
    action,
    mrNumber: iid,
  });

  // Only handle open, update, and reopen actions
  if (!["open", "update", "reopen"].includes(action)) {
    if (action === "close" || action === "merge") {
      return handleMergeRequestClosed(payload);
    }
    return NextResponse.json({ message: "Action ignored" });
  }

  // Find applications with MR previews enabled
  const apps = await db.query.applications.findMany({
    where: and(
      eq(applications.gitRepository, project.path_with_namespace),
      eq(applications.branch, target_branch),
      eq(applications.previewDeploymentsEnabled, true),
      isNull(applications.deletedAt)
    ),
    with: {
      server: true,
      gitlabApp: true,
    },
  });

  if (apps.length === 0) {
    return NextResponse.json({
      message: "No applications with preview deployments enabled",
    });
  }

  const deployments = [];

  for (const app of apps) {
    // Verify token if configured
    if (app.gitlabApp?.webhookSecret) {
      const isValid = verifyGitLabSignature(token, app.gitlabApp.webhookSecret);

      if (!isValid) {
        logger.warn("Invalid GitLab webhook token for MR", { appId: app.id });
        continue;
      }
    }

    // Create preview deployment
    const deploymentId = createId();

    const [deployment] = await db
      .insert(deploymentQueue)
      .values({
        id: deploymentId,
        applicationId: app.id,
        status: "queued",
        triggeredBy: "webhook",
        commit: last_commit.id,
        branch: source_branch,
        isPullRequest: true,
        pullRequestNumber: iid,
      })
      .returning();

    // Queue the deployment
    await queue.add("deployment", {
      deploymentId: deployment.id,
      applicationId: app.id,
      serverId: app.serverId,
      isPreview: true,
      prNumber: iid,
    });

    deployments.push({
      deploymentId: deployment.id,
      applicationId: app.id,
      mergeRequest: iid,
    });

    logger.info("GitLab MR preview deployment queued", {
      deploymentId: deployment.id,
      appId: app.id,
      mrNumber: iid,
    });
  }

  return NextResponse.json({
    message: `Queued ${deployments.length} MR preview deployment(s)`,
    deployments,
  });
}

async function handleMergeRequestClosed(payload: GitLabMergeRequestEvent) {
  const { object_attributes, project } = payload;

  logger.info("Handling MR closure", {
    repo: project.path_with_namespace,
    mrNumber: object_attributes.iid,
  });

  // Find applications and clean up preview environments
  const apps = await db.query.applications.findMany({
    where: and(
      eq(applications.gitRepository, project.path_with_namespace),
      eq(applications.previewDeploymentsEnabled, true),
      isNull(applications.deletedAt)
    ),
  });

  // TODO: Queue cleanup jobs to remove preview containers/resources

  return NextResponse.json({
    message: "MR closed, cleanup initiated",
    mergeRequest: object_attributes.iid,
    applicationsAffected: apps.length,
  });
}
