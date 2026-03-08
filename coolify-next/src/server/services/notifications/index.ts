import { logger } from "@/lib/logger";
import { db } from "@/server/db";
import {
  emailNotificationSettings,
  discordNotificationSettings,
  slackNotificationSettings,
  telegramNotificationSettings,
  pushoverNotificationSettings,
  notificationSubscriptions,
  notificationHistory,
} from "@/server/db/schema/notifications";
import { eq, and } from "drizzle-orm";
import nodemailer from "nodemailer";

export type NotificationChannel =
  | "email"
  | "discord"
  | "slack"
  | "telegram"
  | "pushover"
  | "webhook";

export type NotificationEventType =
  | "deployment_success"
  | "deployment_failed"
  | "application_stopped"
  | "application_started"
  | "database_backup_success"
  | "database_backup_failed"
  | "server_unreachable"
  | "server_reachable"
  | "ssl_expiring"
  | "ssl_expired"
  | "scheduled_task_success"
  | "scheduled_task_failed"
  | "container_stopped"
  | "container_restarted"
  | "high_disk_usage"
  | "high_memory_usage";

export interface NotificationPayload {
  title: string;
  message: string;
  eventType: NotificationEventType;
  teamId: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

class NotificationService {
  /**
   * Send a notification to all enabled channels for a team
   */
  async send(payload: NotificationPayload): Promise<void> {
    const { teamId, eventType } = payload;

    try {
      // Get subscriptions for this event type
      const subscriptions = await db.query.notificationSubscriptions.findMany({
        where: and(
          eq(notificationSubscriptions.teamId, teamId),
          eq(notificationSubscriptions.eventType, eventType),
          eq(notificationSubscriptions.enabled, true)
        ),
      });

      // Send to each subscribed channel
      const sendPromises = subscriptions.map((sub) =>
        this.sendToChannel(sub.channel, payload)
      );

      const results = await Promise.allSettled(sendPromises);

      // Log results
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const channel = subscriptions[i]?.channel;

        await db.insert(notificationHistory).values({
          teamId,
          eventType,
          channel: channel ?? "email",
          title: payload.title,
          message: payload.message,
          metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
          success: result?.status === "fulfilled",
          errorMessage:
            result?.status === "rejected"
              ? String(result.reason)
              : null,
          resourceType: payload.resourceType,
          resourceId: payload.resourceId,
        });
      }
    } catch (error) {
      logger.error("Failed to send notification", { error, payload });
    }
  }

  /**
   * Send notification to a specific channel
   */
  private async sendToChannel(
    channel: NotificationChannel,
    payload: NotificationPayload
  ): Promise<void> {
    switch (channel) {
      case "email":
        await this.sendEmail(payload);
        break;
      case "discord":
        await this.sendDiscord(payload);
        break;
      case "slack":
        await this.sendSlack(payload);
        break;
      case "telegram":
        await this.sendTelegram(payload);
        break;
      case "pushover":
        await this.sendPushover(payload);
        break;
      case "webhook":
        await this.sendWebhook(payload);
        break;
    }
  }

  /**
   * Send email notification
   */
  private async sendEmail(payload: NotificationPayload): Promise<void> {
    const settings = await db.query.emailNotificationSettings.findFirst({
      where: and(
        eq(emailNotificationSettings.teamId, payload.teamId),
        eq(emailNotificationSettings.enabled, true)
      ),
    });

    if (!settings || !settings.smtpHost || !settings.recipientAddresses) {
      throw new Error("Email notifications not configured");
    }

    const transporter = nodemailer.createTransport({
      host: settings.smtpHost,
      port: parseInt(settings.smtpPort ?? "587"),
      secure: settings.smtpEncryption === "ssl",
      auth: settings.smtpUsername
        ? {
            user: settings.smtpUsername,
            pass: settings.smtpPassword ?? "",
          }
        : undefined,
    });

    const recipients = JSON.parse(settings.recipientAddresses) as string[];

    await transporter.sendMail({
      from: `"${settings.fromName ?? "Coolify"}" <${settings.fromAddress ?? "noreply@coolify.io"}>`,
      to: recipients.join(", "),
      subject: payload.title,
      text: payload.message,
      html: this.formatEmailHtml(payload),
    });

    logger.info("Email notification sent", {
      teamId: payload.teamId,
      eventType: payload.eventType,
    });
  }

