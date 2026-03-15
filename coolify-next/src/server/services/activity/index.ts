import { db } from "@/server/db";
import { activityLogs } from "@/server/db/schema/advanced";
import { logger } from "@/lib/logger";

export interface ActivityLogData {
  userId?: string;
  teamId: string;
  ipAddress?: string;
  userAgent?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  description?: string;
  properties?: {
    old?: Record<string, unknown>;
    new?: Record<string, unknown>;
    changes?: Record<string, { from: unknown; to: unknown }>;
  };
  metadata?: Record<string, unknown>;
}

class ActivityService {
  /**
   * Log an activity
   */
  async log(data: ActivityLogData): Promise<void> {
    try {
      await db.insert(activityLogs).values({
        userId: data.userId,
        teamId: data.teamId,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        action: data.action,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        resourceName: data.resourceName,
        description: data.description,
        properties: data.properties ? JSON.stringify(data.properties) : null,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      });
    } catch (error) {
      // Don't throw - activity logging should not break main flow
      logger.error("Failed to log activity", { error, data });
    }
  }

  /**
   * Log a resource creation
   */
  async logCreated(
    teamId: string,
    resourceType: string,
    resourceId: string,
    resourceName: string,
    userId?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      teamId,
      userId,
      action: "created",
      resourceType,
      resourceId,
      resourceName,
      description: `Created ${resourceType}: ${resourceName}`,
      metadata,
    });
  }

  /**
   * Log a resource update
   */
  async logUpdated(
    teamId: string,
    resourceType: string,
    resourceId: string,
    resourceName: string,
    changes: Record<string, { from: unknown; to: unknown }>,
    userId?: string
  ): Promise<void> {
    const changedFields = Object.keys(changes);
    await this.log({
      teamId,
      userId,
      action: "updated",
      resourceType,
      resourceId,
      resourceName,
      description: `Updated ${resourceType}: ${resourceName} (${changedFields.join(", ")})`,
      properties: { changes },
    });
  }

  /**
   * Log a resource deletion
   */
  async logDeleted(
    teamId: string,
    resourceType: string,
    resourceId: string,
    resourceName: string,
    userId?: string
  ): Promise<void> {
    await this.log({
      teamId,
      userId,
      action: "deleted",
      resourceType,
      resourceId,
      resourceName,
      description: `Deleted ${resourceType}: ${resourceName}`,
    });
  }

  /**
   * Log a deployment
   */
  async logDeployment(
    teamId: string,
    applicationId: string,
    applicationName: string,
    status: "started" | "completed" | "failed",
    deploymentId: string,
    userId?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      teamId,
      userId,
      action: `deployment_${status}`,
      resourceType: "application",
      resourceId: applicationId,
      resourceName: applicationName,
      description: `Deployment ${status}: ${applicationName}`,
      metadata: {
        deploymentId,
        ...metadata,
      },
    });
  }

  /**
   * Log a backup
   */
  async logBackup(
    teamId: string,
    databaseId: string,
    databaseName: string,
    status: "started" | "completed" | "failed",
    backupId?: string,
    userId?: string
  ): Promise<void> {
    await this.log({
      teamId,
      userId,
      action: `backup_${status}`,
      resourceType: "database",
      resourceId: databaseId,
      resourceName: databaseName,
      description: `Backup ${status}: ${databaseName}`,
      metadata: backupId ? { backupId } : undefined,
    });
  }

  /**
   * Log authentication events
   */
  async logAuth(
    teamId: string,
    userId: string,
    action: "login" | "logout" | "password_changed" | "2fa_enabled" | "2fa_disabled",
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.log({
      teamId,
      userId,
      action,
      resourceType: "user",
      resourceId: userId,
      description: `User ${action.replace("_", " ")}`,
      ipAddress,
      userAgent,
    });
  }

  /**
   * Log team events
   */
  async logTeamEvent(
    teamId: string,
    action: "member_added" | "member_removed" | "role_changed" | "settings_updated",
    targetUserId?: string,
    userId?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      teamId,
      userId,
      action,
      resourceType: "team",
      resourceId: teamId,
      description: `Team ${action.replace("_", " ")}`,
      metadata: {
        targetUserId,
        ...metadata,
      },
    });
  }

  /**
   * Log server events
   */
  async logServerEvent(
    teamId: string,
    serverId: string,
    serverName: string,
    action: "connected" | "disconnected" | "validated" | "proxy_started" | "proxy_stopped",
    userId?: string
  ): Promise<void> {
    await this.log({
      teamId,
      userId,
      action: `server_${action}`,
      resourceType: "server",
      resourceId: serverId,
      resourceName: serverName,
      description: `Server ${action}: ${serverName}`,
    });
  }

  /**
   * Get recent activity for a team
   */
  async getRecentActivity(
    teamId: string,
    limit = 50,
    offset = 0
  ): Promise<typeof activityLogs.$inferSelect[]> {
    return db.query.activityLogs.findMany({
      where: (logs, { eq }) => eq(logs.teamId, teamId),
      orderBy: (logs, { desc }) => [desc(logs.createdAt)],
      limit,
      offset,
    });
  }

  /**
   * Get activity for a specific resource
   */
  async getResourceActivity(
    resourceType: string,
    resourceId: string,
    limit = 50
  ): Promise<typeof activityLogs.$inferSelect[]> {
    return db.query.activityLogs.findMany({
      where: (logs, { and, eq }) =>
        and(eq(logs.resourceType, resourceType), eq(logs.resourceId, resourceId)),
      orderBy: (logs, { desc }) => [desc(logs.createdAt)],
      limit,
    });
  }
}

export const activityService = new ActivityService();
