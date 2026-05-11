import { Job, Worker, Queue } from "bullmq";
import { db } from "@/server/db";
import { scheduledTasks, taskExecutions } from "@/server/db/schema/advanced";
import { eq, and, lte, isNull } from "drizzle-orm";
import { sshService } from "@/server/services/ssh";
import { notificationService } from "@/server/services/notifications";
import { logger } from "@/lib/logger";
import Redis from "ioredis";
import cron from "node-cron";

export interface ScheduledTaskJobData {
  taskId: string;
  executionId: string;
  triggeredBy: "scheduler" | "manual" | "webhook";
}

// Cron expression mapping for predefined frequencies
const FREQUENCY_CRON_MAP: Record<string, string> = {
  every_minute: "* * * * *",
  every_5_minutes: "*/5 * * * *",
  every_10_minutes: "*/10 * * * *",
  every_15_minutes: "*/15 * * * *",
  every_30_minutes: "*/30 * * * *",
  hourly: "0 * * * *",
  every_6_hours: "0 */6 * * *",
  every_12_hours: "0 */12 * * *",
  daily: "0 0 * * *",
  weekly: "0 0 * * 0",
  monthly: "0 0 1 * *",
};

export function createScheduledTaskWorker(redis: Redis) {
  const worker = new Worker<ScheduledTaskJobData>(
    "scheduled-task",
    async (job) => {
      const { taskId, executionId, triggeredBy } = job.data;

      try {
        // Get task details
        const task = await db.query.scheduledTasks.findFirst({
          where: eq(scheduledTasks.id, taskId),
          with: {
            server: {
              with: {
                privateKey: true,
              },
            },
            team: true,
          },
        });

        if (!task) {
          throw new Error("Task not found");
        }

        if (!task.enabled || task.status !== "active") {
          // Mark execution as skipped
          await db
            .update(taskExecutions)
            .set({
              status: "skipped",
              finishedAt: new Date(),
              output: "Task is disabled or paused",
            })
            .where(eq(taskExecutions.id, executionId));
          return { success: false, skipped: true };
        }

        // Update execution to running
        const startTime = Date.now();
        await db
          .update(taskExecutions)
          .set({
            status: "running",
            startedAt: new Date(),
          })
          .where(eq(taskExecutions.id, executionId));

        let output = "";
        let errorOutput = "";
        let exitCode = 0;
        let success = true;

        try {
          if (task.server?.privateKey) {
            // Execute command on remote server
            const result = await sshService.executeCommand({
              host: task.server.ip,
              port: task.server.port,
              username: task.server.user,
              privateKey: task.server.privateKey.privateKey,
              command: task.command,
              timeout: (task.timeout ?? 3600) * 1000,
            });

            output = result.stdout;
            errorOutput = result.stderr;
            exitCode = result.exitCode ?? (result.success ? 0 : 1);
            success = result.success;
          } else {
            throw new Error("No server configured for task execution");
          }
        } catch (error) {
          success = false;
          errorOutput = error instanceof Error ? error.message : "Unknown error";
          exitCode = 1;
        }

        const duration = Date.now() - startTime;

        // Update execution record
        await db
          .update(taskExecutions)
          .set({
            status: success ? "completed" : "failed",
            finishedAt: new Date(),
            duration,
            output,
            errorOutput,
            exitCode,
          })
          .where(eq(taskExecutions.id, executionId));

        // Update task stats
        const now = new Date();
        await db
          .update(scheduledTasks)
          .set({
            lastRunAt: now,
            nextRunAt: calculateNextRun(task.frequency, task.cronExpression),
            lastSuccessAt: success ? now : task.lastSuccessAt,
            lastFailureAt: success ? task.lastFailureAt : now,
            runCount: (task.runCount ?? 0) + 1,
            failureCount: success
              ? task.failureCount
              : (task.failureCount ?? 0) + 1,
            updatedAt: now,
          })
          .where(eq(scheduledTasks.id, taskId));

        // Send notifications
        if (success && task.notifyOnSuccess) {
          await notificationService.send({
            teamId: task.teamId,
            eventType: "scheduled_task_success",
            title: `Task Completed: ${task.name}`,
            message: `Scheduled task "${task.name}" completed successfully in ${duration}ms`,
            resourceType: "scheduled_task",
            resourceId: taskId,
          });
        } else if (!success && task.notifyOnFailure) {
          await notificationService.send({
            teamId: task.teamId,
            eventType: "scheduled_task_failed",
            title: `Task Failed: ${task.name}`,
            message: `Scheduled task "${task.name}" failed: ${errorOutput.substring(0, 200)}`,
            resourceType: "scheduled_task",
            resourceId: taskId,
          });
        }

        return { success, output, errorOutput, exitCode, duration };
      } catch (error) {
        logger.error("Scheduled task execution failed", {
          error,
          taskId,
          executionId,
        });

        await db
          .update(taskExecutions)
          .set({
            status: "failed",
            finishedAt: new Date(),
            errorOutput: error instanceof Error ? error.message : "Unknown error",
            exitCode: 1,
          })
          .where(eq(taskExecutions.id, executionId));

        throw error;
      }
    },
    {
      connection: redis,
      concurrency: 10,
    }
  );

  return worker;
}

