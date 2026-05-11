/**
 * SSH Service Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ssh2 Client
vi.mock("ssh2", () => ({
  Client: vi.fn().mockImplementation(() => ({
    on: vi.fn().mockReturnThis(),
    connect: vi.fn(),
    exec: vi.fn(),
    end: vi.fn(),
  })),
}));

describe("SSHService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("executeCommand", () => {
    it("should execute a command and return result", async () => {
      const { Client } = await import("ssh2");
      const mockExec = vi.fn((cmd, callback) => {
        const channel = {
          on: vi.fn((event, handler) => {
            if (event === "close") setTimeout(() => handler(0), 10);
            if (event === "data") setTimeout(() => handler(Buffer.from("output")), 5);
            return channel;
          }),
          stderr: {
            on: vi.fn().mockReturnThis(),
          },
        };
        callback(null, channel);
      });

      vi.mocked(Client).mockImplementation(() => ({
        on: vi.fn(function (event, handler) {
          if (event === "ready") setTimeout(handler, 0);
          return this;
        }),
        connect: vi.fn(),
        exec: mockExec,
        end: vi.fn(),
      }) as any);

      const { sshService } = await import("@/server/services/ssh");

      const result = await sshService.executeCommand({
        host: "localhost",
        port: 22,
        username: "test",
        privateKey: "test-key",
        command: "echo hello",
      });

      expect(result.success).toBe(true);
      expect(result.stdout).toBe("output");
    });

    it("should handle connection errors", async () => {
      const { Client } = await import("ssh2");

      vi.mocked(Client).mockImplementation(() => ({
        on: vi.fn(function (event, handler) {
          if (event === "error") setTimeout(() => handler(new Error("Connection failed")), 0);
          return this;
        }),
        connect: vi.fn(),
        end: vi.fn(),
      }) as any);

      const { sshService } = await import("@/server/services/ssh");

      await expect(
        sshService.executeCommand({
          host: "localhost",
          port: 22,
          username: "test",
          privateKey: "test-key",
          command: "echo hello",
        })
      ).rejects.toThrow("Connection failed");
    });
  });

  describe("validateConnection", () => {
    it("should validate SSH connection and check Docker", async () => {
      const { Client } = await import("ssh2");
      let execCount = 0;

      vi.mocked(Client).mockImplementation(() => ({
        on: vi.fn(function (event, handler) {
          if (event === "ready") setTimeout(handler, 0);
          return this;
        }),
        connect: vi.fn(),
        exec: vi.fn((cmd, callback) => {
          execCount++;
          const output =
            execCount === 1
              ? "Connection successful"
              : execCount === 2
                ? "Docker version 24.0.0"
                : execCount === 3
                  ? "Docker Compose version v2.21.0"
                  : "";
          const channel = {
            on: vi.fn((event, handler) => {
              if (event === "close") setTimeout(() => handler(0), 10);
              if (event === "data") setTimeout(() => handler(Buffer.from(output)), 5);
              return channel;
            }),
            stderr: { on: vi.fn().mockReturnThis() },
          };
          callback(null, channel);
        }),
        end: vi.fn(),
      }) as any);

      const { sshService } = await import("@/server/services/ssh");

      const result = await sshService.validateConnection({
        host: "localhost",
        port: 22,
        username: "test",
        privateKey: "test-key",
      });

      expect(result.success).toBe(true);
      expect(result.dockerVersion).toContain("Docker");
    });
  });

  describe("writeFile", () => {
    it("should write content using heredoc", async () => {
      const { Client } = await import("ssh2");
      let executedCommand = "";

      vi.mocked(Client).mockImplementation(() => ({
        on: vi.fn(function (event, handler) {
          if (event === "ready") setTimeout(handler, 0);
          return this;
        }),
        connect: vi.fn(),
        exec: vi.fn((cmd, callback) => {
          executedCommand = cmd;
          const channel = {
            on: vi.fn((event, handler) => {
              if (event === "close") setTimeout(() => handler(0), 10);
              return channel;
            }),
            stderr: { on: vi.fn().mockReturnThis() },
          };
          callback(null, channel);
        }),
        end: vi.fn(),
      }) as any);

      const { sshService } = await import("@/server/services/ssh");

      await sshService.writeFile({
        host: "localhost",
        port: 22,
        username: "test",
        privateKey: "test-key",
        remotePath: "/tmp/test.txt",
        content: "Hello World",
      });

      expect(executedCommand).toContain("cat > /tmp/test.txt");
      expect(executedCommand).toContain("Hello World");
    });
  });
});
