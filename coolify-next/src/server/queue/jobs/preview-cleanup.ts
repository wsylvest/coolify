/**
 * Preview Environment Cleanup Job
 *
 * Handles cleanup of preview deployments when PRs are closed/merged.
 */

import { Job, Worker, Queue } from "bullmq";
import { db } from "@/server/db";
import { applications, applicationPreviews } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { sshService } from "@/server/services/ssh";
import { proxyService } from "@/server/services/proxy";
import { logger } from "@/lib/logger";
import { createQueue } from "../index";

export interface PreviewCleanupJobData {
  applicationId: string;
  pullRequestId: number;
  repositoryFullName: string;
}

export const previewCleanupQueue = createQueue<PreviewCleanupJobData>("preview-cleanup");

export function createPreviewCleanupWorker(redisConnection: { host: string; port: number }) {
  const worker = new Worker<PreviewCleanupJobData>(
    "preview-cleanup",
    async (job: Job<PreviewCleanupJobData>) => {
      const { applicationId, pullRequestId, repositoryFullName } = job.data;

      logger.info("Starting preview cleanup", {
        applicationId,
        pullRequestId,
        repositoryFullName,
      });

      try {
        // Get application with server details
        const application = await db.query.applications.findFirst({
          where: eq(applications.id, applicationId),
          with: {
            destination: {
              with: {
                server: {
                  with: {
                    privateKey: true,
                  },
                },
              },
            },
            previews: {
              where: eq(applicationPreviews.pullRequestId, pullRequestId),
            },
          },
        });

        if (!application) {
          logger.warn("Application not found for preview cleanup", { applicationId });
          return;
        }

        const server = application.destination?.server;
        if (!server?.privateKey) {
          logger.warn("Server or private key not configured", { applicationId });
          return;
        }

        const sshConfig = {
          host: server.ip,
          port: server.port,
          username: server.user,
          privateKey: server.privateKey.privateKey,
        };

        // Find and remove preview containers
        for (const preview of application.previews ?? []) {
          const containerName = `coolify-preview-${application.uuid}-pr${pullRequestId}`;

          logger.info("Removing preview container", { containerName, previewId: preview.id });

          // Stop and remove container
          await sshService.executeCommand({
            ...sshConfig,
            command: `docker stop ${containerName} 2>/dev/null || true && docker rm ${containerName} 2>/dev/null || true`,
          });

          // Remove preview-specific volumes
          await sshService.executeCommand({
            ...sshConfig,
            command: `docker volume rm ${containerName}-data 2>/dev/null || true`,
          });

          // Clean up proxy configuration for preview domain
          if (preview.fqdn) {
            try {
              await proxyService.removeDomain({
                serverId: server.id,
                domain: preview.fqdn,
              });
              logger.info("Removed proxy configuration for preview", { fqdn: preview.fqdn });
            } catch (error) {
              logger.warn("Failed to remove proxy config", { fqdn: preview.fqdn, error });
            }
          }

          // Update preview status in database
          await db
            .update(applicationPreviews)
            .set({
              status: "deleted",
              deletedAt: new Date(),
            })
            .where(eq(applicationPreviews.id, preview.id));
        }

        // Clean up preview directory
        const previewDir = `/data/coolify/applications/${application.uuid}/previews/pr${pullRequestId}`;
        await sshService.executeCommand({
          ...sshConfig,
          command: `rm -rf ${previewDir}`,
        });

        logger.info("Preview cleanup completed", {
          applicationId,
          pullRequestId,
          previewsRemoved: application.previews?.length ?? 0,
        });

      } catch (error) {
        logger.error("Preview cleanup failed", {
          error,
          applicationId,
          pullRequestId,
        });
        throw error;
      }
    },
    {
      connection: redisConnection,
      concurrency: 5,
    }
  );

  worker.on("completed", (job) => {
    logger.info(`Preview cleanup job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    logger.error(`Preview cleanup job ${job?.id} failed:`, err);
  });

  return worker;
}

/**
 * Queue preview cleanup for an application/PR
 */
export async function queuePreviewCleanup(data: PreviewCleanupJobData): Promise<string> {
  const job = await previewCleanupQueue.add("cleanup", data, {
    removeOnComplete: 100,
    removeOnFail: 100,
  });
  return job.id ?? "";
}
