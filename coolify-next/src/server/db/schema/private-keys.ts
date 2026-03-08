import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { teams } from "./teams";
import { servers } from "./servers";

export const privateKeys = pgTable(
  "private_keys",
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
    privateKey: text("private_key").notNull(),
    publicKey: text("public_key"),
    fingerprint: varchar("fingerprint", { length: 255 }),
    isDefault: boolean("is_default").default(false).notNull(),
    isGitRelated: boolean("is_git_related").default(false).notNull(),
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
    teamIdIdx: index("private_keys_team_id_idx").on(table.teamId),
    uuidIdx: index("private_keys_uuid_idx").on(table.uuid),
  })
);

export const privateKeysRelations = relations(privateKeys, ({ one, many }) => ({
  team: one(teams, {
    fields: [privateKeys.teamId],
    references: [teams.id],
  }),
  servers: many(servers),
}));

export type PrivateKey = typeof privateKeys.$inferSelect;
export type NewPrivateKey = typeof privateKeys.$inferInsert;
