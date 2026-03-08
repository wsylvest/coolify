import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { applications, deploymentQueue } from "@/server/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { verifyApiToken, getTeamFromToken } from "@/lib/api-auth";
import { deploymentQueue as queue } from "@/server/queue";
import { createId } from "@paralleldrive/cuid2";

// POST /api/v1/deploy - Trigger deployment
export async function POST(request: NextRequest) {
  const authResult = await verifyApiToken(request, ["deploy"]);
  if (!authResult.success) {
    return NextResponse.json(
      { error: authResult.error },
      { status: 401 }
    );
  }

  const team = await getTeamFromToken(authResult.token!);
  if (!team) {
    return NextResponse.json(
      { error: "Team not found" },
      { status: 404 }
    );
  }

  const body = await request.json();

  const schema = z.object({
    uuid: z.string().optional(),
    tag: z.string().optional(),
    force: z.boolean().default(false),
    rollback: z.boolean().default(false),
    commit: z.string().optional(),
    branch: z.string().optional(),
  });

  const parseResult = schema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parseResult.error.errors },
      { status: 400 }
    );
  }

  const input = parseResult.data;

  if (!input.uuid && !input.tag) {
    return NextResponse.json(
      { error: "Either uuid or tag must be provided" },
      { status: 400 }
    );
  }

  // Find application by UUID or tag
  let application;
  if (input.uuid) {
    application = await db.query.applications.findFirst({
      where: and(
        eq(applications.uuid, input.uuid),
        isNull(applications.deletedAt)
      ),
      with: {
        environment: {
          with: {
            project: true,
          },
        },
        server: true,
      },
    });
  } else if (input.tag) {
    // Find by tag - this would require a tags relationship
    // For now, we'll search by name containing the tag
    application = await db.query.applications.findFirst({
      where: and(
        eq(applications.name, input.tag),
        isNull(applications.deletedAt)
      ),
      with: {
        environment: {
          with: {
            project: true,
          },
        },
        server: true,
      },
    });
  }

  if (!application) {
    return NextResponse.json(
      { error: "Application not found" },
      { status: 404 }
    );
  }

  // Verify team has access
  if (application.environment.project.teamId !== team.id) {
    return NextResponse.json(
      { error: "Application not found" },
      { status: 404 }
    );
  }

  // Create deployment
  const deploymentId = createId();

  const [deployment] = await db
    .insert(deploymentQueue)
    .values({
      id: deploymentId,
      applicationId: application.id,
      status: "queued",
      triggeredBy: "api",
      commit: input.commit,
      branch: input.branch ?? application.branch,
      force: input.force,
      rollback: input.rollback,
    })
    .returning();

  // Queue the deployment job
  await queue.add("deployment", {
    deploymentId: deployment.id,
    applicationId: application.id,
    serverId: application.serverId,
    force: input.force,
    rollback: input.rollback,
  });

  return NextResponse.json({
    data: {
      deploymentId: deployment.id,
      applicationId: application.id,
      applicationUuid: application.uuid,
      status: "queued",
      message: "Deployment queued successfully",
    },
  });
}

// GET /api/v1/deploy - Get deployment status
export async function GET(request: NextRequest) {
  const authResult = await verifyApiToken(request);
  if (!authResult.success) {
    return NextResponse.json(
      { error: authResult.error },
      { status: 401 }
    );
  }

  const team = await getTeamFromToken(authResult.token!);
  if (!team) {
    return NextResponse.json(
      { error: "Team not found" },
      { status: 404 }
    );
  }

  const { searchParams } = new URL(request.url);
  const deploymentId = searchParams.get("deploymentId");

  if (!deploymentId) {
    return NextResponse.json(
      { error: "deploymentId query parameter is required" },
      { status: 400 }
    );
  }

  const deployment = await db.query.deploymentQueue.findFirst({
    where: eq(deploymentQueue.id, deploymentId),
    with: {
      application: {
        with: {
          environment: {
            with: {
              project: true,
            },
          },
        },
      },
    },
  });

  if (!deployment) {
    return NextResponse.json(
      { error: "Deployment not found" },
      { status: 404 }
    );
  }

  // Verify team has access
  if (deployment.application.environment.project.teamId !== team.id) {
    return NextResponse.json(
      { error: "Deployment not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    data: {
      id: deployment.id,
      applicationId: deployment.applicationId,
      status: deployment.status,
      commit: deployment.commit,
      branch: deployment.branch,
      startedAt: deployment.startedAt,
      finishedAt: deployment.finishedAt,
      logs: deployment.logs,
    },
  });
}
