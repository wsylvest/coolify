import { z } from "zod";
import { createTRPCRouter, teamProcedure, adminProcedure } from "../trpc";
import { projects, environments } from "@/server/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const projectsRouter = createTRPCRouter({
  /**
   * List all projects for the current team
   */
  list: teamProcedure.query(async ({ ctx }) => {
    const teamProjects = await ctx.db.query.projects.findMany({
      where: and(
        eq(projects.teamId, ctx.team.id),
        isNull(projects.deletedAt)
      ),
      with: {
        environments: {
          where: isNull(environments.deletedAt),
        },
      },
      orderBy: (projects, { desc }) => [desc(projects.createdAt)],
    });

    return teamProjects;
  }),

  /**
   * Get project by ID
   */
  getById: teamProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.teamId, ctx.team.id),
          isNull(projects.deletedAt)
        ),
        with: {
          environments: {
            where: isNull(environments.deletedAt),
            with: {
              applications: true,
              databases: true,
              services: true,
            },
          },
        },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      return project;
    }),

  /**
   * Get project by UUID
   */
  getByUuid: teamProcedure
    .input(z.object({ uuid: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.uuid, input.uuid),
          eq(projects.teamId, ctx.team.id),
          isNull(projects.deletedAt)
        ),
        with: {
          environments: {
            where: isNull(environments.deletedAt),
            with: {
              applications: true,
              databases: true,
              services: true,
            },
          },
        },
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      return project;
    }),

  /**
   * Create a new project
   */
  create: teamProcedure
    .input(
      z.object({
        name: z.string().min(2).max(255),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [project] = await ctx.db
        .insert(projects)
        .values({
          teamId: ctx.team.id,
          name: input.name,
          description: input.description,
        })
        .returning();

      if (!project) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create project",
        });
      }

      // Create default production environment
      await ctx.db.insert(environments).values({
        projectId: project.id,
        name: "production",
        description: "Production environment",
      });

      return project;
    }),

  /**
   * Update project
   */
  update: teamProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(2).max(255).optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, ...updateData } = input;

      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, projectId),
          eq(projects.teamId, ctx.team.id)
        ),
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      const [updated] = await ctx.db
        .update(projects)
        .set(updateData)
        .where(eq(projects.id, projectId))
        .returning();

      return updated;
    }),

  /**
   * Delete project (soft delete)
   */
  delete: adminProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.teamId, ctx.team.id)
        ),
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      await ctx.db
        .update(projects)
        .set({ deletedAt: new Date() })
        .where(eq(projects.id, input.projectId));

      return { success: true };
    }),

  /**
   * Create environment in project
   */
  createEnvironment: teamProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(2).max(255),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.teamId, ctx.team.id)
        ),
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      const [environment] = await ctx.db
        .insert(environments)
        .values({
          projectId: input.projectId,
          name: input.name,
          description: input.description,
        })
        .returning();

      return environment;
    }),

  /**
   * Delete environment
   */
  deleteEnvironment: adminProcedure
    .input(z.object({ environmentId: z.string() }))
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

      await ctx.db
        .update(environments)
        .set({ deletedAt: new Date() })
        .where(eq(environments.id, input.environmentId));

      return { success: true };
    }),
});
