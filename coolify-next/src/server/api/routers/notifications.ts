import { z } from "zod";
import { createTRPCRouter, teamProcedure, adminProcedure } from "../trpc";
import {
  notificationSettings,
  emailNotificationSettings,
  discordNotificationSettings,
  slackNotificationSettings,
  telegramNotificationSettings,
  pushoverNotificationSettings,
  notificationSubscriptions,
  notificationHistory,
} from "@/server/db/schema/notifications";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { notificationService } from "@/server/services/notifications";

const notificationEventTypes = [
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
] as const;

const notificationChannels = [
  "email",
  "discord",
  "slack",
  "telegram",
  "pushover",
  "webhook",
] as const;

export const notificationsRouter = createTRPCRouter({
  /**
   * Get notification settings for the team
   */
  getSettings: teamProcedure.query(async ({ ctx }) => {
    const [settings, email, discord, slack, telegram, pushover] =
      await Promise.all([
        ctx.db.query.notificationSettings.findFirst({
          where: eq(notificationSettings.teamId, ctx.team.id),
        }),
        ctx.db.query.emailNotificationSettings.findFirst({
          where: eq(emailNotificationSettings.teamId, ctx.team.id),
        }),
        ctx.db.query.discordNotificationSettings.findFirst({
          where: eq(discordNotificationSettings.teamId, ctx.team.id),
        }),
        ctx.db.query.slackNotificationSettings.findFirst({
          where: eq(slackNotificationSettings.teamId, ctx.team.id),
        }),
        ctx.db.query.telegramNotificationSettings.findFirst({
          where: eq(telegramNotificationSettings.teamId, ctx.team.id),
        }),
        ctx.db.query.pushoverNotificationSettings.findFirst({
          where: eq(pushoverNotificationSettings.teamId, ctx.team.id),
        }),
      ]);

    return {
      global: settings,
      email,
      discord,
      slack,
      telegram,
      pushover,
    };
  }),

  /**
   * Update global notification settings
   */
  updateGlobalSettings: adminProcedure
    .input(
      z.object({
        notificationsEnabled: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.notificationSettings.findFirst({
        where: eq(notificationSettings.teamId, ctx.team.id),
      });

      if (existing) {
        await ctx.db
          .update(notificationSettings)
          .set({
            notificationsEnabled: input.notificationsEnabled,
            updatedAt: new Date(),
          })
          .where(eq(notificationSettings.id, existing.id));
      } else {
        await ctx.db.insert(notificationSettings).values({
          teamId: ctx.team.id,
          notificationsEnabled: input.notificationsEnabled,
        });
      }

      return { success: true };
    }),

  /**
   * Update email notification settings
   */
  updateEmailSettings: adminProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        smtpHost: z.string().optional(),
        smtpPort: z.string().optional(),
        smtpUsername: z.string().optional(),
        smtpPassword: z.string().optional(),
        smtpEncryption: z.enum(["tls", "ssl", "none"]).optional(),
        fromAddress: z.string().email().optional(),
        fromName: z.string().optional(),
        recipientAddresses: z.array(z.string().email()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.emailNotificationSettings.findFirst({
        where: eq(emailNotificationSettings.teamId, ctx.team.id),
      });

      const data = {
        enabled: input.enabled,
        smtpHost: input.smtpHost,
        smtpPort: input.smtpPort,
        smtpUsername: input.smtpUsername,
        smtpPassword: input.smtpPassword,
        smtpEncryption: input.smtpEncryption,
        fromAddress: input.fromAddress,
        fromName: input.fromName,
        recipientAddresses: input.recipientAddresses
          ? JSON.stringify(input.recipientAddresses)
          : undefined,
        updatedAt: new Date(),
      };

      if (existing) {
        await ctx.db
          .update(emailNotificationSettings)
          .set(data)
          .where(eq(emailNotificationSettings.id, existing.id));
      } else {
        await ctx.db.insert(emailNotificationSettings).values({
          teamId: ctx.team.id,
          ...data,
        });
      }

      return { success: true };
    }),

  /**
   * Update Discord notification settings
   */
  updateDiscordSettings: adminProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        webhookUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.discordNotificationSettings.findFirst(
        {
          where: eq(discordNotificationSettings.teamId, ctx.team.id),
        }
      );

      const data = {
        enabled: input.enabled,
        webhookUrl: input.webhookUrl,
        updatedAt: new Date(),
      };

      if (existing) {
        await ctx.db
          .update(discordNotificationSettings)
          .set(data)
          .where(eq(discordNotificationSettings.id, existing.id));
      } else {
        await ctx.db.insert(discordNotificationSettings).values({
          teamId: ctx.team.id,
          ...data,
        });
      }

      return { success: true };
    }),

  /**
   * Update Slack notification settings
   */
  updateSlackSettings: adminProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        webhookUrl: z.string().url().optional(),
        channel: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.slackNotificationSettings.findFirst({
        where: eq(slackNotificationSettings.teamId, ctx.team.id),
      });

      const data = {
        enabled: input.enabled,
        webhookUrl: input.webhookUrl,
        channel: input.channel,
        updatedAt: new Date(),
      };

      if (existing) {
        await ctx.db
          .update(slackNotificationSettings)
          .set(data)
          .where(eq(slackNotificationSettings.id, existing.id));
      } else {
        await ctx.db.insert(slackNotificationSettings).values({
          teamId: ctx.team.id,
          ...data,
        });
      }

      return { success: true };
    }),

  /**
   * Update Telegram notification settings
   */
  updateTelegramSettings: adminProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        botToken: z.string().optional(),
        chatId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing =
        await ctx.db.query.telegramNotificationSettings.findFirst({
          where: eq(telegramNotificationSettings.teamId, ctx.team.id),
        });

      const data = {
        enabled: input.enabled,
        botToken: input.botToken,
        chatId: input.chatId,
        updatedAt: new Date(),
      };

      if (existing) {
        await ctx.db
          .update(telegramNotificationSettings)
          .set(data)
          .where(eq(telegramNotificationSettings.id, existing.id));
      } else {
        await ctx.db.insert(telegramNotificationSettings).values({
          teamId: ctx.team.id,
          ...data,
        });
      }

      return { success: true };
    }),

  /**
   * Update Pushover notification settings
   */
  updatePushoverSettings: adminProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        userKey: z.string().optional(),
        apiToken: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing =
        await ctx.db.query.pushoverNotificationSettings.findFirst({
          where: eq(pushoverNotificationSettings.teamId, ctx.team.id),
        });

      const data = {
        enabled: input.enabled,
        userKey: input.userKey,
        apiToken: input.apiToken,
        updatedAt: new Date(),
      };

      if (existing) {
        await ctx.db
          .update(pushoverNotificationSettings)
          .set(data)
          .where(eq(pushoverNotificationSettings.id, existing.id));
      } else {
        await ctx.db.insert(pushoverNotificationSettings).values({
          teamId: ctx.team.id,
          ...data,
        });
      }

      return { success: true };
    }),

  /**
   * Test a notification channel
   */
  testChannel: adminProcedure
    .input(
      z.object({
        channel: z.enum(notificationChannels),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await notificationService.testChannel(
        ctx.team.id,
        input.channel
      );

      if (!result.success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.error ?? "Test failed",
        });
      }

      return { success: true };
    }),

  /**
   * Get notification subscriptions
   */
  getSubscriptions: teamProcedure.query(async ({ ctx }) => {
    const subscriptions = await ctx.db.query.notificationSubscriptions.findMany(
      {
        where: eq(notificationSubscriptions.teamId, ctx.team.id),
      }
    );

    return subscriptions;
  }),

  /**
   * Update notification subscription
   */
  updateSubscription: adminProcedure
    .input(
      z.object({
        eventType: z.enum(notificationEventTypes),
        channel: z.enum(notificationChannels),
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.notificationSubscriptions.findFirst({
        where: and(
          eq(notificationSubscriptions.teamId, ctx.team.id),
          eq(notificationSubscriptions.eventType, input.eventType),
          eq(notificationSubscriptions.channel, input.channel)
        ),
      });

      if (existing) {
        await ctx.db
          .update(notificationSubscriptions)
          .set({
            enabled: input.enabled,
            updatedAt: new Date(),
          })
          .where(eq(notificationSubscriptions.id, existing.id));
      } else {
        await ctx.db.insert(notificationSubscriptions).values({
          teamId: ctx.team.id,
          eventType: input.eventType,
          channel: input.channel,
          enabled: input.enabled,
        });
      }

      return { success: true };
    }),

  /**
   * Bulk update subscriptions
   */
  bulkUpdateSubscriptions: adminProcedure
    .input(
      z.object({
        subscriptions: z.array(
          z.object({
            eventType: z.enum(notificationEventTypes),
            channel: z.enum(notificationChannels),
            enabled: z.boolean(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      for (const sub of input.subscriptions) {
        const existing = await ctx.db.query.notificationSubscriptions.findFirst(
          {
            where: and(
              eq(notificationSubscriptions.teamId, ctx.team.id),
              eq(notificationSubscriptions.eventType, sub.eventType),
              eq(notificationSubscriptions.channel, sub.channel)
            ),
          }
        );

        if (existing) {
          await ctx.db
            .update(notificationSubscriptions)
            .set({
              enabled: sub.enabled,
              updatedAt: new Date(),
            })
            .where(eq(notificationSubscriptions.id, existing.id));
        } else {
          await ctx.db.insert(notificationSubscriptions).values({
            teamId: ctx.team.id,
            eventType: sub.eventType,
            channel: sub.channel,
            enabled: sub.enabled,
          });
        }
      }

      return { success: true };
    }),

  /**
   * Get notification history
   */
  getHistory: teamProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
        eventType: z.enum(notificationEventTypes).optional(),
        channel: z.enum(notificationChannels).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const history = await ctx.db.query.notificationHistory.findMany({
        where: eq(notificationHistory.teamId, ctx.team.id),
        orderBy: [desc(notificationHistory.sentAt)],
        limit: input.limit,
        offset: input.offset,
      });

      return history;
    }),

  /**
   * Send a test notification (internal use)
   */
  sendTestNotification: adminProcedure
    .input(
      z.object({
        eventType: z.enum(notificationEventTypes),
        title: z.string(),
        message: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await notificationService.send({
        teamId: ctx.team.id,
        eventType: input.eventType,
        title: input.title,
        message: input.message,
      });

      return { success: true };
    }),
});
