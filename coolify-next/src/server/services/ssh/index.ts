import { Client, type ConnectConfig, type ClientChannel } from "ssh2";
import { logger } from "@/lib/logger";

export interface SSHConnectionConfig {
  host: string;
  port?: number;
  username: string;
  privateKey?: string;
  privateKeyId?: string;
  timeout?: number;
}

export interface SSHConnection {
  client: Client;
  config: SSHConnectionConfig;
  id: string;
}

export interface SSHExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export interface SSHValidationResult {
  success: boolean;
  logs: string;
  dockerVersion?: string;
  dockerComposeVersion?: string;
}

export interface ServerResources {
  containers: ContainerInfo[];
  diskUsage: DiskUsage | null;
  memoryUsage: MemoryUsage | null;
  error?: string;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string[];
  labels: Record<string, string>;
}

export interface DiskUsage {
  total: string;
  used: string;
  available: string;
  usedPercent: number;
}

export interface MemoryUsage {
  total: string;
  used: string;
  free: string;
  usedPercent: number;
}

class SSHService {
  private connections: Map<string, SSHConnection> = new Map();
  private connectionCounter = 0;

  private createClient(): Client {
    return new Client();
  }

  private getConnectionConfig(config: SSHConnectionConfig): ConnectConfig {
    return {
      host: config.host,
      port: config.port || 22,
      username: config.username,
      privateKey: config.privateKey,
      readyTimeout: config.timeout || 30000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
    };
  }

  /**
   * Create a persistent SSH connection
   */
  async connect(config: SSHConnectionConfig): Promise<SSHConnection> {
    return new Promise((resolve, reject) => {
      const client = this.createClient();
      const id = `ssh-${++this.connectionCounter}-${Date.now()}`;

      client
        .on("ready", () => {
          logger.debug(`SSH connection established: ${id} to ${config.host}`);
          const connection: SSHConnection = { client, config, id };
          this.connections.set(id, connection);
          resolve(connection);
        })
        .on("error", (err) => {
          logger.error(`SSH connection error: ${err.message}`);
          reject(err);
        })
        .on("close", () => {
          this.connections.delete(id);
          logger.debug(`SSH connection closed: ${id}`);
        })
        .connect(this.getConnectionConfig(config));
    });
  }

