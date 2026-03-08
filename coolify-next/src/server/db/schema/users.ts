import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { teamMembers, teams } from "./teams";

export const users = pgTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    password: text("password"),
    avatarUrl: text("avatar_url"),
    twoFactorSecret: text("two_factor_secret"),
    twoFactorRecoveryCodes: text("two_factor_recovery_codes"),
    twoFactorConfirmedAt: timestamp("two_factor_confirmed_at", {
      withTimezone: true,
    }),
    forcePasswordReset: boolean("force_password_reset").default(false).notNull(),
    marketingEmails: boolean("marketing_emails").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    emailIdx: uniqueIndex("users_email_idx").on(table.email),
  })
);

export const usersRelations = relations(users, ({ many }) => ({
  teamMembers: many(teamMembers),
  accounts: many(accounts),
  sessions: many(sessions),
}));

// NextAuth.js required tables
export const accounts = pgTable(
  "accounts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 255 }).notNull(),
    provider: varchar("provider", { length: 255 }).notNull(),
    providerAccountId: varchar("provider_account_id", { length: 255 }).notNull(),
    refreshToken: text("refresh_token"),
    accessToken: text("access_token"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    tokenType: varchar("token_type", { length: 255 }),
    scope: text("scope"),
    idToken: text("id_token"),
    sessionState: text("session_state"),
  },
  (table) => ({
    providerProviderAccountIdIdx: uniqueIndex(
      "accounts_provider_provider_account_id_idx"
    ).on(table.provider, table.providerAccountId),
    userIdIdx: index("accounts_user_id_idx").on(table.userId),
  })
);

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

export const sessions = pgTable(
  "sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    sessionToken: text("session_token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => ({
    userIdIdx: index("sessions_user_id_idx").on(table.userId),
  })
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: varchar("identifier", { length: 255 }).notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => ({
    compoundKey: uniqueIndex("verification_tokens_identifier_token_idx").on(
      table.identifier,
      table.token
    ),
  })
);

// API Tokens (like Laravel Sanctum)
export const personalAccessTokens = pgTable(
  "personal_access_tokens",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    token: text("token").notNull().unique(),
    abilities: text("abilities").default("*"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdIdx: index("personal_access_tokens_user_id_idx").on(table.userId),
    tokenIdx: uniqueIndex("personal_access_tokens_token_idx").on(table.token),
  })
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type PersonalAccessToken = typeof personalAccessTokens.$inferSelect;
