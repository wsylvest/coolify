/**
 * Firecracker MicroVM Service
 *
 * Provides lightweight microVM management using Amazon Firecracker.
 * Enables secure, isolated container execution with VM-level isolation.
 */

import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { logger } from "@/lib/logger";
import type { SSHConnection } from "@/server/services/ssh";
import { sshService } from "@/server/services/ssh";

export interface FirecrackerConfig {
  kernelImagePath: string;
  rootfsPath: string;
  vcpuCount?: number;
  memSizeMb?: number;
  socketPath?: string;
}

export interface MicroVMConfig {
  id: string;
  vcpuCount: number;
  memSizeMb: number;
  kernelImagePath: string;
  rootfsPath: string;
  bootArgs?: string;
  networkInterfaces?: NetworkInterface[];
  drives?: Drive[];
  metadata?: Record<string, unknown>;
}

export interface NetworkInterface {
  ifaceId: string;
  guestMac?: string;
  hostDevName: string;
  allowMmdsRequests?: boolean;
}

export interface Drive {
  driveId: string;
  pathOnHost: string;
  isRootDevice: boolean;
  isReadOnly?: boolean;
}

export interface MicroVMStatus {
  id: string;
  state: "not_started" | "running" | "paused" | "stopped" | "error";
  pid?: number;
  socketPath: string;
  startedAt?: Date;
}

interface FirecrackerProcess {
  id: string;
  process: ChildProcess;
  socketPath: string;
  config: MicroVMConfig;
  startedAt: Date;
}

class FirecrackerService {
  private vms: Map<string, FirecrackerProcess> = new Map();
  private firecrackerPath: string | null = null;
  private jailerPath: string | null = null;
  private dataDir: string;

  constructor() {
    this.dataDir = process.env.FIRECRACKER_DATA_DIR || "/data/coolify/firecracker";
  }

