/**
 * Application Deployment Worker
 *
 * Handles deployment jobs for applications (git-based, Dockerfile, Docker Compose).
 */

import { Job, Worker } from "bullmq";
import IORedis from "ioredis";
import { db } from "../src/server/db";
import { applications, deploymentQueue } from "../src/server/db/schema";
import { eq } from "drizzle-orm";
import { sshService } from "../src/server/services/ssh";
import { dockerService } from "../src/server/services/docker";
import { proxyService } from "../src/server/services/proxy";
import { realtimeService } from "../src/server/services/realtime";
import { notificationService } from "../src/server/services/notifications";
import { logger } from "../src/lib/logger";

export interface DeploymentJobData {
  deploymentId: string;
  applicationId: string;
  commitSha?: string;
  force?: boolean;
}

export interface StopJobData {
  applicationId: string;
}

export interface RestartJobData {
  deploymentId: string;
  applicationId: string;
}

type JobData = DeploymentJobData | StopJobData | RestartJobData;

const COOLIFY_DIR = "/data/coolify";

function isDeploymentJob(data: JobData): data is DeploymentJobData {
  return "deploymentId" in data && "applicationId" in data && !("force" in data && data.force === undefined);
}

function isStopJob(data: JobData): data is StopJobData {
  return "applicationId" in data && !("deploymentId" in data);
}

