import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { logger } from "@/lib/logger";

// Redis connection for BullMQ
const connection: ConnectionOptions = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  maxRetriesPerRequest: null,
};

// Create Redis client
export const redisClient = new IORedis({
  host: connection.host as string,
  port: connection.port as number,
  maxRetriesPerRequest: null,
});

// Queue factory
export function createQueue<T>(name: string): Queue<T> {
  return new Queue<T>(name, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      removeOnComplete: {
        count: 100,
        age: 24 * 3600, // 24 hours
      },
      removeOnFail: {
        count: 500,
        age: 7 * 24 * 3600, // 7 days
      },
    },
  });
}

// Worker factory
export function createWorker<T>(
  name: string,
  processor: (job: Job<T>) => Promise<void>
): Worker<T> {
  const worker = new Worker<T>(name, processor, {
    connection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || "5", 10),
  });

  worker.on("completed", (job) => {
    logger.info(`Job ${job.id} completed in queue ${name}`);
  });

  worker.on("failed", (job, err) => {
    logger.error(`Job ${job?.id} failed in queue ${name}:`, err);
  });

  worker.on("error", (err) => {
    logger.error(`Worker error in queue ${name}:`, err);
  });

  return worker;
}

// Queue names
export const QUEUE_NAMES = {
  DEPLOYMENT: "deployment",
  DATABASE: "database",
  SERVICE: "service",
  SERVER_CHECK: "server-check",
  BACKUP: "backup",
  NOTIFICATION: "notification",
} as const;
