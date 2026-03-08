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
import { servers } from "./servers";

// SSL certificate status enum
export const sslStatusEnum = pgEnum("ssl_status", [
  "pending",
  "issuing",
  "valid",
  "expired",
  "error",
]);

// SSL provider enum
export const sslProviderEnum = pgEnum("ssl_provider", [
  "letsencrypt",
  "custom",
  "self_signed",
]);

// Proxy configuration table
export const proxyConfigurations = pgTable("proxy_configurations", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  serverId: text("server_id")
    .notNull()
    .references(() => servers.id, { onDelete: "cascade" }),

  // Proxy status
  isRunning: boolean("is_running").default(false),
  lastStartedAt: timestamp("last_started_at"),
  lastStoppedAt: timestamp("last_stopped_at"),

  // Configuration
  configYaml: text("config_yaml"),
  dynamicConfigYaml: text("dynamic_config_yaml"),

  // Ports
  httpPort: integer("http_port").default(80),
  httpsPort: integer("https_port").default(443),
  dashboardPort: integer("dashboard_port").default(8080),
  dashboardEnabled: boolean("dashboard_enabled").default(false),

  // Access log settings
  accessLogsEnabled: boolean("access_logs_enabled").default(false),
  errorLogsEnabled: boolean("error_logs_enabled").default(true),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// SSL certificates table
export const sslCertificates = pgTable("ssl_certificates", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  uuid: text("uuid")
    .notNull()
    .$defaultFn(() => createId())
    .unique(),

  // Domain info
  domain: text("domain").notNull(),
  wildcard: boolean("wildcard").default(false),

  // Certificate data
  certificate: text("certificate"),
  privateKey: text("private_key"),
  certificateChain: text("certificate_chain"),

  // Status
  status: sslStatusEnum("status").default("pending").notNull(),
  provider: sslProviderEnum("provider").default("letsencrypt").notNull(),

  // Let's Encrypt specific
  acmeAccountEmail: text("acme_account_email"),
  challengeType: text("challenge_type").default("http"),

  // Expiry tracking
  issuedAt: timestamp("issued_at"),
  expiresAt: timestamp("expires_at"),
  renewalAttemptedAt: timestamp("renewal_attempted_at"),

  // Error tracking
  lastError: text("last_error"),

  // Relations
  serverId: text("server_id").references(() => servers.id, {
    onDelete: "cascade",
  }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Domain management table
export const domains = pgTable("domains", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  uuid: text("uuid")
    .notNull()
    .$defaultFn(() => createId())
    .unique(),

  // Domain info
  fqdn: text("fqdn").notNull(),
  isWildcard: boolean("is_wildcard").default(false),

  // Target resource (polymorphic)
  resourceType: text("resource_type").notNull(), // 'application', 'service', 'database'
  resourceId: text("resource_id").notNull(),

  // SSL
  sslEnabled: boolean("ssl_enabled").default(true),
  sslCertificateId: text("ssl_certificate_id").references(
    () => sslCertificates.id
  ),
  forceHttps: boolean("force_https").default(true),

  // Proxy settings
  pathPrefix: text("path_prefix").default("/"),
  redirectType: text("redirect_type").default("permanent"), // 'permanent', 'temporary', 'none'

  // Headers
  customHeaders: text("custom_headers"), // JSON
  corsEnabled: boolean("cors_enabled").default(false),
  corsOrigins: text("cors_origins"),

  // Rate limiting
  rateLimitEnabled: boolean("rate_limit_enabled").default(false),
  rateLimitRequests: integer("rate_limit_requests").default(100),
  rateLimitPeriod: text("rate_limit_period").default("1m"),

  // Basic auth
  basicAuthEnabled: boolean("basic_auth_enabled").default(false),
  basicAuthUsers: text("basic_auth_users"), // JSON array

  // Health check
  healthCheckPath: text("health_check_path").default("/"),
  healthCheckInterval: text("health_check_interval").default("30s"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Relations
export const proxyConfigurationsRelations = relations(
  proxyConfigurations,
  ({ one }) => ({
    server: one(servers, {
      fields: [proxyConfigurations.serverId],
      references: [servers.id],
    }),
  })
);

export const sslCertificatesRelations = relations(
  sslCertificates,
  ({ one, many }) => ({
    server: one(servers, {
      fields: [sslCertificates.serverId],
      references: [servers.id],
    }),
    domains: many(domains),
  })
);

export const domainsRelations = relations(domains, ({ one }) => ({
  sslCertificate: one(sslCertificates, {
    fields: [domains.sslCertificateId],
    references: [sslCertificates.id],
  }),
}));

// Types
export type ProxyConfiguration = typeof proxyConfigurations.$inferSelect;
export type NewProxyConfiguration = typeof proxyConfigurations.$inferInsert;
export type SslCertificate = typeof sslCertificates.$inferSelect;
export type NewSslCertificate = typeof sslCertificates.$inferInsert;
export type Domain = typeof domains.$inferSelect;
export type NewDomain = typeof domains.$inferInsert;