export function createDeploymentWorker(redis: IORedis) {
  const worker = new Worker<JobData>(
    "deployment",
    async (job: Job<JobData>) => {
      if (isStopJob(job.data)) {
        return handleStopJob(job.data);
      }
      return handleDeploymentJob(job.data as DeploymentJobData);
    },
    {
      connection: {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379", 10),
      },
      concurrency: parseInt(process.env.DEPLOYMENT_CONCURRENCY || "3", 10),
    }
  );

  worker.on("completed", (job) => {
    logger.info(`Deployment job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    logger.error(`Deployment job ${job?.id} failed:`, err);
  });

  return worker;
}

async function handleDeploymentJob(data: DeploymentJobData): Promise<void> {
  const { deploymentId, applicationId, commitSha, force } = data;

  const logs: string[] = [];
  const addLog = (message: string) => {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}`;
    logs.push(logLine);
    logger.info(message, { deploymentId, applicationId });
    realtimeService.emitDeploymentLogs("", deploymentId, logLine);
  };

  try {
    addLog("Starting application deployment...");

    // Get application details with relations
    const application = await db.query.applications.findFirst({
      where: eq(applications.id, applicationId),
      with: {
        environment: {
          with: {
            project: true,
          },
        },
        destination: {
          with: {
            server: {
              with: {
                privateKey: true,
              },
            },
          },
        },
        privateKey: true,
      },
    });

    if (!application) {
      throw new Error("Application not found");
    }

    const server = application.destination?.server;
    if (!server?.privateKey) {
      throw new Error("Server has no private key configured");
    }

    const teamId = application.environment.project.teamId;
    const sshConfig = {
      host: server.ip,
      port: server.port,
      username: server.user,
      privateKey: server.privateKey.privateKey,
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

    const appDir = `${COOLIFY_DIR}/applications/${application.uuid}`;
    addLog(`Working directory: ${appDir}`);

    // Create application directory
    await sshService.executeCommand({
      ...sshConfig,
      command: `mkdir -p ${appDir}`,
    });

    // Handle different build packs
    switch (application.buildPack) {
      case "nixpacks":
        await deployWithNixpacks(application, sshConfig, appDir, commitSha, addLog);
        break;
      case "dockerfile":
        await deployWithDockerfile(application, sshConfig, appDir, commitSha, addLog);
        break;
      case "dockercompose":
        await deployWithDockerCompose(application, sshConfig, appDir, addLog);
        break;
      case "dockerimage":
        await deployWithDockerImage(application, sshConfig, appDir, addLog);
        break;
      default:
        throw new Error(`Unsupported build pack: ${application.buildPack}`);
    }

    // Configure proxy if FQDN is set
    if (application.fqdn) {
      addLog(`Configuring proxy for: ${application.fqdn}`);
      await proxyService.configureDomain({
        serverId: server.id,
        resourceType: "application",
        resourceId: application.id,
        domain: application.fqdn,
        targetPort: application.ports?.[0] || 3000,
        ssl: true,
      });
    }

    // Update deployment as finished
    await db
      .update(deploymentQueue)
      .set({
        status: "finished",
        finishedAt: new Date(),
        logs: logs.join("\n"),
      })
      .where(eq(deploymentQueue.id, deploymentId));

    // Update application status
    await db
      .update(applications)
      .set({
        status: "running",
        lastOnlineAt: new Date(),
        gitCommitSha: commitSha || application.gitCommitSha,
      })
      .where(eq(applications.id, applicationId));

    realtimeService.emitDeploymentStatus(teamId, deploymentId, "finished");
    addLog("Deployment completed successfully!");

    // Send notification
    await notificationService.send({
      teamId,
      type: "deployment",
      title: `Deployment Successful`,
      message: `Application ${application.name} deployed successfully`,
      metadata: { applicationId, deploymentId },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    addLog(`Deployment failed: ${errorMessage}`);

    // Update deployment as failed
    await db
      .update(deploymentQueue)
      .set({
        status: "failed",
        finishedAt: new Date(),
        logs: logs.join("\n"),
      })
      .where(eq(deploymentQueue.id, deploymentId));

    // Get team ID for notification
    const application = await db.query.applications.findFirst({
      where: eq(applications.id, applicationId),
      with: {
        environment: {
          with: {
            project: true,
          },
        },
      },
    });

    if (application) {
      const teamId = application.environment.project.teamId;
      realtimeService.emitDeploymentStatus(teamId, deploymentId, "failed");

      await notificationService.send({
        teamId,
        type: "deployment",
        title: "Deployment Failed",
        message: `Application ${application.name} deployment failed: ${errorMessage}`,
        metadata: { applicationId, deploymentId, error: errorMessage },
      });
    }

    throw error;
  }
}

async function handleStopJob(data: StopJobData): Promise<void> {
  const { applicationId } = data;

  const application = await db.query.applications.findFirst({
    where: eq(applications.id, applicationId),
    with: {
      destination: {
        with: {
          server: {
            with: {
              privateKey: true,
            },
          },
        },
      },
    },
  });

  if (!application) {
    throw new Error("Application not found");
  }

  const server = application.destination?.server;
  if (!server?.privateKey) {
    throw new Error("Server has no private key configured");
  }

  const sshConfig = {
    host: server.ip,
    port: server.port,
    username: server.user,
    privateKey: server.privateKey.privateKey,
  };

  logger.info(`Stopping application ${application.name}...`);

  // Stop containers
  const containerName = `coolify-${application.uuid}`;
  await sshService.executeCommand({
    ...sshConfig,
    command: `docker stop ${containerName} || true`,
  });

  // Update application status
  await db
    .update(applications)
    .set({ status: "exited" })
    .where(eq(applications.id, applicationId));

  logger.info(`Application ${application.name} stopped`);
}

async function deployWithNixpacks(
  application: any,
  sshConfig: any,
  appDir: string,
  commitSha: string | undefined,
  addLog: (msg: string) => void
): Promise<void> {
  addLog("Building with Nixpacks...");

  // Clone or pull repository
  if (application.gitRepository) {
    addLog(`Cloning repository: ${application.gitRepository}`);
    const branch = application.gitBranch || "main";
    const cloneResult = await sshService.executeCommand({
      ...sshConfig,
      command: `cd ${appDir} && rm -rf source && git clone --depth 1 --branch ${branch} ${application.gitFullUrl || application.gitRepository} source`,
      timeout: 300000,
    });

    if (!cloneResult.success) {
      throw new Error(`Git clone failed: ${cloneResult.stderr}`);
    }
  }

  const sourceDir = `${appDir}/source`;
  const imageName = `coolify-${application.uuid}:latest`;

  // Build with Nixpacks
  addLog("Running Nixpacks build...");
  const buildCommand = [
    "nixpacks build",
    sourceDir,
    `--name ${imageName}`,
    application.installCommand ? `--install-cmd "${application.installCommand}"` : "",
    application.buildCommand ? `--build-cmd "${application.buildCommand}"` : "",
    application.startCommand ? `--start-cmd "${application.startCommand}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const buildResult = await sshService.executeCommand({
    ...sshConfig,
    command: buildCommand,
    timeout: 600000,
  });

  if (!buildResult.success) {
    throw new Error(`Nixpacks build failed: ${buildResult.stderr}`);
  }

  addLog("Build completed, starting container...");
  await startContainer(application, sshConfig, imageName, addLog);
}

async function deployWithDockerfile(
  application: any,
  sshConfig: any,
  appDir: string,
  commitSha: string | undefined,
  addLog: (msg: string) => void
): Promise<void> {
  addLog("Building with Dockerfile...");

  // Clone repository
  if (application.gitRepository) {
    addLog(`Cloning repository: ${application.gitRepository}`);
    const branch = application.gitBranch || "main";
    await sshService.executeCommand({
      ...sshConfig,
      command: `cd ${appDir} && rm -rf source && git clone --depth 1 --branch ${branch} ${application.gitFullUrl || application.gitRepository} source`,
      timeout: 300000,
    });
  }

  const sourceDir = `${appDir}/source`;
  const dockerfilePath = application.dockerfileLocation || "/Dockerfile";
  const imageName = `coolify-${application.uuid}:latest`;

  // Build Docker image
  addLog("Building Docker image...");
  const buildResult = await sshService.executeCommand({
    ...sshConfig,
    command: `cd ${sourceDir} && docker build -t ${imageName} -f .${dockerfilePath} .`,
    timeout: 600000,
  });

  if (!buildResult.success) {
    throw new Error(`Docker build failed: ${buildResult.stderr}`);
  }

  addLog("Build completed, starting container...");
  await startContainer(application, sshConfig, imageName, addLog);
}

async function deployWithDockerCompose(
  application: any,
  sshConfig: any,
  appDir: string,
  addLog: (msg: string) => void
): Promise<void> {
  addLog("Deploying with Docker Compose...");

  const composeFile = `${appDir}/docker-compose.yaml`;

  // Write compose file
  if (application.dockerCompose) {
    await sshService.writeFile({
      ...sshConfig,
      remotePath: composeFile,
      content: application.dockerCompose,
    });
  }

  // Deploy with compose
  addLog("Starting Docker Compose services...");
  const result = await dockerService.composeUp(sshConfig, {
    projectName: `coolify-${application.uuid}`,
    composeFile,
    workDir: appDir,
  });

  addLog(result);
}

async function deployWithDockerImage(
  application: any,
  sshConfig: any,
  appDir: string,
  addLog: (msg: string) => void
): Promise<void> {
  const imageName = application.dockerRegistryImageName;
  const imageTag = application.dockerRegistryImageTag || "latest";
  const fullImage = `${imageName}:${imageTag}`;

  addLog(`Pulling Docker image: ${fullImage}...`);
  const pullResult = await sshService.executeCommand({
    ...sshConfig,
    command: `docker pull ${fullImage}`,
    timeout: 300000,
  });

  if (!pullResult.success) {
    throw new Error(`Failed to pull image: ${pullResult.stderr}`);
  }

  addLog("Starting container...");
  await startContainer(application, sshConfig, fullImage, addLog);
}

async function startContainer(
  application: any,
  sshConfig: any,
  imageName: string,
  addLog: (msg: string) => void
): Promise<void> {
  const containerName = `coolify-${application.uuid}`;

  // Stop existing container
  await sshService.executeCommand({
    ...sshConfig,
    command: `docker stop ${containerName} 2>/dev/null || true && docker rm ${containerName} 2>/dev/null || true`,
  });

  // Build docker run command
  const envVars = application.environmentVariables
    ? Object.entries(JSON.parse(application.environmentVariables) as Record<string, string>)
        .map(([k, v]) => `-e "${k}=${v}"`)
        .join(" ")
    : "";

  const ports = application.ports
    ? application.ports.map((p: number) => `-p ${p}:${p}`).join(" ")
    : "-p 3000:3000";

  const runCommand = [
    "docker run -d",
    `--name ${containerName}`,
    "--restart unless-stopped",
    "--network coolify-proxy",
    `--label coolify.managed=true`,
    `--label coolify.applicationId=${application.id}`,
    envVars,
    ports,
    imageName,
    application.startCommand || "",
  ]
    .filter(Boolean)
    .join(" ");

  addLog(`Running: docker run --name ${containerName}...`);
  const result = await sshService.executeCommand({
    ...sshConfig,
    command: runCommand,
    timeout: 60000,
  });

  if (!result.success) {
    throw new Error(`Failed to start container: ${result.stderr}`);
  }

  addLog(`Container ${containerName} started successfully`);
}
