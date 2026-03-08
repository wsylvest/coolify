import { NextResponse } from "next/server";

// API v1 root endpoint - returns API info
export async function GET() {
  return NextResponse.json({
    name: "Coolify API",
    version: "1.0.0",
    documentation: "/api/v1/docs",
    endpoints: {
      health: "/api/v1/health",
      servers: "/api/v1/servers",
      projects: "/api/v1/projects",
      applications: "/api/v1/applications",
      databases: "/api/v1/databases",
      services: "/api/v1/services",
      deployments: "/api/v1/deployments",
      teams: "/api/v1/teams",
    },
  });
}