export function createScheduledTaskQueue(redis: Redis) {
  return new Queue<ScheduledTaskJobData>("scheduled-task", {
    connection: redis,
  });
}

/**
 * Calculate the next run time based on frequency
 */
function calculateNextRun(
  frequency: string,
  customCron?: string | null
): Date {
  const cronExpr = frequency === "custom" && customCron
    ? customCron
    : FREQUENCY_CRON_MAP[frequency] ?? "0 0 * * *";

  // Parse cron and calculate next run
  const interval = cron.schedule(cronExpr, () => {}, { scheduled: false });

  // Simple calculation - add the interval
  const now = new Date();
  switch (frequency) {
    case "every_minute":
      return new Date(now.getTime() + 60 * 1000);
    case "every_5_minutes":
      return new Date(now.getTime() + 5 * 60 * 1000);
    case "every_10_minutes":
      return new Date(now.getTime() + 10 * 60 * 1000);
    case "every_15_minutes":
      return new Date(now.getTime() + 15 * 60 * 1000);
    case "every_30_minutes":
      return new Date(now.getTime() + 30 * 60 * 1000);
    case "hourly":
      return new Date(now.getTime() + 60 * 60 * 1000);
    case "every_6_hours":
      return new Date(now.getTime() + 6 * 60 * 60 * 1000);
    case "every_12_hours":
      return new Date(now.getTime() + 12 * 60 * 60 * 1000);
    case "daily":
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "weekly":
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case "monthly":
      const next = new Date(now);
      next.setMonth(next.getMonth() + 1);
      return next;
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

/**
 * Scheduler service that checks for due tasks
 */
export class TaskSchedulerService {
  private queue: Queue<ScheduledTaskJobData>;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(queue: Queue<ScheduledTaskJobData>) {
    this.queue = queue;
  }

  /**
   * Start the scheduler
   */
  start(intervalMs = 60000) {
    logger.info("Starting task scheduler");

    this.checkInterval = setInterval(() => {
      this.checkAndQueueDueTasks();
    }, intervalMs);

    // Run immediately
    this.checkAndQueueDueTasks();
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logger.info("Task scheduler stopped");
  }

  /**
   * Check for due tasks and queue them
   */
  private async checkAndQueueDueTasks() {
    try {
      const now = new Date();

      // Find tasks that are due to run
      const dueTasks = await db.query.scheduledTasks.findMany({
        where: and(
          eq(scheduledTasks.enabled, true),
          eq(scheduledTasks.status, "active"),
          lte(scheduledTasks.nextRunAt, now)
        ),
      });

      for (const task of dueTasks) {
        await this.queueTask(task.id, "scheduler");
      }

      if (dueTasks.length > 0) {
        logger.info(`Queued ${dueTasks.length} scheduled tasks`);
      }
    } catch (error) {
      logger.error("Error checking for due tasks", { error });
    }
  }

  /**
   * Queue a task for execution
   */
  async queueTask(
    taskId: string,
    triggeredBy: "scheduler" | "manual" | "webhook"
  ): Promise<string> {
    // Create execution record
    const [execution] = await db
      .insert(taskExecutions)
      .values({
        taskId,
        status: "pending",
        triggeredBy,
      })
      .returning();

    // Add to queue
    await this.queue.add(
      "execute",
      {
        taskId,
        executionId: execution.id,
        triggeredBy,
      },
      {
        removeOnComplete: 100,
        removeOnFail: 100,
      }
    );

    return execution.id;
  }
}
