import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { environments } from "./environments";
import { destinations } from "./destinations";

export const services = pgTable(
  "services",
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

    // Docker Compose configuration
    dockerCompose: text("docker_compose"),
    dockerComposeRaw: text("docker_compose_raw"),
    composeParsingVersion: varchar("compose_parsing_version", { length: 10 }),
    configHash: text("config_hash"),

    // Networking
    connectToDockerNetwork: boolean("connect_to_docker_network")
      .default(false)
      .notNull(),

    // Template info
    serviceType: varchar("service_type", { length: 255 }),

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
    environmentIdIdx: index("services_environment_id_idx").on(
      table.environmentId
    ),
    destinationIdIdx: index("services_destination_id_idx").on(
      table.destinationId
    ),
    uuidIdx: index("services_uuid_idx").on(table.uuid),
  })
);

export const servicesRelations = relations(services, ({ one, many }) => ({
  environment: one(environments, {
    fields: [services.environmentId],
    references: [environments.id],
  }),
  destination: one(destinations, {
    fields: [services.destinationId],
    references: [destinations.id],
  }),
  applications: many(serviceApplications),
  databases: many(serviceDatabases),
  environmentVariables: many(serviceEnvironmentVariables),
}));

// Service Applications (containers within a service)
export const serviceApplications = pgTable(
  "service_applications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    uuid: text("uuid")
      .notNull()
      .unique()
      .$defaultFn(() => createId()),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 255 }).notNull(),
    fqdn: text("fqdn"),
    status: varchar("status", { length: 50 }).default("exited"),
    lastOnlineAt: timestamp("last_online_at", { withTimezone: true }),

    // Container config
    image: varchar("image", { length: 255 }),
    excludeFromStatus: boolean("exclude_from_status").default(false).notNull(),
    required: boolean("required").default(false).notNull(),
    isLogDrainEnabled: boolean("is_log_drain_enabled").default(false).notNull(),
    isGzipEnabled: boolean("is_gzip_enabled").default(true).notNull(),
    isStrippathEnabled: boolean("is_strippath_enabled")
      .default(false)
      .notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    serviceIdIdx: index("service_applications_service_id_idx").on(
      table.serviceId
    ),
    uuidIdx: index("service_applications_uuid_idx").on(table.uuid),
  })
);

export const serviceApplicationsRelations = relations(
  serviceApplications,
  ({ one }) => ({
    service: one(services, {
      fields: [serviceApplications.serviceId],
      references: [services.id],
    }),
  })
);

// Service Databases (database containers within a service)
export const serviceDatabases = pgTable(
  "service_databases",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    uuid: text("uuid")
      .notNull()
      .unique()
      .$defaultFn(() => createId()),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 255 }).notNull(),
    status: varchar("status", { length: 50 }).default("exited"),
    lastOnlineAt: timestamp("last_online_at", { withTimezone: true }),

    // Container config
    image: varchar("image", { length: 255 }),
    excludeFromStatus: boolean("exclude_from_status").default(false).notNull(),
    required: boolean("required").default(false).notNull(),
    isPublic: boolean("is_public").default(false).notNull(),
    publicPort: integer("public_port"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    serviceIdIdx: index("service_databases_service_id_idx").on(table.serviceId),
    uuidIdx: index("service_databases_uuid_idx").on(table.uuid),
  })
);

export const serviceDatabasesRelations = relations(
  serviceDatabases,
  ({ one }) => ({
    service: one(services, {
      fields: [serviceDatabases.serviceId],
      references: [services.id],
    }),
  })
);

// Service Environment Variables
export const serviceEnvironmentVariables = pgTable(
  "service_environment_variables",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    uuid: text("uuid")
      .notNull()
      .unique()
      .$defaultFn(() => createId()),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
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
    serviceIdIdx: index("service_environment_variables_service_id_idx").on(
      table.serviceId
    ),
  })
);

export const serviceEnvironmentVariablesRelations = relations(
  serviceEnvironmentVariables,
  ({ one }) => ({
    service: one(services, {
      fields: [serviceEnvironmentVariables.serviceId],
      references: [services.id],
    }),
  })
);

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
export type ServiceApplication = typeof serviceApplications.$inferSelect;
export type ServiceDatabase = typeof serviceDatabases.$inferSelect;
