import { z } from "zod";
import { createTRPCRouter, teamProcedure, adminProcedure } from "../trpc";
import {
  applications,
  applicationDeployments,
  applicationEnvironmentVariables,
  environments,
  projects,
  destinations,
} from "@/server/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { deploymentQueue } from "@/server/queue/jobs/deployment";

const applicationInputSchema = z.object({
  name: z.string().min(2).max(255),
  description: z.string().optional(),
  environmentId: z.string(),
  destinationId: z.string().optional(),

  // Git configuration
  gitRepository: z.string().optional(),
  gitBranch: z.string().default("main"),
  privateKeyId: z.string().optional(),

  // Build configuration
  buildPack: z.enum(["nixpacks", "dockerfile", "dockercompose", "dockerimage", "static"]).default("nixpacks"),
  installCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  startCommand: z.string().optional(),
  baseDirectory: z.string().default("/"),
  publishDirectory: z.string().optional(),

  // Docker configuration
  dockerfile: z.string().optional(),
  dockerfileLocation: z.string().default("/Dockerfile"),
  dockerRegistryImageName: z.string().optional(),
  dockerRegistryImageTag: z.string().optional(),
  portsExposes: z.string().default("3000"),

  // Domain
  fqdn: z.string().optional(),
});

export const applicationsRouter = createTRPCRouter({
  /**
   * List all applications for a team
   */
  list: teamProcedure.query(async ({ ctx }) => {
    const teamApps = await ctx.db.query.applications.findMany({
      where: isNull(applications.deletedAt),
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
      orderBy: [desc(applications.createdAt)],
    });

    // Filter by team
    return teamApps.filter(
      (app) => app.environment.project.teamId === ctx.team.id
    );
  }),

  /**
   * Get application by ID
   */
  getById: teamProcedure
    .input(z.object({ applicationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: and(
          eq(applications.id, input.applicationId),
          isNull(applications.deletedAt)
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
          deployments: {
            orderBy: [desc(applicationDeployments.createdAt)],
            limit: 10,
          },
          environmentVariables: true,
        },
      });

      if (!app || app.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      }

      return app;
    }),

  /**
   * Get application by UUID
   */
  getByUuid: teamProcedure
    .input(z.object({ uuid: z.string() }))
    .query(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: and(
          eq(applications.uuid, input.uuid),
          isNull(applications.deletedAt)
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
          deployments: {
            orderBy: [desc(applicationDeployments.createdAt)],
            limit: 10,
          },
          environmentVariables: true,
        },
      });

      if (!app || app.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      }

      return app;
    }),

  /**
   * Create a new application
   */
  create: teamProcedure
    .input(applicationInputSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify environment belongs to team
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

      // Verify destination if provided
      if (input.destinationId) {
        const destination = await ctx.db.query.destinations.findFirst({
          where: eq(destinations.id, input.destinationId),
          with: {
            server: true,
          },
        });

        if (!destination || destination.server.teamId !== ctx.team.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Destination not found",
          });
        }
      }

      const [app] = await ctx.db
        .insert(applications)
        .values(input)
        .returning();

      if (!app) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create application",
        });
      }

      return app;
    }),

  /**
   * Update application
   */
  update: teamProcedure
    .input(
      z.object({
        applicationId: z.string(),
      }).merge(applicationInputSchema.partial())
    )
    .mutation(async ({ ctx, input }) => {
      const { applicationId, ...updateData } = input;

      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, applicationId),
        with: {
          environment: {
            with: {
              project: true,
            },
          },
        },
      });

      if (!app || app.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      }

      const [updated] = await ctx.db
        .update(applications)
        .set(updateData)
        .where(eq(applications.id, applicationId))
        .returning();

      return updated;
    }),

  /**
   * Delete application (soft delete)
   */
  delete: adminProcedure
    .input(z.object({ applicationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.applicationId),
        with: {
          environment: {
            with: {
              project: true,
            },
          },
        },
      });

      if (!app || app.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      }

      await ctx.db
        .update(applications)
        .set({ deletedAt: new Date() })
        .where(eq(applications.id, input.applicationId));

      return { success: true };
    }),

  /**
   * Deploy application
   */
  deploy: teamProcedure
    .input(
      z.object({
        applicationId: z.string(),
        forceRebuild: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.applicationId),
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
      });

      if (!app || app.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      }

      if (!app.destination) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Application has no destination configured",
        });
      }

      // Create deployment record
      const [deployment] = await ctx.db
        .insert(applicationDeployments)
        .values({
          applicationId: app.id,
          forceRebuild: input.forceRebuild,
          status: "queued",
        })
        .returning();

      // Queue deployment job
      await deploymentQueue.add("deploy", {
        deploymentId: deployment!.id,
        applicationId: app.id,
      });

      return deployment;
    }),

  /**
   * Stop application
   */
  stop: teamProcedure
    .input(z.object({ applicationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.applicationId),
        with: {
          environment: {
            with: {
              project: true,
            },
          },
        },
      });

      if (!app || app.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      }

      // Queue stop job
      await deploymentQueue.add("stop", {
        applicationId: app.id,
      });

      return { success: true };
    }),

  /**
   * Restart application
   */
  restart: teamProcedure
    .input(z.object({ applicationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.applicationId),
        with: {
          environment: {
            with: {
              project: true,
            },
          },
        },
      });

      if (!app || app.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      }

      // Create deployment for restart
      const [deployment] = await ctx.db
        .insert(applicationDeployments)
        .values({
          applicationId: app.id,
          restartOnly: true,
          status: "queued",
        })
        .returning();

      await deploymentQueue.add("restart", {
        deploymentId: deployment!.id,
        applicationId: app.id,
      });

      return deployment;
    }),

  /**
   * Add environment variable
   */
  addEnvVar: teamProcedure
    .input(
      z.object({
        applicationId: z.string(),
        key: z.string().min(1),
        value: z.string(),
        isBuildTime: z.boolean().default(false),
        isPreview: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.applicationId),
        with: {
          environment: {
            with: {
              project: true,
            },
          },
        },
      });

      if (!app || app.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      }

      const [envVar] = await ctx.db
        .insert(applicationEnvironmentVariables)
        .values({
          applicationId: input.applicationId,
          key: input.key,
          value: input.value,
          isBuildTime: input.isBuildTime,
          isPreview: input.isPreview,
        })
        .returning();

      return envVar;
    }),

  /**
   * Delete environment variable
   */
  deleteEnvVar: teamProcedure
    .input(z.object({ envVarId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const envVar = await ctx.db.query.applicationEnvironmentVariables.findFirst({
        where: eq(applicationEnvironmentVariables.id, input.envVarId),
        with: {
          application: {
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

      if (!envVar || envVar.application.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment variable not found",
        });
      }

      await ctx.db
        .delete(applicationEnvironmentVariables)
        .where(eq(applicationEnvironmentVariables.id, input.envVarId));

      return { success: true };
    }),
});
