import { relations, sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { projects } from "./projects";
import { applications } from "./applications";
import { databases } from "./databases";
import { services } from "./services";

export const environments = pgTable(
  "environments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    uuid: text("uuid")
      .notNull()
      .unique()
      .$defaultFn(() => createId()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
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
    projectIdIdx: index("environments_project_id_idx").on(table.projectId),
    uuidIdx: index("environments_uuid_idx").on(table.uuid),
    nameIdx: index("environments_name_idx").on(table.name),
  })
);

export const environmentsRelations = relations(
  environments,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [environments.projectId],
      references: [projects.id],
    }),
    applications: many(applications),
    databases: many(databases),
    services: many(services),
  })
);

export type Environment = typeof environments.$inferSelect;
export type NewEnvironment = typeof environments.$inferInsert;
