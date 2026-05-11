import { Job, Worker, Queue } from "bullmq";
import { db } from "@/server/db";
import { services, deploymentQueue } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { sshService } from "@/server/services/ssh";
import { dockerService } from "@/server/services/docker";
import { proxyService } from "@/server/services/proxy";
import { templateService } from "@/server/services/templates";
import { notificationService } from "@/server/services/notifications";
import { realtimeService } from "@/server/services/realtime";
import { logger } from "@/lib/logger";
import Redis from "ioredis";
import YAML from "yaml";

export interface ServiceDeploymentJobData {
  deploymentId: string;
  serviceId: string;
  serverId: string;
  templateId?: string;
  variables?: Record<string, string>;
  force?: boolean;
}

const COOLIFY_DIR = "/data/coolify";

export function createServiceDeploymentWorker(redis: Redis) {
  const worker = new Worker<ServiceDeploymentJobData>(
    "service-deployment",
    async (job) => {
      const { deploymentId, serviceId, serverId, templateId, variables, force } =
        job.data;

      const logs: string[] = [];
      const addLog = (message: string) => {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] ${message}`;
        logs.push(logLine);
        logger.info(message, { deploymentId, serviceId });

        // Emit real-time log
        realtimeService.emitDeploymentLogs(
          "", // Will be filled with teamId
          deploymentId,
          logLine
        );
      };

      try {
        addLog("Starting service deployment...");

        // Get service details
        const service = await db.query.services.findFirst({
          where: eq(services.id, serviceId),
          with: {
            server: {
              with: {
                privateKey: true,
              },
            },
            environment: {
              with: {
                project: true,
              },
            },
          },
        });

        if (!service) {
          throw new Error("Service not found");
        }

        if (!service.server?.privateKey) {
          throw new Error("Server has no private key configured");
        }

        const teamId = service.environment.project.teamId;
        const sshConfig = {
          host: service.server.ip,
          port: service.server.port,
          username: service.server.user,
          privateKey: service.server.privateKey.privateKey,
        };

        // Update deployment status
        await db
          .update(deploymentQueue)
          .set({
            status: "in_progress",
            startedAt: new Date(),
          })
          .where(eq(deploymentQueue.id, deploymentId));

        realtimeService.emitDeploymentStatus(teamId, deploymentId, "in_progress");

        // Get service compose configuration
        let composeConfig: string;

        if (templateId) {
          addLog(`Using template: ${templateId}`);

          // Load and parse template
          const template = await templateService.getTemplateById(templateId);
          if (!template) {
            throw new Error(`Template not found: ${templateId}`);
          }

          const parsed = templateService.parseTemplate(template);

          // Validate variables
          const validation = templateService.validateVariables(
            parsed,
            variables ?? {}
          );
          if (!validation.valid) {
            throw new Error(
              `Invalid variables: ${Object.values(validation.errors).join(", ")}`
            );
          }

          // Generate secure defaults for passwords
          const secureDefaults = templateService.generateSecureDefaults(
            parsed.variables
          );
          const allVariables = { ...secureDefaults, ...variables };

          // Generate compose configuration
          const generatedConfig = templateService.generateComposeConfig(
            template,
            allVariables,
            {
              projectName: service.name,
              network: "coolify-proxy",
            }
          );

          composeConfig = YAML.stringify(generatedConfig);
        } else if (service.dockerComposeYaml) {
          addLog("Using custom Docker Compose configuration");
          composeConfig = service.dockerComposeYaml;
        } else {
          throw new Error("No template or compose configuration provided");
        }

        // Create service directory
        const serviceDir = `${COOLIFY_DIR}/services/${service.uuid}`;
        addLog(`Creating service directory: ${serviceDir}`);

        await sshService.executeCommand({
          ...sshConfig,
          command: `mkdir -p ${serviceDir}`,
        });

        // Write compose file
        addLog("Writing docker-compose.yaml...");
        await sshService.writeFile({
          ...sshConfig,
          remotePath: `${serviceDir}/docker-compose.yaml`,
          content: composeConfig,
        });

        // Write environment file if service has env vars
        if (service.environmentVariables) {
          addLog("Writing environment variables...");
          const envContent = Object.entries(
            JSON.parse(service.environmentVariables) as Record<string, string>
          )
            .map(([key, value]) => `${key}=${value}`)
            .join("\n");

          await sshService.writeFile({
            ...sshConfig,
            remotePath: `${serviceDir}/.env`,
            content: envContent,
          });
        }

        // Stop existing containers if force
        if (force) {
          addLog("Force deployment requested, stopping existing containers...");
          try {
            await dockerService.composeDown(sshConfig, {
              projectName: service.name,
              composeFile: `${serviceDir}/docker-compose.yaml`,
              workDir: serviceDir,
            });
          } catch {
            addLog("No existing containers to stop");
          }
        }

        // Pull images
        addLog("Pulling Docker images...");
        const pullResult = await sshService.executeCommand({
          ...sshConfig,
          command: `cd ${serviceDir} && docker compose pull`,
          timeout: 600000, // 10 minutes
        });

        if (!pullResult.success) {
          addLog(`Warning: Image pull may have issues: ${pullResult.stderr}`);
        }

        // Start the service
        addLog("Starting service containers...");
        const upResult = await dockerService.composeUp(sshConfig, {
          projectName: service.name,
          composeFile: `${serviceDir}/docker-compose.yaml`,
          workDir: serviceDir,
          forceRecreate: force,
        });

        addLog(upResult);

        // Wait for containers to be healthy
        addLog("Waiting for containers to be ready...");
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Check container status
        const containers = await dockerService.listContainers(sshConfig);
        const serviceContainers = containers.filter((c) =>
          c.name.startsWith(service.name)
        );

        const allRunning = serviceContainers.every(
          (c) => c.state === "running"
        );

        if (!allRunning) {
          const failedContainers = serviceContainers.filter(
            (c) => c.state !== "running"
          );
          addLog(
            `Warning: Some containers are not running: ${failedContainers.map((c) => c.name).join(", ")}`
          );
        }

        // Configure proxy if service has domains
        if (service.fqdn) {
          addLog(`Configuring proxy for domain: ${service.fqdn}`);

          const proxyType = service.server.proxyType as "traefik" | "caddy";
          const domains = service.fqdn.split(",").map((d) => d.trim());

          // Find the main service container and port
          const mainContainer = serviceContainers[0];
          const containerPort = service.exposedPort ?? 80;

          if (proxyType === "traefik") {
            const dynamicConfig = proxyService.generateTraefikDynamicConfig({
              serviceName: service.name,
              domains,
              containerPort,
              containerName: mainContainer?.name ?? service.name,
              enableSsl: true,
              forceHttps: true,
            });

            await proxyService.writeApplicationProxyConfig(
              sshConfig,
              proxyType,
              service.uuid,
              YAML.stringify(dynamicConfig)
            );
          } else if (proxyType === "caddy") {
            const caddyConfig = proxyService.generateCaddySiteConfig({
              domains,
              containerPort,
              containerName: mainContainer?.name ?? service.name,
              enableSsl: true,
              forceHttps: true,
            });

            await proxyService.writeApplicationProxyConfig(
              sshConfig,
              proxyType,
              service.uuid,
              caddyConfig
            );
          }

          addLog("Proxy configuration updated");
        }

        // Update deployment status to completed
        const finalLogs = logs.join("\n");

        await db
          .update(deploymentQueue)
          .set({
            status: "completed",
            finishedAt: new Date(),
            logs: finalLogs,
          })
          .where(eq(deploymentQueue.id, deploymentId));

        // Update service status
        await db
          .update(services)
          .set({
            status: "running",
            lastDeployedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(services.id, serviceId));

        addLog("Service deployment completed successfully!");

        realtimeService.emitDeploymentStatus(
          teamId,
          deploymentId,
          "completed",
          100
        );

        // Send notification
        await notificationService.send({
          teamId,
          eventType: "deployment_success",
          title: `Service Deployed: ${service.name}`,
          message: `Service ${service.name} has been deployed successfully.`,
          resourceType: "service",
          resourceId: serviceId,
        });

        return { success: true, logs: finalLogs };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        const finalLogs = logs.join("\n") + `\n[ERROR] ${errorMsg}`;

        logger.error("Service deployment failed", {
          error,
          deploymentId,
          serviceId,
        });

        // Update deployment status
        await db
          .update(deploymentQueue)
          .set({
            status: "failed",
            finishedAt: new Date(),
            logs: finalLogs,
          })
          .where(eq(deploymentQueue.id, deploymentId));

        // Update service status
        await db
          .update(services)
          .set({
            status: "error",
            updatedAt: new Date(),
          })
          .where(eq(services.id, serviceId));

        // Get service for notification
        const service = await db.query.services.findFirst({
          where: eq(services.id, serviceId),
          with: {
            environment: {
              with: {
                project: true,
              },
            },
          },
        });

        if (service) {
          const teamId = service.environment.project.teamId;

          realtimeService.emitDeploymentStatus(teamId, deploymentId, "failed");

          await notificationService.send({
            teamId,
            eventType: "deployment_failed",
            title: `Service Deployment Failed: ${service.name}`,
            message: `Service ${service.name} deployment failed: ${errorMsg}`,
            resourceType: "service",
            resourceId: serviceId,
          });
        }

        throw error;
      }
    },
    {
      connection: redis,
      concurrency: 5,
    }
  );

  worker.on("completed", (job) => {
    logger.info(`Service deployment completed`, { jobId: job.id });
  });

  worker.on("failed", (job, err) => {
    logger.error(`Service deployment failed`, {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}

export function createServiceDeploymentQueue(redis: Redis) {
  return new Queue<ServiceDeploymentJobData>("service-deployment", {
    connection: redis,
  });
}
