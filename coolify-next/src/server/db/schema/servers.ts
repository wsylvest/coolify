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
import { teams } from "./teams";
import { privateKeys } from "./private-keys";
import { destinations } from "./destinations";

export const proxyTypeEnum = pgEnum("proxy_type", ["traefik", "caddy", "none"]);

export const serverValidationStatusEnum = pgEnum("server_validation_status", [
  "pending",
  "validating",
  "valid",
  "invalid",
]);

export const servers = pgTable(
  "servers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    uuid: text("uuid")
      .notNull()
      .unique()
      .$defaultFn(() => createId()),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    privateKeyId: text("private_key_id").references(() => privateKeys.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    ip: varchar("ip", { length: 255 }).notNull(),
    port: integer("port").default(22).notNull(),
    user: varchar("user", { length: 255 }).default("root").notNull(),

    // Proxy configuration
    proxyType: proxyTypeEnum("proxy_type").default("traefik").notNull(),
    proxy: jsonb("proxy").$type<{
      status?: string;
      force_stop?: boolean;
      redirect?: string;
      last_applied_settings?: string;
      last_saved_settings?: string;
    }>(),

    // Server status
    validationStatus: serverValidationStatusEnum("validation_status")
      .default("pending")
      .notNull(),
    validationLogs: text("validation_logs"),
    unreachableCount: integer("unreachable_count").default(0).notNull(),
    unreachableNotificationSent: boolean("unreachable_notification_sent")
      .default(false)
      .notNull(),
    lastOnlineAt: timestamp("last_online_at", { withTimezone: true }),

    // Server features
    isReachable: boolean("is_reachable").default(false).notNull(),
    isBuildServer: boolean("is_build_server").default(false).notNull(),
    isSwarmWorker: boolean("is_swarm_worker").default(false).notNull(),
    isSwarmManager: boolean("is_swarm_manager").default(false).notNull(),
    swarmCluster: jsonb("swarm_cluster"),
    isMetricsEnabled: boolean("is_metrics_enabled").default(false).notNull(),
    isSentinelEnabled: boolean("is_sentinel_enabled").default(true).notNull(),
    isLogDrainEnabled: boolean("is_log_drain_enabled").default(false).notNull(),

    // Sentinel
    sentinelToken: text("sentinel_token"),
    sentinelUpdatedAt: timestamp("sentinel_updated_at", { withTimezone: true }),
    sentinelCustomUrl: text("sentinel_custom_url"),

    // Log drain settings
    logDrainAxiomApiKey: text("log_drain_axiom_api_key"),
    logDrainAxiomDataset: text("log_drain_axiom_dataset"),
    logDrainNewRelicApiKey: text("log_drain_new_relic_api_key"),
    logDrainNewRelicLicenseKey: text("log_drain_new_relic_license_key"),
    logDrainHighlightProjectId: text("log_drain_highlight_project_id"),
    logDrainCustomConfig: text("log_drain_custom_config"),
    logDrainCustomConfigParser: text("log_drain_custom_config_parser"),

    // Settings (schemaless)
    settings: jsonb("settings").$type<{
      concurrent_builds?: number;
      dynamic_timeout?: number;
      force_disabled?: boolean;
      docker_cleanup_frequency?: string;
      docker_cleanup_threshold?: number;
      wildcard_domain?: string;
      is_cloudflare_tunnel?: boolean;
      cloudflare_tunnel_id?: string;
    }>(),

    // Metadata
    highDiskUsageNotificationSent: boolean("high_disk_usage_notification_sent")
      .default(false)
      .notNull(),
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
    teamIdIdx: index("servers_team_id_idx").on(table.teamId),
    uuidIdx: index("servers_uuid_idx").on(table.uuid),
    ipIdx: index("servers_ip_idx").on(table.ip),
  })
);

export const serversRelations = relations(servers, ({ one, many }) => ({
  team: one(teams, {
    fields: [servers.teamId],
    references: [teams.id],
  }),
  privateKey: one(privateKeys, {
    fields: [servers.privateKeyId],
    references: [privateKeys.id],
  }),
  destinations: many(destinations),
}));

export type Server = typeof servers.$inferSelect;
export type NewServer = typeof servers.$inferInsert;
