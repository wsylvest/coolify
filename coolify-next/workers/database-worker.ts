/**
 * Database Operations Worker
 *
 * Handles database start, stop, and backup jobs.
 */

import { Job, Worker } from "bullmq";
import IORedis from "ioredis";
import { db } from "../src/server/db";
import { databases, databaseBackups, backupExecutions } from "../src/server/db/schema";
import { eq } from "drizzle-orm";
import { sshService } from "../src/server/services/ssh";
import { dockerService } from "../src/server/services/docker";
import { storageService } from "../src/server/services/storage";
import { realtimeService } from "../src/server/services/realtime";
import { notificationService } from "../src/server/services/notifications";
import { logger } from "../src/lib/logger";

export interface DatabaseStartJobData {
  type: "start";
  databaseId: string;
}

export interface DatabaseStopJobData {
  type: "stop";
  databaseId: string;
}

export interface DatabaseBackupJobData {
  type: "backup";
  executionId: string;
  backupId: string;
  databaseId: string;
}

type JobData = DatabaseStartJobData | DatabaseStopJobData | DatabaseBackupJobData;

const COOLIFY_DIR = "/data/coolify";

const DATABASE_IMAGES: Record<string, string> = {
  postgresql: "postgres:16-alpine",
  mysql: "mysql:8.0",
  mariadb: "mariadb:11",
  redis: "redis:7-alpine",
  mongodb: "mongo:7",
  keydb: "eqalpha/keydb:latest",
  dragonfly: "docker.dragonflydb.io/dragonflydb/dragonfly:latest",
  clickhouse: "clickhouse/clickhouse-server:latest",
};

export function createDatabaseWorker(redis: IORedis) {
  const worker = new Worker<JobData>(
    "database",
    async (job: Job<JobData>) => {
      switch (job.data.type) {
        case "start":
          return handleStartJob(job.data);
        case "stop":
          return handleStopJob(job.data);
        case "backup":
          return handleBackupJob(job.data);
        default:
          throw new Error(`Unknown job type: ${(job.data as any).type}`);
      }
    },
    {
      connection: {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379", 10),
      },
      concurrency: parseInt(process.env.DATABASE_WORKER_CONCURRENCY || "5", 10),
    }
  );

  worker.on("completed", (job) => {
    logger.info(`Database job ${job.id} (${job.data.type}) completed`);
  });

  worker.on("failed", (job, err) => {
    logger.error(`Database job ${job?.id} failed:`, err);
  });

  return worker;
}

async function handleStartJob(data: DatabaseStartJobData): Promise<void> {
  const { databaseId } = data;

  logger.info(`Starting database ${databaseId}...`);

  const database = await db.query.databases.findFirst({
    where: eq(databases.id, databaseId),
    with: {
      server: {
        with: {
          privateKey: true,
        },
      },
      environment: {
        with: {
          project: true,
        },
      },
    },
  });

  if (!database) {
    throw new Error("Database not found");
  }

  const server = database.server;
  if (!server?.privateKey) {
    throw new Error("Server has no private key configured");
  }

  const teamId = database.environment.project.teamId;
  const sshConfig = {
    host: server.ip,
    port: server.port,
    username: server.user,
    privateKey: server.privateKey.privateKey,
  };

  const containerName = `coolify-db-${database.uuid}`;
  const dataDir = `${COOLIFY_DIR}/databases/${database.uuid}/data`;
  const image = DATABASE_IMAGES[database.type] || `${database.type}:latest`;

  // Create data directory
  await sshService.executeCommand({
    ...sshConfig,
    command: `mkdir -p ${dataDir}`,
  });

  // Build environment variables
  const envVars = buildDatabaseEnvVars(database);

  // Build volume mounts
  const volumes = buildVolumeMounts(database, dataDir);

  // Build docker run command
  const runCommand = [
    "docker run -d",
    `--name ${containerName}`,
    "--restart unless-stopped",
    "--network coolify-proxy",
    `--label coolify.managed=true`,
    `--label coolify.databaseId=${database.id}`,
    envVars,
    volumes,
    database.publicPort ? `-p ${database.publicPort}:${getDefaultPort(database.type)}` : "",
    image,
  ]
    .filter(Boolean)
    .join(" ");

  // Stop existing container first
  await sshService.executeCommand({
    ...sshConfig,
    command: `docker stop ${containerName} 2>/dev/null || true && docker rm ${containerName} 2>/dev/null || true`,
  });

  // Start new container
  const result = await sshService.executeCommand({
    ...sshConfig,
    command: runCommand,
    timeout: 120000,
  });

  if (!result.success) {
    throw new Error(`Failed to start database: ${result.stderr}`);
  }

  // Wait for database to be ready
  await waitForDatabase(sshConfig, containerName, database.type);

  // Update database status
  await db
    .update(databases)
    .set({
      status: "running",
      startedAt: new Date(),
    })
    .where(eq(databases.id, databaseId));

  realtimeService.emitDatabaseStatus(teamId, databaseId, "running");

  logger.info(`Database ${database.name} started successfully`);
}

