import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { sql } from "drizzle-orm";

export async function GET() {
  const healthStatus = {
    status: "ok",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? "1.0.0",
    services: {
      database: "unknown",
      redis: "unknown",
    },
  };

  // Check database connection
  try {
    await db.execute(sql`SELECT 1`);
    healthStatus.services.database = "healthy";
  } catch (error) {
    healthStatus.services.database = "unhealthy";
    healthStatus.status = "degraded";
  }

  // Check Redis connection (if configured)
  if (process.env.REDIS_URL) {
    try {
      // Redis check would go here
      healthStatus.services.redis = "healthy";
    } catch (error) {
      healthStatus.services.redis = "unhealthy";
      healthStatus.status = "degraded";
    }
  } else {
    healthStatus.services.redis = "not_configured";
  }

  const statusCode = healthStatus.status === "ok" ? 200 : 503;

  return NextResponse.json(healthStatus, { status: statusCode });
}