  /**
   * Initialize the Firecracker service
   */
  async initialize(): Promise<void> {
    // Check for firecracker binary
    this.firecrackerPath = await this.findBinary("firecracker");
    this.jailerPath = await this.findBinary("jailer");

    if (!this.firecrackerPath) {
      logger.warn("firecracker not found - microVM support disabled");
      return;
    }

    // Ensure data directory exists
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(path.join(this.dataDir, "vms"), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, "kernels"), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, "rootfs"), { recursive: true });

    logger.info("Firecracker service initialized", {
      firecrackerPath: this.firecrackerPath,
      jailerPath: this.jailerPath,
    });
  }

  /**
   * Find binary path
   */
  private async findBinary(name: string): Promise<string | null> {
    const paths = [
      `/usr/local/bin/${name}`,
      `/usr/bin/${name}`,
      path.join(process.cwd(), "bin", name),
    ];

    for (const p of paths) {
      try {
        await fs.access(p, fs.constants.X_OK);
        return p;
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Create and start a microVM
   */
  async createVM(config: MicroVMConfig): Promise<MicroVMStatus> {
    if (!this.firecrackerPath) {
      throw new Error("Firecracker not available");
    }

    if (this.vms.has(config.id)) {
      throw new Error(`VM ${config.id} already exists`);
    }

    const vmDir = path.join(this.dataDir, "vms", config.id);
    const socketPath = path.join(vmDir, "firecracker.sock");

    await fs.mkdir(vmDir, { recursive: true });

    // Start firecracker process
    const proc = spawn(
      this.firecrackerPath,
      ["--api-sock", socketPath],
      {
        cwd: vmDir,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      }
    );

    // Wait for socket to be ready
    await this.waitForSocket(socketPath, 5000);

    // Configure the VM
    await this.configureVM(socketPath, config);

    // Start the VM
    await this.startVM(socketPath);

    const fcProcess: FirecrackerProcess = {
      id: config.id,
      process: proc,
      socketPath,
      config,
      startedAt: new Date(),
    };

    this.vms.set(config.id, fcProcess);

    // Handle process exit
    proc.on("exit", (code) => {
      logger.info(`Firecracker VM ${config.id} exited`, { code });
      this.vms.delete(config.id);
    });

    logger.info("MicroVM created", { id: config.id });

    return {
      id: config.id,
      state: "running",
      pid: proc.pid,
      socketPath,
      startedAt: fcProcess.startedAt,
    };
  }

  /**
   * Wait for socket to be available
   */
  private async waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await fs.access(socketPath);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error("Timeout waiting for Firecracker socket");
  }

  /**
   * Configure VM via API
   */
  private async configureVM(socketPath: string, config: MicroVMConfig): Promise<void> {
    // Set boot source
    await this.apiCall(socketPath, "PUT", "/boot-source", {
      kernel_image_path: config.kernelImagePath,
      boot_args: config.bootArgs || "console=ttyS0 reboot=k panic=1 pci=off",
    });

    // Set machine config
    await this.apiCall(socketPath, "PUT", "/machine-config", {
      vcpu_count: config.vcpuCount,
      mem_size_mib: config.memSizeMb,
    });

    // Add root drive
    await this.apiCall(socketPath, "PUT", "/drives/rootfs", {
      drive_id: "rootfs",
      path_on_host: config.rootfsPath,
      is_root_device: true,
      is_read_only: false,
    });

    // Add additional drives
    if (config.drives) {
      for (const drive of config.drives) {
        await this.apiCall(socketPath, "PUT", `/drives/${drive.driveId}`, {
          drive_id: drive.driveId,
          path_on_host: drive.pathOnHost,
          is_root_device: drive.isRootDevice,
          is_read_only: drive.isReadOnly ?? false,
        });
      }
    }

    // Configure network interfaces
    if (config.networkInterfaces) {
      for (const iface of config.networkInterfaces) {
        await this.apiCall(socketPath, "PUT", `/network-interfaces/${iface.ifaceId}`, {
          iface_id: iface.ifaceId,
          guest_mac: iface.guestMac,
          host_dev_name: iface.hostDevName,
          allow_mmds_requests: iface.allowMmdsRequests ?? false,
        });
      }
    }

    // Set MMDS config with metadata if provided
    if (config.metadata) {
      await this.apiCall(socketPath, "PUT", "/mmds", config.metadata);
    }
  }

  /**
   * Start the VM
   */
  private async startVM(socketPath: string): Promise<void> {
    await this.apiCall(socketPath, "PUT", "/actions", {
      action_type: "InstanceStart",
    });
  }

  /**
   * Make API call to Firecracker
   */
  private async apiCall(
    socketPath: string,
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<unknown> {
    // Use curl to communicate with Unix socket
    const args = [
      "--unix-socket",
      socketPath,
      "-X",
      method,
      `http://localhost${endpoint}`,
    ];

    if (body) {
      args.push("-H", "Content-Type: application/json");
      args.push("-d", JSON.stringify(body));
    }

    return new Promise((resolve, reject) => {
      const proc = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => (stdout += data.toString()));
      proc.stderr.on("data", (data) => (stderr += data.toString()));

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Firecracker API error: ${stderr || stdout}`));
        } else {
          try {
            resolve(stdout ? JSON.parse(stdout) : null);
          } catch {
            resolve(stdout);
          }
        }
      });
    });
  }

  /**
   * Stop a microVM
   */
  async stopVM(id: string): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    // Send shutdown action
    try {
      await this.apiCall(vm.socketPath, "PUT", "/actions", {
        action_type: "SendCtrlAltDel",
      });

      // Wait for graceful shutdown
      await new Promise((r) => setTimeout(r, 5000));
    } catch {
      // Ignore errors during shutdown
    }

    // Force kill if still running
    if (vm.process.exitCode === null) {
      vm.process.kill("SIGKILL");
    }

    this.vms.delete(id);

    // Cleanup VM directory
    const vmDir = path.join(this.dataDir, "vms", id);
    await fs.rm(vmDir, { recursive: true, force: true });

    logger.info("MicroVM stopped", { id });
  }

  /**
   * Pause a microVM
   */
  async pauseVM(id: string): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    await this.apiCall(vm.socketPath, "PATCH", "/vm", {
      state: "Paused",
    });

    logger.info("MicroVM paused", { id });
  }

  /**
   * Resume a paused microVM
   */
  async resumeVM(id: string): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    await this.apiCall(vm.socketPath, "PATCH", "/vm", {
      state: "Resumed",
    });

    logger.info("MicroVM resumed", { id });
  }

  /**
   * Get VM status
   */
  getVMStatus(id: string): MicroVMStatus | null {
    const vm = this.vms.get(id);
    if (!vm) {
      return null;
    }

    return {
      id: vm.id,
      state: vm.process.exitCode === null ? "running" : "stopped",
      pid: vm.process.pid,
      socketPath: vm.socketPath,
      startedAt: vm.startedAt,
    };
  }

  /**
   * List all VMs
   */
  listVMs(): MicroVMStatus[] {
    return Array.from(this.vms.values()).map((vm) => ({
      id: vm.id,
      state: vm.process.exitCode === null ? "running" : "stopped",
      pid: vm.process.pid,
      socketPath: vm.socketPath,
      startedAt: vm.startedAt,
    }));
  }

  /**
   * Create VM on remote server via SSH
   */
  async createRemoteVM(
    connection: SSHConnection,
    config: MicroVMConfig
  ): Promise<MicroVMStatus> {
    const vmDir = `/data/coolify/firecracker/vms/${config.id}`;
    const socketPath = `${vmDir}/firecracker.sock`;

    // Create VM directory
    await sshService.execute(connection, `mkdir -p ${vmDir}`);

    // Start firecracker with jailer for security
    const startCmd = this.jailerPath
      ? `${this.jailerPath} --id ${config.id} --exec-file /usr/local/bin/firecracker --uid 1000 --gid 1000 -- --api-sock ${socketPath} &`
      : `firecracker --api-sock ${socketPath} &`;

    await sshService.execute(connection, `cd ${vmDir} && ${startCmd}`);

    // Wait for socket
    await sshService.execute(
      connection,
      `timeout 10 bash -c 'while [ ! -S ${socketPath} ]; do sleep 0.1; done'`
    );

    // Configure VM
    await this.configureRemoteVM(connection, socketPath, config);

    // Start VM
    await sshService.execute(
      connection,
      `curl --unix-socket ${socketPath} -X PUT http://localhost/actions -H 'Content-Type: application/json' -d '{"action_type":"InstanceStart"}'`
    );

    logger.info("Remote microVM created", { id: config.id });

    return {
      id: config.id,
      state: "running",
      socketPath,
      startedAt: new Date(),
    };
  }

  /**
   * Configure remote VM
   */
  private async configureRemoteVM(
    connection: SSHConnection,
    socketPath: string,
    config: MicroVMConfig
  ): Promise<void> {
    const apiCall = async (method: string, endpoint: string, body: unknown) => {
      const bodyJson = JSON.stringify(body).replace(/'/g, "'\\''");
      await sshService.execute(
        connection,
        `curl --unix-socket ${socketPath} -X ${method} http://localhost${endpoint} -H 'Content-Type: application/json' -d '${bodyJson}'`
      );
    };

    // Set boot source
    await apiCall("PUT", "/boot-source", {
      kernel_image_path: config.kernelImagePath,
      boot_args: config.bootArgs || "console=ttyS0 reboot=k panic=1 pci=off",
    });

    // Set machine config
    await apiCall("PUT", "/machine-config", {
      vcpu_count: config.vcpuCount,
      mem_size_mib: config.memSizeMb,
    });

    // Add root drive
    await apiCall("PUT", "/drives/rootfs", {
      drive_id: "rootfs",
      path_on_host: config.rootfsPath,
      is_root_device: true,
      is_read_only: false,
    });
  }

  /**
   * Stop remote VM
   */
  async stopRemoteVM(connection: SSHConnection, id: string): Promise<void> {
    const vmDir = `/data/coolify/firecracker/vms/${id}`;
    const socketPath = `${vmDir}/firecracker.sock`;

    // Send shutdown
    await sshService.execute(
      connection,
      `curl --unix-socket ${socketPath} -X PUT http://localhost/actions -H 'Content-Type: application/json' -d '{"action_type":"SendCtrlAltDel"}' || true`
    );

    // Wait and force kill
    await sshService.execute(connection, `sleep 3`);
    await sshService.execute(connection, `pkill -f "firecracker.*${id}" || true`);

    // Cleanup
    await sshService.execute(connection, `rm -rf ${vmDir}`);

    logger.info("Remote microVM stopped", { id });
  }

  /**
   * Check if Firecracker is available
   */
  isAvailable(): boolean {
    return this.firecrackerPath !== null;
  }

  /**
   * Shutdown all VMs
   */
  async shutdown(): Promise<void> {
    for (const [id] of this.vms) {
      try {
        await this.stopVM(id);
      } catch {
        // Ignore errors during shutdown
      }
    }
    logger.info("Firecracker service shutdown");
  }
}

export const firecrackerService = new FirecrackerService();
