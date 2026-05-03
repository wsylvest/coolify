import { Server as SocketIOServer, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import { decode } from "next-auth/jwt";
import { Client, type ClientChannel } from "ssh2";
import { db } from "@/server/db";
import { teamMembers, servers, privateKeys } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";
import type { Server as HTTPServer } from "http";

interface SSHTerminalSession {
  id: string;
  userId: string;
  serverId: string;
  client: Client;
  channel: ClientChannel;
  cols: number;
  rows: number;
}

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
  private terminalSessions: Map<string, SSHTerminalSession> = new Map();

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

      // Handle terminal session start
      socket.on(
        "terminal:start",
        async (data: { serverId: string; cols?: number; rows?: number }) => {
          if (!socket.data.userId) {
            socket.emit("terminal:error", { message: "Not authenticated" });
            return;
          }
          await this.handleTerminalStart(socket, data);
        }
      );

      // Handle terminal input
      socket.on(
        "terminal:input",
        (data: { sessionId: string; input: string }) => {
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

      // Handle terminal close
      socket.on("terminal:close", (data: { sessionId: string }) => {
        this.handleTerminalClose(socket, data);
      });

      // Handle disconnection
      socket.on("disconnect", (reason) => {
        logger.debug("Client disconnected", {
          socketId: socket.id,
          reason,
        });
        // Clean up any terminal sessions for this socket
        this.cleanupSocketSessions(socket.id);
      });
    });
  }

  /**
   * Verify authentication token
   */
  private async verifyToken(
    token: string
  ): Promise<{ id: string; teamId: string } | null> {
    try {
      if (!token || token.length === 0) {
        return null;
      }

      const secret = process.env.NEXTAUTH_SECRET;
      if (!secret) {
        logger.error("NEXTAUTH_SECRET not configured");
        return null;
      }

      // Decode the JWT token from NextAuth
      const decoded = await decode({
        token,
        secret,
      });

      if (!decoded?.id || typeof decoded.id !== "string") {
        logger.debug("Invalid token: missing user ID");
        return null;
      }

      const userId = decoded.id;

      // Get the user's first team membership (or active team if stored)
      const membership = await db.query.teamMembers.findFirst({
        where: eq(teamMembers.userId, userId),
        orderBy: (tm, { desc }) => [desc(tm.createdAt)],
      });

      if (!membership) {
        logger.debug("User has no team membership", { userId });
        return null;
      }

      return {
        id: userId,
        teamId: membership.teamId,
      };
    } catch (error) {
      logger.error("Token verification failed", { error });
      return null;
    }
  }

  /**
   * Handle terminal session start
   */
  private async handleTerminalStart(
    socket: Socket,
    data: { serverId: string; cols?: number; rows?: number }
  ): Promise<void> {
    try {
      // Get server details
      const server = await db.query.servers.findFirst({
        where: eq(servers.id, data.serverId),
        with: { privateKey: true },
      });

      if (!server) {
        socket.emit("terminal:error", { message: "Server not found" });
        return;
      }

      if (!server.privateKey) {
        socket.emit("terminal:error", { message: "Server has no SSH key configured" });
        return;
      }

      const sessionId = `term-${socket.id}-${Date.now()}`;
      const cols = data.cols || 80;
      const rows = data.rows || 24;

      // Create SSH client
      const client = new Client();

      client.on("ready", () => {
        // Request a PTY and shell
        client.shell(
          { cols, rows, term: "xterm-256color" },
          (err, channel) => {
            if (err) {
              socket.emit("terminal:error", { message: `Shell error: ${err.message}` });
              client.end();
              return;
            }

            // Store session
            const session: SSHTerminalSession = {
              id: sessionId,
              userId: socket.data.userId,
              serverId: data.serverId,
              client,
              channel,
              cols,
              rows,
            };
            this.terminalSessions.set(sessionId, session);

            // Join terminal room
            socket.join(`terminal:${sessionId}`);

            // Send session ID to client
            socket.emit("terminal:started", { sessionId });

            // Forward terminal output to client
            channel.on("data", (output: Buffer) => {
              socket.emit("terminal:output", {
                sessionId,
                output: output.toString(),
              });
            });

            channel.stderr.on("data", (output: Buffer) => {
              socket.emit("terminal:output", {
                sessionId,
                output: output.toString(),
              });
            });

            channel.on("close", () => {
              socket.emit("terminal:closed", { sessionId });
              this.terminalSessions.delete(sessionId);
              socket.leave(`terminal:${sessionId}`);
            });

            logger.info("Terminal session started", { sessionId, serverId: data.serverId });
          }
        );
      });

      client.on("error", (err) => {
        socket.emit("terminal:error", { message: `SSH error: ${err.message}` });
        this.terminalSessions.delete(sessionId);
      });

      // Connect to server
      client.connect({
        host: server.ip,
        port: server.port,
        username: server.user,
        privateKey: server.privateKey.privateKey,
        readyTimeout: 30000,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      socket.emit("terminal:error", { message });
      logger.error("Terminal start failed", { error });
    }
  }

  /**
   * Handle terminal input from client
   */
  private handleTerminalInput(
    socket: Socket,
    data: { sessionId: string; input: string }
  ): void {
    const session = this.terminalSessions.get(data.sessionId);
    if (!session) {
      socket.emit("terminal:error", { message: "Session not found" });
      return;
    }

    // Verify ownership
    if (session.userId !== socket.data.userId) {
      socket.emit("terminal:error", { message: "Unauthorized" });
      return;
    }

    // Write input to SSH channel
    session.channel.write(data.input);
  }

  /**
   * Handle terminal resize from client
   */
  private handleTerminalResize(
    socket: Socket,
    data: { sessionId: string; cols: number; rows: number }
  ): void {
    const session = this.terminalSessions.get(data.sessionId);
    if (!session) {
      socket.emit("terminal:error", { message: "Session not found" });
      return;
    }

    // Verify ownership
    if (session.userId !== socket.data.userId) {
      socket.emit("terminal:error", { message: "Unauthorized" });
      return;
    }

    // Resize PTY
    session.channel.setWindow(data.rows, data.cols, 0, 0);
    session.cols = data.cols;
    session.rows = data.rows;

    logger.debug("Terminal resized", { sessionId: data.sessionId, cols: data.cols, rows: data.rows });
  }

  /**
   * Handle terminal close from client
   */
  private handleTerminalClose(
    socket: Socket,
    data: { sessionId: string }
  ): void {
    const session = this.terminalSessions.get(data.sessionId);
    if (!session) return;

    // Verify ownership
    if (session.userId !== socket.data.userId) return;

    // Close SSH connection
    session.channel.close();
    session.client.end();
    this.terminalSessions.delete(data.sessionId);
    socket.leave(`terminal:${data.sessionId}`);

    logger.info("Terminal session closed", { sessionId: data.sessionId });
  }

  /**
   * Clean up terminal sessions for a disconnected socket
   */
  private cleanupSocketSessions(socketId: string): void {
    for (const [sessionId, session] of this.terminalSessions.entries()) {
      if (sessionId.includes(socketId)) {
        session.channel.close();
        session.client.end();
        this.terminalSessions.delete(sessionId);
        logger.debug("Cleaned up terminal session", { sessionId });
      }
    }
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
