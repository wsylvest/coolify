import { Job, Worker, Queue } from "bullmq";
import { db } from "@/server/db";
import {
  applications,
  applicationDeployments,
  applicationEnvironmentVariables,
} from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { sshService } from "@/server/services/ssh";
import { dockerService } from "@/server/services/docker";
import { proxyService } from "@/server/services/proxy";
import { realtimeService } from "@/server/services/realtime";
import { notificationService } from "@/server/services/notifications";
import { logger } from "@/lib/logger";
import { createQueue } from "../index";
import Redis from "ioredis";

export interface DeploymentJobData {
  deploymentId: string;
  applicationId: string;
  serverId?: string;
  force?: boolean;
  rollback?: boolean;
  commit?: string;
}

export const deploymentQueue = createQueue<DeploymentJobData>("deployment");

const COOLIFY_DIR = "/data/coolify";

export function createDeploymentWorker(redis: Redis) {
  const worker = new Worker<DeploymentJobData>(
    "deployment",
    async (job) => {
      const { deploymentId, applicationId, force, rollback, commit } = job.data;

      const logs: string[] = [];
      const addLog = (message: string) => {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] ${message}`;
        logs.push(logLine);
        logger.info(message, { deploymentId, applicationId });
        realtimeService.emitDeploymentLogs("", deploymentId, logLine);
      };

      try {
        addLog("Starting deployment...");

        // Mark as in_progress
        await db
          .update(applicationDeployments)
          .set({ status: "in_progress" })
          .where(eq(applicationDeployments.id, deploymentId));

        // Load application with relations
        const app = await db.query.applications.findFirst({
          where: eq(applications.id, applicationId),
          with: {
            environment: { with: { project: true } },
            destination: { with: { server: { with: { privateKey: true } } } },
            privateKey: true,
            environmentVariables: true,
          },
        });

        if (!app) throw new Error("Application not found");

        const server = app.destination?.server;
        if (!server) throw new Error("No server assigned to this application");

        const privateKey = server.privateKey ?? app.privateKey;
        if (!privateKey) throw new Error("No SSH key configured for the server");

        const teamId = app.environment.project.teamId;
        const sshConfig = {
          host: server.ip,
          port: server.port,
          username: server.user,
          privateKey: privateKey.privateKey,
        };

        const containerName = `${app.uuid}`;
        const network = app.destination?.network ?? "coolify";
        const workdir = `${COOLIFY_DIR}/applications/${app.uuid}`;
        const envVars = buildEnvFile(app.environmentVariables);

        // 1. Prepare work directory
        addLog("Preparing remote work directory...");
        await sshService.executeCommand({
          ...sshConfig,
          command: `mkdir -p ${workdir}`,
        });

        // 2. Route by build pack
        switch (app.buildPack) {
          case "nixpacks":
            await deployNixpacks({
              sshConfig,
              app,
              workdir,
              containerName,
              network,
              envVars,
              force: force ?? false,
              commit,
              addLog,
            });
            break;
          case "dockerfile":
            await deployDockerfile({
              sshConfig,
              app,
              workdir,
              containerName,
              network,
              envVars,
              force: force ?? false,
              commit,
              addLog,
            });
            break;
          case "dockercompose":
            await deployDockerCompose({
              sshConfig,
              app,
              workdir,
              envVars,
              force: force ?? false,
              commit,
              addLog,
            });
            break;
          case "dockerimage":
            await deployDockerImage({
              sshConfig,
              app,
              containerName,
              network,
              envVars,
              addLog,
            });
            break;
          case "static":
            await deployStatic({
              sshConfig,
              app,
              workdir,
              containerName,
              network,
              envVars,
              force: force ?? false,
              commit,
              addLog,
            });
            break;
          default:
            throw new Error(`Unsupported build pack: ${app.buildPack}`);
        }

        // 3. Configure proxy if FQDN is set
        if (app.fqdn) {
          addLog(`Configuring proxy for ${app.fqdn}...`);
          await proxyService.writeApplicationProxyConfig(sshConfig, {
            applicationId: app.uuid,
            containerName,
            domain: app.fqdn,
            port: parseInt(app.portsExposes ?? "3000", 10),
            proxyType: server.proxyType,
            customLabels: app.customLabels ?? undefined,
          });
        }

        // 4. Health check
        if (app.healthCheckEnabled) {
          addLog("Waiting for health check...");
          await waitForHealthy(sshConfig, containerName, {
            path: app.healthCheckPath ?? "/",
            port: app.healthCheckPort ?? app.portsExposes ?? "3000",
            retries: app.healthCheckRetries ?? 10,
            interval: app.healthCheckInterval ?? 5,
          });
          addLog("Health check passed.");
        }

        // 5. Mark deployment as finished
        addLog("Deployment completed successfully.");
        await db
          .update(applicationDeployments)
          .set({
            status: "finished",
            logs: logs.join("\n"),
          })
          .where(eq(applicationDeployments.id, deploymentId));

        await db
          .update(applications)
          .set({ status: "running", lastOnlineAt: new Date() })
          .where(eq(applications.id, applicationId));

        realtimeService.emitDeploymentStatus(teamId, deploymentId, "finished");
        realtimeService.emitContainerStatus(teamId, app.uuid, "running");

        await notificationService.send({
          teamId,
          eventType: "deployment_success",
          title: `Deployment successful: ${app.name}`,
          message: `Application ${app.name} was deployed successfully.`,
          resourceType: "application",
          resourceId: app.uuid,
        });
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        addLog(`Deployment failed: ${errorMessage}`);

        await db
          .update(applicationDeployments)
          .set({
            status: "failed",
            logs: logs.join("\n"),
          })
          .where(eq(applicationDeployments.id, deploymentId));

        await db
          .update(applications)
          .set({ status: "exited" })
          .where(eq(applications.id, applicationId));

        const app = await db.query.applications.findFirst({
          where: eq(applications.id, applicationId),
          with: { environment: { with: { project: true } } },
        });

        if (app) {
          const teamId = app.environment.project.teamId;
          realtimeService.emitDeploymentStatus(teamId, deploymentId, "failed");

          await notificationService.send({
            teamId,
            eventType: "deployment_failure",
            title: `Deployment failed: ${app.name}`,
            message: `Application ${app.name} deployment failed: ${errorMessage}`,
            resourceType: "application",
            resourceId: app.uuid,
          });
        }

        throw error;
      }
    },
    {
      connection: redis,
      concurrency: parseInt(process.env.DEPLOYMENT_CONCURRENCY || "2", 10),
    }
  );

  worker.on("completed", (job) => {
    logger.info(`Deployment ${job.data.deploymentId} completed`);
  });

  worker.on("failed", (job, err) => {
    logger.error(`Deployment ${job?.data.deploymentId} failed:`, err);
  });

  return worker;
}

// ----- Build pack implementations -----

interface DeployContext {
  sshConfig: { host: string; port: number; username: string; privateKey: string };
  app: any;
  workdir: string;
  containerName: string;
  network: string;
  envVars: string;
  force: boolean;
  commit?: string;
  addLog: (msg: string) => void;
}

async function cloneOrPull(ctx: Pick<DeployContext, "sshConfig" | "app" | "workdir" | "commit" | "addLog">) {
  const { sshConfig, app, workdir, commit, addLog } = ctx;
  const branch = app.gitBranch ?? "main";
  const repoUrl = app.gitFullUrl || app.gitRepository;

  if (!repoUrl) throw new Error("No git repository configured");

  const baseDir = app.baseDirectory ?? "/";
  const targetDir = baseDir === "/" ? workdir : `${workdir}/${baseDir.replace(/^\//, "")}`;

  addLog(`Cloning ${repoUrl} (branch: ${branch})...`);

  // Clone fresh each time for clean builds
  await sshService.executeCommand({
    ...sshConfig,
    command: `rm -rf ${workdir}/source && git clone --depth 1 --branch ${branch} ${repoUrl} ${workdir}/source`,
  });

  if (commit) {
    addLog(`Checking out commit ${commit}...`);
    await sshService.executeCommand({
      ...sshConfig,
      command: `cd ${workdir}/source && git fetch origin ${commit} && git checkout ${commit}`,
    });
  }

  return `${workdir}/source`;
}

async function writeEnvFile(
  sshConfig: DeployContext["sshConfig"],
  dir: string,
  envVars: string
) {
  if (!envVars.trim()) return;
  await sshService.executeCommand({
    ...sshConfig,
    command: `cat > ${dir}/.env << 'COOLIFY_ENV_EOF'\n${envVars}\nCOOLIFY_ENV_EOF`,
  });
}

async function deployNixpacks(ctx: DeployContext) {
  const { sshConfig, app, workdir, containerName, network, envVars, addLog } = ctx;

  const sourceDir = await cloneOrPull(ctx);
  await writeEnvFile(sshConfig, sourceDir, envVars);

  const imageName = `coolify-${app.uuid}:latest`;

  // Build with nixpacks
  addLog("Building with Nixpacks...");
  let buildArgs = `nixpacks build ${sourceDir} --name ${imageName}`;
  if (app.installCommand) buildArgs += ` --install-cmd "${app.installCommand}"`;
  if (app.buildCommand) buildArgs += ` --build-cmd "${app.buildCommand}"`;
  if (app.startCommand) buildArgs += ` --start-cmd "${app.startCommand}"`;

  const buildResult = await sshService.executeCommand({
    ...sshConfig,
    command: buildArgs,
  });

  if (!buildResult.success) {
    throw new Error(`Nixpacks build failed: ${buildResult.stderr}`);
  }
  addLog("Nixpacks build completed.");

  // Stop old container
  await stopAndRemoveContainer(sshConfig, containerName, addLog);

  // Run new container
  addLog("Starting container...");
  const port = app.portsExposes ?? "3000";
  let runCmd = `docker run -d --name ${containerName} --network ${network} --restart unless-stopped`;
  runCmd += ` -l coolify.managed=true -l coolify.applicationId=${app.uuid}`;
  if (app.portsMappings) runCmd += ` -p ${app.portsMappings}`;
  if (app.customDockerRunOptions) runCmd += ` ${app.customDockerRunOptions}`;
  runCmd += addResourceLimits(app);
  runCmd += ` --env-file ${sourceDir}/.env`;
  runCmd += ` ${imageName}`;

  const runResult = await sshService.executeCommand({ ...sshConfig, command: runCmd });
  if (!runResult.success) {
    throw new Error(`Failed to start container: ${runResult.stderr}`);
  }
  addLog(`Container ${containerName} started.`);
}

async function deployDockerfile(ctx: DeployContext) {
  const { sshConfig, app, workdir, containerName, network, envVars, addLog } = ctx;

  const sourceDir = await cloneOrPull(ctx);
  await writeEnvFile(sshConfig, sourceDir, envVars);

  const imageName = `coolify-${app.uuid}:latest`;
  const dockerfilePath = app.dockerfileLocation ?? "/Dockerfile";
  const fullDockerfilePath = `${sourceDir}${dockerfilePath}`;

  // If inline Dockerfile content is provided, write it
  if (app.dockerfile) {
    addLog("Writing custom Dockerfile...");
    await sshService.executeCommand({
      ...sshConfig,
      command: `cat > ${fullDockerfilePath} << 'COOLIFY_DOCKERFILE_EOF'\n${app.dockerfile}\nCOOLIFY_DOCKERFILE_EOF`,
    });
  }

  addLog("Building Docker image...");
  let buildCmd = `docker build -t ${imageName} -f ${fullDockerfilePath}`;
  if (app.dockerfileBuildStage) buildCmd += ` --target ${app.dockerfileBuildStage}`;
  buildCmd += ` ${sourceDir}`;

  const buildResult = await sshService.executeCommand({ ...sshConfig, command: buildCmd });
  if (!buildResult.success) {
    throw new Error(`Docker build failed: ${buildResult.stderr}`);
  }
  addLog("Docker build completed.");

  await stopAndRemoveContainer(sshConfig, containerName, addLog);

  addLog("Starting container...");
  let runCmd = `docker run -d --name ${containerName} --network ${network} --restart unless-stopped`;
  runCmd += ` -l coolify.managed=true -l coolify.applicationId=${app.uuid}`;
  if (app.portsMappings) runCmd += ` -p ${app.portsMappings}`;
  if (app.customDockerRunOptions) runCmd += ` ${app.customDockerRunOptions}`;
  runCmd += addResourceLimits(app);
  runCmd += ` --env-file ${sourceDir}/.env`;
  runCmd += ` ${imageName}`;

  const runResult = await sshService.executeCommand({ ...sshConfig, command: runCmd });
  if (!runResult.success) {
    throw new Error(`Failed to start container: ${runResult.stderr}`);
  }
  addLog(`Container ${containerName} started.`);
}

async function deployDockerCompose(
  ctx: Pick<DeployContext, "sshConfig" | "app" | "workdir" | "envVars" | "force" | "commit" | "addLog">
) {
  const { sshConfig, app, workdir, envVars, addLog } = ctx;

  const sourceDir = await cloneOrPull(ctx as DeployContext);
  await writeEnvFile(sshConfig, sourceDir, envVars);

  const composeFile = app.dockerComposeLocation ?? "/docker-compose.yml";
  const composePath = `${sourceDir}${composeFile}`;

  // If inline compose content is provided, write it
  if (app.dockerCompose) {
    addLog("Writing custom docker-compose.yml...");
    await sshService.executeCommand({
      ...sshConfig,
      command: `cat > ${composePath} << 'COOLIFY_COMPOSE_EOF'\n${app.dockerCompose}\nCOOLIFY_COMPOSE_EOF`,
    });
  }

  addLog("Starting docker compose...");
  let upCmd = `cd ${sourceDir} && docker compose -f ${composePath} up -d --build --remove-orphans`;
  if (app.dockerComposeCustomBuildCommand) {
    upCmd = `cd ${sourceDir} && ${app.dockerComposeCustomBuildCommand}`;
  }

  const result = await sshService.executeCommand({ ...sshConfig, command: upCmd });
  if (!result.success) {
    throw new Error(`Docker compose failed: ${result.stderr}`);
  }
  addLog("Docker compose deployment completed.");
}

async function deployDockerImage(
  ctx: Pick<DeployContext, "sshConfig" | "app" | "containerName" | "network" | "envVars" | "addLog">
) {
  const { sshConfig, app, containerName, network, envVars, addLog } = ctx;

  const image = app.dockerRegistryImageName;
  const tag = app.dockerRegistryImageTag ?? "latest";

  if (!image) throw new Error("No Docker image configured");

  const fullImage = `${image}:${tag}`;
  addLog(`Pulling image ${fullImage}...`);

  const pullResult = await sshService.executeCommand({
    ...sshConfig,
    command: `docker pull ${fullImage}`,
  });
  if (!pullResult.success) {
    throw new Error(`Failed to pull image: ${pullResult.stderr}`);
  }

  await stopAndRemoveContainer(sshConfig, containerName, addLog);

  addLog("Starting container...");
  const tmpEnvFile = `/tmp/coolify-env-${app.uuid}`;
  await sshService.executeCommand({
    ...sshConfig,
    command: `cat > ${tmpEnvFile} << 'COOLIFY_ENV_EOF'\n${envVars}\nCOOLIFY_ENV_EOF`,
  });

  let runCmd = `docker run -d --name ${containerName} --network ${network} --restart unless-stopped`;
  runCmd += ` -l coolify.managed=true -l coolify.applicationId=${app.uuid}`;
  if (app.portsMappings) runCmd += ` -p ${app.portsMappings}`;
  if (app.customDockerRunOptions) runCmd += ` ${app.customDockerRunOptions}`;
  runCmd += addResourceLimits(app);
  if (envVars.trim()) runCmd += ` --env-file ${tmpEnvFile}`;
  runCmd += ` ${fullImage}`;

  const runResult = await sshService.executeCommand({ ...sshConfig, command: runCmd });
  if (!runResult.success) {
    throw new Error(`Failed to start container: ${runResult.stderr}`);
  }
  addLog(`Container ${containerName} started.`);
}

async function deployStatic(ctx: DeployContext) {
  const { sshConfig, app, workdir, containerName, network, envVars, addLog } = ctx;

  const sourceDir = await cloneOrPull(ctx);
  await writeEnvFile(sshConfig, sourceDir, envVars);

  const publishDir = app.publishDirectory ?? "/dist";
  const staticImage = app.staticImage ?? "nginx:alpine";

  // Run build if configured
  if (app.installCommand || app.buildCommand) {
    addLog("Installing dependencies and building...");
    let buildScript = "set -e";
    if (app.installCommand) buildScript += ` && ${app.installCommand}`;
    if (app.buildCommand) buildScript += ` && ${app.buildCommand}`;

    const buildResult = await sshService.executeCommand({
      ...sshConfig,
      command: `cd ${sourceDir} && ${buildScript}`,
    });
    if (!buildResult.success) {
      throw new Error(`Build failed: ${buildResult.stderr}`);
    }
  }

  // Generate nginx config for SPA
  const nginxConf = app.customNginxConfiguration || `
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;
  location / {
    try_files $uri $uri/ /index.html;
  }
}`;

  await sshService.executeCommand({
    ...sshConfig,
    command: `cat > ${sourceDir}/coolify-nginx.conf << 'COOLIFY_NGINX_EOF'\n${nginxConf}\nCOOLIFY_NGINX_EOF`,
  });

  await stopAndRemoveContainer(sshConfig, containerName, addLog);

  addLog(`Starting static server with ${staticImage}...`);
  let runCmd = `docker run -d --name ${containerName} --network ${network} --restart unless-stopped`;
  runCmd += ` -l coolify.managed=true -l coolify.applicationId=${app.uuid}`;
  runCmd += ` -v ${sourceDir}${publishDir}:/usr/share/nginx/html:ro`;
  runCmd += ` -v ${sourceDir}/coolify-nginx.conf:/etc/nginx/conf.d/default.conf:ro`;
  if (app.portsMappings) runCmd += ` -p ${app.portsMappings}`;
  runCmd += addResourceLimits(app);
  runCmd += ` ${staticImage}`;

  const runResult = await sshService.executeCommand({ ...sshConfig, command: runCmd });
  if (!runResult.success) {
    throw new Error(`Failed to start static server: ${runResult.stderr}`);
  }
  addLog(`Static server ${containerName} started.`);
}

// ----- Helpers -----

async function stopAndRemoveContainer(
  sshConfig: DeployContext["sshConfig"],
  containerName: string,
  addLog: (msg: string) => void
) {
  addLog("Stopping existing container...");
  await sshService.executeCommand({
    ...sshConfig,
    command: `docker stop ${containerName} 2>/dev/null; docker rm ${containerName} 2>/dev/null; true`,
  });
}

function buildEnvFile(envVars: { key: string; value: string | null; isBuildTime: boolean }[]): string {
  return envVars
    .filter((v) => !v.isBuildTime && v.value !== null)
    .map((v) => `${v.key}=${v.value}`)
    .join("\n");
}

function addResourceLimits(app: any): string {
  let flags = "";
  if (app.limitsMemory && app.limitsMemory !== "0") flags += ` --memory=${app.limitsMemory}`;
  if (app.limitsMemorySwap && app.limitsMemorySwap !== "0") flags += ` --memory-swap=${app.limitsMemorySwap}`;
  if (app.limitsCpus && app.limitsCpus !== "0") flags += ` --cpus=${app.limitsCpus}`;
  if (app.limitsCpuset) flags += ` --cpuset-cpus=${app.limitsCpuset}`;
  if (app.limitsCpuShares && app.limitsCpuShares !== 1024) flags += ` --cpu-shares=${app.limitsCpuShares}`;
  return flags;
}

async function waitForHealthy(
  sshConfig: DeployContext["sshConfig"],
  containerName: string,
  opts: { path: string; port: string; retries: number; interval: number }
) {
  for (let attempt = 1; attempt <= opts.retries; attempt++) {
    const result = await sshService.executeCommand({
      ...sshConfig,
      command: `docker exec ${containerName} wget -q -O /dev/null http://localhost:${opts.port}${opts.path} 2>&1 && echo "healthy" || echo "unhealthy"`,
    });

    if (result.stdout.trim().includes("healthy")) return;

    if (attempt < opts.retries) {
      await new Promise((r) => setTimeout(r, opts.interval * 1000));
    }
  }
  throw new Error(`Health check failed after ${opts.retries} attempts`);
}
