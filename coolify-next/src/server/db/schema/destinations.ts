import { relations, sql } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { servers } from "./servers";

export const destinationTypeEnum = pgEnum("destination_type", [
  "standalone_docker",
  "swarm_docker",
  "kubernetes",
]);

export const destinations = pgTable(
  "destinations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    uuid: text("uuid")
      .notNull()
      .unique()
      .$defaultFn(() => createId()),
    serverId: text("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    type: destinationTypeEnum("type").default("standalone_docker").notNull(),
    network: varchar("network", { length: 255 }).default("coolify").notNull(),
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
    serverIdIdx: index("destinations_server_id_idx").on(table.serverId),
    uuidIdx: index("destinations_uuid_idx").on(table.uuid),
  })
);

export const destinationsRelations = relations(destinations, ({ one }) => ({
  server: one(servers, {
    fields: [destinations.serverId],
    references: [servers.id],
  }),
}));

export type Destination = typeof destinations.$inferSelect;
export type NewDestination = typeof destinations.$inferInsert;
