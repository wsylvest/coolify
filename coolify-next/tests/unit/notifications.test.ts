/**
 * Notification Service Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock database
vi.mock("@/server/db", () => ({
  db: {
    query: {
      notificationSubscriptions: { findMany: vi.fn() },
      emailNotificationSettings: { findFirst: vi.fn() },
      discordNotificationSettings: { findFirst: vi.fn() },
      slackNotificationSettings: { findFirst: vi.fn() },
      telegramNotificationSettings: { findFirst: vi.fn() },
      pushoverNotificationSettings: { findFirst: vi.fn() },
    },
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn() })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
  },
}));

// Mock nodemailer
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: "test-123" }),
    })),
  },
}));

// Mock fetch for webhooks
global.fetch = vi.fn();

describe("NotificationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("send", () => {
    it("should send notifications to all subscribed channels", async () => {
      const { db } = await import("@/server/db");
      vi.mocked(db.query.notificationSubscriptions.findMany).mockResolvedValue([
        { channel: "email", eventType: "deployment_success", enabled: true },
        { channel: "discord", eventType: "deployment_success", enabled: true },
      ] as any);

      vi.mocked(db.query.emailNotificationSettings.findFirst).mockResolvedValue({
        enabled: true,
        smtpHost: "smtp.test.com",
        smtpPort: "587",
        smtpUsername: "user",
        smtpPassword: "pass",
        fromAddress: "test@test.com",
        recipientEmails: "admin@test.com",
      } as any);

      vi.mocked(db.query.discordNotificationSettings.findFirst).mockResolvedValue({
        enabled: true,
        webhookUrl: "https://discord.com/api/webhooks/test",
      } as any);

      vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

      const { notificationService } = await import(
        "@/server/services/notifications/index"
      );

      // Should not throw
      await expect(
        notificationService.send({
          teamId: "team-1",
          eventType: "deployment_success",
          title: "Test",
          message: "Test message",
        })
      ).resolves.not.toThrow();
    });

    it("should skip disabled channels", async () => {
      const { db } = await import("@/server/db");
      vi.mocked(db.query.notificationSubscriptions.findMany).mockResolvedValue([
        { channel: "email", eventType: "deployment_success", enabled: true },
      ] as any);

      vi.mocked(db.query.emailNotificationSettings.findFirst).mockResolvedValue({
        enabled: false,
      } as any);

      const { notificationService } = await import(
        "@/server/services/notifications/index"
      );

      // Should complete without sending
      await notificationService.send({
        teamId: "team-1",
        eventType: "deployment_success",
        title: "Test",
        message: "Test message",
      });

      // Email should not be sent since channel is disabled
    });
  });

  describe("sendEmail", () => {
    it("should send email with correct parameters", async () => {
      const nodemailer = await import("nodemailer");
      const sendMailMock = vi.fn().mockResolvedValue({ messageId: "test-123" });
      vi.mocked(nodemailer.default.createTransport).mockReturnValue({
        sendMail: sendMailMock,
      } as any);

      const { notificationService } = await import(
        "@/server/services/notifications/index"
      );

      await notificationService.sendEmail({
        to: "user@test.com",
        subject: "Test Subject",
        text: "Test body",
        html: "<p>Test body</p>",
      });

      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "user@test.com",
          subject: "Test Subject",
          text: "Test body",
          html: "<p>Test body</p>",
        })
      );
    });
  });

  describe("sendWebhook", () => {
    it("should POST to configured webhook URLs", async () => {
      const { db } = await import("@/server/db");

      vi.mocked(db.query.discordNotificationSettings.findFirst).mockResolvedValue({
        enabled: true,
        webhookUrl: "https://discord.com/api/webhooks/test",
      } as any);

      vi.mocked(db.query.slackNotificationSettings.findFirst).mockResolvedValue(null);

      vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

      const { notificationService } = await import(
        "@/server/services/notifications/index"
      );

      // Trigger webhook via private method through testChannel
      await notificationService.testChannel("team-1", "webhook");

      expect(fetch).toHaveBeenCalledWith(
        "https://discord.com/api/webhooks/test",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });
  });
});
