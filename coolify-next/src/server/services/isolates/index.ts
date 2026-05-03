/**
 * V8 Isolates Service (workerd)
 *
 * Provides sandboxed JavaScript/TypeScript execution using Cloudflare's workerd runtime.
 * Used for running user-provided scripts, webhooks, and custom automation safely.
 */

import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { logger } from "@/lib/logger";

export interface IsolateConfig {
  memoryLimit?: number; // MB, default 128
  cpuLimit?: number; // percentage, default 100
  timeout?: number; // ms, default 30000
  allowNet?: boolean; // allow network access
  allowedHosts?: string[]; // whitelist of allowed hosts
  env?: Record<string, string>;
}

export interface IsolateScript {
  code: string;
  entrypoint?: string; // default "fetch" or "scheduled"
  bindings?: Record<string, unknown>;
}

export interface IsolateResult {
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
  memoryUsed?: number;
}

export interface WorkerdConfig {
  services: {
    name: string;
    worker: {
      compatibilityDate: string;
      modules: { name: string; esModule: string }[];
      bindings?: { name: string; text?: string; json?: unknown }[];
    };
  }[];
  sockets: {
    name: string;
    address: string;
    service: string;
  }[];
}

class IsolatesService {
  private workerdPath: string | null = null;
  private tempDir: string;
  private activeProcesses: Map<string, ChildProcess> = new Map();

  constructor() {
    this.tempDir = path.join(os.tmpdir(), "coolify-isolates");
  }

  /**
   * Initialize the isolates service
   */
  async initialize(): Promise<void> {
    // Ensure temp directory exists
    await fs.mkdir(this.tempDir, { recursive: true });

    // Check for workerd binary
    this.workerdPath = await this.findWorkerd();

    if (!this.workerdPath) {
      logger.warn("workerd not found - V8 isolates disabled. Install with: npm install workerd");
    } else {
      logger.info("V8 Isolates service initialized", { workerdPath: this.workerdPath });
    }
  }

  /**
   * Find workerd binary path
   */
  private async findWorkerd(): Promise<string | null> {
    const possiblePaths = [
      path.join(process.cwd(), "node_modules", ".bin", "workerd"),
      path.join(process.cwd(), "node_modules", "workerd", "bin", "workerd"),
      "/usr/local/bin/workerd",
      "/usr/bin/workerd",
    ];

    for (const p of possiblePaths) {
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
   * Execute code in a V8 isolate
   */
  async execute(
    script: IsolateScript,
    config: IsolateConfig = {}
  ): Promise<IsolateResult> {
    if (!this.workerdPath) {
      return {
        success: false,
        error: "workerd not available",
        duration: 0,
      };
    }

    const startTime = Date.now();
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workDir = path.join(this.tempDir, executionId);

    try {
      await fs.mkdir(workDir, { recursive: true });

      // Write the worker script
      const scriptPath = path.join(workDir, "worker.js");
      const wrappedCode = this.wrapScript(script.code, script.entrypoint);
      await fs.writeFile(scriptPath, wrappedCode);

      // Generate workerd config
      const configPath = path.join(workDir, "config.capnp");
      const workerdConfig = this.generateConfig(executionId, scriptPath, script, config);
      await fs.writeFile(configPath, workerdConfig);

      // Execute workerd
      const result = await this.runWorkerd(executionId, configPath, config);

      return {
        ...result,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        duration: Date.now() - startTime,
      };
    } finally {
      // Cleanup
      await this.cleanup(executionId, workDir);
    }
  }

  /**
   * Execute a scheduled task in isolate
   */
  async executeScheduled(
    script: IsolateScript,
    config: IsolateConfig = {}
  ): Promise<IsolateResult> {
    return this.execute(
      { ...script, entrypoint: "scheduled" },
      config
    );
  }

  /**
   * Execute a fetch handler in isolate with HTTP request
   */
  async executeFetch(
    script: IsolateScript,
    request: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    },
    config: IsolateConfig = {}
  ): Promise<IsolateResult & { response?: { status: number; headers: Record<string, string>; body: string } }> {
    if (!this.workerdPath) {
      return {
        success: false,
        error: "workerd not available",
        duration: 0,
      };
    }

    const startTime = Date.now();
    const executionId = `fetch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workDir = path.join(this.tempDir, executionId);
    const port = 8787 + Math.floor(Math.random() * 1000);

    try {
      await fs.mkdir(workDir, { recursive: true });

      // Write the worker script
      const scriptPath = path.join(workDir, "worker.js");
      await fs.writeFile(scriptPath, script.code);

      // Generate workerd config with HTTP socket
      const configPath = path.join(workDir, "config.capnp");
      const workerdConfig = this.generateHttpConfig(executionId, scriptPath, port, script, config);
      await fs.writeFile(configPath, workerdConfig);

      // Start workerd server
      const proc = await this.startWorkerdServer(executionId, configPath, config);

      // Wait for server to be ready
      await this.waitForServer(port, 5000);

      // Make HTTP request
      const response = await fetch(`http://127.0.0.1:${port}${new URL(request.url).pathname}`, {
        method: request.method || "GET",
        headers: request.headers,
        body: request.body,
      });

      const responseBody = await response.text();
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      // Stop server
      this.stopProcess(executionId);

