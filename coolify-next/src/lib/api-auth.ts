import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { apiTokens, teams, users } from "@/server/db/schema";
import { eq, and, gt } from "drizzle-orm";
import crypto from "crypto";

export interface ApiToken {
  id: string;
  name: string;
  token: string;
  abilities: string[];
  userId: string;
  teamId: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

export interface AuthResult {
  success: boolean;
  token?: ApiToken;
  error?: string;
}

/**
 * Verify API token from request headers
 */
export async function verifyApiToken(
  request: NextRequest,
  requiredAbilities: string[] = ["read"]
): Promise<AuthResult> {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader) {
    return { success: false, error: "Missing Authorization header" };
  }

  const [type, tokenValue] = authHeader.split(" ");

  if (type !== "Bearer" || !tokenValue) {
    return { success: false, error: "Invalid Authorization header format" };
  }

  // Hash the token for lookup
  const hashedToken = crypto
    .createHash("sha256")
    .update(tokenValue)
    .digest("hex");

  const token = await db.query.apiTokens.findFirst({
    where: and(
      eq(apiTokens.token, hashedToken),
      gt(apiTokens.expiresAt, new Date())
    ),
  });

  if (!token) {
    return { success: false, error: "Invalid or expired token" };
  }

  // Check abilities
  const tokenAbilities = JSON.parse(token.abilities) as string[];
  const hasAllAbilities = requiredAbilities.every(
    (ability) => tokenAbilities.includes(ability) || tokenAbilities.includes("*")
  );

  if (!hasAllAbilities) {
    return {
      success: false,
      error: `Missing required abilities: ${requiredAbilities.join(", ")}`,
    };
  }

  // Update last used timestamp
  await db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, token.id));

  return {
    success: true,
    token: {
      id: token.id,
      name: token.name,
      token: token.token,
      abilities: tokenAbilities,
      userId: token.userId,
      teamId: token.teamId,
      lastUsedAt: token.lastUsedAt,
      expiresAt: token.expiresAt,
    },
  };
}

/**
 * Get team from API token
 */
export async function getTeamFromToken(
  token: ApiToken
): Promise<{ id: string; name: string } | null> {
  const team = await db.query.teams.findFirst({
    where: eq(teams.id, token.teamId),
  });

  if (!team) {
    return null;
  }

  return {
    id: team.id,
    name: team.name,
  };
}

/**
 * Get user from API token
 */
export async function getUserFromToken(
  token: ApiToken
): Promise<{ id: string; email: string; name: string | null } | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, token.userId),
  });

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

/**
 * Generate a new API token
 */
export function generateApiToken(): { plain: string; hashed: string } {
  const plain = crypto.randomBytes(32).toString("hex");
  const hashed = crypto.createHash("sha256").update(plain).digest("hex");
  return { plain, hashed };
}

/**
 * Verify webhook signature (GitHub)
 */
export function verifyGitHubSignature(
  payload: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) {
    return false;
  }

  const expectedSignature = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex")}`;

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Verify webhook signature (GitLab)
 */
export function verifyGitLabSignature(
  tokenHeader: string | null,
  secret: string
): boolean {
  if (!tokenHeader) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(tokenHeader),
    Buffer.from(secret)
  );
}
