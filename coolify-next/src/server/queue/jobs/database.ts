import { createQueue } from "../index";

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

export type DatabaseJobData = DatabaseStartJobData | DatabaseStopJobData | DatabaseBackupJobData;

export const databaseQueue = createQueue<DatabaseJobData>("database");

// Helper functions to queue jobs with correct type
export const queueDatabaseStart = (databaseId: string) =>
  databaseQueue.add("start", { type: "start", databaseId });

export const queueDatabaseStop = (databaseId: string) =>
  databaseQueue.add("stop", { type: "stop", databaseId });

export const queueDatabaseBackup = (data: Omit<DatabaseBackupJobData, "type">) =>
  databaseQueue.add("backup", { type: "backup", ...data });
