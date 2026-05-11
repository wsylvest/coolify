import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { teams } from "./teams";
import { servers } from "./servers";
import { applications } from "./applications";

// Scheduled task frequency enum
export const taskFrequencyEnum = pgEnum("task_frequency", [
  "every_minute",
  "every_5_minutes",
  "every_10_minutes",
  "every_15_minutes",
  "every_30_minutes",
  "hourly",
  "every_6_hours",
  "every_12_hours",
  "daily",
  "weekly",
  "monthly",
  "custom",
]);

// Task status enum
export const taskStatusEnum = pgEnum("task_status", [
  "active",
  "paused",
  "disabled",
]);

// Execution status enum
export const executionStatusEnum = pgEnum("execution_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

// Scheduled tasks table
export const scheduledTasks = pgTable("scheduled_tasks", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  uuid: text("uuid")
    .notNull()
    .$defaultFn(() => createId())
    .unique(),

  name: text("name").notNull(),
  description: text("description"),

  // Task configuration
  command: text("command").notNull(),
  frequency: taskFrequencyEnum("frequency").default("daily").notNull(),
  cronExpression: text("cron_expression"), // For custom frequency
  timezone: text("timezone").default("UTC"),

  // Status
  status: taskStatusEnum("status").default("active").notNull(),
  enabled: boolean("enabled").default(true),

  // Execution settings
  timeout: integer("timeout").default(3600), // seconds
  retries: integer("retries").default(0),
  retryDelay: integer("retry_delay").default(60), // seconds

  // Notifications
  notifyOnSuccess: boolean("notify_on_success").default(false),
  notifyOnFailure: boolean("notify_on_failure").default(true),

  // Resource association (polymorphic)
  resourceType: text("resource_type"), // 'application', 'database', 'service', 'server'
  resourceId: text("resource_id"),

  // Relations
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  serverId: text("server_id").references(() => servers.id, {
    onDelete: "cascade",
  }),

  // Tracking
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  lastSuccessAt: timestamp("last_success_at"),
  lastFailureAt: timestamp("last_failure_at"),
  runCount: integer("run_count").default(0),
  failureCount: integer("failure_count").default(0),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Task executions table
export const taskExecutions = pgTable("task_executions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),

  taskId: text("task_id")
    .notNull()
    .references(() => scheduledTasks.id, { onDelete: "cascade" }),

  status: executionStatusEnum("status").default("pending").notNull(),

  // Execution details
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  duration: integer("duration"), // milliseconds

  // Output
  output: text("output"),
  errorOutput: text("error_output"),
  exitCode: integer("exit_code"),

  // Retry info
  attempt: integer("attempt").default(1),
  triggeredBy: text("triggered_by").default("scheduler"), // 'scheduler', 'manual', 'webhook'

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Activity log table
export const activityLogs = pgTable("activity_logs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),

  // Who
  userId: text("user_id"),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),

  // What
  action: text("action").notNull(), // 'created', 'updated', 'deleted', 'deployed', etc.
  resourceType: text("resource_type").notNull(), // 'server', 'application', 'database', etc.
  resourceId: text("resource_id"),
  resourceName: text("resource_name"),

  // Details
  description: text("description"),
  properties: text("properties"), // JSON - old/new values
  metadata: text("metadata"), // JSON - additional context

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// S3 storage configuration
export const s3Storages = pgTable("s3_storages", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  uuid: text("uuid")
    .notNull()
    .$defaultFn(() => createId())
    .unique(),

  name: text("name").notNull(),
  description: text("description"),

  // S3 configuration
  endpoint: text("endpoint").notNull(),
  bucket: text("bucket").notNull(),
  region: text("region").default("us-east-1"),
  accessKey: text("access_key").notNull(),
  secretKey: text("secret_key").notNull(),

  // Optional settings
  pathPrefix: text("path_prefix"),
  usePathStyleEndpoint: boolean("use_path_style_endpoint").default(false),
  forcePathStyle: boolean("force_path_style").default(false),

  // Validation
  isUsable: boolean("is_usable").default(false),
  lastTestedAt: timestamp("last_tested_at"),
  testError: text("test_error"),

  // Relations
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Relations
export const scheduledTasksRelations = relations(scheduledTasks, ({ one, many }) => ({
  team: one(teams, {
    fields: [scheduledTasks.teamId],
    references: [teams.id],
  }),
  server: one(servers, {
    fields: [scheduledTasks.serverId],
    references: [servers.id],
  }),
  executions: many(taskExecutions),
}));

export const taskExecutionsRelations = relations(taskExecutions, ({ one }) => ({
  task: one(scheduledTasks, {
    fields: [taskExecutions.taskId],
    references: [scheduledTasks.id],
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  team: one(teams, {
    fields: [activityLogs.teamId],
    references: [teams.id],
  }),
}));

export const s3StoragesRelations = relations(s3Storages, ({ one }) => ({
  team: one(teams, {
    fields: [s3Storages.teamId],
    references: [teams.id],
  }),
}));

// Types
export type ScheduledTask = typeof scheduledTasks.$inferSelect;
export type NewScheduledTask = typeof scheduledTasks.$inferInsert;
export type TaskExecution = typeof taskExecutions.$inferSelect;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type S3Storage = typeof s3Storages.$inferSelect;
export type NewS3Storage = typeof s3Storages.$inferInsert;
