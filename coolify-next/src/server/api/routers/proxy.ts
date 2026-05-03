import { z } from "zod";
import { createTRPCRouter, teamProcedure, adminProcedure } from "../trpc";
import {
  servers,
  proxyConfigurations,
  sslCertificates,
  domains,
} from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { proxyService, type ProxyType } from "@/server/services/proxy";
import { sslService } from "@/server/services/ssl";
import { sshService } from "@/server/services/ssh";

export const proxyRouter = createTRPCRouter({
  /**
   * Get proxy status for a server
   */
  getStatus: teamProcedure
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

      if (!server.privateKey || !server.isReachable) {
        return {
          running: false,
          proxyType: server.proxyType,
          error: "Server not reachable",
        };
      }

      const status = await proxyService.checkProxyStatus(
        {
          host: server.ip,
          port: server.port,
          username: server.user,
          privateKey: server.privateKey.privateKey,
        },
        server.proxyType as ProxyType
      );

      return {
        ...status,
        proxyType: server.proxyType,
      };
    }),

  /**
   * Get proxy configuration for a server
   */
  getConfiguration: teamProcedure
    .input(z.object({ serverId: z.string() }))
    .query(async ({ ctx, input }) => {
      const config = await ctx.db.query.proxyConfigurations.findFirst({
        where: eq(proxyConfigurations.serverId, input.serverId),
      });

      return config;
    }),

  /**
   * Start the proxy on a server
   */
  start: adminProcedure
    .input(
      z.object({
        serverId: z.string(),
        httpPort: z.number().int().min(1).max(65535).default(80),
        httpsPort: z.number().int().min(1).max(65535).default(443),
        dashboardEnabled: z.boolean().default(false),
        dashboardPort: z.number().int().min(1).max(65535).default(8080),
        accessLogsEnabled: z.boolean().default(false),
        acmeEmail: z.string().email().optional(),
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

      // Check for port conflicts
      const portConflicts = await proxyService.checkPortConflicts(
        {
          host: server.ip,
          port: server.port,
          username: server.user,
          privateKey: server.privateKey.privateKey,
        },
        [input.httpPort, input.httpsPort]
      );

      const conflictingPorts = portConflicts.filter((p) => p.inUse);
      if (conflictingPorts.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Ports in use: ${conflictingPorts.map((p) => `${p.port} (${p.process ?? "unknown"})`).join(", ")}`,
        });
      }

      // Start the proxy
      const result = await proxyService.startProxy(
        {
          host: server.ip,
          port: server.port,
          username: server.user,
          privateKey: server.privateKey.privateKey,
        },
        {
          type: server.proxyType as ProxyType,
          httpPort: input.httpPort,
          httpsPort: input.httpsPort,
          dashboardEnabled: input.dashboardEnabled,
          dashboardPort: input.dashboardPort,
          accessLogsEnabled: input.accessLogsEnabled,
          acmeEmail: input.acmeEmail,
        }
      );

      if (!result.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to start proxy",
          cause: result.logs,
        });
      }

      // Save configuration
      await ctx.db
        .insert(proxyConfigurations)
        .values({
          serverId: input.serverId,
          isRunning: true,
          lastStartedAt: new Date(),
          httpPort: input.httpPort,
          httpsPort: input.httpsPort,
          dashboardPort: input.dashboardPort,
          dashboardEnabled: input.dashboardEnabled,
          accessLogsEnabled: input.accessLogsEnabled,
        })
        .onConflictDoUpdate({
          target: proxyConfigurations.serverId,
          set: {
            isRunning: true,
            lastStartedAt: new Date(),
            httpPort: input.httpPort,
            httpsPort: input.httpsPort,
            dashboardPort: input.dashboardPort,
            dashboardEnabled: input.dashboardEnabled,
            accessLogsEnabled: input.accessLogsEnabled,
            updatedAt: new Date(),
          },
        });

      return { success: true, logs: result.logs };
    }),

  /**
   * Stop the proxy on a server
   */
  stop: adminProcedure
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

      const result = await proxyService.stopProxy(
        {
          host: server.ip,
          port: server.port,
          username: server.user,
          privateKey: server.privateKey.privateKey,
        },
        server.proxyType as ProxyType
      );

      // Update configuration
      await ctx.db
        .update(proxyConfigurations)
        .set({
          isRunning: false,
          lastStoppedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(proxyConfigurations.serverId, input.serverId));

      return result;
    }),

  /**
   * Restart the proxy
   */
  restart: adminProcedure
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

      const config = await ctx.db.query.proxyConfigurations.findFirst({
        where: eq(proxyConfigurations.serverId, input.serverId),
      });

      const result = await proxyService.restartProxy(
        {
          host: server.ip,
          port: server.port,
          username: server.user,
          privateKey: server.privateKey.privateKey,
        },
        {
          type: server.proxyType as ProxyType,
          httpPort: config?.httpPort ?? 80,
          httpsPort: config?.httpsPort ?? 443,
          dashboardEnabled: config?.dashboardEnabled ?? false,
          dashboardPort: config?.dashboardPort ?? 8080,
          accessLogsEnabled: config?.accessLogsEnabled ?? false,
        }
      );

      return result;
    }),

  // SSL Certificate management
  ssl: {
    /**
     * List SSL certificates for a server
     */
    list: teamProcedure
      .input(z.object({ serverId: z.string() }))
      .query(async ({ ctx, input }) => {
        const certs = await ctx.db.query.sslCertificates.findMany({
          where: eq(sslCertificates.serverId, input.serverId),
          orderBy: (certs, { desc }) => [desc(certs.createdAt)],
        });

        return certs;
      }),

    /**
     * Issue a new SSL certificate
     */
    issue: adminProcedure
      .input(
        z.object({
          serverId: z.string(),
          domains: z.array(z.string()).min(1),
          email: z.string().email(),
          challengeType: z.enum(["http", "tls-alpn"]).default("http"),
          staging: z.boolean().default(false),
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

        if (!server || !server.privateKey) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Server not found or no private key",
          });
        }

        const result = await sslService.issueCertificate(
          {
            host: server.ip,
            port: server.port,
            username: server.user,
            privateKey: server.privateKey.privateKey,
          },
          {
            domains: input.domains,
            email: input.email,
            challengeType: input.challengeType,
            staging: input.staging,
          }
        );

        if (!result.success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: result.error ?? "Failed to issue certificate",
          });
        }

        // Save certificate to database
        const [cert] = await ctx.db
          .insert(sslCertificates)
          .values({
            serverId: input.serverId,
            domain: input.domains[0] ?? "",
            wildcard: input.domains.some((d) => d.startsWith("*.")),
            certificate: result.certificate,
            privateKey: result.privateKey,
            certificateChain: result.chain,
            status: "valid",
            provider: "letsencrypt",
            acmeAccountEmail: input.email,
            challengeType: input.challengeType,
            issuedAt: new Date(),
            expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
          })
          .returning();

        return cert;
      }),

    /**
     * Renew an SSL certificate
     */
    renew: adminProcedure
      .input(z.object({ certificateId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const cert = await ctx.db.query.sslCertificates.findFirst({
          where: eq(sslCertificates.id, input.certificateId),
          with: {
            server: {
              with: {
                privateKey: true,
              },
            },
          },
        });

        if (!cert || !cert.server || !cert.server.privateKey) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Certificate not found",
          });
        }

        const result = await sslService.renewCertificate(
          {
            host: cert.server.ip,
            port: cert.server.port,
            username: cert.server.user,
            privateKey: cert.server.privateKey.privateKey,
          },
          cert.domain
        );

        if (!result.success) {
          await ctx.db
            .update(sslCertificates)
            .set({
              status: "error",
              lastError: result.error,
              renewalAttemptedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(sslCertificates.id, input.certificateId));

          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: result.error ?? "Failed to renew certificate",
          });
        }

        const [updated] = await ctx.db
          .update(sslCertificates)
          .set({
            certificate: result.certificate,
            privateKey: result.privateKey,
            certificateChain: result.chain,
            status: "valid",
            issuedAt: new Date(),
            expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
            renewalAttemptedAt: new Date(),
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(sslCertificates.id, input.certificateId))
          .returning();

        return updated;
      }),

    /**
     * Delete an SSL certificate
     */
    delete: adminProcedure
      .input(z.object({ certificateId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const cert = await ctx.db.query.sslCertificates.findFirst({
          where: eq(sslCertificates.id, input.certificateId),
          with: {
            server: {
              with: {
                privateKey: true,
              },
            },
          },
        });

        if (!cert) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Certificate not found",
          });
        }

        // Delete from server if possible
        if (cert.server?.privateKey) {
          await sslService.deleteCertificate(
            {
              host: cert.server.ip,
              port: cert.server.port,
              username: cert.server.user,
              privateKey: cert.server.privateKey.privateKey,
            },
            cert.domain
          );
        }

        // Delete from database
        await ctx.db
          .delete(sslCertificates)
          .where(eq(sslCertificates.id, input.certificateId));

        return { success: true };
      }),
  },

  // Domain management
  domains: {
    /**
     * List domains
     */
    list: teamProcedure
      .input(
        z.object({
          resourceType: z.string().optional(),
          resourceId: z.string().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        // Build where conditions based on filters
        const conditions = [];

        if (input.resourceType) {
          conditions.push(eq(domains.resourceType, input.resourceType));
        }

        if (input.resourceId) {
          conditions.push(eq(domains.resourceId, input.resourceId));
        }

        const result = await ctx.db.query.domains.findMany({
          where: conditions.length > 0 ? and(...conditions) : undefined,
          with: {
            sslCertificate: true,
          },
          orderBy: (domains, { asc }) => [asc(domains.fqdn)],
        });

        return result;
      }),

    /**
     * Create a domain
     */
    create: adminProcedure
      .input(
        z.object({
          fqdn: z.string().min(1),
          resourceType: z.enum(["application", "service", "database"]),
          resourceId: z.string(),
          sslEnabled: z.boolean().default(true),
          forceHttps: z.boolean().default(true),
          pathPrefix: z.string().default("/"),
          corsEnabled: z.boolean().default(false),
          corsOrigins: z.string().optional(),
          rateLimitEnabled: z.boolean().default(false),
          rateLimitRequests: z.number().int().default(100),
          rateLimitPeriod: z.string().default("1m"),
          basicAuthEnabled: z.boolean().default(false),
          basicAuthUsers: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const [domain] = await ctx.db
          .insert(domains)
          .values({
            fqdn: input.fqdn,
            isWildcard: input.fqdn.startsWith("*."),
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            sslEnabled: input.sslEnabled,
            forceHttps: input.forceHttps,
            pathPrefix: input.pathPrefix,
            corsEnabled: input.corsEnabled,
            corsOrigins: input.corsOrigins,
            rateLimitEnabled: input.rateLimitEnabled,
            rateLimitRequests: input.rateLimitRequests,
            rateLimitPeriod: input.rateLimitPeriod,
            basicAuthEnabled: input.basicAuthEnabled,
            basicAuthUsers: input.basicAuthUsers,
          })
          .returning();

        return domain;
      }),

    /**
     * Update a domain
     */
    update: adminProcedure
      .input(
        z.object({
          domainId: z.string(),
          fqdn: z.string().min(1).optional(),
          sslEnabled: z.boolean().optional(),
          forceHttps: z.boolean().optional(),
          pathPrefix: z.string().optional(),
          corsEnabled: z.boolean().optional(),
          corsOrigins: z.string().optional(),
          rateLimitEnabled: z.boolean().optional(),
          rateLimitRequests: z.number().int().optional(),
          rateLimitPeriod: z.string().optional(),
          basicAuthEnabled: z.boolean().optional(),
          basicAuthUsers: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { domainId, ...updateData } = input;

        const [updated] = await ctx.db
          .update(domains)
          .set({
            ...updateData,
            isWildcard: updateData.fqdn?.startsWith("*."),
            updatedAt: new Date(),
          })
          .where(eq(domains.id, domainId))
          .returning();

        return updated;
      }),

    /**
     * Delete a domain
     */
    delete: adminProcedure
      .input(z.object({ domainId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db.delete(domains).where(eq(domains.id, input.domainId));
        return { success: true };
      }),
  },
});
