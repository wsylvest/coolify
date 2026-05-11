import { sshService, type SSHConnectionConfig } from "../ssh";
import { logger } from "@/lib/logger";
import YAML from "yaml";

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string[];
  labels: Record<string, string>;
  networks: string[];
}

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
}

export interface DockerComposeConfig {
  version?: string;
  services: Record<string, DockerServiceConfig>;
  networks?: Record<string, DockerNetworkConfig>;
  volumes?: Record<string, DockerVolumeConfig>;
}

export interface DockerServiceConfig {
  image?: string;
  build?: {
    context?: string;
    dockerfile?: string;
    args?: Record<string, string>;
  };
  ports?: string[];
  environment?: Record<string, string> | string[];
  volumes?: string[];
  networks?: string[];
  depends_on?: string[];
  restart?: string;
  labels?: Record<string, string>;
  healthcheck?: {
    test: string | string[];
    interval?: string;
    timeout?: string;
    retries?: number;
    start_period?: string;
  };
  deploy?: {
    replicas?: number;
    resources?: {
      limits?: {
        cpus?: string;
        memory?: string;
      };
      reservations?: {
        cpus?: string;
        memory?: string;
      };
    };
  };
}

export interface DockerNetworkConfig {
  external?: boolean;
  driver?: string;
}

export interface DockerVolumeConfig {
  external?: boolean;
  driver?: string;
}

