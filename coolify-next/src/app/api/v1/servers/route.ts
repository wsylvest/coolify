import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { servers, privateKeys } from "@/server/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { verifyApiToken, getTeamFromToken } from "@/lib/api-auth";

// GET /api/v1/servers - List all servers
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

  const teamServers = await db.query.servers.findMany({
    where: and(
      eq(servers.teamId, team.id),
      isNull(servers.deletedAt)
    ),
    columns: {
      id: true,
      uuid: true,
      name: true,
      description: true,
      ip: true,
      port: true,
      user: true,
      proxyType: true,
      isReachable: true,
      validationStatus: true,
      lastOnlineAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ data: teamServers });
}

// POST /api/v1/servers - Create a new server
export async function POST(request: NextRequest) {
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
    name: z.string().min(2).max(255),
    description: z.string().optional(),
    ip: z.string().min(1),
    port: z.number().int().min(1).max(65535).default(22),
    user: z.string().default("root"),
    privateKeyId: z.string(),
    proxyType: z.enum(["traefik", "caddy", "none"]).default("traefik"),
  });

  const parseResult = schema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parseResult.error.errors },
      { status: 400 }
    );
  }

  const input = parseResult.data;

  // Verify private key belongs to team
  const privateKey = await db.query.privateKeys.findFirst({
    where: and(
      eq(privateKeys.id, input.privateKeyId),
      eq(privateKeys.teamId, team.id)
    ),
  });

  if (!privateKey) {
    return NextResponse.json(
      { error: "Private key not found" },
      { status: 404 }
    );
  }

  const [server] = await db
    .insert(servers)
    .values({
      teamId: team.id,
      name: input.name,
      description: input.description,
      ip: input.ip,
      port: input.port,
      user: input.user,
      privateKeyId: input.privateKeyId,
      proxyType: input.proxyType,
    })
    .returning();

  return NextResponse.json({ data: server }, { status: 201 });
}
