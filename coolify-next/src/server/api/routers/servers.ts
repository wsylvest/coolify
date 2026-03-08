import { z } from "zod";
import { createTRPCRouter, teamProcedure, adminProcedure } from "../trpc";
import { servers, destinations, privateKeys } from "@/server/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { sshService } from "@/server/services/ssh";

export const serversRouter = createTRPCRouter({
  /**
   * List all servers for the current team
   */
  list: teamProcedure.query(async ({ ctx }) => {
    const teamServers = await ctx.db.query.servers.findMany({
      where: and(
        eq(servers.teamId, ctx.team.id),
        isNull(servers.deletedAt)
      ),
      with: {
        privateKey: {
          columns: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: (servers, { desc }) => [desc(servers.createdAt)],
    });

    return teamServers;
  }),

  /**
   * Get server by ID
   */
  getById: teamProcedure
    .input(z.object({ serverId: z.string() }))
    .query(async ({ ctx, input }) => {
      const server = await ctx.db.query.servers.findFirst({
        where: and(
          eq(servers.id, input.serverId),
          eq(servers.teamId, ctx.team.id),
          isNull(servers.deletedAt)
        ),
        with: {
          privateKey: true,
          destinations: true,
        },
      });

      if (!server) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Server not found",
        });
      }

      return server;
    }),

  /**
   * Get server by UUID
   */
  getByUuid: teamProcedure
    .input(z.object({ uuid: z.string() }))
    .query(async ({ ctx, input }) => {
      const server = await ctx.db.query.servers.findFirst({
        where: and(
          eq(servers.uuid, input.uuid),
          eq(servers.teamId, ctx.team.id),
          isNull(servers.deletedAt)
        ),
        with: {
          privateKey: true,
          destinations: true,
        },
      });

      if (!server) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Server not found",
        });
      }

      return server;
    }),

  /**
   * Create a new server
   */
  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(2).max(255),
        description: z.string().optional(),
        ip: z.string().min(1),
        port: z.number().int().min(1).max(65535).default(22),
        user: z.string().default("root"),
        privateKeyId: z.string(),
        proxyType: z.enum(["traefik", "caddy", "none"]).default("traefik"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify private key belongs to team
      const privateKey = await ctx.db.query.privateKeys.findFirst({
        where: and(
          eq(privateKeys.id, input.privateKeyId),
          eq(privateKeys.teamId, ctx.team.id)
        ),
      });

      if (!privateKey) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Private key not found",
        });
      }

      const [server] = await ctx.db
        .insert(servers)
        .values({
          teamId: ctx.team.id,
          name: input.name,
          description: input.description,
          ip: input.ip,
          port: input.port,
          user: input.user,
          privateKeyId: input.privateKeyId,
          proxyType: input.proxyType,
        })
        .returning();

      if (!server) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create server",
        });
      }

      // Create default destination
      await ctx.db.insert(destinations).values({
        serverId: server.id,
        name: "default",
        type: "standalone_docker",
        network: "coolify",
      });

      return server;
    }),

  /**
   * Update server
   */
  update: adminProcedure
    .input(
      z.object({
        serverId: z.string(),
        name: z.string().min(2).max(255).optional(),
        description: z.string().optional(),
        ip: z.string().min(1).optional(),
        port: z.number().int().min(1).max(65535).optional(),
        user: z.string().optional(),
        privateKeyId: z.string().optional(),
        proxyType: z.enum(["traefik", "caddy", "none"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { serverId, ...updateData } = input;

      // Verify server belongs to team
      const server = await ctx.db.query.servers.findFirst({
        where: and(
          eq(servers.id, serverId),
          eq(servers.teamId, ctx.team.id)
        ),
      });

      if (!server) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Server not found",
        });
      }

      const [updated] = await ctx.db
        .update(servers)
        .set(updateData)
        .where(eq(servers.id, serverId))
        .returning();

      return updated;
    }),

  /**
   * Delete server (soft delete)
   */
  delete: adminProcedure
    .input(z.object({ serverId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const server = await ctx.db.query.servers.findFirst({
        where: and(
          eq(servers.id, input.serverId),
          eq(servers.teamId, ctx.team.id)
        ),
      });

      if (!server) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Server not found",
        });
      }

      await ctx.db
        .update(servers)
        .set({ deletedAt: new Date() })
        .where(eq(servers.id, input.serverId));

      return { success: true };
    }),

  /**
   * Validate server connection
   */
  validate: teamProcedure
    .input(z.object({ serverId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const server = await ctx.db.query.servers.findFirst({
        where: and(
          eq(servers.id, input.serverId),
          eq(servers.teamId, ctx.team.id)
        ),
        with: {
          privateKey: true,
        },
      });

      if (!server) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Server not found",
        });
      }

      if (!server.privateKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Server has no private key configured",
        });
      }

      // Update status to validating
      await ctx.db
        .update(servers)
        .set({ validationStatus: "validating" })
        .where(eq(servers.id, input.serverId));

      try {
        // Test SSH connection
        const result = await sshService.validateConnection({
          host: server.ip,
          port: server.port,
          username: server.user,
          privateKey: server.privateKey.privateKey,
        });

        // Update server status
        await ctx.db
          .update(servers)
          .set({
            validationStatus: result.success ? "valid" : "invalid",
            validationLogs: result.logs,
            isReachable: result.success,
            lastOnlineAt: result.success ? new Date() : undefined,
          })
          .where(eq(servers.id, input.serverId));

        return result;
      } catch (error) {
        await ctx.db
          .update(servers)
          .set({
            validationStatus: "invalid",
            validationLogs: error instanceof Error ? error.message : "Unknown error",
            isReachable: false,
          })
          .where(eq(servers.id, input.serverId));

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Failed to validate server connection",
          cause: error,
        });
      }
    }),

  /**
   * Get server resources (containers, disk usage, etc.)
   */
  getResources: teamProcedure
    .input(z.object({ serverId: z.string() }))
    .query(async ({ ctx, input }) => {
      const server = await ctx.db.query.servers.findFirst({
        where: and(
          eq(servers.id, input.serverId),
          eq(servers.teamId, ctx.team.id)
        ),
        with: {
          privateKey: true,
        },
      });

      if (!server) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Server not found",
        });
      }

      if (!server.isReachable || !server.privateKey) {
        return {
          containers: [],
          diskUsage: null,
          memoryUsage: null,
        };
      }

      try {
        const resources = await sshService.getServerResources({
          host: server.ip,
          port: server.port,
          username: server.user,
          privateKey: server.privateKey.privateKey,
        });

        return resources;
      } catch (error) {
        return {
          containers: [],
          diskUsage: null,
          memoryUsage: null,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

  /**
   * Execute command on server
   */
  executeCommand: adminProcedure
    .input(
      z.object({
        serverId: z.string(),
        command: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const server = await ctx.db.query.servers.findFirst({
        where: and(
          eq(servers.id, input.serverId),
          eq(servers.teamId, ctx.team.id)
        ),
        with: {
          privateKey: true,
        },
      });

      if (!server) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Server not found",
        });
      }

      if (!server.privateKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Server has no private key configured",
        });
      }

      const result = await sshService.executeCommand({
        host: server.ip,
        port: server.port,
        username: server.user,
        privateKey: server.privateKey.privateKey,
        command: input.command,
      });

      return result;
    }),
});
