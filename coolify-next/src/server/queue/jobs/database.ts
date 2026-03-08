import { createQueue } from "../index";

export interface DatabaseStartJobData {
  databaseId: string;
}

export interface DatabaseStopJobData {
  databaseId: string;
}

export interface DatabaseBackupJobData {
  executionId: string;
  backupId: string;
  databaseId: string;
}

export const databaseQueue = createQueue<
  DatabaseStartJobData | DatabaseStopJobData | DatabaseBackupJobData
>("database");