class DockerService {
  /**
   * List all containers on a server
   */
  async listContainers(
    sshConfig: SSHConnectionConfig
  ): Promise<DockerContainer[]> {
    const result = await sshService.executeCommand({
      ...sshConfig,
      command: `docker ps -a --format '{{json .}}'`,
    });

    if (!result.success) {
      throw new Error(`Failed to list containers: ${result.stderr}`);
    }

    const containers: DockerContainer[] = [];
    const lines = result.stdout.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        containers.push({
          id: data.ID,
          name: data.Names,
          image: data.Image,
          status: data.Status,
          state: data.State,
          ports: data.Ports ? data.Ports.split(",").filter(Boolean) : [],
          labels: {},
          networks: data.Networks ? data.Networks.split(",") : [],
        });
      } catch {
        // Skip invalid JSON
      }
    }

    return containers;
  }

  /**
   * Get container logs
   */
  async getContainerLogs(
    sshConfig: SSHConnectionConfig,
    containerId: string,
    options: { tail?: number; since?: string } = {}
  ): Promise<string> {
    const args: string[] = [];
    if (options.tail) args.push(`--tail ${options.tail}`);
    if (options.since) args.push(`--since ${options.since}`);

    const result = await sshService.executeCommand({
      ...sshConfig,
      command: `docker logs ${args.join(" ")} ${containerId}`,
    });

    return result.stdout + result.stderr;
  }

  /**
   * Start a container
   */
  async startContainer(
    sshConfig: SSHConnectionConfig,
    containerId: string
  ): Promise<void> {
    const result = await sshService.executeCommand({
      ...sshConfig,
      command: `docker start ${containerId}`,
    });

    if (!result.success) {
      throw new Error(`Failed to start container: ${result.stderr}`);
    }
  }

  /**
   * Stop a container
   */
  async stopContainer(
    sshConfig: SSHConnectionConfig,
    containerId: string,
    timeout = 30
  ): Promise<void> {
    const result = await sshService.executeCommand({
      ...sshConfig,
      command: `docker stop -t ${timeout} ${containerId}`,
    });

    if (!result.success) {
      throw new Error(`Failed to stop container: ${result.stderr}`);
    }
  }

  /**
   * Remove a container
   */
  async removeContainer(
    sshConfig: SSHConnectionConfig,
    containerId: string,
    force = false
  ): Promise<void> {
    const result = await sshService.executeCommand({
      ...sshConfig,
      command: `docker rm ${force ? "-f" : ""} ${containerId}`,
    });

    if (!result.success) {
      throw new Error(`Failed to remove container: ${result.stderr}`);
    }
  }

  /**
   * Pull an image
   */
  async pullImage(
    sshConfig: SSHConnectionConfig,
    image: string
  ): Promise<void> {
    const result = await sshService.executeCommand({
      ...sshConfig,
      command: `docker pull ${image}`,
      timeout: 300000, // 5 minutes
    });

    if (!result.success) {
      throw new Error(`Failed to pull image: ${result.stderr}`);
    }
  }

  /**
   * Build an image from Dockerfile
   */
  async buildImage(
    sshConfig: SSHConnectionConfig,
    options: {
      context: string;
      dockerfile?: string;
      tag: string;
      buildArgs?: Record<string, string>;
    }
  ): Promise<string> {
    const args: string[] = ["-t", options.tag];

    if (options.dockerfile) {
      args.push("-f", options.dockerfile);
    }

    if (options.buildArgs) {
      for (const [key, value] of Object.entries(options.buildArgs)) {
        args.push("--build-arg", `${key}=${value}`);
      }
    }

    const result = await sshService.executeCommand({
      ...sshConfig,
      command: `cd ${options.context} && docker build ${args.join(" ")} .`,
      timeout: 600000, // 10 minutes
    });

    if (!result.success) {
      throw new Error(`Failed to build image: ${result.stderr}`);
    }

    return result.stdout;
  }

  /**
   * Create and start containers using Docker Compose
   */
  async composeUp(
    sshConfig: SSHConnectionConfig,
    options: {
      projectName: string;
      composeFile: string;
      workDir: string;
      detach?: boolean;
      build?: boolean;
      forceRecreate?: boolean;
    }
  ): Promise<string> {
    const args: string[] = [
      "-p",
      options.projectName,
      "-f",
      options.composeFile,
      "up",
    ];

    if (options.detach !== false) args.push("-d");
    if (options.build) args.push("--build");
    if (options.forceRecreate) args.push("--force-recreate");

    // Write compose file
    await sshService.createDirectory({ ...sshConfig, remotePath: options.workDir });

    const result = await sshService.executeCommand({
      ...sshConfig,
      command: `cd ${options.workDir} && docker compose ${args.join(" ")}`,
      timeout: 600000, // 10 minutes
    });

    if (!result.success) {
      throw new Error(`Failed to start compose: ${result.stderr}`);
    }

    return result.stdout;
  }

  /**
   * Stop and remove containers using Docker Compose
   */
  async composeDown(
    sshConfig: SSHConnectionConfig,
    options: {
      projectName: string;
      composeFile: string;
      workDir: string;
      removeVolumes?: boolean;
      removeImages?: "all" | "local";
    }
  ): Promise<string> {
    const args: string[] = [
      "-p",
      options.projectName,
      "-f",
      options.composeFile,
      "down",
    ];

    if (options.removeVolumes) args.push("-v");
    if (options.removeImages) args.push("--rmi", options.removeImages);

    const result = await sshService.executeCommand({
      ...sshConfig,
      command: `cd ${options.workDir} && docker compose ${args.join(" ")}`,
    });

    if (!result.success) {
      throw new Error(`Failed to stop compose: ${result.stderr}`);
    }

    return result.stdout;
  }

  /**
   * Create a Docker network
   */
  async createNetwork(
    sshConfig: SSHConnectionConfig,
    name: string,
    driver = "bridge"
  ): Promise<void> {
    // Check if network exists
    const checkResult = await sshService.executeCommand({
      ...sshConfig,
      command: `docker network inspect ${name}`,
    });

    if (checkResult.success) {
      logger.debug(`Network ${name} already exists`);
      return;
    }

    const result = await sshService.executeCommand({
      ...sshConfig,
      command: `docker network create --driver ${driver} ${name}`,
    });

    if (!result.success) {
      throw new Error(`Failed to create network: ${result.stderr}`);
    }
  }

  /**
   * Parse a Docker Compose file
   */
  parseComposeFile(content: string): DockerComposeConfig {
    return YAML.parse(content) as DockerComposeConfig;
  }

  /**
   * Generate a Docker Compose file
   */
  generateComposeFile(config: DockerComposeConfig): string {
    return YAML.stringify(config, {
      indent: 2,
      lineWidth: 0,
    });
  }

  /**
   * Prune unused Docker resources
   */
  async prune(
    sshConfig: SSHConnectionConfig,
    options: {
      containers?: boolean;
      images?: boolean;
      volumes?: boolean;
      networks?: boolean;
      all?: boolean;
    } = {}
  ): Promise<string> {
    const results: string[] = [];

    if (options.all || options.containers) {
      const result = await sshService.executeCommand({
        ...sshConfig,
        command: "docker container prune -f",
      });
      results.push(`Containers: ${result.stdout}`);
    }

    if (options.all || options.images) {
      const result = await sshService.executeCommand({
        ...sshConfig,
        command: "docker image prune -af",
      });
      results.push(`Images: ${result.stdout}`);
    }

    if (options.all || options.volumes) {
      const result = await sshService.executeCommand({
        ...sshConfig,
        command: "docker volume prune -f",
      });
      results.push(`Volumes: ${result.stdout}`);
    }

    if (options.all || options.networks) {
      const result = await sshService.executeCommand({
        ...sshConfig,
        command: "docker network prune -f",
      });
      results.push(`Networks: ${result.stdout}`);
    }

    return results.join("\n");
  }
}

export const dockerService = new DockerService();