      return {
        success: true,
        duration: Date.now() - startTime,
        response: {
          status: response.status,
          headers: responseHeaders,
          body: responseBody,
        },
      };
    } catch (error) {
      this.stopProcess(executionId);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        duration: Date.now() - startTime,
      };
    } finally {
      await this.cleanup(executionId, workDir);
    }
  }

  /**
   * Wrap script with execution harness
   */
  private wrapScript(code: string, entrypoint?: string): string {
    if (entrypoint === "scheduled") {
      return `
${code}

export default {
  async scheduled(event, env, ctx) {
    const output = [];
    const originalLog = console.log;
    console.log = (...args) => output.push(args.map(String).join(' '));

    try {
      if (typeof scheduled === 'function') {
        await scheduled(event, env, ctx);
      } else if (typeof main === 'function') {
        await main();
      }
      return { output: output.join('\\n'), success: true };
    } catch (error) {
      return { output: output.join('\\n'), error: error.message, success: false };
    } finally {
      console.log = originalLog;
    }
  }
};
`;
    }

    // Default fetch handler
    return `
${code}

export default {
  async fetch(request, env, ctx) {
    const output = [];
    const originalLog = console.log;
    console.log = (...args) => output.push(args.map(String).join(' '));

    try {
      if (typeof fetch === 'function' && fetch !== globalThis.fetch) {
        const response = await fetch(request, env, ctx);
        console.log = originalLog;
        return response;
      } else if (typeof handler === 'function') {
        const response = await handler(request, env, ctx);
        console.log = originalLog;
        return response;
      } else if (typeof main === 'function') {
        await main();
        console.log = originalLog;
        return new Response(output.join('\\n'), { status: 200 });
      }
      console.log = originalLog;
      return new Response('No handler found', { status: 500 });
    } catch (error) {
      console.log = originalLog;
      return new Response(error.message, { status: 500 });
    }
  }
};
`;
  }

  /**
   * Generate workerd config for one-shot execution
   */
  private generateConfig(
    id: string,
    scriptPath: string,
    script: IsolateScript,
    config: IsolateConfig
  ): string {
    const bindings = script.bindings
      ? Object.entries(script.bindings)
          .map(([name, value]) => {
            if (typeof value === "string") {
              return `      ( name = "${name}", text = "${value.replace(/"/g, '\\"')}" ),`;
            }
            return `      ( name = "${name}", json = "${JSON.stringify(value).replace(/"/g, '\\"')}" ),`;
          })
          .join("\n")
      : "";

    return `
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    ( name = "${id}",
      worker = (
        modules = [
          ( name = "worker", esModule = embed "${scriptPath}" )
        ],
        compatibilityDate = "2024-01-01",
${bindings ? `        bindings = [\n${bindings}\n        ],` : ""}
      )
    )
  ],
);
`;
  }

  /**
   * Generate workerd config for HTTP server
   */
  private generateHttpConfig(
    id: string,
    scriptPath: string,
    port: number,
    script: IsolateScript,
    config: IsolateConfig
  ): string {
    return `
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    ( name = "${id}",
      worker = (
        modules = [
          ( name = "worker", esModule = embed "${scriptPath}" )
        ],
        compatibilityDate = "2024-01-01",
      )
    )
  ],
  sockets = [
    ( name = "http",
      address = "127.0.0.1:${port}",
      http = (),
      service = "${id}"
    )
  ],
);
`;
  }

  /**
   * Run workerd and capture output
   */
  private async runWorkerd(
    id: string,
    configPath: string,
    config: IsolateConfig
  ): Promise<IsolateResult> {
    return new Promise((resolve) => {
      const timeout = config.timeout || 30000;
      let stdout = "";
      let stderr = "";

      const proc = spawn(this.workerdPath!, ["test", configPath], {
        timeout,
        env: {
          ...process.env,
          ...config.env,
        },
      });

      this.activeProcesses.set(id, proc);

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        this.activeProcesses.delete(id);
        resolve({
          success: code === 0,
          output: stdout,
          error: code !== 0 ? stderr : undefined,
          duration: 0,
        });
      });

      proc.on("error", (err) => {
        this.activeProcesses.delete(id);
        resolve({
          success: false,
          error: err.message,
          duration: 0,
        });
      });
    });
  }

  /**
   * Start workerd as HTTP server
   */
  private async startWorkerdServer(
    id: string,
    configPath: string,
    config: IsolateConfig
  ): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.workerdPath!, ["serve", configPath], {
        env: {
          ...process.env,
          ...config.env,
        },
      });

      this.activeProcesses.set(id, proc);

      proc.on("error", (err) => {
        this.activeProcesses.delete(id);
        reject(err);
      });

      // Give it a moment to start
      setTimeout(() => resolve(proc), 500);
    });
  }

  /**
   * Wait for server to be ready
   */
  private async waitForServer(port: number, timeout: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        await fetch(`http://127.0.0.1:${port}/`);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error("Server startup timeout");
  }

  /**
   * Stop a running process
   */
  private stopProcess(id: string): void {
    const proc = this.activeProcesses.get(id);
    if (proc) {
      proc.kill("SIGTERM");
      this.activeProcesses.delete(id);
    }
  }

  /**
   * Cleanup execution directory
   */
  private async cleanup(id: string, workDir: string): Promise<void> {
    this.stopProcess(id);
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Check if isolates are available
   */
  isAvailable(): boolean {
    return this.workerdPath !== null;
  }

  /**
   * Shutdown service
   */
  async shutdown(): Promise<void> {
    for (const [id] of this.activeProcesses) {
      this.stopProcess(id);
    }
    logger.info("V8 Isolates service shutdown");
  }
}

export const isolatesService = new IsolatesService();
