import { sshService, type SSHConnectionConfig } from "../ssh";
import { dockerService } from "../docker";
import { logger } from "@/lib/logger";
import YAML from "yaml";

export type ProxyType = "traefik" | "caddy" | "none";

export interface ProxyConfig {
  type: ProxyType;
  httpPort?: number;
  httpsPort?: number;
  dashboardEnabled?: boolean;
  dashboardPort?: number;
  accessLogsEnabled?: boolean;
  acmeEmail?: string;
}

export interface TraefikRouterConfig {
  rule: string;
  service: string;
  entryPoints: string[];
  tls?: {
    certResolver?: string;
    domains?: { main: string; sans?: string[] }[];
  };
  middlewares?: string[];
}

export interface CaddyRouteConfig {
  match: { host: string[] }[];
  handle: {
    handler: string;
    upstreams?: { dial: string }[];
  }[];
}

class ProxyService {
  private readonly TRAEFIK_IMAGE = "traefik:v2.11";
  private readonly CADDY_IMAGE = "caddy:2-alpine";
  private readonly PROXY_NETWORK = "coolify-proxy";
  private readonly COOLIFY_DIR = "/data/coolify";

  /**
   * Check if proxy is running on a server
   */
  async checkProxyStatus(
    sshConfig: SSHConnectionConfig,
    proxyType: ProxyType
  ): Promise<{ running: boolean; version?: string; error?: string }> {
    const containerName =
      proxyType === "traefik" ? "coolify-proxy" : "coolify-caddy";

    const result = await sshService.executeCommand({
      ...sshConfig,
      command: `docker inspect --format '{{.State.Running}} {{.Config.Image}}' ${containerName} 2>/dev/null`,
    });

    if (!result.success || !result.stdout.trim()) {
      return { running: false };
    }

    const [running, image] = result.stdout.trim().split(" ");
    return {
      running: running === "true",
      version: image,
    };
  }

  /**
   * Start the proxy on a server
   */
  async startProxy(
    sshConfig: SSHConnectionConfig,
    config: ProxyConfig
  ): Promise<{ success: boolean; logs: string }> {
    const logs: string[] = [];

    try {
      // Ensure proxy network exists
      logs.push("Creating proxy network...");
      await dockerService.createNetwork(sshConfig, this.PROXY_NETWORK);

      // Create directories
      logs.push("Creating directories...");
      await sshService.executeCommand({
        ...sshConfig,
        command: `mkdir -p ${this.COOLIFY_DIR}/proxy`,
      });

      if (config.type === "traefik") {
        return await this.startTraefik(sshConfig, config, logs);
      } else if (config.type === "caddy") {
        return await this.startCaddy(sshConfig, config, logs);
      }

      return { success: false, logs: "Unknown proxy type" };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      logs.push(`Error: ${errorMsg}`);
      return { success: false, logs: logs.join("\n") };
    }
  }

