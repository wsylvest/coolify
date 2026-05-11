/**
 * Coolify Worker Entry Point
 *
 * This file initializes all BullMQ workers for background job processing.
 * Run with: npm run worker:dev (development) or npm run worker:start (production)
 */

import IORedis from "ioredis";
import { Queue } from "bullmq";
import { logger } from "../src/lib/logger";
import { createServiceDeploymentWorker } from "../src/server/queue/jobs/service-deployment";
import {
  createScheduledTaskWorker,
  TaskSchedulerService,
  type ScheduledTaskJobData,
} from "../src/server/queue/jobs/scheduled-task";
import { createPreviewCleanupWorker } from "../src/server/queue/jobs/preview-cleanup";
import { createDeploymentWorker } from "./deployment-worker";
import { createDatabaseWorker } from "./database-worker";
import { createServiceWorker } from "./service-worker";

// Redis connection
const redis = new IORedis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  maxRetriesPerRequest: null,
});

// Track all workers for graceful shutdown
const workers: Array<{ close: () => Promise<void> }> = [];

async function startWorkers() {
  logger.info("Starting Coolify workers...");

  try {
    // Initialize service deployment worker
    const serviceDeploymentWorker = createServiceDeploymentWorker(redis);
    workers.push(serviceDeploymentWorker);
    logger.info("Service deployment worker started");

    // Initialize application deployment worker
    const deploymentWorker = createDeploymentWorker(redis);
    workers.push(deploymentWorker);
    logger.info("Application deployment worker started");

    // Initialize database worker
    const databaseWorker = createDatabaseWorker(redis);
    workers.push(databaseWorker);
    logger.info("Database worker started");

    // Initialize scheduled task worker
    const scheduledTaskWorker = createScheduledTaskWorker(redis);
    workers.push(scheduledTaskWorker);
    logger.info("Scheduled task worker started");

    // Initialize service worker (start/stop/restart operations)
    const serviceWorker = createServiceWorker(redis);
    workers.push(serviceWorker);
    logger.info("Service worker started");

    // Initialize preview cleanup worker
    const previewCleanupWorker = createPreviewCleanupWorker(redis);
    workers.push(previewCleanupWorker);
    logger.info("Preview cleanup worker started");

    // Initialize the cron scheduler for scheduled tasks
    const scheduledTaskQueue = new Queue<ScheduledTaskJobData>("scheduled-task", {
      connection: {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379", 10),
      },
    });
    const taskScheduler = new TaskSchedulerService(scheduledTaskQueue);
    taskScheduler.start();
    logger.info("Task scheduler initialized");

    logger.info(`All workers started successfully. Waiting for jobs...`);
  } catch (error) {
    logger.error("Failed to start workers:", error);
    process.exit(1);
  }
}

async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  // Close all workers
  for (const worker of workers) {
    try {
      await worker.close();
    } catch (error) {
      logger.error("Error closing worker:", error);
    }
  }

  // Close Redis connection
  try {
    await redis.quit();
  } catch (error) {
    logger.error("Error closing Redis connection:", error);
  }

  logger.info("Graceful shutdown complete");
  process.exit(0);
}

// Handle shutdown signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception:", error);
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection:", reason);
});

// Start workers
startWorkers();
