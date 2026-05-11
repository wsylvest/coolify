/**
 * Cloudflare Tunnels Service
 *
 * Manages Cloudflare Tunnels (cloudflared) for secure access to services
 * without exposing ports or requiring public IP addresses.
 */

import { logger } from "@/lib/logger";
import type { SSHConnection } from "@/server/services/ssh";
import { sshService } from "@/server/services/ssh";

export interface CloudflareConfig {
  apiToken: string;
  accountId: string;
  zoneId?: string;
}

export interface CloudflareTunnel {
  id: string;
  name: string;
  status: "active" | "inactive" | "degraded";
  createdAt: string;
  connections: {
    id: string;
    clientVersion: string;
    originIP: string;
    openedAt: string;
  }[];
}

export interface TunnelRoute {
  hostname: string;
  service: string;
  path?: string;
  originRequest?: {
    noTLSVerify?: boolean;
    connectTimeout?: string;
    httpHostHeader?: string;
  };
}

export interface DNSRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
}

class CloudflareService {
  private config: CloudflareConfig | null = null;
  private baseUrl = "https://api.cloudflare.com/client/v4";

  /**
   * Configure the Cloudflare API client
   */
  configure(config: CloudflareConfig): void {
    this.config = config;
    logger.info("Cloudflare service configured", { accountId: config.accountId });
  }

  /**
   * Make authenticated request to Cloudflare API
   */
  private async apiRequest<T>(
    method: string,
    endpoint: string,
    body?: object
  ): Promise<T> {
    if (!this.config) {
      throw new Error("Cloudflare not configured");
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!data.success) {
      const errors = data.errors?.map((e: { message: string }) => e.message).join(", ");
      throw new Error(`Cloudflare API error: ${errors || response.statusText}`);
    }

    return data.result as T;
  }

  /**
   * List all tunnels for the account
   */
  async listTunnels(): Promise<CloudflareTunnel[]> {
    if (!this.config) throw new Error("Cloudflare not configured");

    const tunnels = await this.apiRequest<
      {
        id: string;
        name: string;
        status: string;
        created_at: string;
        connections: {
          id: string;
          client_version: string;
          origin_ip: string;
          opened_at: string;
        }[];
      }[]
    >("GET", `/accounts/${this.config.accountId}/cfd_tunnel`);

    return tunnels.map((t) => ({
      id: t.id,
      name: t.name,
      status: this.parseTunnelStatus(t.status),
      createdAt: t.created_at,
      connections: (t.connections || []).map((c) => ({
        id: c.id,
        clientVersion: c.client_version,
        originIP: c.origin_ip,
        openedAt: c.opened_at,
      })),
    }));
  }

  /**
   * Get tunnel by ID
   */
  async getTunnel(tunnelId: string): Promise<CloudflareTunnel> {
    if (!this.config) throw new Error("Cloudflare not configured");

    const tunnel = await this.apiRequest<{
      id: string;
      name: string;
      status: string;
      created_at: string;
      connections: {
        id: string;
        client_version: string;
        origin_ip: string;
        opened_at: string;
      }[];
    }>("GET", `/accounts/${this.config.accountId}/cfd_tunnel/${tunnelId}`);

    return {
      id: tunnel.id,
      name: tunnel.name,
      status: this.parseTunnelStatus(tunnel.status),
      createdAt: tunnel.created_at,
      connections: (tunnel.connections || []).map((c) => ({
        id: c.id,
        clientVersion: c.client_version,
        originIP: c.origin_ip,
        openedAt: c.opened_at,
      })),
    };
  }

  /**
   * Create a new tunnel
   */
  async createTunnel(name: string): Promise<{ tunnel: CloudflareTunnel; secret: string }> {
    if (!this.config) throw new Error("Cloudflare not configured");

    // Generate a random tunnel secret
    const secretBytes = new Uint8Array(32);
    crypto.getRandomValues(secretBytes);
    const secret = Buffer.from(secretBytes).toString("base64");

    const tunnel = await this.apiRequest<{
      id: string;
      name: string;
      status: string;
      created_at: string;
    }>("POST", `/accounts/${this.config.accountId}/cfd_tunnel`, {
      name,
      tunnel_secret: secret,
    });

    logger.info("Created Cloudflare tunnel", { tunnelId: tunnel.id, name });

    return {
      tunnel: {
        id: tunnel.id,
        name: tunnel.name,
        status: this.parseTunnelStatus(tunnel.status),
        createdAt: tunnel.created_at,
        connections: [],
      },
      secret,
    };
  }