  /**
   * Stop the proxy on a server
   */
  async stopProxy(
    sshConfig: SSHConnectionConfig,
    proxyType: ProxyType
  ): Promise<{ success: boolean; logs: string }> {
    const containerName =
      proxyType === "traefik" ? "coolify-proxy" : "coolify-caddy";

    try {
      await dockerService.stopContainer(sshConfig, containerName, 10);
      await dockerService.removeContainer(sshConfig, containerName, true);
      return { success: true, logs: `Stopped ${containerName}` };
    } catch (error) {
      return {
        success: false,
        logs: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Restart the proxy
   */
  async restartProxy(
    sshConfig: SSHConnectionConfig,
    config: ProxyConfig
  ): Promise<{ success: boolean; logs: string }> {
    const stopResult = await this.stopProxy(sshConfig, config.type);
    if (!stopResult.success) {
      logger.warn("Failed to stop proxy, continuing with start...");
    }

    return this.startProxy(sshConfig, config);
  }

  /**
   * Start Traefik proxy
   */
  private async startTraefik(
    sshConfig: SSHConnectionConfig,
    config: ProxyConfig,
    logs: string[]
  ): Promise<{ success: boolean; logs: string }> {
    const httpPort = config.httpPort ?? 80;
    const httpsPort = config.httpsPort ?? 443;
    const dashboardPort = config.dashboardPort ?? 8080;

    // Generate Traefik static configuration
    const traefikConfig = this.generateTraefikStaticConfig({
      httpPort,
      httpsPort,
      dashboardEnabled: config.dashboardEnabled ?? false,
      dashboardPort,
      accessLogsEnabled: config.accessLogsEnabled ?? false,
      acmeEmail: config.acmeEmail,
    });

    // Write config file
    logs.push("Writing Traefik configuration...");
    await sshService.writeFile({
      ...sshConfig,
      remotePath: `${this.COOLIFY_DIR}/proxy/traefik.yaml`,
      content: YAML.stringify(traefikConfig),
    });

    // Create acme.json for Let's Encrypt
    await sshService.executeCommand({
      ...sshConfig,
      command: `touch ${this.COOLIFY_DIR}/proxy/acme.json && chmod 600 ${this.COOLIFY_DIR}/proxy/acme.json`,
    });

    // Generate Docker Compose
    const composeConfig = this.generateTraefikComposeConfig({
      httpPort,
      httpsPort,
      dashboardEnabled: config.dashboardEnabled ?? false,
      dashboardPort,
    });

    // Write compose file
    await sshService.writeFile({
      ...sshConfig,
      remotePath: `${this.COOLIFY_DIR}/proxy/docker-compose.yaml`,
      content: YAML.stringify(composeConfig),
    });

    // Start Traefik
    logs.push("Starting Traefik...");
    const result = await dockerService.composeUp(sshConfig, {
      projectName: "coolify-proxy",
      composeFile: `${this.COOLIFY_DIR}/proxy/docker-compose.yaml`,
      workDir: `${this.COOLIFY_DIR}/proxy`,
      forceRecreate: true,
    });

    logs.push(result);
    logs.push("Traefik started successfully!");

    return { success: true, logs: logs.join("\n") };
  }

  /**
   * Start Caddy proxy
   */
  private async startCaddy(
    sshConfig: SSHConnectionConfig,
    config: ProxyConfig,
    logs: string[]
  ): Promise<{ success: boolean; logs: string }> {
    const httpPort = config.httpPort ?? 80;
    const httpsPort = config.httpsPort ?? 443;

    // Generate Caddyfile
    const caddyfile = this.generateCaddyfile({
      acmeEmail: config.acmeEmail,
    });

    // Write Caddyfile
    logs.push("Writing Caddyfile...");
    await sshService.writeFile({
      ...sshConfig,
      remotePath: `${this.COOLIFY_DIR}/proxy/Caddyfile`,
      content: caddyfile,
    });

    // Create data directories
    await sshService.executeCommand({
      ...sshConfig,
      command: `mkdir -p ${this.COOLIFY_DIR}/proxy/caddy_data ${this.COOLIFY_DIR}/proxy/caddy_config`,
    });

    // Generate Docker Compose
    const composeConfig = this.generateCaddyComposeConfig({
      httpPort,
      httpsPort,
    });

    // Write compose file
    await sshService.writeFile({
      ...sshConfig,
      remotePath: `${this.COOLIFY_DIR}/proxy/docker-compose.yaml`,
      content: YAML.stringify(composeConfig),
    });

    // Start Caddy
    logs.push("Starting Caddy...");
    const result = await dockerService.composeUp(sshConfig, {
      projectName: "coolify-caddy",
      composeFile: `${this.COOLIFY_DIR}/proxy/docker-compose.yaml`,
      workDir: `${this.COOLIFY_DIR}/proxy`,
      forceRecreate: true,
    });

    logs.push(result);
    logs.push("Caddy started successfully!");

    return { success: true, logs: logs.join("\n") };
  }

  /**
   * Generate Traefik static configuration
   */
  private generateTraefikStaticConfig(options: {
    httpPort: number;
    httpsPort: number;
    dashboardEnabled: boolean;
    dashboardPort: number;
    accessLogsEnabled: boolean;
    acmeEmail?: string;
  }): Record<string, unknown> {
    const config: Record<string, unknown> = {
      global: {
        checkNewVersion: false,
        sendAnonymousUsage: false,
      },
      entryPoints: {
        web: {
          address: `:${options.httpPort}`,
          http: {
            redirections: {
              entryPoint: {
                to: "websecure",
                scheme: "https",
              },
            },
          },
        },
        websecure: {
          address: `:${options.httpsPort}`,
          http: {
            tls: {
              certResolver: "letsencrypt",
            },
          },
        },
      },
      providers: {
        docker: {
          exposedByDefault: false,
          network: this.PROXY_NETWORK,
        },
        file: {
          directory: "/dynamic",
          watch: true,
        },
      },
      log: {
        level: "INFO",
      },
    };

    // Add ACME (Let's Encrypt) configuration
    if (options.acmeEmail) {
      config.certificatesResolvers = {
        letsencrypt: {
          acme: {
            email: options.acmeEmail,
            storage: "/acme.json",
            httpChallenge: {
              entryPoint: "web",
            },
          },
        },
      };
    }

    // Add dashboard
    if (options.dashboardEnabled) {
      config.api = {
        dashboard: true,
        insecure: true,
      };
      (config.entryPoints as Record<string, unknown>).traefik = {
        address: `:${options.dashboardPort}`,
      };
    }

    // Add access logs
    if (options.accessLogsEnabled) {
      config.accessLog = {
        filePath: "/var/log/traefik/access.log",
        bufferingSize: 100,
      };
    }

    return config;
  }

  /**
   * Generate Traefik Docker Compose configuration
   */
  private generateTraefikComposeConfig(options: {
    httpPort: number;
    httpsPort: number;
    dashboardEnabled: boolean;
    dashboardPort: number;
  }): Record<string, unknown> {
    const ports = [
      `${options.httpPort}:${options.httpPort}`,
      `${options.httpsPort}:${options.httpsPort}`,
    ];

    if (options.dashboardEnabled) {
      ports.push(`${options.dashboardPort}:${options.dashboardPort}`);
    }

    return {
      services: {
        "coolify-proxy": {
          image: this.TRAEFIK_IMAGE,
          container_name: "coolify-proxy",
          restart: "always",
          ports,
          volumes: [
            "/var/run/docker.sock:/var/run/docker.sock:ro",
            `${this.COOLIFY_DIR}/proxy/traefik.yaml:/traefik.yaml:ro`,
            `${this.COOLIFY_DIR}/proxy/dynamic:/dynamic:ro`,
            `${this.COOLIFY_DIR}/proxy/acme.json:/acme.json`,
          ],
          networks: [this.PROXY_NETWORK],
          labels: {
            "coolify.managed": "true",
          },
        },
      },
      networks: {
        [this.PROXY_NETWORK]: {
          external: true,
        },
      },
    };
  }

  /**
   * Generate Caddyfile
   */
  private generateCaddyfile(options: { acmeEmail?: string }): string {
    let caddyfile = "";

    if (options.acmeEmail) {
      caddyfile += `{
    email ${options.acmeEmail}
    acme_ca https://acme-v02.api.letsencrypt.org/directory
}

`;
    }

    // Global options
    caddyfile += `# Dynamic configuration will be imported
import /etc/caddy/sites/*
`;

    return caddyfile;
  }

  /**
   * Generate Caddy Docker Compose configuration
   */
  private generateCaddyComposeConfig(options: {
    httpPort: number;
    httpsPort: number;
  }): Record<string, unknown> {
    return {
      services: {
        "coolify-caddy": {
          image: this.CADDY_IMAGE,
          container_name: "coolify-caddy",
          restart: "always",
          ports: [
            `${options.httpPort}:80`,
            `${options.httpsPort}:443`,
            `${options.httpsPort}:443/udp`, // HTTP/3
          ],
          volumes: [
            `${this.COOLIFY_DIR}/proxy/Caddyfile:/etc/caddy/Caddyfile:ro`,
            `${this.COOLIFY_DIR}/proxy/sites:/etc/caddy/sites:ro`,
            `${this.COOLIFY_DIR}/proxy/caddy_data:/data`,
            `${this.COOLIFY_DIR}/proxy/caddy_config:/config`,
          ],
          networks: [this.PROXY_NETWORK],
          labels: {
            "coolify.managed": "true",
          },
        },
      },
      networks: {
        [this.PROXY_NETWORK]: {
          external: true,
        },
      },
    };
  }

  /**
   * Generate Traefik dynamic configuration for an application
   */
  generateTraefikDynamicConfig(options: {
    serviceName: string;
    domains: string[];
    containerPort: number;
    containerName: string;
    enableSsl: boolean;
    forceHttps: boolean;
    pathPrefix?: string;
    middlewares?: string[];
    rateLimiting?: {
      average: number;
      burst: number;
    };
    basicAuth?: {
      users: string[];
    };
    cors?: {
      origins: string[];
      methods?: string[];
    };
  }): Record<string, unknown> {
    const config: Record<string, unknown> = {
      http: {
        routers: {},
        services: {},
        middlewares: {},
      },
    };

    const httpConfig = config.http as Record<string, Record<string, unknown>>;

    // Create router rule
    const hostRules = options.domains.map((d) => `Host(\`${d}\`)`).join(" || ");
    const pathRule = options.pathPrefix
      ? ` && PathPrefix(\`${options.pathPrefix}\`)`
      : "";
    const rule = `(${hostRules})${pathRule}`;

    // HTTP router (redirect to HTTPS)
    if (options.forceHttps) {
      httpConfig.routers[`${options.serviceName}-http`] = {
        rule,
        entryPoints: ["web"],
        middlewares: ["redirect-to-https"],
        service: options.serviceName,
      };
    }

    // HTTPS router
    const middlewares: string[] = [...(options.middlewares ?? [])];

    if (options.rateLimiting) {
      middlewares.push(`${options.serviceName}-ratelimit`);
      httpConfig.middlewares[`${options.serviceName}-ratelimit`] = {
        rateLimit: {
          average: options.rateLimiting.average,
          burst: options.rateLimiting.burst,
        },
      };
    }

    if (options.basicAuth) {
      middlewares.push(`${options.serviceName}-auth`);
      httpConfig.middlewares[`${options.serviceName}-auth`] = {
        basicAuth: {
          users: options.basicAuth.users,
        },
      };
    }

    if (options.cors) {
      middlewares.push(`${options.serviceName}-cors`);
      httpConfig.middlewares[`${options.serviceName}-cors`] = {
        headers: {
          accessControlAllowOriginList: options.cors.origins,
          accessControlAllowMethods: options.cors.methods ?? [
            "GET",
            "POST",
            "PUT",
            "DELETE",
            "OPTIONS",
          ],
          accessControlAllowHeaders: ["*"],
        },
      };
    }

    httpConfig.routers[`${options.serviceName}-secure`] = {
      rule,
      entryPoints: ["websecure"],
      middlewares: middlewares.length > 0 ? middlewares : undefined,
      service: options.serviceName,
      tls: options.enableSsl
        ? {
            certResolver: "letsencrypt",
            domains: options.domains.map((d) => ({ main: d })),
          }
        : {},
    };

    // Service
    httpConfig.services[options.serviceName] = {
      loadBalancer: {
        servers: [{ url: `http://${options.containerName}:${options.containerPort}` }],
      },
    };

    // Default middlewares
    httpConfig.middlewares["redirect-to-https"] = {
      redirectScheme: {
        scheme: "https",
        permanent: true,
      },
    };

    return config;
  }

  /**
   * Generate Caddy site configuration
   */
  generateCaddySiteConfig(options: {
    domains: string[];
    containerPort: number;
    containerName: string;
    enableSsl: boolean;
    forceHttps: boolean;
    pathPrefix?: string;
    rateLimiting?: {
      average: number;
      burst: number;
    };
    basicAuth?: {
      users: { username: string; password: string }[];
    };
  }): string {
    const hosts = options.domains.join(", ");
    let config = "";

    if (options.enableSsl) {
      config += `${hosts} {\n`;
    } else {
      config += `http://${hosts} {\n`;
    }

    // Rate limiting
    if (options.rateLimiting) {
      config += `    rate_limit {\n`;
      config += `        zone static_zone {\n`;
      config += `            key static\n`;
      config += `            events ${options.rateLimiting.average}\n`;
      config += `            window 1s\n`;
      config += `        }\n`;
      config += `    }\n`;
    }

    // Basic auth
    if (options.basicAuth && options.basicAuth.users.length > 0) {
      config += `    basicauth {\n`;
      for (const user of options.basicAuth.users) {
        config += `        ${user.username} ${user.password}\n`;
      }
      config += `    }\n`;
    }

    // Path prefix handling
    if (options.pathPrefix && options.pathPrefix !== "/") {
      config += `    handle_path ${options.pathPrefix}* {\n`;
      config += `        reverse_proxy ${options.containerName}:${options.containerPort}\n`;
      config += `    }\n`;
    } else {
      config += `    reverse_proxy ${options.containerName}:${options.containerPort}\n`;
    }

    config += `}\n`;

    return config;
  }

  /**
   * Write dynamic proxy configuration for an application
   */
  async writeApplicationProxyConfig(
    sshConfig: SSHConnectionConfig,
    proxyType: ProxyType,
    applicationId: string,
    config: string
  ): Promise<void> {
    const filename =
      proxyType === "traefik"
        ? `${this.COOLIFY_DIR}/proxy/dynamic/${applicationId}.yaml`
        : `${this.COOLIFY_DIR}/proxy/sites/${applicationId}.caddy`;

    // Ensure directory exists
    const dir = proxyType === "traefik" ? "dynamic" : "sites";
    await sshService.executeCommand({
      ...sshConfig,
      command: `mkdir -p ${this.COOLIFY_DIR}/proxy/${dir}`,
    });

    await sshService.writeFile({
      ...sshConfig,
      remotePath: filename,
      content: config,
    });

    // Reload proxy if needed (Caddy auto-reloads, Traefik watches files)
    if (proxyType === "caddy") {
      await sshService.executeCommand({
        ...sshConfig,
        command: `docker exec coolify-caddy caddy reload --config /etc/caddy/Caddyfile`,
      });
    }
  }

  /**
   * Remove proxy configuration for an application
   */
  async removeApplicationProxyConfig(
    sshConfig: SSHConnectionConfig,
    proxyType: ProxyType,
    applicationId: string
  ): Promise<void> {
    const filename =
      proxyType === "traefik"
        ? `${this.COOLIFY_DIR}/proxy/dynamic/${applicationId}.yaml`
        : `${this.COOLIFY_DIR}/proxy/sites/${applicationId}.caddy`;

    await sshService.executeCommand({
      ...sshConfig,
      command: `rm -f ${filename}`,
    });
  }

  /**
   * Check for port conflicts
   */
  async checkPortConflicts(
    sshConfig: SSHConnectionConfig,
    ports: number[]
  ): Promise<{ port: number; inUse: boolean; process?: string }[]> {
    const results: { port: number; inUse: boolean; process?: string }[] = [];

    for (const port of ports) {
      // Try multiple methods to check port availability
      const methods = [
        `ss -tlnp | grep ':${port} '`,
        `netstat -tlnp | grep ':${port} '`,
        `lsof -i :${port} -P -n | grep LISTEN`,
      ];

      let inUse = false;
      let process: string | undefined;

      for (const command of methods) {
        const result = await sshService.executeCommand({
          ...sshConfig,
          command,
        });

        if (result.success && result.stdout.trim()) {
          inUse = true;
          // Extract process name if available
          const match = result.stdout.match(/users:\(\("([^"]+)"/);
          if (match) {
            process = match[1];
          }
          break;
        }
      }

      results.push({ port, inUse, process });
    }

    return results;
  }
}

export const proxyService = new ProxyService();
