import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { servers } from "@/server/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { verifyApiToken, getTeamFromToken } from "@/lib/api-auth";

// GET /api/v1/servers/:serverId - Get server by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const { serverId } = await params;

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

  const server = await db.query.servers.findFirst({
    where: and(
      eq(servers.id, serverId),
      eq(servers.teamId, team.id),
      isNull(servers.deletedAt)
    ),
    with: {
      destinations: true,
    },
  });

  if (!server) {
    return NextResponse.json(
      { error: "Server not found" },
      { status: 404 }
    );
  }

  // Remove sensitive data
  const { privateKeyId, ...safeServer } = server;

  return NextResponse.json({ data: safeServer });
}

// PATCH /api/v1/servers/:serverId - Update server
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const { serverId } = await params;

  const authResult = await verifyApiToken(request, ["write"]);
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
    name: z.string().min(2).max(255).optional(),
    description: z.string().optional(),
    ip: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    user: z.string().optional(),
    privateKeyId: z.string().optional(),
    proxyType: z.enum(["traefik", "caddy", "none"]).optional(),
  });

  const parseResult = schema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parseResult.error.errors },
      { status: 400 }
    );
  }

  // Verify server belongs to team
  const existingServer = await db.query.servers.findFirst({
    where: and(
      eq(servers.id, serverId),
      eq(servers.teamId, team.id),
      isNull(servers.deletedAt)
    ),
  });

  if (!existingServer) {
    return NextResponse.json(
      { error: "Server not found" },
      { status: 404 }
    );
  }

  const [updated] = await db
    .update(servers)
    .set({
      ...parseResult.data,
      updatedAt: new Date(),
    })
    .where(eq(servers.id, serverId))
    .returning();

  return NextResponse.json({ data: updated });
}

// DELETE /api/v1/servers/:serverId - Delete server
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const { serverId } = await params;

  const authResult = await verifyApiToken(request, ["write"]);
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

  // Verify server belongs to team
  const server = await db.query.servers.findFirst({
    where: and(
      eq(servers.id, serverId),
      eq(servers.teamId, team.id),
      isNull(servers.deletedAt)
    ),
  });

  if (!server) {
    return NextResponse.json(
      { error: "Server not found" },
      { status: 404 }
    );
  }

  // Soft delete
  await db
    .update(servers)
    .set({ deletedAt: new Date() })
    .where(eq(servers.id, serverId));

  return NextResponse.json({ success: true });
}