  /**
   * Delete a tunnel
   */
  async deleteTunnel(tunnelId: string): Promise<void> {
    if (!this.config) throw new Error("Cloudflare not configured");

    await this.apiRequest(
      "DELETE",
      `/accounts/${this.config.accountId}/cfd_tunnel/${tunnelId}`
    );

    logger.info("Deleted Cloudflare tunnel", { tunnelId });
  }

  /**
   * Get tunnel configuration
   */
  async getTunnelConfig(tunnelId: string): Promise<{ ingress: TunnelRoute[] }> {
    if (!this.config) throw new Error("Cloudflare not configured");

    const config = await this.apiRequest<{
      config: {
        ingress: {
          hostname?: string;
          service: string;
          path?: string;
          originRequest?: object;
        }[];
      };
    }>("GET", `/accounts/${this.config.accountId}/cfd_tunnel/${tunnelId}/configurations`);

    return {
      ingress: config.config.ingress.map((r) => ({
        hostname: r.hostname || "",
        service: r.service,
        path: r.path,
        originRequest: r.originRequest as TunnelRoute["originRequest"],
      })),
    };
  }

  /**
   * Update tunnel configuration (routes)
   */
  async updateTunnelConfig(tunnelId: string, routes: TunnelRoute[]): Promise<void> {
    if (!this.config) throw new Error("Cloudflare not configured");

    // Ensure catch-all route exists at the end
    const ingress = routes.map((r) => ({
      hostname: r.hostname || undefined,
      service: r.service,
      path: r.path,
      originRequest: r.originRequest,
    }));

    // Add catch-all 404 service if not present
    if (!ingress.some((r) => !r.hostname)) {
      ingress.push({ hostname: undefined, service: "http_status:404" });
    }

    await this.apiRequest(
      "PUT",
      `/accounts/${this.config.accountId}/cfd_tunnel/${tunnelId}/configurations`,
      { config: { ingress } }
    );

    logger.info("Updated tunnel configuration", { tunnelId, routeCount: routes.length });
  }

  /**
   * Add a route to tunnel configuration
   */
  async addRoute(tunnelId: string, route: TunnelRoute): Promise<void> {
    const config = await this.getTunnelConfig(tunnelId);
    const existingRoutes = config.ingress.filter((r) => r.hostname && r.service !== "http_status:404");

    // Check if route already exists
    const exists = existingRoutes.some(
      (r) => r.hostname === route.hostname && r.path === route.path
    );
    if (exists) {
      // Update existing route
      const updated = existingRoutes.map((r) =>
        r.hostname === route.hostname && r.path === route.path ? route : r
      );
      await this.updateTunnelConfig(tunnelId, updated);
    } else {
      // Add new route
      await this.updateTunnelConfig(tunnelId, [...existingRoutes, route]);
    }
  }

  /**
   * Remove a route from tunnel configuration
   */
  async removeRoute(tunnelId: string, hostname: string, path?: string): Promise<void> {
    const config = await this.getTunnelConfig(tunnelId);
    const filtered = config.ingress.filter(
      (r) => !(r.hostname === hostname && r.path === path) && r.service !== "http_status:404"
    );
    await this.updateTunnelConfig(tunnelId, filtered);
  }