  /**
   * Execute command on an existing connection
   */
  async execute(
    connection: SSHConnection,
    command: string
  ): Promise<SSHExecuteResult> {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      connection.client.exec(command, (err, channel: ClientChannel) => {
        if (err) {
          reject(err);
          return;
        }

        channel
          .on("close", (code: number) => {
            resolve({
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              exitCode: code,
              success: code === 0,
            });
          })
          .on("data", (data: Buffer) => {
            stdout += data.toString();
          })
          .stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
          });
      });
    });
  }

  /**
   * Write file content to remote server via existing connection
   */
  async writeFile(
    connection: SSHConnection,
    remotePath: string,
    content: string
  ): Promise<SSHExecuteResult> {
    // Use heredoc for safer content transfer
    const heredocMarker = `COOLIFY_EOF_${Date.now()}`;
    const command = `cat > ${remotePath} << '${heredocMarker}'\n${content}\n${heredocMarker}`;
    return this.execute(connection, command);
  }

  /**
   * Read file content from remote server via existing connection
   */
  async readFileContent(
    connection: SSHConnection,
    remotePath: string
  ): Promise<string> {
    const result = await this.execute(connection, `cat ${remotePath}`);
    if (!result.success) {
      throw new Error(`Failed to read file ${remotePath}: ${result.stderr}`);
    }
    return result.stdout;
  }

  /**
   * Disconnect an SSH connection
   */
  disconnect(connection: SSHConnection): void {
    connection.client.end();
    this.connections.delete(connection.id);
  }

  /**
   * Get all active connections
   */
  getActiveConnections(): SSHConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Execute a command on a remote server via SSH
   */
  async executeCommand(
    config: SSHConnectionConfig & { command: string }
  ): Promise<SSHExecuteResult> {
    return new Promise((resolve, reject) => {
      const client = this.createClient();
      let stdout = "";
      let stderr = "";

      client
        .on("ready", () => {
          logger.debug(`SSH connected to ${config.host}`);

          client.exec(config.command, (err, channel: ClientChannel) => {
            if (err) {
              client.end();
              reject(err);
              return;
            }

            channel
              .on("close", (code: number) => {
                client.end();
                resolve({
                  stdout: stdout.trim(),
                  stderr: stderr.trim(),
                  exitCode: code,
                  success: code === 0,
                });
              })
              .on("data", (data: Buffer) => {
                stdout += data.toString();
              })
              .stderr.on("data", (data: Buffer) => {
                stderr += data.toString();
              });
          });
        })
        .on("error", (err) => {
          logger.error(`SSH error: ${err.message}`);
          reject(err);
        })
        .connect(this.getConnectionConfig(config));
    });
  }

  /**
   * Execute multiple commands in sequence
   */
  async executeCommands(
    config: SSHConnectionConfig & { commands: string[] }
  ): Promise<SSHExecuteResult[]> {
    const results: SSHExecuteResult[] = [];

    for (const command of config.commands) {
      const result = await this.executeCommand({ ...config, command });
      results.push(result);

      // Stop on first failure
      if (!result.success) {
        break;
      }
    }

    return results;
  }

  /**
   * Validate SSH connection and check Docker installation
   */
  async validateConnection(
    config: SSHConnectionConfig
  ): Promise<SSHValidationResult> {
    const logs: string[] = [];
    let dockerVersion: string | undefined;
    let dockerComposeVersion: string | undefined;

    try {
      // Test basic connection
      logs.push("Testing SSH connection...");
      const echoResult = await this.executeCommand({
        ...config,
        command: "echo 'Connection successful'",
      });

      if (!echoResult.success) {
        return {
          success: false,
          logs: logs.join("\n") + "\nFailed to establish SSH connection",
        };
      }
      logs.push("SSH connection established");

      // Check Docker
      logs.push("Checking Docker installation...");
      const dockerResult = await this.executeCommand({
        ...config,
        command: "docker --version",
      });

      if (dockerResult.success) {
        dockerVersion = dockerResult.stdout;
        logs.push(`Docker found: ${dockerVersion}`);
      } else {
        logs.push("Docker not found or not accessible");
      }

      // Check Docker Compose
      logs.push("Checking Docker Compose installation...");
      const composeResult = await this.executeCommand({
        ...config,
        command: "docker compose version || docker-compose --version",
      });

      if (composeResult.success) {
        dockerComposeVersion = composeResult.stdout;
        logs.push(`Docker Compose found: ${dockerComposeVersion}`);
      } else {
        logs.push("Docker Compose not found");
      }

      // Check if user can run Docker without sudo
      logs.push("Checking Docker permissions...");
      const permResult = await this.executeCommand({
        ...config,
        command: "docker ps",
      });

      if (!permResult.success) {
        logs.push(
          "Warning: User may not have permission to run Docker commands"
        );
      } else {
        logs.push("Docker permissions OK");
      }

      return {
        success: true,
        logs: logs.join("\n"),
        dockerVersion,
        dockerComposeVersion,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logs.push(`Error: ${errorMessage}`);

      return {
        success: false,
        logs: logs.join("\n"),
      };
    }
  }

  /**
   * Get server resources (containers, disk, memory)
   */
  async getServerResources(
    config: SSHConnectionConfig
  ): Promise<ServerResources> {
    try {
      // Get containers
      const containersResult = await this.executeCommand({
        ...config,
        command: `docker ps -a --format '{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","state":"{{.State}}","ports":"{{.Ports}}"}'`,
      });

      const containers: ContainerInfo[] = [];
      if (containersResult.success && containersResult.stdout) {
        const lines = containersResult.stdout.split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const container = JSON.parse(line);
            containers.push({
              ...container,
              ports: container.ports ? container.ports.split(",") : [],
              labels: {},
            });
          } catch {
            // Skip invalid JSON
          }
        }
      }

      // Get disk usage
      const diskResult = await this.executeCommand({
        ...config,
        command: "df -h / | tail -1 | awk '{print $2,$3,$4,$5}'",
      });

      let diskUsage: DiskUsage | null = null;
      if (diskResult.success && diskResult.stdout) {
        const parts = diskResult.stdout.split(" ");
        if (parts.length >= 4) {
          diskUsage = {
            total: parts[0]!,
            used: parts[1]!,
            available: parts[2]!,
            usedPercent: parseInt(parts[3]!.replace("%", ""), 10),
          };
        }
      }

      // Get memory usage
      const memResult = await this.executeCommand({
        ...config,
        command:
          "free -h | grep Mem | awk '{print $2,$3,$4}' && free | grep Mem | awk '{printf \"%.1f\", $3/$2 * 100}'",
      });

      let memoryUsage: MemoryUsage | null = null;
      if (memResult.success && memResult.stdout) {
        const lines = memResult.stdout.split("\n");
        if (lines.length >= 2) {
          const parts = lines[0]!.split(" ");
          if (parts.length >= 3) {
            memoryUsage = {
              total: parts[0]!,
              used: parts[1]!,
              free: parts[2]!,
              usedPercent: parseFloat(lines[1]!),
            };
          }
        }
      }

      return {
        containers,
        diskUsage,
        memoryUsage,
      };
    } catch (error) {
      return {
        containers: [],
        diskUsage: null,
        memoryUsage: null,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Copy file to remote server (alias for writeFile)
   */
  async copyFile(
    config: SSHConnectionConfig & {
      localContent: string;
      remotePath: string;
    }
  ): Promise<SSHExecuteResult> {
    return this.writeFileConfig({
      ...config,
      content: config.localContent,
    });
  }

  /**
   * Write file to remote server (config-based API)
   */
  async writeFileConfig(
    config: SSHConnectionConfig & {
      remotePath: string;
      content: string;
    }
  ): Promise<SSHExecuteResult> {
    // Use heredoc for safer content transfer (handles special characters)
    const heredocMarker = `COOLIFY_EOF_${Date.now()}`;
    return this.executeCommand({
      ...config,
      command: `cat > ${config.remotePath} << '${heredocMarker}'\n${config.content}\n${heredocMarker}`,
    });
  }

  /**
   * Write file to remote server (supports both config and connection-based calls)
   */
  writeFile(
    configOrConnection: (SSHConnectionConfig & { remotePath: string; content: string }) | SSHConnection,
    remotePath?: string,
    content?: string
  ): Promise<SSHExecuteResult> {
    // Connection-based call: writeFile(connection, path, content)
    if ('client' in configOrConnection && remotePath && content !== undefined) {
      const heredocMarker = `COOLIFY_EOF_${Date.now()}`;
      const command = `cat > ${remotePath} << '${heredocMarker}'\n${content}\n${heredocMarker}`;
      return this.execute(configOrConnection, command);
    }
    // Config-based call: writeFile({ ...config, remotePath, content })
    return this.writeFileConfig(configOrConnection as SSHConnectionConfig & { remotePath: string; content: string });
  }

  /**
   * Read file from remote server
   */
  async readFile(
    config: SSHConnectionConfig & { remotePath: string }
  ): Promise<SSHExecuteResult> {
    return this.executeCommand({
      ...config,
      command: `cat ${config.remotePath}`,
    });
  }

  /**
   * Check if file exists on remote server
   */
  async fileExists(
    config: SSHConnectionConfig & { remotePath: string }
  ): Promise<boolean> {
    const result = await this.executeCommand({
      ...config,
      command: `test -f ${config.remotePath} && echo "exists"`,
    });

    return result.stdout.includes("exists");
  }

  /**
   * Create directory on remote server
   */
  async createDirectory(
    config: SSHConnectionConfig & { remotePath: string }
  ): Promise<SSHExecuteResult> {
    return this.executeCommand({
      ...config,
      command: `mkdir -p ${config.remotePath}`,
    });
  }
}

export const sshService = new SSHService();
