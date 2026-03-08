import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { users } from "./users";
import { projects } from "./projects";
import { servers } from "./servers";
import { privateKeys } from "./private-keys";

export const teamRoleEnum = pgEnum("team_role", ["owner", "admin", "member"]);

export const teams = pgTable(
  "teams",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    personalTeam: boolean("personal_team").default(false).notNull(),
    showBoarding: boolean("show_boarding").default(true).notNull(),
    resendEnabled: boolean("resend_enabled").default(false).notNull(),
    resendApiKey: text("resend_api_key"),
    smtpEnabled: boolean("smtp_enabled").default(false).notNull(),
    smtpFromAddress: varchar("smtp_from_address", { length: 255 }),
    smtpFromName: varchar("smtp_from_name", { length: 255 }),
    smtpHost: varchar("smtp_host", { length: 255 }),
    smtpPort: varchar("smtp_port", { length: 10 }),
    smtpEncryption: varchar("smtp_encryption", { length: 10 }),
    smtpUsername: varchar("smtp_username", { length: 255 }),
    smtpPassword: text("smtp_password"),
    smtpTimeout: varchar("smtp_timeout", { length: 10 }),
    customServerLimit: text("custom_server_limit"),
    useInstanceEmailSettings: boolean("use_instance_email_settings")
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
    nameIdx: index("teams_name_idx").on(table.name),
  })
);

export const teamsRelations = relations(teams, ({ many }) => ({
  members: many(teamMembers),
  invitations: many(teamInvitations),
  projects: many(projects),
  servers: many(servers),
  privateKeys: many(privateKeys),
}));

export const teamMembers = pgTable(
  "team_members",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: teamRoleEnum("role").default("member").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    teamUserIdx: uniqueIndex("team_members_team_user_idx").on(
      table.teamId,
      table.userId
    ),
    teamIdIdx: index("team_members_team_id_idx").on(table.teamId),
    userIdIdx: index("team_members_user_id_idx").on(table.userId),
  })
);

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id],
  }),
}));

export const teamInvitations = pgTable(
  "team_invitations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    uuid: text("uuid")
      .notNull()
      .unique()
      .$defaultFn(() => createId()),
    email: varchar("email", { length: 255 }).notNull(),
    role: teamRoleEnum("role").default("member").notNull(),
    invitedBy: text("invited_by").references(() => users.id, {
      onDelete: "set null",
    }),
    link: text("link").notNull(),
    viaLink: boolean("via_link").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    teamIdIdx: index("team_invitations_team_id_idx").on(table.teamId),
    emailIdx: index("team_invitations_email_idx").on(table.email),
  })
);

export const teamInvitationsRelations = relations(
  teamInvitations,
  ({ one }) => ({
    team: one(teams, {
      fields: [teamInvitations.teamId],
      references: [teams.id],
    }),
    inviter: one(users, {
      fields: [teamInvitations.invitedBy],
      references: [users.id],
    }),
  })
);

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type TeamInvitation = typeof teamInvitations.$inferSelect;