  /**
   * Create a DNS CNAME record pointing to the tunnel
   */
  async createDNSRecord(
    tunnelId: string,
    hostname: string,
    zoneId?: string
  ): Promise<DNSRecord> {
    if (!this.config) throw new Error("Cloudflare not configured");
    const zone = zoneId || this.config.zoneId;
    if (!zone) throw new Error("Zone ID required for DNS operations");

    const record = await this.apiRequest<{
      id: string;
      type: string;
      name: string;
      content: string;
      proxied: boolean;
      ttl: number;
    }>("POST", `/zones/${zone}/dns_records`, {
      type: "CNAME",
      name: hostname,
      content: `${tunnelId}.cfargotunnel.com`,
      proxied: true,
      ttl: 1, // Auto TTL when proxied
    });

    logger.info("Created DNS record for tunnel", { hostname, tunnelId });

    return {
      id: record.id,
      type: record.type,
      name: record.name,
      content: record.content,
      proxied: record.proxied,
      ttl: record.ttl,
    };
  }

  /**
   * Delete a DNS record
   */
  async deleteDNSRecord(recordId: string, zoneId?: string): Promise<void> {
    if (!this.config) throw new Error("Cloudflare not configured");
    const zone = zoneId || this.config.zoneId;
    if (!zone) throw new Error("Zone ID required for DNS operations");

    await this.apiRequest("DELETE", `/zones/${zone}/dns_records/${recordId}`);
    logger.info("Deleted DNS record", { recordId });
  }