  /**
   * Send Discord notification
   */
  private async sendDiscord(payload: NotificationPayload): Promise<void> {
    const settings = await db.query.discordNotificationSettings.findFirst({
      where: and(
        eq(discordNotificationSettings.teamId, payload.teamId),
        eq(discordNotificationSettings.enabled, true)
      ),
    });

    if (!settings?.webhookUrl) {
      throw new Error("Discord notifications not configured");
    }

    const color = this.getColorForEventType(payload.eventType);

    const response = await fetch(settings.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: payload.title,
            description: payload.message,
            color,
            timestamp: new Date().toISOString(),
            footer: {
              text: "Coolify",
            },
            fields: payload.metadata
              ? Object.entries(payload.metadata).map(([name, value]) => ({
                  name,
                  value: String(value),
                  inline: true,
                }))
              : undefined,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.status}`);
    }

    logger.info("Discord notification sent", {
      teamId: payload.teamId,
      eventType: payload.eventType,
    });
  }

  /**
   * Send Slack notification
   */
  private async sendSlack(payload: NotificationPayload): Promise<void> {
    const settings = await db.query.slackNotificationSettings.findFirst({
      where: and(
        eq(slackNotificationSettings.teamId, payload.teamId),
        eq(slackNotificationSettings.enabled, true)
      ),
    });

    if (!settings?.webhookUrl) {
      throw new Error("Slack notifications not configured");
    }

    const color = this.getSlackColorForEventType(payload.eventType);

    const response = await fetch(settings.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: settings.channel,
        attachments: [
          {
            color,
            title: payload.title,
            text: payload.message,
            ts: Math.floor(Date.now() / 1000),
            footer: "Coolify",
            fields: payload.metadata
              ? Object.entries(payload.metadata).map(([title, value]) => ({
                  title,
                  value: String(value),
                  short: true,
                }))
              : undefined,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed: ${response.status}`);
    }

    logger.info("Slack notification sent", {
      teamId: payload.teamId,
      eventType: payload.eventType,
    });
  }

  /**
   * Send Telegram notification
   */
  private async sendTelegram(payload: NotificationPayload): Promise<void> {
    const settings = await db.query.telegramNotificationSettings.findFirst({
      where: and(
        eq(telegramNotificationSettings.teamId, payload.teamId),
        eq(telegramNotificationSettings.enabled, true)
      ),
    });

    if (!settings?.botToken || !settings?.chatId) {
      throw new Error("Telegram notifications not configured");
    }

    const emoji = this.getEmojiForEventType(payload.eventType);
    const text = `${emoji} *${this.escapeMarkdown(payload.title)}*\n\n${this.escapeMarkdown(payload.message)}`;

    const response = await fetch(
      `https://api.telegram.org/bot${settings.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: settings.chatId,
          text,
          parse_mode: "MarkdownV2",
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telegram API failed: ${error}`);
    }

    logger.info("Telegram notification sent", {
      teamId: payload.teamId,
      eventType: payload.eventType,
    });
  }

  /**
   * Send Pushover notification
   */
  private async sendPushover(payload: NotificationPayload): Promise<void> {
    const settings = await db.query.pushoverNotificationSettings.findFirst({
      where: and(
        eq(pushoverNotificationSettings.teamId, payload.teamId),
        eq(pushoverNotificationSettings.enabled, true)
      ),
    });

    if (!settings?.userKey || !settings?.apiToken) {
      throw new Error("Pushover notifications not configured");
    }

    const priority = this.getPushoverPriorityForEventType(payload.eventType);

    const response = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: settings.apiToken,
        user: settings.userKey,
        title: payload.title,
        message: payload.message,
        priority,
        timestamp: Math.floor(Date.now() / 1000),
      }),
    });

    if (!response.ok) {
      throw new Error(`Pushover API failed: ${response.status}`);
    }

    logger.info("Pushover notification sent", {
      teamId: payload.teamId,
      eventType: payload.eventType,
    });
  }

  /**
   * Send webhook notification
   */
  private async sendWebhook(payload: NotificationPayload): Promise<void> {
    // Webhooks are handled separately - this is for custom webhook endpoints
    // that teams can configure for integrations
    logger.info("Webhook notification placeholder", {
      teamId: payload.teamId,
      eventType: payload.eventType,
    });
  }

  /**
   * Test a notification channel
   */
  async testChannel(
    teamId: string,
    channel: NotificationChannel
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.sendToChannel(channel, {
        teamId,
        eventType: "deployment_success",
        title: "Test Notification",
        message:
          "This is a test notification from Coolify. If you see this, notifications are working correctly!",
      });

      // Update test status
      const settingsTable = this.getSettingsTableForChannel(channel);
      if (settingsTable) {
        await db
          .update(settingsTable)
          .set({
            lastTestedAt: new Date(),
            testSuccessful: true,
          })
          .where(eq(settingsTable.teamId, teamId));
      }

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";

      // Update test status
      const settingsTable = this.getSettingsTableForChannel(channel);
      if (settingsTable) {
        await db
          .update(settingsTable)
          .set({
            lastTestedAt: new Date(),
            testSuccessful: false,
          })
          .where(eq(settingsTable.teamId, teamId));
      }

      return { success: false, error: errorMsg };
    }
  }

  // Helper methods
  private getSettingsTableForChannel(channel: NotificationChannel) {
    switch (channel) {
      case "email":
        return emailNotificationSettings;
      case "discord":
        return discordNotificationSettings;
      case "slack":
        return slackNotificationSettings;
      case "telegram":
        return telegramNotificationSettings;
      case "pushover":
        return pushoverNotificationSettings;
      default:
        return null;
    }
  }

  private getColorForEventType(eventType: NotificationEventType): number {
    const successEvents = [
      "deployment_success",
      "application_started",
      "database_backup_success",
      "server_reachable",
      "scheduled_task_success",
    ];
    const errorEvents = [
      "deployment_failed",
      "application_stopped",
      "database_backup_failed",
      "server_unreachable",
      "ssl_expired",
      "scheduled_task_failed",
      "container_stopped",
    ];
    const warningEvents = ["ssl_expiring", "high_disk_usage", "high_memory_usage"];

    if (successEvents.includes(eventType)) return 0x00ff00; // Green
    if (errorEvents.includes(eventType)) return 0xff0000; // Red
    if (warningEvents.includes(eventType)) return 0xffff00; // Yellow
    return 0x0099ff; // Blue (default)
  }

  private getSlackColorForEventType(eventType: NotificationEventType): string {
    const successEvents = [
      "deployment_success",
      "application_started",
      "database_backup_success",
      "server_reachable",
      "scheduled_task_success",
    ];
    const errorEvents = [
      "deployment_failed",
      "application_stopped",
      "database_backup_failed",
      "server_unreachable",
      "ssl_expired",
      "scheduled_task_failed",
      "container_stopped",
    ];

    if (successEvents.includes(eventType)) return "good";
    if (errorEvents.includes(eventType)) return "danger";
    return "warning";
  }

  private getEmojiForEventType(eventType: NotificationEventType): string {
    const emojiMap: Record<NotificationEventType, string> = {
      deployment_success: "✅",
      deployment_failed: "❌",
      application_stopped: "🛑",
      application_started: "🚀",
      database_backup_success: "💾",
      database_backup_failed: "⚠️",
      server_unreachable: "🔴",
      server_reachable: "🟢",
      ssl_expiring: "⚠️",
      ssl_expired: "🔒",
      scheduled_task_success: "✅",
      scheduled_task_failed: "❌",
      container_stopped: "⏹️",
      container_restarted: "🔄",
      high_disk_usage: "💽",
      high_memory_usage: "🧠",
    };
    return emojiMap[eventType] ?? "📢";
  }

  private getPushoverPriorityForEventType(
    eventType: NotificationEventType
  ): number {
    const criticalEvents = [
      "deployment_failed",
      "server_unreachable",
      "ssl_expired",
    ];
    const highPriorityEvents = [
      "application_stopped",
      "database_backup_failed",
      "scheduled_task_failed",
    ];

    if (criticalEvents.includes(eventType)) return 1; // High priority
    if (highPriorityEvents.includes(eventType)) return 0; // Normal
    return -1; // Low priority (no notification sound)
  }

  private escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
  }

  private formatEmailHtml(payload: NotificationPayload): string {
    const color = payload.eventType.includes("success")
      ? "#10B981"
      : payload.eventType.includes("failed") ||
          payload.eventType.includes("stopped") ||
          payload.eventType.includes("unreachable")
        ? "#EF4444"
        : "#F59E0B";

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background-color: #f4f4f5;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="background-color: ${color}; padding: 20px; color: white;">
      <h1 style="margin: 0; font-size: 20px;">${payload.title}</h1>
    </div>
    <div style="padding: 20px;">
      <p style="margin: 0 0 16px; color: #374151; line-height: 1.6;">${payload.message}</p>
      ${
        payload.metadata
          ? `
        <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
          ${Object.entries(payload.metadata)
            .map(
              ([key, value]) => `
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">${key}</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; color: #111827; font-size: 14px;">${String(value)}</td>
            </tr>
          `
            )
            .join("")}
        </table>
      `
          : ""
      }
    </div>
    <div style="padding: 16px 20px; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0; color: #6b7280; font-size: 12px;">Sent by Coolify</p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }
}

export const notificationService = new NotificationService();
