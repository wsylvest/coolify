import {
  pgTable,
  text,
  timestamp,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { teams } from "./teams";

// Notification channel enum
export const notificationChannelEnum = pgEnum("notification_channel", [
  "email",
  "discord",
  "slack",
  "telegram",
  "pushover",
  "webhook",
]);

// Notification event type enum
export const notificationEventEnum = pgEnum("notification_event", [
  "deployment_success",
  "deployment_failed",
  "application_stopped",
  "application_started",
  "database_backup_success",
  "database_backup_failed",
  "server_unreachable",
  "server_reachable",
  "ssl_expiring",
  "ssl_expired",
  "scheduled_task_success",
  "scheduled_task_failed",
  "container_stopped",
  "container_restarted",
  "high_disk_usage",
  "high_memory_usage",
]);

// Notification settings table (per team)
export const notificationSettings = pgTable("notification_settings", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),

  // Global settings
  notificationsEnabled: boolean("notifications_enabled").default(true),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Email notification settings
export const emailNotificationSettings = pgTable("email_notification_settings", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),

  enabled: boolean("enabled").default(false),

  // SMTP settings
  smtpHost: text("smtp_host"),
  smtpPort: text("smtp_port").default("587"),
  smtpUsername: text("smtp_username"),
  smtpPassword: text("smtp_password"),
  smtpEncryption: text("smtp_encryption").default("tls"), // 'tls', 'ssl', 'none'

  // Sender info
  fromAddress: text("from_address"),
  fromName: text("from_name"),

  // Recipients
  recipientAddresses: text("recipient_addresses"), // JSON array

  // Test
  lastTestedAt: timestamp("last_tested_at"),
  testSuccessful: boolean("test_successful"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Discord notification settings
export const discordNotificationSettings = pgTable(
  "discord_notification_settings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),

    enabled: boolean("enabled").default(false),
    webhookUrl: text("webhook_url"),

    // Test
    lastTestedAt: timestamp("last_tested_at"),
    testSuccessful: boolean("test_successful"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  }
);

// Slack notification settings
export const slackNotificationSettings = pgTable("slack_notification_settings", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),

  enabled: boolean("enabled").default(false),
  webhookUrl: text("webhook_url"),
  channel: text("channel"),

  // Test
  lastTestedAt: timestamp("last_tested_at"),
  testSuccessful: boolean("test_successful"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Telegram notification settings
export const telegramNotificationSettings = pgTable(
  "telegram_notification_settings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),

    enabled: boolean("enabled").default(false),
    botToken: text("bot_token"),
    chatId: text("chat_id"),

    // Test
    lastTestedAt: timestamp("last_tested_at"),
    testSuccessful: boolean("test_successful"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  }
);

// Pushover notification settings
export const pushoverNotificationSettings = pgTable(
  "pushover_notification_settings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),

    enabled: boolean("enabled").default(false),
    userKey: text("user_key"),
    apiToken: text("api_token"),

    // Test
    lastTestedAt: timestamp("last_tested_at"),
    testSuccessful: boolean("test_successful"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  }
);

// Notification event subscriptions (which events to notify for)
export const notificationSubscriptions = pgTable("notification_subscriptions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),

  eventType: notificationEventEnum("event_type").notNull(),
  channel: notificationChannelEnum("channel").notNull(),
  enabled: boolean("enabled").default(true),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Notification history
export const notificationHistory = pgTable("notification_history", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),

  eventType: notificationEventEnum("event_type").notNull(),
  channel: notificationChannelEnum("channel").notNull(),

  // Content
  title: text("title").notNull(),
  message: text("message").notNull(),
  metadata: text("metadata"), // JSON

  // Status
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  success: boolean("success").default(true),
  errorMessage: text("error_message"),

  // Resource reference
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Relations
export const notificationSettingsRelations = relations(
  notificationSettings,
  ({ one }) => ({
    team: one(teams, {
      fields: [notificationSettings.teamId],
      references: [teams.id],
    }),
  })
);

export const emailNotificationSettingsRelations = relations(
  emailNotificationSettings,
  ({ one }) => ({
    team: one(teams, {
      fields: [emailNotificationSettings.teamId],
      references: [teams.id],
    }),
  })
);

export const discordNotificationSettingsRelations = relations(
  discordNotificationSettings,
  ({ one }) => ({
    team: one(teams, {
      fields: [discordNotificationSettings.teamId],
      references: [teams.id],
    }),
  })
);

export const slackNotificationSettingsRelations = relations(
  slackNotificationSettings,
  ({ one }) => ({
    team: one(teams, {
      fields: [slackNotificationSettings.teamId],
      references: [teams.id],
    }),
  })
);

export const telegramNotificationSettingsRelations = relations(
  telegramNotificationSettings,
  ({ one }) => ({
    team: one(teams, {
      fields: [telegramNotificationSettings.teamId],
      references: [teams.id],
    }),
  })
);

export const pushoverNotificationSettingsRelations = relations(
  pushoverNotificationSettings,
  ({ one }) => ({
    team: one(teams, {
      fields: [pushoverNotificationSettings.teamId],
      references: [teams.id],
    }),
  })
);

// Types
export type NotificationSettings = typeof notificationSettings.$inferSelect;
export type EmailNotificationSettings = typeof emailNotificationSettings.$inferSelect;
export type DiscordNotificationSettings = typeof discordNotificationSettings.$inferSelect;
export type SlackNotificationSettings = typeof slackNotificationSettings.$inferSelect;
export type TelegramNotificationSettings = typeof telegramNotificationSettings.$inferSelect;
export type PushoverNotificationSettings = typeof pushoverNotificationSettings.$inferSelect;
export type NotificationSubscription = typeof notificationSubscriptions.$inferSelect;
export type NotificationHistory = typeof notificationHistory.$inferSelect;