  /**
   * List DNS records for a zone
   */
  async listDNSRecords(zoneId?: string): Promise<DNSRecord[]> {
    if (!this.config) throw new Error("Cloudflare not configured");
    const zone = zoneId || this.config.zoneId;
    if (!zone) throw new Error("Zone ID required for DNS operations");

    const records = await this.apiRequest<
      {
        id: string;
        type: string;
        name: string;
        content: string;
        proxied: boolean;
        ttl: number;
      }[]
    >("GET", `/zones/${zone}/dns_records`);

    return records.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      content: r.content,
      proxied: r.proxied,
      ttl: r.ttl,
    }));
  }

  /**
   * Install cloudflared on a server
   */
  async installCloudflared(connection: SSHConnection): Promise<void> {
    // Detect OS and install cloudflared
    const osResult = await sshService.execute(connection, "cat /etc/os-release");
    const isDebian = osResult.stdout.includes("debian") || osResult.stdout.includes("ubuntu");
    const isRhel = osResult.stdout.includes("rhel") || osResult.stdout.includes("centos") || osResult.stdout.includes("fedora");

    if (isDebian) {
      await sshService.execute(
        connection,
        `curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && dpkg -i cloudflared.deb && rm cloudflared.deb`
      );
    } else if (isRhel) {
      await sshService.execute(
        connection,
        `curl -L --output cloudflared.rpm https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm && rpm -i cloudflared.rpm && rm cloudflared.rpm`
      );
    } else {
      // Generic binary install
      await sshService.execute(
        connection,
        `curl -L --output /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /usr/local/bin/cloudflared`
      );
    }

    logger.info("Installed cloudflared on server");
  }

  /**
   * Generate tunnel credentials file
   */
  generateCredentialsFile(
    tunnelId: string,
    accountId: string,
    tunnelSecret: string
  ): string {
    return JSON.stringify(
      {
        AccountTag: accountId,
        TunnelSecret: tunnelSecret,
        TunnelID: tunnelId,
      },
      null,
      2
    );
  }

  /**
   * Generate tunnel config file
   */
  generateConfigFile(
    tunnelId: string,
    routes: TunnelRoute[],
    options?: { metricsPort?: number; noAutoUpdate?: boolean }
  ): string {
    const ingress = routes.map((r) => {
      const entry: Record<string, unknown> = { service: r.service };
      if (r.hostname) entry.hostname = r.hostname;
      if (r.path) entry.path = r.path;
      if (r.originRequest) entry.originRequest = r.originRequest;
      return entry;
    });

    // Add catch-all
    ingress.push({ service: "http_status:404" });

    const config: Record<string, unknown> = {
      tunnel: tunnelId,
      "credentials-file": `/etc/cloudflared/${tunnelId}.json`,
      ingress,
    };

    if (options?.metricsPort) {
      config.metrics = `localhost:${options.metricsPort}`;
    }

    if (options?.noAutoUpdate) {
      config["no-autoupdate"] = true;
    }

    // Convert to YAML-like format (simple key: value for cloudflared)
    return this.toYaml(config);
  }

  /**
   * Setup cloudflared tunnel on a server
   */
  async setupTunnel(
    connection: SSHConnection,
    tunnelId: string,
    accountId: string,
    tunnelSecret: string,
    routes: TunnelRoute[]
  ): Promise<void> {
    // Ensure cloudflared is installed
    const checkResult = await sshService.execute(connection, "which cloudflared || echo 'not found'");
    if (checkResult.stdout.includes("not found")) {
      await this.installCloudflared(connection);
    }

    // Create config directory
    await sshService.execute(connection, "mkdir -p /etc/cloudflared");

    // Write credentials file
    const credentials = this.generateCredentialsFile(tunnelId, accountId, tunnelSecret);
    await sshService.execute(
      connection,
      `cat > /etc/cloudflared/${tunnelId}.json << 'EOF'\n${credentials}\nEOF`
    );

    // Write config file
    const config = this.generateConfigFile(tunnelId, routes);
    await sshService.execute(
      connection,
      `cat > /etc/cloudflared/config.yml << 'EOF'\n${config}\nEOF`
    );

    logger.info("Set up cloudflared tunnel on server", { tunnelId });
  }

  /**
   * Start cloudflared as a systemd service
   */
  async startTunnelService(connection: SSHConnection): Promise<void> {
    // Install as systemd service
    await sshService.execute(connection, "cloudflared service install");
    await sshService.execute(connection, "systemctl enable cloudflared");
    await sshService.execute(connection, "systemctl start cloudflared");

    logger.info("Started cloudflared service");
  }

  /**
   * Stop cloudflared service
   */
  async stopTunnelService(connection: SSHConnection): Promise<void> {
    await sshService.execute(connection, "systemctl stop cloudflared");
    logger.info("Stopped cloudflared service");
  }

  /**
   * Restart cloudflared service
   */
  async restartTunnelService(connection: SSHConnection): Promise<void> {
    await sshService.execute(connection, "systemctl restart cloudflared");
    logger.info("Restarted cloudflared service");
  }

  /**
   * Get cloudflared service status
   */
  async getTunnelServiceStatus(
    connection: SSHConnection
  ): Promise<{ active: boolean; status: string }> {
    const result = await sshService.execute(
      connection,
      "systemctl is-active cloudflared || echo 'inactive'"
    );
    const status = result.stdout.trim();

    return {
      active: status === "active",
      status,
    };
  }

  /**
   * Uninstall cloudflared service
   */
  async uninstallTunnelService(connection: SSHConnection): Promise<void> {
    await sshService.execute(connection, "systemctl stop cloudflared || true");
    await sshService.execute(connection, "cloudflared service uninstall || true");
    await sshService.execute(connection, "rm -rf /etc/cloudflared");

    logger.info("Uninstalled cloudflared service");
  }

  private parseTunnelStatus(status: string): CloudflareTunnel["status"] {
    const s = status?.toLowerCase();
    if (s === "active" || s === "healthy") return "active";
    if (s === "inactive" || s === "down") return "inactive";
    return "degraded";
  }

  private toYaml(obj: Record<string, unknown>, indent = 0): string {
    const spaces = "  ".repeat(indent);
    let result = "";

    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        result += `${spaces}${key}:\n`;
        for (const item of value) {
          if (typeof item === "object" && item !== null) {
            result += `${spaces}- `;
            const itemYaml = this.toYaml(item as Record<string, unknown>, 0)
              .split("\n")
              .map((line, i) => (i === 0 ? line : `${spaces}  ${line}`))
              .join("\n");
            result += itemYaml;
          } else {
            result += `${spaces}- ${item}\n`;
          }
        }
      } else if (typeof value === "object" && value !== null) {
        result += `${spaces}${key}:\n`;
        result += this.toYaml(value as Record<string, unknown>, indent + 1);
      } else if (typeof value === "string") {
        result += `${spaces}${key}: "${value}"\n`;
      } else {
        result += `${spaces}${key}: ${value}\n`;
      }
    }

    return result;
  }
}

export const cloudflareService = new CloudflareService();
