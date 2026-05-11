/**
 * Service Worker
 *
 * Handles Docker Compose service start/stop/restart operations.
 */

import { Worker, type Job, type ConnectionOptions } from "bullmq";
import type IORedis from "ioredis";
import { logger } from "../src/lib/logger";
import { db } from "../src/server/db";
import { services, standaloneDockers, servers } from "../src/server/db/schema";
import { eq } from "drizzle-orm";
import { sshService } from "../src/server/services/ssh";
import { realtimeService } from "../src/server/services/realtime";

export interface ServiceStartJobData {
  type: "start";
  serviceId: string;
}

export interface ServiceStopJobData {
  type: "stop";
  serviceId: string;
}

export interface ServiceRestartJobData {
  type: "restart";
  serviceId: string;
}

export type ServiceJobData = ServiceStartJobData | ServiceStopJobData | ServiceRestartJobData;

export function createServiceWorker(redis: IORedis.Redis): Worker<ServiceJobData> {
  const connection: ConnectionOptions = {
    host: redis.options.host as string,
    port: redis.options.port as number,
    maxRetriesPerRequest: null,
  };

  const worker = new Worker<ServiceJobData>(
    "service",
    async (job: Job<ServiceJobData>) => {
      const { type, serviceId } = job.data;

      logger.info(`Processing service ${type} job`, { serviceId, jobId: job.id });

      try {
        switch (type) {
          case "start":
            await handleStart(serviceId, job);
            break;
          case "stop":
            await handleStop(serviceId, job);
            break;
          case "restart":
            await handleRestart(serviceId, job);
            break;
          default:
            throw new Error(`Unknown job type: ${type}`);
        }
      } catch (error) {
        logger.error(`Service ${type} failed`, { serviceId, error });
        throw error;
      }
    },
    { connection, concurrency: 5 }
  );

  worker.on("completed", (job) => {
    logger.info(`Service job completed`, { jobId: job.id, type: job.data.type });
  });

  worker.on("failed", (job, err) => {
    logger.error(`Service job failed`, { jobId: job?.id, error: err.message });
  });

  return worker;
}

async function handleStart(serviceId: string, job: Job<ServiceJobData>): Promise<void> {
  const service = await getServiceWithServer(serviceId);
  if (!service) throw new Error("Service not found");

  const { server, destination, composeFile } = service;
  if (!server || !destination) throw new Error("Service has no server destination");

  const sshConfig = await getSSHConfig(server);
  const workDir = `/data/coolify/services/${service.uuid}`;

  // Ensure working directory exists
  await sshService.executeCommand({
    ...sshConfig,
    command: `mkdir -p ${workDir}`,
  });

  // Write docker-compose file
  if (composeFile) {
    await sshService.writeFile({
      ...sshConfig,
      remotePath: `${workDir}/docker-compose.yml`,
      content: composeFile,
    });
  }

  // Start containers
  const result = await sshService.executeCommand({
    ...sshConfig,
    command: `cd ${workDir} && docker compose up -d`,
  });

  if (!result.success) {
    throw new Error(`Failed to start service: ${result.stderr}`);
  }

  // Update service status
  await db.update(services)
    .set({ status: "running" })
    .where(eq(services.id, serviceId));

  // Emit status update
  emitServiceStatus(service.teamId, serviceId, "running");

  logger.info("Service started", { serviceId, uuid: service.uuid });
}

async function handleStop(serviceId: string, job: Job<ServiceJobData>): Promise<void> {
  const service = await getServiceWithServer(serviceId);
  if (!service) throw new Error("Service not found");

  const { server, destination } = service;
  if (!server || !destination) throw new Error("Service has no server destination");

  const sshConfig = await getSSHConfig(server);
  const workDir = `/data/coolify/services/${service.uuid}`;

  // Stop containers
  const result = await sshService.executeCommand({
    ...sshConfig,
    command: `cd ${workDir} && docker compose down`,
  });

  if (!result.success) {
    logger.warn("Service stop had warnings", { stderr: result.stderr });
  }

  // Update service status
  await db.update(services)
    .set({ status: "stopped" })
    .where(eq(services.id, serviceId));

  // Emit status update
  emitServiceStatus(service.teamId, serviceId, "stopped");

  logger.info("Service stopped", { serviceId, uuid: service.uuid });
}

async function handleRestart(serviceId: string, job: Job<ServiceJobData>): Promise<void> {
  const service = await getServiceWithServer(serviceId);
  if (!service) throw new Error("Service not found");

  const { server, destination } = service;
  if (!server || !destination) throw new Error("Service has no server destination");

  const sshConfig = await getSSHConfig(server);
  const workDir = `/data/coolify/services/${service.uuid}`;

  // Emit restarting status
  emitServiceStatus(service.teamId, serviceId, "restarting");

  // Restart containers
  const result = await sshService.executeCommand({
    ...sshConfig,
    command: `cd ${workDir} && docker compose restart`,
  });

  if (!result.success) {
    throw new Error(`Failed to restart service: ${result.stderr}`);
  }

  // Update service status
  await db.update(services)
    .set({ status: "running" })
    .where(eq(services.id, serviceId));

  // Emit status update
  emitServiceStatus(service.teamId, serviceId, "running");

  logger.info("Service restarted", { serviceId, uuid: service.uuid });
}

async function getServiceWithServer(serviceId: string) {
  const service = await db.query.services.findFirst({
    where: eq(services.id, serviceId),
    with: {
      destination: {
        with: {
          server: {
            with: { privateKey: true },
          },
        },
      },
      environment: {
        with: {
          project: true,
        },
      },
    },
  });

  if (!service) return null;

  const destination = service.destination as typeof standaloneDockers.$inferSelect & {
    server: typeof servers.$inferSelect & { privateKey: { privateKey: string } | null };
  } | null;

  return {
    ...service,
    server: destination?.server || null,
    destination,
    teamId: service.environment?.project?.teamId || "",
  };
}

async function getSSHConfig(server: typeof servers.$inferSelect & { privateKey: { privateKey: string } | null }) {
  if (!server.privateKey) {
    throw new Error("Server has no SSH key configured");
  }

  return {
    host: server.ip,
    port: server.port,
    username: server.user,
    privateKey: server.privateKey.privateKey,
  };
}

function emitServiceStatus(teamId: string, serviceId: string, status: string) {
  if (teamId) {
    realtimeService.emitToTeam(teamId, "service:status", {
      serviceId,
      status,
      timestamp: Date.now(),
    });
  }
}
