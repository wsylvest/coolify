import { Job, Worker } from "bullmq";
import { db } from "@/server/db";
import { databases, databaseBackups, databaseBackupExecutions, servers as serversTable } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { sshService } from "@/server/services/ssh";
import { realtimeService } from "@/server/services/realtime";
import { notificationService } from "@/server/services/notifications";
import { s3StorageService as storageService } from "@/server/services/storage";
import { logger } from "@/lib/logger";
import { createQueue } from "../index";
import Redis from "ioredis";

export interface DatabaseStartJobData {
  databaseId: string;
  action: "start";
}

export interface DatabaseStopJobData {
  databaseId: string;
  action: "stop";
}

export interface DatabaseBackupJobData {
  executionId: string;
  backupId: string;
  databaseId: string;
  action: "backup";
}

export type DatabaseJobData =
  | DatabaseStartJobData
  | DatabaseStopJobData
  | DatabaseBackupJobData;

export const databaseQueue = createQueue<DatabaseJobData>("database");

const COOLIFY_DIR = "/data/coolify";

const IMAGE_DEFAULTS: Record<string, { image: string; port: number }> = {
  postgresql: { image: "postgres:16-alpine", port: 5432 },
  mysql: { image: "mysql:8", port: 3306 },
  mariadb: { image: "mariadb:11", port: 3306 },
  mongodb: { image: "mongo:7", port: 27017 },
  redis: { image: "redis:7-alpine", port: 6379 },
  clickhouse: { image: "clickhouse/clickhouse-server:latest", port: 8123 },
  keydb: { image: "eqalpha/keydb:latest", port: 6379 },
  dragonfly: { image: "docker.dragonflydb.io/dragonflydb/dragonfly", port: 6379 },
};

export function createDatabaseWorker(redis: Redis) {
  const worker = new Worker<DatabaseJobData>(
    "database",
    async (job) => {
      switch (job.data.action) {
        case "start":
          await handleStart(job.data);
          break;
        case "stop":
          await handleStop(job.data);
          break;
        case "backup":
          await handleBackup(job.data as DatabaseBackupJobData);
          break;
      }
    },
    {
      connection: redis,
      concurrency: parseInt(process.env.DATABASE_WORKER_CONCURRENCY || "3", 10),
    }
  );

  worker.on("completed", (job) => {
    logger.info(`Database job completed: ${job.data.action} ${job.data.databaseId}`);
  });

  worker.on("failed", (job, err) => {
    logger.error(`Database job failed: ${job?.data.action} ${job?.data.databaseId}`, err);
  });

  return worker;
}

async function loadDatabase(databaseId: string) {
  const database = await db.query.databases.findFirst({
    where: eq(databases.id, databaseId),
    with: {
      environment: { with: { project: true } },
      destination: { with: { server: true } },
    },
  });

  if (!database) throw new Error("Database not found");

  const server = database.destination?.server;
  if (!server) throw new Error("No server assigned");
  if (!server.privateKey) {
    const fullServer = await db.query.servers.findFirst({
      where: eq(serversTable.id, server.id),
      with: { privateKey: true },
    });
    if (!fullServer?.privateKey) throw new Error("No SSH key for server");
    (server as any).privateKey = fullServer.privateKey;
  }

  const sshConfig = {
    host: server.ip,
    port: server.port,
    username: server.user,
    privateKey: (server as any).privateKey.privateKey,
  };

  return { database, server, sshConfig, teamId: database.environment.project.teamId };
}

