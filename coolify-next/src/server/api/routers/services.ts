import { z } from "zod";
import { createTRPCRouter, teamProcedure, adminProcedure } from "../trpc";
import { services, environments } from "@/server/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { serviceQueue } from "@/server/queue/jobs/service";

export const servicesRouter = createTRPCRouter({
  /**
   * List all services for a team
   */
  list: teamProcedure.query(async ({ ctx }) => {
    const teamServices = await ctx.db.query.services.findMany({
      where: isNull(services.deletedAt),
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
        applications: true,
        databases: true,
      },
      orderBy: [desc(services.createdAt)],
    });

    return teamServices.filter(
      (svc) => svc.environment.project.teamId === ctx.team.id
    );
  }),

  /**
   * Get service by ID
   */
  getById: teamProcedure
    .input(z.object({ serviceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const service = await ctx.db.query.services.findFirst({
        where: and(
          eq(services.id, input.serviceId),
          isNull(services.deletedAt)
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
          applications: true,
          databases: true,
          environmentVariables: true,
        },
      });

      if (!service || service.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Service not found",
        });
      }

      return service;
    }),

  /**
   * Create a new service from template
   */
  create: teamProcedure
    .input(
      z.object({
        name: z.string().min(2).max(255),
        description: z.string().optional(),
        environmentId: z.string(),
        destinationId: z.string().optional(),
        serviceType: z.string(),
        dockerCompose: z.string(),
      })
    )
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

      const [service] = await ctx.db
        .insert(services)
        .values({
          name: input.name,
          description: input.description,
          environmentId: input.environmentId,
          destinationId: input.destinationId,
          serviceType: input.serviceType,
          dockerCompose: input.dockerCompose,
          dockerComposeRaw: input.dockerCompose,
        })
        .returning();

      return service;
    }),

  /**
   * Update service
   */
  update: teamProcedure
    .input(
      z.object({
        serviceId: z.string(),
        name: z.string().min(2).max(255).optional(),
        description: z.string().optional(),
        dockerCompose: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { serviceId, ...updateData } = input;

      const service = await ctx.db.query.services.findFirst({
        where: eq(services.id, serviceId),
        with: {
          environment: {
            with: {
              project: true,
            },
          },
        },
      });

      if (!service || service.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Service not found",
        });
      }

      const [updated] = await ctx.db
        .update(services)
        .set(updateData)
        .where(eq(services.id, serviceId))
        .returning();

      return updated;
    }),

  /**
   * Delete service
   */
  delete: adminProcedure
    .input(z.object({ serviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const service = await ctx.db.query.services.findFirst({
        where: eq(services.id, input.serviceId),
        with: {
          environment: {
            with: {
              project: true,
            },
          },
        },
      });

      if (!service || service.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Service not found",
        });
      }

      await ctx.db
        .update(services)
        .set({ deletedAt: new Date() })
        .where(eq(services.id, input.serviceId));

      return { success: true };
    }),

  /**
   * Start service
   */
  start: teamProcedure
    .input(z.object({ serviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const service = await ctx.db.query.services.findFirst({
        where: eq(services.id, input.serviceId),
        with: {
          environment: {
            with: {
              project: true,
            },
          },
        },
      });

      if (!service || service.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Service not found",
        });
      }

      await serviceQueue.add("start", {
        serviceId: service.id,
      });

      return { success: true };
    }),

  /**
   * Stop service
   */
  stop: teamProcedure
    .input(z.object({ serviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const service = await ctx.db.query.services.findFirst({
        where: eq(services.id, input.serviceId),
        with: {
          environment: {
            with: {
              project: true,
            },
          },
        },
      });

      if (!service || service.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Service not found",
        });
      }

      await serviceQueue.add("stop", {
        serviceId: service.id,
      });

      return { success: true };
    }),

  /**
   * Restart service
   */
  restart: teamProcedure
    .input(z.object({ serviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const service = await ctx.db.query.services.findFirst({
        where: eq(services.id, input.serviceId),
        with: {
          environment: {
            with: {
              project: true,
            },
          },
        },
      });

      if (!service || service.environment.project.teamId !== ctx.team.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Service not found",
        });
      }

      await serviceQueue.add("restart", {
        serviceId: service.id,
      });

      return { success: true };
    }),

  /**
   * List available service templates
   */
  listTemplates: teamProcedure.query(async () => {
    // This would load from templates directory
    // For now, return a static list
    return [
      { id: "wordpress", name: "WordPress", category: "CMS" },
      { id: "ghost", name: "Ghost", category: "CMS" },
      { id: "strapi", name: "Strapi", category: "CMS" },
      { id: "n8n", name: "n8n", category: "Automation" },
      { id: "gitea", name: "Gitea", category: "DevOps" },
      { id: "uptime-kuma", name: "Uptime Kuma", category: "Monitoring" },
      { id: "grafana", name: "Grafana", category: "Monitoring" },
      { id: "minio", name: "MinIO", category: "Storage" },
      { id: "plausible", name: "Plausible Analytics", category: "Analytics" },
    ];
  }),
});