async function handleStopJob(data: DatabaseStopJobData): Promise<void> {
  const { databaseId } = data;

  logger.info(`Stopping database ${databaseId}...`);

  const database = await db.query.databases.findFirst({
    where: eq(databases.id, databaseId),
    with: {
      server: {
        with: {
          privateKey: true,
        },
      },
      environment: {
        with: {
          project: true,
        },
      },
    },
  });

  if (!database) {
    throw new Error("Database not found");
  }

  const server = database.server;
  if (!server?.privateKey) {
    throw new Error("Server has no private key configured");
  }

  const teamId = database.environment.project.teamId;
  const sshConfig = {
    host: server.ip,
    port: server.port,
    username: server.user,
    privateKey: server.privateKey.privateKey,
  };

  const containerName = `coolify-db-${database.uuid}`;

  // Stop container
  await sshService.executeCommand({
    ...sshConfig,
    command: `docker stop ${containerName}`,
    timeout: 30000,
  });

  // Update database status
  await db
    .update(databases)
    .set({ status: "exited" })
    .where(eq(databases.id, databaseId));

  realtimeService.emitDatabaseStatus(teamId, databaseId, "exited");

  logger.info(`Database ${database.name} stopped`);
}

async function handleBackupJob(data: DatabaseBackupJobData): Promise<void> {
  const { executionId, backupId, databaseId } = data;

  logger.info(`Starting backup for database ${databaseId}...`);

  // Update execution status
  await db
    .update(backupExecutions)
    .set({
      status: "in_progress",
      startedAt: new Date(),
    })
    .where(eq(backupExecutions.id, executionId));

  try {
    const database = await db.query.databases.findFirst({
      where: eq(databases.id, databaseId),
      with: {
        server: {
          with: {
            privateKey: true,
          },
        },
        environment: {
          with: {
            project: true,
          },
        },
      },
    });

    if (!database) {
      throw new Error("Database not found");
    }

    const backup = await db.query.databaseBackups.findFirst({
      where: eq(databaseBackups.id, backupId),
    });

    if (!backup) {
      throw new Error("Backup configuration not found");
    }

    const server = database.server;
    if (!server?.privateKey) {
      throw new Error("Server has no private key configured");
    }

    const sshConfig = {
      host: server.ip,
      port: server.port,
      username: server.user,
      privateKey: server.privateKey.privateKey,
    };

    const containerName = `coolify-db-${database.uuid}`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = `${COOLIFY_DIR}/backups/${database.uuid}`;
    const backupFile = `${backupDir}/${database.name}-${timestamp}.sql`;

    // Create backup directory
    await sshService.executeCommand({
      ...sshConfig,
      command: `mkdir -p ${backupDir}`,
    });

    // Create backup based on database type
    const dumpCommand = getDumpCommand(database, containerName, backupFile);
    const result = await sshService.executeCommand({
      ...sshConfig,
      command: dumpCommand,
      timeout: 600000, // 10 minutes
    });

    if (!result.success) {
      throw new Error(`Backup failed: ${result.stderr}`);
    }

    // Compress backup
    await sshService.executeCommand({
      ...sshConfig,
      command: `gzip ${backupFile}`,
    });

    const compressedFile = `${backupFile}.gz`;

    // Get file size
    const sizeResult = await sshService.executeCommand({
      ...sshConfig,
      command: `stat -c%s ${compressedFile}`,
    });
    const fileSize = parseInt(sizeResult.stdout.trim(), 10) || 0;

    // Upload to S3 if configured
    let s3Path: string | undefined;
    if (backup.s3StorageId) {
      logger.info("Uploading backup to S3...");
      s3Path = await storageService.uploadBackup({
        storageId: backup.s3StorageId,
        localPath: compressedFile,
        remotePath: `backups/${database.uuid}/${timestamp}.sql.gz`,
        sshConfig,
      });
    }

    // Update execution record
    await db
      .update(backupExecutions)
      .set({
        status: "completed",
        finishedAt: new Date(),
        size: fileSize,
        filename: `${database.name}-${timestamp}.sql.gz`,
        storagePath: s3Path || compressedFile,
      })
      .where(eq(backupExecutions.id, executionId));

    // Clean up old local backups (keep last 5)
    await sshService.executeCommand({
      ...sshConfig,
      command: `cd ${backupDir} && ls -t *.gz 2>/dev/null | tail -n +6 | xargs -r rm --`,
    });

    logger.info(`Backup completed for database ${database.name}`);

    // Send notification
    const teamId = database.environment.project.teamId;
    await notificationService.send({
      teamId,
      type: "backup",
      title: "Backup Completed",
      message: `Database ${database.name} backup completed (${(fileSize / 1024 / 1024).toFixed(2)} MB)`,
      metadata: { databaseId, backupId, executionId },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Backup failed for database ${databaseId}:`, error);

    await db
      .update(backupExecutions)
      .set({
        status: "failed",
        finishedAt: new Date(),
        message: errorMessage,
      })
      .where(eq(backupExecutions.id, executionId));

    throw error;
  }
}

function buildDatabaseEnvVars(database: any): string {
  const vars: string[] = [];

  switch (database.type) {
    case "postgresql":
      vars.push(`-e POSTGRES_USER=${database.dbUser || "postgres"}`);
      vars.push(`-e POSTGRES_PASSWORD=${database.dbPassword}`);
      vars.push(`-e POSTGRES_DB=${database.dbName || "postgres"}`);
      break;
    case "mysql":
    case "mariadb":
      vars.push(`-e MYSQL_ROOT_PASSWORD=${database.rootPassword || database.dbPassword}`);
      vars.push(`-e MYSQL_USER=${database.dbUser}`);
      vars.push(`-e MYSQL_PASSWORD=${database.dbPassword}`);
      vars.push(`-e MYSQL_DATABASE=${database.dbName}`);
      break;
    case "mongodb":
      vars.push(`-e MONGO_INITDB_ROOT_USERNAME=${database.dbUser || "mongo"}`);
      vars.push(`-e MONGO_INITDB_ROOT_PASSWORD=${database.dbPassword}`);
      break;
    case "redis":
    case "keydb":
    case "dragonfly":
      if (database.dbPassword) {
        vars.push(`-e REDIS_PASSWORD=${database.dbPassword}`);
      }
      break;
  }

  return vars.join(" ");
}

function buildVolumeMounts(database: any, dataDir: string): string {
  switch (database.type) {
    case "postgresql":
      return `-v ${dataDir}:/var/lib/postgresql/data`;
    case "mysql":
    case "mariadb":
      return `-v ${dataDir}:/var/lib/mysql`;
    case "mongodb":
      return `-v ${dataDir}:/data/db`;
    case "redis":
    case "keydb":
      return `-v ${dataDir}:/data`;
    case "dragonfly":
      return `-v ${dataDir}:/data`;
    case "clickhouse":
      return `-v ${dataDir}:/var/lib/clickhouse`;
    default:
      return `-v ${dataDir}:/data`;
  }
}

function getDefaultPort(type: string): number {
  switch (type) {
    case "postgresql":
      return 5432;
    case "mysql":
    case "mariadb":
      return 3306;
    case "mongodb":
      return 27017;
    case "redis":
    case "keydb":
    case "dragonfly":
      return 6379;
    case "clickhouse":
      return 8123;
    default:
      return 5432;
  }
}

function getDumpCommand(database: any, containerName: string, outputFile: string): string {
  switch (database.type) {
    case "postgresql":
      return `docker exec ${containerName} pg_dump -U ${database.dbUser || "postgres"} ${database.dbName || "postgres"} > ${outputFile}`;
    case "mysql":
    case "mariadb":
      return `docker exec ${containerName} mysqldump -u${database.dbUser} -p${database.dbPassword} ${database.dbName} > ${outputFile}`;
    case "mongodb":
      return `docker exec ${containerName} mongodump --archive --username=${database.dbUser || "mongo"} --password=${database.dbPassword} --authenticationDatabase=admin > ${outputFile}`;
    default:
      throw new Error(`Backup not supported for database type: ${database.type}`);
  }
}

async function waitForDatabase(
  sshConfig: any,
  containerName: string,
  type: string,
  maxRetries = 30
): Promise<void> {
  const healthCommand = getHealthCheckCommand(containerName, type);

  for (let i = 0; i < maxRetries; i++) {
    const result = await sshService.executeCommand({
      ...sshConfig,
      command: healthCommand,
      timeout: 5000,
    });

    if (result.success && result.exitCode === 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  logger.warn(`Database ${containerName} health check timed out, but container is running`);
}

function getHealthCheckCommand(containerName: string, type: string): string {
  switch (type) {
    case "postgresql":
      return `docker exec ${containerName} pg_isready`;
    case "mysql":
    case "mariadb":
      return `docker exec ${containerName} mysqladmin ping -h localhost`;
    case "mongodb":
      return `docker exec ${containerName} mongosh --eval "db.adminCommand('ping')"`;
    case "redis":
    case "keydb":
    case "dragonfly":
      return `docker exec ${containerName} redis-cli ping`;
    default:
      return `docker inspect ${containerName} --format='{{.State.Running}}'`;
  }
}
