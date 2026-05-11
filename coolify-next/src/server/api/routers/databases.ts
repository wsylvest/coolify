import { z } from "zod";
import { createTRPCRouter, teamProcedure, adminProcedure } from "../trpc";
import {
  databases,
  databaseBackups,
  databaseBackupExecutions,
  environments,
  destinations,
} from "@/server/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { queueDatabaseStart, queueDatabaseStop, queueDatabaseBackup } from "@/server/queue";
import { generatePassword } from "@/lib/utils";

const databaseInputSchema = z.object({
  name: z.string().min(2).max(255),
  description: z.string().optional(),
  environmentId: z.string(),
  destinationId: z.string().optional(),
  type: z.enum(["postgresql", "mysql", "mariadb", "mongodb", "redis", "clickhouse", "keydb", "dragonfly"]),
  image: z.string(),
  imageTag: z.string().default("latest"),
  isPublic: z.boolean().default(false),
  publicPort: z.number().optional(),
});

export const databasesRouter = createTRPCRouter({
  /**
   * List all databases for a team
   */
  list: teamProcedure.query(async ({ ctx }) => {
    const teamDatabases = await ctx.db.query.databases.findMany({
      where: isNull(databases.deletedAt),
      with: {
        environment: {
          with: {
            project: true,
          },
        },
        destination: {
          with: {
            server: true,
          },
        },
      },
      orderBy: [desc(databases.createdAt)],
    });

    return teamDatabases.filter(
      (db) => db.environment.project.teamId === ctx.team.id
    );
  }),

  /**
   * Get database by ID
   */
  getById: teamProcedure
    .input(z.object({ databaseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const database = await ctx.db.query.databases.findFirst({
        where: and(
          eq(databases.id, input.databaseId),
          isNull(databases.deletedAt)
        ),
        with: {
          environment: {
            with: {
              project: true,
            },
          },
          destination: {
            with: {
              server: true,
            },
          },
          backups: {
            with: {
              executions: {
                orderBy: [desc(databaseBackupExecutions.createdAt)],
                limit: 5,
              },
            },
          },
        },
      });

      if (!database || database.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found",
        });
      }

      return database;
    }),

  /**
   * Create a new database
   */
  create: teamProcedure
    .input(databaseInputSchema)
    .mutation(async ({ ctx, input }) => {
      const environment = await ctx.db.query.environments.findFirst({
        where: eq(environments.id, input.environmentId),
        with: {
          project: true,
        },
      });

      if (!environment || environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment not found",
        });
      }

      // Generate credentials based on database type
      const dbName = input.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
      const dbUser = `${dbName}_user`;
      const dbPassword = generatePassword(32);
      const dbRootPassword = generatePassword(32);

      const [database] = await ctx.db
        .insert(databases)
        .values({
          ...input,
          dbName,
          dbUser,
          dbPassword,
          dbRootPassword,
        })
        .returning();

      if (!database) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create database",
        });
      }

      return database;
    }),

  /**
   * Update database
   */
  update: teamProcedure
    .input(
      z.object({
        databaseId: z.string(),
      }).merge(databaseInputSchema.partial())
    )
    .mutation(async ({ ctx, input }) => {
      const { databaseId, ...updateData } = input;

      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, databaseId),
        with: {
          environment: {
            with: {
              project: true,
            },
          },
        },
      });

      if (!database || database.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found",
        });
      }

      const [updated] = await ctx.db
        .update(databases)
        .set(updateData)
        .where(eq(databases.id, databaseId))
        .returning();

      return updated;
    }),

  /**
   * Delete database
   */
  delete: adminProcedure
    .input(z.object({ databaseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, input.databaseId),
        with: {
          environment: {
            with: {
              project: true,
            },
          },
        },
      });

      if (!database || database.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found",
        });
      }

      await ctx.db
        .update(databases)
        .set({ deletedAt: new Date() })
        .where(eq(databases.id, input.databaseId));

      return { success: true };
    }),

  /**
   * Start database
   */
  start: teamProcedure
    .input(z.object({ databaseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, input.databaseId),
        with: {
          environment: {
            with: {
              project: true,
            },
          },
        },
      });

      if (!database || database.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found",
        });
      }

      await queueDatabaseStart(database.id);

      return { success: true };
    }),

  /**
   * Stop database
   */
  stop: teamProcedure
    .input(z.object({ databaseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, input.databaseId),
        with: {
          environment: {
            with: {
              project: true,
            },
          },
        },
      });

      if (!database || database.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found",
        });
      }

      await queueDatabaseStop(database.id);

      return { success: true };
    }),

  /**
   * Create backup configuration
   */
  createBackup: teamProcedure
    .input(
      z.object({
        databaseId: z.string(),
        frequency: z.string().default("0 0 * * *"),
        numberOfBackupsToKeep: z.number().default(7),
        s3StorageId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, input.databaseId),
        with: {
          environment: {
            with: {
              project: true,
            },
          },
        },
      });

      if (!database || database.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found",
        });
      }

      const [backup] = await ctx.db
        .insert(databaseBackups)
        .values({
          databaseId: input.databaseId,
          frequency: input.frequency,
          numberOfBackupsToKeep: input.numberOfBackupsToKeep,
          s3StorageId: input.s3StorageId,
        })
        .returning();

      return backup;
    }),

  /**
   * Run backup now
   */
  runBackup: teamProcedure
    .input(z.object({ backupId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const backup = await ctx.db.query.databaseBackups.findFirst({
        where: eq(databaseBackups.id, input.backupId),
        with: {
          database: {
            with: {
              environment: {
                with: {
                  project: true,
                },
              },
            },
          },
        },
      });

      if (!backup || backup.database.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup not found",
        });
      }

      // Create execution record
      const [execution] = await ctx.db
        .insert(databaseBackupExecutions)
        .values({
          backupId: backup.id,
          status: "running",
        })
        .returning();

      // Queue backup job
      await queueDatabaseBackup({
        executionId: execution!.id,
        backupId: backup.id,
        databaseId: backup.databaseId,
      });

      return execution;
    }),
});
