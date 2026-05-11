/**
 * Docker Swarm Service
 *
 * Handles Docker Swarm cluster management and service deployments.
 */

import { logger } from "@/lib/logger";
import type { SSHConnection } from "@/server/services/ssh";
import { sshService } from "@/server/services/ssh";

export interface SwarmConfig {
  serverId: string;
  managerHost: string;
  sshKeyId?: string;
}

export interface SwarmNode {
  id: string;
  hostname: string;
  status: "ready" | "down" | "disconnected" | "unknown";
  availability: "active" | "pause" | "drain";
  role: "manager" | "worker";
  engineVersion: string;
  ip: string;
}

export interface SwarmService {
  id: string;
  name: string;
  mode: "replicated" | "global";
  replicas: number;
  runningReplicas: number;
  image: string;
  ports: { published: number; target: number; protocol: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface SwarmServiceSpec {
  name: string;
  image: string;
  replicas?: number;
  mode?: "replicated" | "global";
  ports?: { published: number; target: number; protocol?: string }[];
  env?: Record<string, string>;
  labels?: Record<string, string>;
  networks?: string[];
  constraints?: string[];
  resources?: {
    limits?: { cpus?: string; memory?: string };
    reservations?: { cpus?: string; memory?: string };
  };
  healthcheck?: {
    test: string[];
    interval?: string;
    timeout?: string;
    retries?: number;
    startPeriod?: string;
  };
}

export interface SwarmStack {
  name: string;
  services: number;
  orchestrator: string;
}

class SwarmService {
  private connections: Map<string, SSHConnection> = new Map();

  /**
   * Initialize connection to a Swarm manager node
   */
  async connect(config: SwarmConfig): Promise<void> {
    const connection = await sshService.connect({
      host: config.managerHost,
      username: "root",
      privateKeyId: config.sshKeyId,
    });

    // Verify this is a swarm manager
    const result = await sshService.execute(connection, "docker info --format '{{.Swarm.LocalNodeState}}'");
    if (result.stdout.trim() !== "active") {
      throw new Error("Server is not part of an active Docker Swarm");
    }

    const roleResult = await sshService.execute(connection, "docker info --format '{{.Swarm.ControlAvailable}}'");
    if (roleResult.stdout.trim() !== "true") {
      throw new Error("Server is not a Swarm manager node");
    }

    this.connections.set(config.serverId, connection);
    logger.info("Connected to Docker Swarm manager", { serverId: config.serverId });
  }

  /**
   * Initialize a new Swarm cluster
   */
  async initSwarm(
    serverId: string,
    options?: { advertiseAddr?: string; listenAddr?: string }
  ): Promise<{ workerjoinToken: string; managerJoinToken: string }> {
    const connection = this.getConnection(serverId);

    let cmd = "docker swarm init";
    if (options?.advertiseAddr) {
      cmd += ` --advertise-addr ${options.advertiseAddr}`;
    }
    if (options?.listenAddr) {
      cmd += ` --listen-addr ${options.listenAddr}`;
    }

    await sshService.execute(connection, cmd);

    // Get join tokens
    const workerToken = await sshService.execute(
      connection,
      "docker swarm join-token worker -q"
    );
    const managerToken = await sshService.execute(
      connection,
      "docker swarm join-token manager -q"
    );

    logger.info("Initialized Docker Swarm cluster", { serverId });

    return {
      workerjoinToken: workerToken.stdout.trim(),
      managerJoinToken: managerToken.stdout.trim(),
    };
  }

  /**
   * Get all nodes in the swarm
   */
  async getNodes(serverId: string): Promise<SwarmNode[]> {
    const connection = this.getConnection(serverId);

    const result = await sshService.execute(
      connection,
      `docker node ls --format '{{json .}}'`
    );

    const nodes: SwarmNode[] = [];
    for (const line of result.stdout.trim().split("\n")) {
      if (!line) continue;
      try {
        const node = JSON.parse(line);
        nodes.push({
          id: node.ID,
          hostname: node.Hostname,
          status: this.parseNodeStatus(node.Status),
          availability: node.Availability?.toLowerCase() || "unknown",
          role: node.ManagerStatus ? "manager" : "worker",
          engineVersion: node.EngineVersion || "",
          ip: node.IP || "",
        });
      } catch {
        logger.warn("Failed to parse node info", { line });
      }
    }

    return nodes;
  }

  /**
   * Get detailed node information
   */
  async getNodeDetails(serverId: string, nodeId: string): Promise<SwarmNode & { resources: object }> {
    const connection = this.getConnection(serverId);

    const result = await sshService.execute(
      connection,
      `docker node inspect ${nodeId} --format '{{json .}}'`
    );

    const node = JSON.parse(result.stdout.trim());

    return {
      id: node.ID,
      hostname: node.Description?.Hostname || "",
      status: this.parseNodeStatus(node.Status?.State),
      availability: node.Spec?.Availability?.toLowerCase() || "unknown",
      role: node.Spec?.Role?.toLowerCase() || "worker",
      engineVersion: node.Description?.Engine?.EngineVersion || "",
      ip: node.Status?.Addr || "",
      resources: {
        cpus: node.Description?.Resources?.NanoCPUs,
        memory: node.Description?.Resources?.MemoryBytes,
      },
    };
  }

  /**
   * Update node availability (active, pause, drain)
   */
  async updateNodeAvailability(
    serverId: string,
    nodeId: string,
    availability: "active" | "pause" | "drain"
  ): Promise<void> {
    const connection = this.getConnection(serverId);

    await sshService.execute(
      connection,
      `docker node update --availability ${availability} ${nodeId}`
    );

    logger.info("Updated node availability", { nodeId, availability });
  }

  /**
   * Remove a node from the swarm
   */
  async removeNode(serverId: string, nodeId: string, force?: boolean): Promise<void> {
    const connection = this.getConnection(serverId);

    const cmd = force
      ? `docker node rm --force ${nodeId}`
      : `docker node rm ${nodeId}`;

    await sshService.execute(connection, cmd);
    logger.info("Removed node from swarm", { nodeId });
  }

  /**
   * List all services
   */
  async listServices(serverId: string): Promise<SwarmService[]> {
    const connection = this.getConnection(serverId);

    const result = await sshService.execute(
      connection,
      `docker service ls --format '{{json .}}'`
    );

    const services: SwarmService[] = [];
    for (const line of result.stdout.trim().split("\n")) {
      if (!line) continue;
      try {
        const svc = JSON.parse(line);
        const [running, total] = (svc.Replicas || "0/0").split("/").map(Number);
        services.push({
          id: svc.ID,
          name: svc.Name,
          mode: svc.Mode?.toLowerCase() === "global" ? "global" : "replicated",
          replicas: total || 0,
          runningReplicas: running || 0,
          image: svc.Image,
          ports: this.parsePorts(svc.Ports || ""),
          createdAt: "",
          updatedAt: "",
        });
      } catch {
        logger.warn("Failed to parse service info", { line });
      }
    }

    return services;
  }

  /**
   * Create a new service
   */
  async createService(serverId: string, spec: SwarmServiceSpec): Promise<string> {
    const connection = this.getConnection(serverId);

    let cmd = `docker service create --name ${spec.name}`;

    if (spec.mode === "global") {
      cmd += " --mode global";
    } else if (spec.replicas) {
      cmd += ` --replicas ${spec.replicas}`;
    }

    if (spec.ports) {
      for (const port of spec.ports) {
        cmd += ` --publish published=${port.published},target=${port.target},protocol=${port.protocol || "tcp"}`;
      }
    }

    if (spec.env) {
      for (const [key, value] of Object.entries(spec.env)) {
        cmd += ` --env ${key}=${this.escapeShellArg(value)}`;
      }
    }

    if (spec.labels) {
      for (const [key, value] of Object.entries(spec.labels)) {
        cmd += ` --label ${key}=${this.escapeShellArg(value)}`;
      }
    }

    // Add Coolify management labels
    cmd += ` --label coolify.managed=true`;

    if (spec.networks) {
      for (const network of spec.networks) {
        cmd += ` --network ${network}`;
      }
    }

    if (spec.constraints) {
      for (const constraint of spec.constraints) {
        cmd += ` --constraint '${constraint}'`;
      }
    }

    if (spec.resources?.limits?.cpus) {
      cmd += ` --limit-cpu ${spec.resources.limits.cpus}`;
    }
    if (spec.resources?.limits?.memory) {
      cmd += ` --limit-memory ${spec.resources.limits.memory}`;
    }
    if (spec.resources?.reservations?.cpus) {
      cmd += ` --reserve-cpu ${spec.resources.reservations.cpus}`;
    }
    if (spec.resources?.reservations?.memory) {
      cmd += ` --reserve-memory ${spec.resources.reservations.memory}`;
    }

    if (spec.healthcheck) {
      cmd += ` --health-cmd '${spec.healthcheck.test.join(" ")}'`;
      if (spec.healthcheck.interval) cmd += ` --health-interval ${spec.healthcheck.interval}`;
      if (spec.healthcheck.timeout) cmd += ` --health-timeout ${spec.healthcheck.timeout}`;
      if (spec.healthcheck.retries) cmd += ` --health-retries ${spec.healthcheck.retries}`;
      if (spec.healthcheck.startPeriod) cmd += ` --health-start-period ${spec.healthcheck.startPeriod}`;
    }

    cmd += ` ${spec.image}`;

    const result = await sshService.execute(connection, cmd);
    const serviceId = result.stdout.trim();

    logger.info("Created swarm service", { name: spec.name, serviceId });
    return serviceId;
  }

  /**
   * Update an existing service
   */
  async updateService(
    serverId: string,
    serviceName: string,
    updates: Partial<SwarmServiceSpec>
  ): Promise<void> {
    const connection = this.getConnection(serverId);

    let cmd = `docker service update`;

    if (updates.image) {
      cmd += ` --image ${updates.image}`;
    }

    if (updates.replicas !== undefined) {
      cmd += ` --replicas ${updates.replicas}`;
    }

    if (updates.env) {
      for (const [key, value] of Object.entries(updates.env)) {
        cmd += ` --env-add ${key}=${this.escapeShellArg(value)}`;
      }
    }

    if (updates.labels) {
      for (const [key, value] of Object.entries(updates.labels)) {
        cmd += ` --label-add ${key}=${this.escapeShellArg(value)}`;
      }
    }

    if (updates.resources?.limits?.cpus) {
      cmd += ` --limit-cpu ${updates.resources.limits.cpus}`;
    }
    if (updates.resources?.limits?.memory) {
      cmd += ` --limit-memory ${updates.resources.limits.memory}`;
    }

    cmd += ` ${serviceName}`;

    await sshService.execute(connection, cmd);
    logger.info("Updated swarm service", { serviceName });
  }

  /**
   * Scale a service
   */
  async scaleService(serverId: string, serviceName: string, replicas: number): Promise<void> {
    const connection = this.getConnection(serverId);

    await sshService.execute(
      connection,
      `docker service scale ${serviceName}=${replicas}`
    );

    logger.info("Scaled swarm service", { serviceName, replicas });
  }

  /**
   * Remove a service
   */
  async removeService(serverId: string, serviceName: string): Promise<void> {
    const connection = this.getConnection(serverId);

    await sshService.execute(connection, `docker service rm ${serviceName}`);
    logger.info("Removed swarm service", { serviceName });
  }

  /**
   * Get service logs
   */
  async getServiceLogs(
    serverId: string,
    serviceName: string,
    options?: { tail?: number; since?: string; timestamps?: boolean }
  ): Promise<string> {
    const connection = this.getConnection(serverId);

    let cmd = `docker service logs`;
    if (options?.tail) cmd += ` --tail ${options.tail}`;
    if (options?.since) cmd += ` --since ${options.since}`;
    if (options?.timestamps) cmd += ` --timestamps`;
    cmd += ` ${serviceName}`;

    const result = await sshService.execute(connection, cmd);
    return result.stdout;
  }

  /**
   * Deploy a stack from compose file
   */
  async deployStack(
    serverId: string,
    stackName: string,
    composeContent: string
  ): Promise<void> {
    const connection = this.getConnection(serverId);

    // Write compose file to temp location
    const tempPath = `/tmp/coolify-stack-${stackName}-${Date.now()}.yml`;
    await sshService.execute(
      connection,
      `cat > ${tempPath} << 'COOLIFY_COMPOSE_EOF'\n${composeContent}\nCOOLIFY_COMPOSE_EOF`
    );

    try {
      await sshService.execute(
        connection,
        `docker stack deploy -c ${tempPath} ${stackName}`
      );
      logger.info("Deployed swarm stack", { stackName });
    } finally {
      // Clean up temp file
      await sshService.execute(connection, `rm -f ${tempPath}`);
    }
  }

  /**
   * List all stacks
   */
  async listStacks(serverId: string): Promise<SwarmStack[]> {
    const connection = this.getConnection(serverId);

    const result = await sshService.execute(
      connection,
      `docker stack ls --format '{{json .}}'`
    );

    const stacks: SwarmStack[] = [];
    for (const line of result.stdout.trim().split("\n")) {
      if (!line) continue;
      try {
        const stack = JSON.parse(line);
        stacks.push({
          name: stack.Name,
          services: parseInt(stack.Services, 10) || 0,
          orchestrator: stack.Orchestrator || "swarm",
        });
      } catch {
        logger.warn("Failed to parse stack info", { line });
      }
    }

    return stacks;
  }

  /**
   * Remove a stack
   */
  async removeStack(serverId: string, stackName: string): Promise<void> {
    const connection = this.getConnection(serverId);

    await sshService.execute(connection, `docker stack rm ${stackName}`);
    logger.info("Removed swarm stack", { stackName });
  }

  /**
   * Get stack services
   */
  async getStackServices(serverId: string, stackName: string): Promise<SwarmService[]> {
    const connection = this.getConnection(serverId);

    const result = await sshService.execute(
      connection,
      `docker stack services ${stackName} --format '{{json .}}'`
    );

    const services: SwarmService[] = [];
    for (const line of result.stdout.trim().split("\n")) {
      if (!line) continue;
      try {
        const svc = JSON.parse(line);
        const [running, total] = (svc.Replicas || "0/0").split("/").map(Number);
        services.push({
          id: svc.ID,
          name: svc.Name,
          mode: svc.Mode?.toLowerCase() === "global" ? "global" : "replicated",
          replicas: total || 0,
          runningReplicas: running || 0,
          image: svc.Image,
          ports: this.parsePorts(svc.Ports || ""),
          createdAt: "",
          updatedAt: "",
        });
      } catch {
        logger.warn("Failed to parse stack service info", { line });
      }
    }

    return services;
  }

  /**
   * Create an overlay network
   */
  async createNetwork(
    serverId: string,
    name: string,
    options?: { driver?: string; attachable?: boolean; encrypted?: boolean }
  ): Promise<void> {
    const connection = this.getConnection(serverId);

    let cmd = `docker network create`;
    cmd += ` --driver ${options?.driver || "overlay"}`;
    if (options?.attachable) cmd += " --attachable";
    if (options?.encrypted) cmd += " --opt encrypted";
    cmd += ` --label coolify.managed=true`;
    cmd += ` ${name}`;

    await sshService.execute(connection, cmd);
    logger.info("Created overlay network", { name });
  }

  /**
   * Remove a network
   */
  async removeNetwork(serverId: string, name: string): Promise<void> {
    const connection = this.getConnection(serverId);

    await sshService.execute(connection, `docker network rm ${name}`);
    logger.info("Removed network", { name });
  }

  /**
   * Get join command for workers
   */
  async getWorkerJoinCommand(serverId: string): Promise<string> {
    const connection = this.getConnection(serverId);

    const result = await sshService.execute(
      connection,
      "docker swarm join-token worker"
    );

    // Extract the join command from output
    const match = result.stdout.match(/docker swarm join --token [\w-]+ [\d.:]+/);
    return match ? match[0] : "";
  }

  /**
   * Get join command for managers
   */
  async getManagerJoinCommand(serverId: string): Promise<string> {
    const connection = this.getConnection(serverId);

    const result = await sshService.execute(
      connection,
      "docker swarm join-token manager"
    );

    const match = result.stdout.match(/docker swarm join --token [\w-]+ [\d.:]+/);
    return match ? match[0] : "";
  }

  /**
   * Leave the swarm
   */
  async leaveSwarm(serverId: string, force?: boolean): Promise<void> {
    const connection = this.getConnection(serverId);

    const cmd = force ? "docker swarm leave --force" : "docker swarm leave";
    await sshService.execute(connection, cmd);

    this.connections.delete(serverId);
    logger.info("Left swarm cluster", { serverId });
  }

  /**
   * Disconnect from swarm manager
   */
  disconnect(serverId: string): void {
    const connection = this.connections.get(serverId);
    if (connection) {
      sshService.disconnect(connection);
      this.connections.delete(serverId);
    }
  }

  private getConnection(serverId: string): SSHConnection {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new Error(`No connection for server ${serverId}`);
    }
    return connection;
  }

  private parseNodeStatus(status: string): SwarmNode["status"] {
    const s = status?.toLowerCase();
    if (s === "ready") return "ready";
    if (s === "down") return "down";
    if (s === "disconnected") return "disconnected";
    return "unknown";
  }

  private parsePorts(portsStr: string): SwarmService["ports"] {
    if (!portsStr) return [];
    const ports: SwarmService["ports"] = [];
    const matches = portsStr.matchAll(/\*:(\d+)->(\d+)\/(\w+)/g);
    for (const match of matches) {
      ports.push({
        published: parseInt(match[1], 10),
        target: parseInt(match[2], 10),
        protocol: match[3],
      });
    }
    return ports;
  }

  private escapeShellArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}

export const swarmService = new SwarmService();
