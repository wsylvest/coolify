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
import { privateKeys } from "./private-keys";

export const buildPackEnum = pgEnum("build_pack", [
  "nixpacks",
  "dockerfile",
  "dockercompose",
  "dockerimage",
  "static",
]);

export const redirectTypeEnum = pgEnum("redirect_type", [
  "www",
  "non-www",
  "both",
]);

export const deploymentStatusEnum = pgEnum("deployment_status", [
  "queued",
  "in_progress",
  "finished",
  "failed",
  "cancelled",
]);

export const applications = pgTable(
  "applications",
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
    privateKeyId: text("private_key_id").references(() => privateKeys.id, {
      onDelete: "set null",
    }),

    // Basic info
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    fqdn: text("fqdn"),
    configHash: text("config_hash"),
    status: varchar("status", { length: 50 }).default("exited"),
    lastOnlineAt: timestamp("last_online_at", { withTimezone: true }),

    // Git configuration
    gitRepository: text("git_repository"),
    gitBranch: varchar("git_branch", { length: 255 }).default("main"),
    gitCommitSha: varchar("git_commit_sha", { length: 255 }),
    gitFullUrl: text("git_full_url"),
    repositoryProjectId: integer("repository_project_id"),

    // Build configuration
    buildPack: buildPackEnum("build_pack").default("nixpacks").notNull(),
    staticImage: varchar("static_image", { length: 255 }).default(
      "nginx:alpine"
    ),
    installCommand: text("install_command"),
    buildCommand: text("build_command"),
    startCommand: text("start_command"),
    baseDirectory: varchar("base_directory", { length: 255 }).default("/"),
    publishDirectory: varchar("publish_directory", { length: 255 }),

    // Docker configuration
    dockerfile: text("dockerfile"),
    dockerfileLocation: varchar("dockerfile_location", { length: 255 }).default(
      "/Dockerfile"
    ),
    dockerfileBuildStage: varchar("dockerfile_build_stage", { length: 255 }),
    dockerfileTargetBuild: varchar("dockerfile_target_build", { length: 255 }),
    dockerRegistryImageName: text("docker_registry_image_name"),
    dockerRegistryImageTag: varchar("docker_registry_image_tag", {
      length: 255,
    }),
    dockerComposeLocation: varchar("docker_compose_location", {
      length: 255,
    }).default("/docker-compose.yml"),
    dockerCompose: text("docker_compose"),
    dockerComposeRaw: text("docker_compose_raw"),
    dockerComposeDomains: text("docker_compose_domains"),
    dockerComposeCustomStartCommand: text("docker_compose_custom_start_command"),
    dockerComposeCustomBuildCommand: text("docker_compose_custom_build_command"),
    customDockerRunOptions: text("custom_docker_run_options"),
    customLabels: text("custom_labels"),
    customNginxConfiguration: text("custom_nginx_configuration"),
    customNetworkAliases: text("custom_network_aliases"),

    // Ports
    portsExposes: varchar("ports_exposes", { length: 255 }).default("3000"),
    portsMappings: text("ports_mappings"),

    // Health check
    healthCheckEnabled: boolean("health_check_enabled").default(true).notNull(),
    healthCheckPath: varchar("health_check_path", { length: 255 }).default("/"),
    healthCheckPort: varchar("health_check_port", { length: 10 }),
    healthCheckHost: varchar("health_check_host", { length: 255 }),
    healthCheckMethod: varchar("health_check_method", { length: 10 }).default(
      "GET"
    ),
    healthCheckReturnCode: integer("health_check_return_code").default(200),
    healthCheckScheme: varchar("health_check_scheme", { length: 10 }).default(
      "http"
    ),
    healthCheckResponseText: text("health_check_response_text"),
    healthCheckInterval: integer("health_check_interval").default(5),
    healthCheckTimeout: integer("health_check_timeout").default(5),
    healthCheckRetries: integer("health_check_retries").default(10),
    healthCheckStartPeriod: integer("health_check_start_period").default(5),
    customHealthcheckFound: boolean("custom_healthcheck_found")
      .default(false)
      .notNull(),

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

    // Deployment hooks
    preDeploymentCommand: text("pre_deployment_command"),
    preDeploymentCommandContainer: varchar("pre_deployment_command_container", {
      length: 255,
    }),
    postDeploymentCommand: text("post_deployment_command"),
    postDeploymentCommandContainer: varchar(
      "post_deployment_command_container",
      { length: 255 }
    ),

    // Webhooks
    manualWebhookSecretGithub: text("manual_webhook_secret_github"),
    manualWebhookSecretGitlab: text("manual_webhook_secret_gitlab"),
    manualWebhookSecretBitbucket: text("manual_webhook_secret_bitbucket"),
    manualWebhookSecretGitea: text("manual_webhook_secret_gitea"),
    watchPaths: text("watch_paths"),

    // Swarm
    swarmReplicas: integer("swarm_replicas").default(1),
    swarmPlacementConstraints: text("swarm_placement_constraints"),

    // Preview
    previewUrlTemplate: text("preview_url_template").default(
      "{{pr_id}}.{{domain}}"
    ),

    // Redirect
    redirect: redirectTypeEnum("redirect"),

    // Timestamps
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
    environmentIdIdx: index("applications_environment_id_idx").on(
      table.environmentId
    ),
    destinationIdIdx: index("applications_destination_id_idx").on(
      table.destinationId
    ),
    uuidIdx: index("applications_uuid_idx").on(table.uuid),
    statusIdx: index("applications_status_idx").on(table.status),
  })
);

