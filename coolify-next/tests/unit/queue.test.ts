/**
 * Queue Service Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock BullMQ
vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation((name) => ({
    name,
    add: vi.fn().mockResolvedValue({ id: "job-123" }),
    getJob: vi.fn(),
    close: vi.fn(),
  })),
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn().mockReturnThis(),
    close: vi.fn(),
  })),
}));

// Mock ioredis
vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => ({
    on: vi.fn().mockReturnThis(),
    quit: vi.fn(),
  })),
}));

describe("Queue Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createQueue", () => {
    it("should create a new queue with default options", async () => {
      const { createQueue } = await import("@/server/queue");
      const queue = createQueue("test-queue");

      expect(queue).toBeDefined();
      expect(queue.name).toBe("test-queue");
    });
  });

  describe("deploymentQueue", () => {
    it("should be exported from queue index", async () => {
      const { deploymentQueue } = await import("@/server/queue");

      expect(deploymentQueue).toBeDefined();
    });
  });

  describe("databaseQueue", () => {
    it("should queue database start job with type field", async () => {
      const { queueDatabaseStart } = await import("@/server/queue/jobs/database");

      await queueDatabaseStart("db-123");

      // Verify the queue add was called with type field
      const { databaseQueue } = await import("@/server/queue/jobs/database");
      expect(databaseQueue.add).toHaveBeenCalledWith(
        "start",
        expect.objectContaining({ type: "start", databaseId: "db-123" })
      );
    });

    it("should queue database backup job with type field", async () => {
      const { queueDatabaseBackup } = await import("@/server/queue/jobs/database");

      await queueDatabaseBackup({
        executionId: "exec-1",
        backupId: "backup-1",
        databaseId: "db-123",
      });

      const { databaseQueue } = await import("@/server/queue/jobs/database");
      expect(databaseQueue.add).toHaveBeenCalledWith(
        "backup",
        expect.objectContaining({
          type: "backup",
          executionId: "exec-1",
          backupId: "backup-1",
          databaseId: "db-123",
        })
      );
    });
  });

  describe("serviceQueue", () => {
    it("should queue service start job with type field", async () => {
      const { queueServiceStart } = await import("@/server/queue/jobs/service");

      await queueServiceStart("svc-123");

      const { serviceQueue } = await import("@/server/queue/jobs/service");
      expect(serviceQueue.add).toHaveBeenCalledWith(
        "start",
        expect.objectContaining({ type: "start", serviceId: "svc-123" })
      );
    });

    it("should queue service restart job with type field", async () => {
      const { queueServiceRestart } = await import("@/server/queue/jobs/service");

      await queueServiceRestart("svc-123");

      const { serviceQueue } = await import("@/server/queue/jobs/service");
      expect(serviceQueue.add).toHaveBeenCalledWith(
        "restart",
        expect.objectContaining({ type: "restart", serviceId: "svc-123" })
      );
    });
  });

  describe("previewCleanupQueue", () => {
    it("should queue preview cleanup job", async () => {
      const { queuePreviewCleanup } = await import("@/server/queue/jobs/preview-cleanup");

      const jobId = await queuePreviewCleanup({
        applicationId: "app-123",
        pullRequestId: 42,
        repositoryFullName: "owner/repo",
      });

      expect(jobId).toBe("job-123");
    });
  });

  describe("QUEUE_NAMES", () => {
    it("should export all queue names", async () => {
      const { QUEUE_NAMES } = await import("@/server/queue");

      expect(QUEUE_NAMES.DEPLOYMENT).toBe("deployment");
      expect(QUEUE_NAMES.DATABASE).toBe("database");
      expect(QUEUE_NAMES.SERVICE).toBe("service");
      expect(QUEUE_NAMES.SERVICE_DEPLOYMENT).toBe("service-deployment");
      expect(QUEUE_NAMES.SCHEDULED_TASK).toBe("scheduled-task");
      expect(QUEUE_NAMES.PREVIEW_CLEANUP).toBe("preview-cleanup");
    });
  });
});
