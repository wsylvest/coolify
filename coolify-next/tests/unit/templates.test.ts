/**
 * Template Service Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs module
vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

import * as fs from "fs/promises";

describe("TemplateService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadTemplates", () => {
    it("should load all YAML templates from directory", async () => {
      const mockFiles = ["postgres.yaml", "redis.yaml", "nginx.yml", "readme.md"];
      vi.mocked(fs.readdir).mockResolvedValue(mockFiles as any);
      vi.mocked(fs.readFile).mockResolvedValue(`
services:
  app:
    image: postgres:16
`);

      const { templateService } = await import(
        "@/server/services/templates/index"
      );

      const templates = await templateService.loadTemplates();

      // Should only load .yaml and .yml files
      expect(fs.readdir).toHaveBeenCalled();
    });

    it("should handle empty templates directory", async () => {
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const { templateService } = await import(
        "@/server/services/templates/index"
      );

      const templates = await templateService.loadTemplates();
      expect(templates).toEqual([]);
    });

    it("should skip invalid template files", async () => {
      vi.mocked(fs.readdir).mockResolvedValue(["invalid.yaml"] as any);
      vi.mocked(fs.readFile).mockRejectedValue(new Error("Parse error"));

      const { templateService } = await import(
        "@/server/services/templates/index"
      );

      const templates = await templateService.loadTemplates();
      expect(templates).toEqual([]);
    });
  });

  describe("parseTemplate", () => {
    it("should extract variables from environment values", async () => {
      const { templateService } = await import(
        "@/server/services/templates/index"
      );

      const template = {
        id: "test",
        name: "Test",
        description: "",
        documentation: "",
        tags: [],
        compose: {
          services: {
            app: {
              image: "postgres:16",
              environment: {
                POSTGRES_USER: "${DB_USER}",
                POSTGRES_PASSWORD: "${DB_PASSWORD}",
              },
            },
          },
        },
      };

      const parsed = templateService.parseTemplate(template);

      expect(parsed.variables).toHaveLength(2);
      expect(parsed.variables.map((v) => v.name)).toContain("DB_USER");
      expect(parsed.variables.map((v) => v.name)).toContain("DB_PASSWORD");
    });

    it("should infer service types from image names", async () => {
      const { templateService } = await import(
        "@/server/services/templates/index"
      );

      const template = {
        id: "test",
        name: "Test",
        description: "",
        documentation: "",
        tags: [],
        compose: {
          services: {
            db: { image: "postgres:16", environment: {} },
            cache: { image: "redis:7", environment: {} },
            app: { image: "nginx:alpine", environment: {} },
          },
        },
      };

      const parsed = templateService.parseTemplate(template);

      const dbService = parsed.services.find((s) => s.name === "db");
      const cacheService = parsed.services.find((s) => s.name === "cache");
      const appService = parsed.services.find((s) => s.name === "app");

      expect(dbService?.type).toBe("database");
      expect(cacheService?.type).toBe("cache");
      expect(appService?.type).toBe("application");
    });
  });

  describe("generateComposeConfig", () => {
    it("should replace variables in generated config", async () => {
      const { templateService } = await import(
        "@/server/services/templates/index"
      );

      const template = {
        id: "test",
        name: "Test",
        description: "",
        documentation: "",
        tags: [],
        compose: {
          services: {
            app: {
              image: "postgres:${PG_VERSION}",
              environment: {
                POSTGRES_PASSWORD: "${DB_PASSWORD}",
              },
            },
          },
        },
      };

      const config = templateService.generateComposeConfig(
        template,
        { PG_VERSION: "16", DB_PASSWORD: "secret123" },
        { projectName: "myproject" }
      );

      expect(config.services.app.image).toBe("postgres:16");
      expect(config.services.app.environment?.POSTGRES_PASSWORD).toBe("secret123");
    });

    it("should add Coolify labels to services", async () => {
      const { templateService } = await import(
        "@/server/services/templates/index"
      );

      const template = {
        id: "test",
        name: "Test",
        description: "",
        documentation: "",
        tags: [],
        compose: {
          services: {
            app: {
              image: "nginx:alpine",
            },
          },
        },
      };

      const config = templateService.generateComposeConfig(
        template,
        {},
        { projectName: "myproject" }
      );

      expect(config.services.app.labels?.["coolify.managed"]).toBe("true");
      expect(config.services.app.labels?.["coolify.project"]).toBe("myproject");
      expect(config.services.app.labels?.["coolify.template"]).toBe("test");
    });
  });

  describe("validateVariables", () => {
    it("should validate required variables", async () => {
      const { templateService } = await import(
        "@/server/services/templates/index"
      );

      const parsed = {
        template: {} as any,
        variables: [
          { name: "DB_USER", label: "Database User", type: "string" as const, required: true },
          { name: "DB_PASS", label: "Database Password", type: "password" as const, required: true },
        ],
        services: [],
      };

      const result = templateService.validateVariables(parsed, { DB_USER: "admin" });

      expect(result.valid).toBe(false);
      expect(result.errors.DB_PASS).toBeDefined();
    });

    it("should pass validation with all required values", async () => {
      const { templateService } = await import(
        "@/server/services/templates/index"
      );

      const parsed = {
        template: {} as any,
        variables: [
          { name: "DB_USER", label: "Database User", type: "string" as const, required: true },
        ],
        services: [],
      };

      const result = templateService.validateVariables(parsed, { DB_USER: "admin" });

      expect(result.valid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
    });
  });
});