export const applicationsRelations = relations(
  applications,
  ({ one, many }) => ({
    environment: one(environments, {
      fields: [applications.environmentId],
      references: [environments.id],
    }),
    destination: one(destinations, {
      fields: [applications.destinationId],
      references: [destinations.id],
    }),
    privateKey: one(privateKeys, {
      fields: [applications.privateKeyId],
      references: [privateKeys.id],
    }),
    deployments: many(applicationDeployments),
    previews: many(applicationPreviews),
    environmentVariables: many(applicationEnvironmentVariables),
  })
);

// Deployment queue
export const applicationDeployments = pgTable(
  "application_deployments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    uuid: text("uuid")
      .notNull()
      .unique()
      .$defaultFn(() => createId()),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    deploymentUuid: text("deployment_uuid")
      .notNull()
      .$defaultFn(() => createId()),
    pullRequestId: integer("pull_request_id"),
    forceRebuild: boolean("force_rebuild").default(false).notNull(),
    commit: varchar("commit", { length: 255 }),
    commitMessage: text("commit_message"),
    status: deploymentStatusEnum("status").default("queued").notNull(),
    logs: text("logs"),
    currentProcessId: text("current_process_id"),
    restartOnly: boolean("restart_only").default(false).notNull(),
    gitType: varchar("git_type", { length: 50 }),
    serverId: text("server_id"),
    onlyThisServer: boolean("only_this_server").default(false).notNull(),
    rollbackVersion: varchar("rollback_version", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    applicationIdIdx: index("application_deployments_application_id_idx").on(
      table.applicationId
    ),
    statusIdx: index("application_deployments_status_idx").on(table.status),
    deploymentUuidIdx: index("application_deployments_deployment_uuid_idx").on(
      table.deploymentUuid
    ),
  })
);

export const applicationDeploymentsRelations = relations(
  applicationDeployments,
  ({ one }) => ({
    application: one(applications, {
      fields: [applicationDeployments.applicationId],
      references: [applications.id],
    }),
  })
);

// PR Previews
export const applicationPreviews = pgTable(
  "application_previews",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    uuid: text("uuid")
      .notNull()
      .unique()
      .$defaultFn(() => createId()),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    pullRequestId: integer("pull_request_id").notNull(),
    pullRequestHtmlUrl: text("pull_request_html_url"),
    fqdn: text("fqdn"),
    status: varchar("status", { length: 50 }).default("exited"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    applicationIdIdx: index("application_previews_application_id_idx").on(
      table.applicationId
    ),
  })
);

export const applicationPreviewsRelations = relations(
  applicationPreviews,
  ({ one }) => ({
    application: one(applications, {
      fields: [applicationPreviews.applicationId],
      references: [applications.id],
    }),
  })
);

// Environment Variables
export const applicationEnvironmentVariables = pgTable(
  "application_environment_variables",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    uuid: text("uuid")
      .notNull()
      .unique()
      .$defaultFn(() => createId()),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 255 }).notNull(),
    value: text("value"),
    isBuildTime: boolean("is_build_time").default(false).notNull(),
    isPreview: boolean("is_preview").default(false).notNull(),
    isMultiline: boolean("is_multiline").default(false).notNull(),
    isLiteral: boolean("is_literal").default(false).notNull(),
    isShownOnce: boolean("is_shown_once").default(false).notNull(),
    realValue: text("real_value"),
    version: varchar("version", { length: 10 }).default("4.0.0"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    applicationIdIdx: index(
      "application_environment_variables_application_id_idx"
    ).on(table.applicationId),
  })
);

export const applicationEnvironmentVariablesRelations = relations(
  applicationEnvironmentVariables,
  ({ one }) => ({
    application: one(applications, {
      fields: [applicationEnvironmentVariables.applicationId],
      references: [applications.id],
    }),
  })
);

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type ApplicationDeployment = typeof applicationDeployments.$inferSelect;
export type ApplicationPreview = typeof applicationPreviews.$inferSelect;
export type ApplicationEnvironmentVariable =
  typeof applicationEnvironmentVariables.$inferSelect;