async function handleStart(data: DatabaseStartJobData) {
  const { database, sshConfig, teamId } = await loadDatabase(data.databaseId);

  const containerName = `${database.uuid}`;
  const network = database.destination?.network ?? "coolify";
  const dataDir = `${COOLIFY_DIR}/databases/${database.uuid}/data`;
  const defaults = IMAGE_DEFAULTS[database.type] ?? { image: database.image, port: 5432 };
  const image = `${database.image}:${database.imageTag ?? "latest"}`;

  // Ensure data directory
  await sshService.executeCommand({
    ...sshConfig,
    command: `mkdir -p ${dataDir}`,
  });

  // Stop existing container if running
  await sshService.executeCommand({
    ...sshConfig,
    command: `docker stop ${containerName} 2>/dev/null; docker rm ${containerName} 2>/dev/null; true`,
  });

  // Build environment variables for the database type
  const envFlags = buildDatabaseEnvFlags(database);

  // Volume mount based on type
  const volumeMount = getVolumeMount(database.type, dataDir);

  let cmd = `docker run -d --name ${containerName} --network ${network} --restart unless-stopped`;
  cmd += ` -l coolify.managed=true -l coolify.databaseId=${database.uuid}`;
  cmd += ` -v ${volumeMount}`;
  if (database.isPublic && database.publicPort) {
    cmd += ` -p ${database.publicPort}:${defaults.port}`;
  }
  if (database.limitsMemory && database.limitsMemory !== "0") cmd += ` --memory=${database.limitsMemory}`;
  if (database.limitsCpus && database.limitsCpus !== "0") cmd += ` --cpus=${database.limitsCpus}`;
  cmd += envFlags;
  if (database.startupCommand) cmd += ` ${database.startupCommand}`;
  cmd += ` ${image}`;

  const result = await sshService.executeCommand({ ...sshConfig, command: cmd });
  if (!result.success) {
    throw new Error(`Failed to start database: ${result.stderr}`);
  }

  await db
    .update(databases)
    .set({ status: "running", lastOnlineAt: new Date() })
    .where(eq(databases.id, data.databaseId));

  realtimeService.emitContainerStatus(teamId, database.uuid, "running");
}

async function handleStop(data: DatabaseStopJobData) {
  const { database, sshConfig, teamId } = await loadDatabase(data.databaseId);

  await sshService.executeCommand({
    ...sshConfig,
    command: `docker stop ${database.uuid} 2>/dev/null; true`,
  });

  await db
    .update(databases)
    .set({ status: "exited" })
    .where(eq(databases.id, data.databaseId));

  realtimeService.emitContainerStatus(teamId, database.uuid, "exited");
}

