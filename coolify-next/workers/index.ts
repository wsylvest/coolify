import "dotenv/config";
import { createDeploymentWorker } from "../src/server/queue/jobs/deployment";
import { createDatabaseWorker } from "../src/server/queue/jobs/database";
import { createServiceDeploymentWorker } from "../src/server/queue/jobs/service-deployment";
import { createScheduledTaskWorker } from "../src/server/queue/jobs/scheduled-task";
import { redisClient } from "../src/server/queue/index";
import { logger } from "../src/lib/logger";
import IORedis from "ioredis";

const redis = new IORedis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  maxRetriesPerRequest: null,
});

const workers = [
  createDeploymentWorker(redis),
  createDatabaseWorker(redis),
  createServiceDeploymentWorker(redis),
  createScheduledTaskWorker(redis),
];

logger.info(`Started ${workers.length} workers`);

async function shutdown() {
  logger.info("Shutting down workers...");
  await Promise.all(workers.map((w) => w.close()));
  await redis.quit();
  await redisClient.quit();
  logger.info("All workers stopped");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
