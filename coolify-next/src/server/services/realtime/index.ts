import { Server as SocketIOServer, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import { logger } from "@/lib/logger";
import type { Server as HTTPServer } from "http";

export type RealtimeEventType =
  | "deployment:started"
  | "deployment:progress"
  | "deployment:completed"
  | "deployment:failed"
  | "deployment:logs"
  | "container:status"
  | "container:logs"
  | "server:status"
  | "server:resources"
  | "application:status"
  | "database:status"
  | "service:status"
  | "proxy:status"
  | "backup:progress"
  | "terminal:output";

export interface RealtimeEvent {
  type: RealtimeEventType;
  teamId: string;
  resourceId?: string;
  data: unknown;
  timestamp: number;
}

export interface TerminalSession {
  userId: string;
  serverId: string;
  cols: number;
  rows: number;
}

class RealtimeService {
  private io: SocketIOServer | null = null;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  /**
   * Initialize the WebSocket server
   */
  async initialize(httpServer: HTTPServer): Promise<void> {
    // Create Socket.IO server
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true,
      },
      transports: ["websocket", "polling"],
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    // Setup Redis adapter for horizontal scaling
    if (process.env.REDIS_URL) {
      try {
        this.pubClient = new Redis(process.env.REDIS_URL);
        this.subClient = this.pubClient.duplicate();

        this.io.adapter(createAdapter(this.pubClient, this.subClient));
        logger.info("Socket.IO Redis adapter initialized");
      } catch (error) {
        logger.warn("Failed to initialize Redis adapter, using in-memory", {
          error,
        });
      }
    }

    // Setup connection handlers
    this.setupConnectionHandlers();

    logger.info("Realtime service initialized");
  }

  /**
   * Setup WebSocket connection handlers
   */
  private setupConnectionHandlers(): void {
    if (!this.io) return;

    this.io.on("connection", (socket: Socket) => {
      logger.debug("Client connected", { socketId: socket.id });

      // Handle authentication
      socket.on("authenticate", async (data: { token: string }) => {
        try {
          const user = await this.verifyToken(data.token);
          if (user) {
            // Store user info in socket data
            socket.data.userId = user.id;
            socket.data.teamId = user.teamId;

            // Join team room
            await socket.join(`team:${user.teamId}`);

            // Join user-specific room
            await socket.join(`user:${user.id}`);

            socket.emit("authenticated", { success: true });
            logger.debug("Client authenticated", {
              socketId: socket.id,
              userId: user.id,
            });
          } else {
            socket.emit("authenticated", {
              success: false,
              error: "Invalid token",
            });
          }
        } catch (error) {
          socket.emit("authenticated", {
            success: false,
            error: "Authentication failed",
          });
        }
      });

      // Handle subscribing to specific resources
      socket.on(
        "subscribe",
        async (data: { resourceType: string; resourceId: string }) => {
          if (!socket.data.teamId) {
            socket.emit("error", { message: "Not authenticated" });
            return;
          }

          // Join resource-specific room
          const room = `${data.resourceType}:${data.resourceId}`;
          await socket.join(room);

          logger.debug("Client subscribed to resource", {
            socketId: socket.id,
            room,
          });
        }
      );

      // Handle unsubscribing from resources
      socket.on(
        "unsubscribe",
        async (data: { resourceType: string; resourceId: string }) => {
          const room = `${data.resourceType}:${data.resourceId}`;
          await socket.leave(room);

          logger.debug("Client unsubscribed from resource", {
            socketId: socket.id,
            room,
          });
        }
      );

      // Handle terminal input
      socket.on(
        "terminal:input",
        (data: { sessionId: string; input: string }) => {
          // Forward to terminal session handler
          this.handleTerminalInput(socket, data);
        }
      );

      // Handle terminal resize
      socket.on(
        "terminal:resize",
        (data: { sessionId: string; cols: number; rows: number }) => {
          this.handleTerminalResize(socket, data);
        }
      );

      // Handle disconnection
      socket.on("disconnect", (reason) => {
        logger.debug("Client disconnected", {
          socketId: socket.id,
          reason,
        });
      });
    });
  }

  /**
   * Verify authentication token
   */
  private async verifyToken(
    token: string
  ): Promise<{ id: string; teamId: string } | null> {
    // This should be implemented to verify the session token
    // For now, returning a placeholder
    try {
      // In a real implementation, you would:
      // 1. Verify the JWT or session token
      // 2. Get the user and their current team
      // 3. Return the user info

      // Placeholder implementation
      if (token && token.length > 0) {
        // Token validation would go here
        return null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Handle terminal input from client
   */
  private handleTerminalInput(
    socket: Socket,
    data: { sessionId: string; input: string }
  ): void {
    // This would be connected to the SSH service for terminal sessions
    // For now, just emit back to the session room
    this.io?.to(`terminal:${data.sessionId}`).emit("terminal:output", {
      sessionId: data.sessionId,
      output: data.input,
    });
  }

  /**
   * Handle terminal resize from client
   */
  private handleTerminalResize(
    socket: Socket,
    data: { sessionId: string; cols: number; rows: number }
  ): void {
    // This would resize the PTY session
    logger.debug("Terminal resize", {
      sessionId: data.sessionId,
      cols: data.cols,
      rows: data.rows,
    });
  }

  /**
   * Emit an event to a team
   */
  emitToTeam(teamId: string, event: RealtimeEventType, data: unknown): void {
    if (!this.io) {
      logger.warn("Realtime service not initialized");
      return;
    }

    this.io.to(`team:${teamId}`).emit(event, {
      type: event,
      data,
      timestamp: Date.now(),
    });

    logger.debug("Event emitted to team", { teamId, event });
  }

  /**
   * Emit an event to a specific user
   */
  emitToUser(userId: string, event: RealtimeEventType, data: unknown): void {
    if (!this.io) {
      logger.warn("Realtime service not initialized");
      return;
    }

    this.io.to(`user:${userId}`).emit(event, {
      type: event,
      data,
      timestamp: Date.now(),
    });

    logger.debug("Event emitted to user", { userId, event });
  }

  /**
   * Emit an event to subscribers of a specific resource
   */
  emitToResource(
    resourceType: string,
    resourceId: string,
    event: RealtimeEventType,
    data: unknown
  ): void {
    if (!this.io) {
      logger.warn("Realtime service not initialized");
      return;
    }

    const room = `${resourceType}:${resourceId}`;
    this.io.to(room).emit(event, {
      type: event,
      resourceId,
      data,
      timestamp: Date.now(),
    });

    logger.debug("Event emitted to resource", { resourceType, resourceId, event });
  }

  /**
   * Emit deployment logs
   */
  emitDeploymentLogs(
    teamId: string,
    deploymentId: string,
    logs: string
  ): void {
    this.emitToResource("deployment", deploymentId, "deployment:logs", {
      deploymentId,
      logs,
    });

    // Also emit to team for dashboard updates
    this.emitToTeam(teamId, "deployment:logs", {
      deploymentId,
      logs,
    });
  }

  /**
   * Emit deployment status change
   */
  emitDeploymentStatus(
    teamId: string,
    deploymentId: string,
    status: string,
    progress?: number
  ): void {
    const eventType =
      status === "completed"
        ? "deployment:completed"
        : status === "failed"
          ? "deployment:failed"
          : status === "in_progress"
            ? "deployment:progress"
            : "deployment:started";

    this.emitToResource("deployment", deploymentId, eventType, {
      deploymentId,
      status,
      progress,
    });

    this.emitToTeam(teamId, eventType, {
      deploymentId,
      status,
      progress,
    });
  }

  /**
   * Emit container status change
   */
  emitContainerStatus(
    teamId: string,
    containerId: string,
    status: {
      state: string;
      health?: string;
      restarts?: number;
    }
  ): void {
    this.emitToTeam(teamId, "container:status", {
      containerId,
      ...status,
    });

    this.emitToResource("container", containerId, "container:status", status);
  }

  /**
   * Emit server status change
   */
  emitServerStatus(
    teamId: string,
    serverId: string,
    status: {
      isReachable: boolean;
      lastOnlineAt?: Date;
    }
  ): void {
    this.emitToTeam(teamId, "server:status", {
      serverId,
      ...status,
    });

    this.emitToResource("server", serverId, "server:status", status);
  }

  /**
   * Emit server resource usage
   */
  emitServerResources(
    teamId: string,
    serverId: string,
    resources: {
      cpu: number;
      memory: number;
      disk: number;
    }
  ): void {
    this.emitToResource("server", serverId, "server:resources", resources);
  }

  /**
   * Emit terminal output
   */
  emitTerminalOutput(sessionId: string, output: string): void {
    if (!this.io) return;

    this.io.to(`terminal:${sessionId}`).emit("terminal:output", {
      sessionId,
      output,
      timestamp: Date.now(),
    });
  }

  /**
   * Get connected clients count
   */
  async getConnectedClientsCount(): Promise<number> {
    if (!this.io) return 0;
    const sockets = await this.io.fetchSockets();
    return sockets.length;
  }

  /**
   * Get clients in a room
   */
  async getRoomClients(room: string): Promise<number> {
    if (!this.io) return 0;
    const sockets = await this.io.in(room).fetchSockets();
    return sockets.length;
  }

  /**
   * Shutdown the realtime service
   */
  async shutdown(): Promise<void> {
    if (this.io) {
      this.io.close();
      this.io = null;
    }

    if (this.pubClient) {
      await this.pubClient.quit();
      this.pubClient = null;
    }

    if (this.subClient) {
      await this.subClient.quit();
      this.subClient = null;
    }

    logger.info("Realtime service shutdown");
  }
}

export const realtimeService = new RealtimeService();
