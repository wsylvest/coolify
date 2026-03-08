import { z } from "zod";
import { createTRPCRouter, teamProcedure } from "../trpc";
import { applicationDeployments, applications } from "@/server/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const deploymentsRouter = createTRPCRouter({
  /**
   * List deployments for an application
   */
  listByApplication: teamProcedure
    .input(
      z.object({
        applicationId: z.string(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
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

      const deployments = await ctx.db.query.applicationDeployments.findMany({
        where: eq(applicationDeployments.applicationId, input.applicationId),
        orderBy: [desc(applicationDeployments.createdAt)],
        limit: input.limit,
        offset: input.offset,
      });

      return deployments;
    }),

  /**
   * Get deployment by ID
   */
  getById: teamProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.applicationDeployments.findFirst({
        where: eq(applicationDeployments.id, input.deploymentId),
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

      if (
        !deployment ||
        deployment.application.environment.project.teamId !== ctx.team.id
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      return deployment;
    }),

  /**
   * Get deployment by UUID
   */
  getByUuid: teamProcedure
    .input(z.object({ uuid: z.string() }))
    .query(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.applicationDeployments.findFirst({
        where: eq(applicationDeployments.deploymentUuid, input.uuid),
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

      if (
        !deployment ||
        deployment.application.environment.project.teamId !== ctx.team.id
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      return deployment;
    }),

  /**
   * Cancel a running deployment
   */
  cancel: teamProcedure
    .input(z.object({ deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.applicationDeployments.findFirst({
        where: eq(applicationDeployments.id, input.deploymentId),
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

      if (
        !deployment ||
        deployment.application.environment.project.teamId !== ctx.team.id
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      if (
        deployment.status !== "queued" &&
        deployment.status !== "in_progress"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only cancel queued or in-progress deployments",
        });
      }

      await ctx.db
        .update(applicationDeployments)
        .set({ status: "cancelled" })
        .where(eq(applicationDeployments.id, input.deploymentId));

      // TODO: Actually cancel the running job if in progress

      return { success: true };
    }),

  /**
   * Get deployment logs
   */
  getLogs: teamProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.applicationDeployments.findFirst({
        where: eq(applicationDeployments.id, input.deploymentId),
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

      if (
        !deployment ||
        deployment.application.environment.project.teamId !== ctx.team.id
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      return {
        logs: deployment.logs || "",
        status: deployment.status,
      };
    }),

  /**
   * Get recent deployments across all applications
   */
  listRecent: teamProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const deployments = await ctx.db.query.applicationDeployments.findMany({
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
        orderBy: [desc(applicationDeployments.createdAt)],
        limit: input.limit * 2, // Fetch more to filter
      });

      // Filter by team
      const teamDeployments = deployments
        .filter((d) => d.application.environment.project.teamId === ctx.team.id)
        .slice(0, input.limit);

      return teamDeployments;
    }),
});
