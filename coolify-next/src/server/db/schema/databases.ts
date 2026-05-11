import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { environments } from "./environments";
import { destinations } from "./destinations";

export const databaseTypeEnum = pgEnum("database_type", [
  "postgresql",
  "mysql",
  "mariadb",
  "mongodb",
  "redis",
  "clickhouse",
  "keydb",
  "dragonfly",
]);

export const databases = pgTable(
  "databases",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    uuid: text("uuid")
      .notNull()
      .unique()
      .$defaultFn(() => createId()),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    destinationId: text("destination_id").references(() => destinations.id, {
      onDelete: "set null",
    }),

    // Basic info
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    type: databaseTypeEnum("type").notNull(),
    status: varchar("status", { length: 50 }).default("exited"),
    lastOnlineAt: timestamp("last_online_at", { withTimezone: true }),

    // Image configuration
    image: varchar("image", { length: 255 }).notNull(),
    imageTag: varchar("image_tag", { length: 255 }).default("latest"),

    // Connection
    isPublic: boolean("is_public").default(false).notNull(),
    publicPort: integer("public_port"),
    internalDbUrl: text("internal_db_url"),

    // Credentials (encrypted)
    dbUser: varchar("db_user", { length: 255 }),
    dbPassword: text("db_password"),
    dbName: varchar("db_name", { length: 255 }),
    dbRootPassword: text("db_root_password"),

    // PostgreSQL specific
    postgresInitdbArgs: text("postgres_initdb_args"),
    postgresHostAuthMethod: varchar("postgres_host_auth_method", {
      length: 50,
    }),
    postgresConf: text("postgres_conf"),

    // MySQL/MariaDB specific
    mysqlConf: text("mysql_conf"),

    // MongoDB specific
    mongoConf: text("mongo_conf"),
    mongoInitdbRootUsername: varchar("mongo_initdb_root_username", {
      length: 255,
    }),
    mongoInitdbRootPassword: text("mongo_initdb_root_password"),

    // Redis specific
    redisPassword: text("redis_password"),
    redisConf: text("redis_conf"),

    // ClickHouse specific
    clickhouseAdminUser: varchar("clickhouse_admin_user", { length: 255 }),
    clickhouseAdminPassword: text("clickhouse_admin_password"),

    // Resource limits
    limitsMemory: varchar("limits_memory", { length: 50 }).default("0"),
    limitsMemorySwap: varchar("limits_memory_swap", { length: 50 }).default(
      "0"
    ),
    limitsMemorySwappiness: integer("limits_memory_swappiness").default(60),
    limitsMemoryReservation: varchar("limits_memory_reservation", {
      length: 50,
    }).default("0"),
    limitsCpus: varchar("limits_cpus", { length: 50 }).default("0"),
    limitsCpuset: varchar("limits_cpuset", { length: 255 }),
    limitsCpuShares: integer("limits_cpu_shares").default(1024),

    // Custom configuration
    startupCommand: text("startup_command"),
    customDockerRunOptions: text("custom_docker_run_options"),
    configHash: text("config_hash"),

    // Extra settings stored as JSON
    settings: jsonb("settings").$type<{
      init_scripts?: string;
      extra_config?: string;
    }>(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    environmentIdIdx: index("databases_environment_id_idx").on(
      table.environmentId
    ),
    destinationIdIdx: index("databases_destination_id_idx").on(
      table.destinationId
    ),
    uuidIdx: index("databases_uuid_idx").on(table.uuid),
    typeIdx: index("databases_type_idx").on(table.type),
    statusIdx: index("databases_status_idx").on(table.status),
  })
);

export const databasesRelations = relations(databases, ({ one, many }) => ({
  environment: one(environments, {
    fields: [databases.environmentId],
    references: [environments.id],
  }),
  destination: one(destinations, {
    fields: [databases.destinationId],
    references: [destinations.id],
  }),
  backups: many(databaseBackups),
  environmentVariables: many(databaseEnvironmentVariables),
}));

// Database Backups
export const databaseBackups = pgTable(
  "database_backups",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    uuid: text("uuid")
      .notNull()
      .unique()
      .$defaultFn(() => createId()),
    databaseId: text("database_id")
      .notNull()
      .references(() => databases.id, { onDelete: "cascade" }),

    // Backup settings
    enabled: boolean("enabled").default(true).notNull(),
    frequency: varchar("frequency", { length: 255 }).default("0 0 * * *"),
    numberOfBackupsToKeep: integer("number_of_backups_to_keep").default(7),

    // S3 settings
    s3StorageId: text("s3_storage_id"),
    databasesToBackup: text("databases_to_backup"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    databaseIdIdx: index("database_backups_database_id_idx").on(
      table.databaseId
    ),
  })
);

export const databaseBackupsRelations = relations(
  databaseBackups,
  ({ one, many }) => ({
    database: one(databases, {
      fields: [databaseBackups.databaseId],
      references: [databases.id],
    }),
    executions: many(databaseBackupExecutions),
  })
);

// Backup Execution History
export const databaseBackupExecutions = pgTable(
  "database_backup_executions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    uuid: text("uuid")
      .notNull()
      .unique()
      .$defaultFn(() => createId()),
    backupId: text("backup_id")
      .notNull()
      .references(() => databaseBackups.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 50 }).default("running"),
    message: text("message"),
    filename: text("filename"),
    size: text("size"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    backupIdIdx: index("database_backup_executions_backup_id_idx").on(
      table.backupId
    ),
    statusIdx: index("database_backup_executions_status_idx").on(table.status),
  })
);

export const databaseBackupExecutionsRelations = relations(
  databaseBackupExecutions,
  ({ one }) => ({
    backup: one(databaseBackups, {
      fields: [databaseBackupExecutions.backupId],
      references: [databaseBackups.id],
    }),
  })
);

// Environment Variables
export const databaseEnvironmentVariables = pgTable(
  "database_environment_variables",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    uuid: text("uuid")
      .notNull()
      .unique()
      .$defaultFn(() => createId()),
    databaseId: text("database_id")
      .notNull()
      .references(() => databases.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 255 }).notNull(),
    value: text("value"),
    isShownOnce: boolean("is_shown_once").default(false).notNull(),
    realValue: text("real_value"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    databaseIdIdx: index(
      "database_environment_variables_database_id_idx"
    ).on(table.databaseId),
  })
);

export const databaseEnvironmentVariablesRelations = relations(
  databaseEnvironmentVariables,
  ({ one }) => ({
    database: one(databases, {
      fields: [databaseEnvironmentVariables.databaseId],
      references: [databases.id],
    }),
  })
);

export type Database = typeof databases.$inferSelect;
export type NewDatabase = typeof databases.$inferInsert;
export type DatabaseBackup = typeof databaseBackups.$inferSelect;
export type DatabaseBackupExecution = typeof databaseBackupExecutions.$inferSelect;
