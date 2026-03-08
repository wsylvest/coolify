import { relations, sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { teams } from "./teams";
import { environments } from "./environments";

export const projects = pgTable(
  "projects",
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
    teamIdIdx: index("projects_team_id_idx").on(table.teamId),
    uuidIdx: index("projects_uuid_idx").on(table.uuid),
    nameIdx: index("projects_name_idx").on(table.name),
  })
);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  team: one(teams, {
    fields: [projects.teamId],
    references: [teams.id],
  }),
  environments: many(environments),
}));

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