async function handleBackup(data: DatabaseBackupJobData) {
  const { database, sshConfig, teamId } = await loadDatabase(data.databaseId);

  await db
    .update(databaseBackupExecutions)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(databaseBackupExecutions.id, data.executionId));

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${database.uuid}-${timestamp}.sql.gz`;
  const tmpPath = `/tmp/${filename}`;

  try {
    const dumpCmd = getDumpCommand(database, tmpPath);

    const result = await sshService.executeCommand({
      ...sshConfig,
      command: dumpCmd,
    });

    if (!result.success) {
      throw new Error(`Backup dump failed: ${result.stderr}`);
    }

    // Get file size
    const sizeResult = await sshService.executeCommand({
      ...sshConfig,
      command: `stat -c%s ${tmpPath} 2>/dev/null || echo "0"`,
    });
    const size = sizeResult.stdout.trim();

    // Upload to S3 if configured
    const backup = await db.query.databaseBackups.findFirst({
      where: eq(databaseBackups.id, data.backupId),
    });

    if (backup?.s3StorageId) {
      const fileResult = await sshService.readFile({ ...sshConfig, remotePath: tmpPath });
      await storageService.uploadBackup(backup.s3StorageId, filename, Buffer.from(fileResult.stdout));

      // Clean up temp file
      await sshService.executeCommand({ ...sshConfig, command: `rm -f ${tmpPath}` });
    }

    await db
      .update(databaseBackupExecutions)
      .set({
        status: "completed",
        finishedAt: new Date(),
        filename,
        size,
      })
      .where(eq(databaseBackupExecutions.id, data.executionId));

    logger.info(`Backup completed: ${filename} (${size} bytes)`);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";

    await db
      .update(databaseBackupExecutions)
      .set({
        status: "failed",
        finishedAt: new Date(),
        message: msg,
      })
      .where(eq(databaseBackupExecutions.id, data.executionId));

    await notificationService.send({
      teamId,
      eventType: "backup_failure",
      title: `Backup failed: ${database.name}`,
      message: msg,
      resourceType: "database",
      resourceId: database.uuid,
    });

    throw error;
  }
}

function buildDatabaseEnvFlags(database: any): string {
  const flags: string[] = [];

  switch (database.type) {
    case "postgresql":
      if (database.dbUser) flags.push(`-e POSTGRES_USER=${database.dbUser}`);
      if (database.dbPassword) flags.push(`-e POSTGRES_PASSWORD=${database.dbPassword}`);
      if (database.dbName) flags.push(`-e POSTGRES_DB=${database.dbName}`);
      if (database.postgresInitdbArgs) flags.push(`-e POSTGRES_INITDB_ARGS="${database.postgresInitdbArgs}"`);
      if (database.postgresHostAuthMethod) flags.push(`-e POSTGRES_HOST_AUTH_METHOD=${database.postgresHostAuthMethod}`);
      break;
    case "mysql":
      if (database.dbRootPassword) flags.push(`-e MYSQL_ROOT_PASSWORD=${database.dbRootPassword}`);
      if (database.dbUser) flags.push(`-e MYSQL_USER=${database.dbUser}`);
      if (database.dbPassword) flags.push(`-e MYSQL_PASSWORD=${database.dbPassword}`);
      if (database.dbName) flags.push(`-e MYSQL_DATABASE=${database.dbName}`);
      break;
    case "mariadb":
      if (database.dbRootPassword) flags.push(`-e MARIADB_ROOT_PASSWORD=${database.dbRootPassword}`);
      if (database.dbUser) flags.push(`-e MARIADB_USER=${database.dbUser}`);
      if (database.dbPassword) flags.push(`-e MARIADB_PASSWORD=${database.dbPassword}`);
      if (database.dbName) flags.push(`-e MARIADB_DATABASE=${database.dbName}`);
      break;
    case "mongodb":
      if (database.mongoInitdbRootUsername) flags.push(`-e MONGO_INITDB_ROOT_USERNAME=${database.mongoInitdbRootUsername}`);
      if (database.mongoInitdbRootPassword) flags.push(`-e MONGO_INITDB_ROOT_PASSWORD=${database.mongoInitdbRootPassword}`);
      break;
    case "redis":
    case "keydb":
    case "dragonfly":
      if (database.redisPassword) flags.push(`-e REDIS_PASSWORD=${database.redisPassword}`);
      break;
    case "clickhouse":
      if (database.clickhouseAdminUser) flags.push(`-e CLICKHOUSE_USER=${database.clickhouseAdminUser}`);
      if (database.clickhouseAdminPassword) flags.push(`-e CLICKHOUSE_PASSWORD=${database.clickhouseAdminPassword}`);
      break;
  }

  return flags.length > 0 ? " " + flags.join(" ") : "";
}

function getVolumeMount(type: string, dataDir: string): string {
  switch (type) {
    case "postgresql":
      return `${dataDir}:/var/lib/postgresql/data`;
    case "mysql":
    case "mariadb":
      return `${dataDir}:/var/lib/mysql`;
    case "mongodb":
      return `${dataDir}:/data/db`;
    case "redis":
    case "keydb":
    case "dragonfly":
      return `${dataDir}:/data`;
    case "clickhouse":
      return `${dataDir}:/var/lib/clickhouse`;
    default:
      return `${dataDir}:/data`;
  }
}

function getDumpCommand(database: any, outputPath: string): string {
  const containerName = database.uuid;

  switch (database.type) {
    case "postgresql":
      return `docker exec ${containerName} pg_dumpall -U ${database.dbUser || "postgres"} | gzip > ${outputPath}`;
    case "mysql":
      return `docker exec ${containerName} mysqldump -u root -p${database.dbRootPassword} --all-databases | gzip > ${outputPath}`;
    case "mariadb":
      return `docker exec ${containerName} mariadb-dump -u root -p${database.dbRootPassword} --all-databases | gzip > ${outputPath}`;
    case "mongodb":
      return `docker exec ${containerName} mongodump --archive --gzip > ${outputPath}`;
    default:
      throw new Error(`Backup not supported for database type: ${database.type}`);
  }
}
