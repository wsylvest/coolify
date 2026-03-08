import * as fs from "fs/promises";
import * as path from "path";
import YAML from "yaml";
import { logger } from "@/lib/logger";
import { createId } from "@paralleldrive/cuid2";

export interface ServiceTemplate {
  id: string;
  name: string;
  description: string;
  documentation: string;
  logo?: string;
  tags: string[];
  minversion?: string;
  compose: DockerComposeTemplate;
}

export interface DockerComposeTemplate {
  version?: string;
  services: Record<string, ServiceDefinition>;
  networks?: Record<string, NetworkDefinition>;
  volumes?: Record<string, VolumeDefinition>;
}

export interface ServiceDefinition {
  image: string;
  environment?: Record<string, string> | string[];
  volumes?: string[];
  ports?: string[];
  depends_on?: string[] | Record<string, { condition: string }>;
  restart?: string;
  healthcheck?: {
    test: string | string[];
    interval?: string;
    timeout?: string;
    retries?: number;
    start_period?: string;
  };
  labels?: Record<string, string>;
  command?: string | string[];
  entrypoint?: string | string[];
  deploy?: {
    resources?: {
      limits?: { cpus?: string; memory?: string };
      reservations?: { cpus?: string; memory?: string };
    };
  };
}

export interface NetworkDefinition {
  external?: boolean;
  driver?: string;
  name?: string;
}

export interface VolumeDefinition {
  external?: boolean;
  driver?: string;
  name?: string;
}

export interface TemplateVariable {
  name: string;
  label: string;
  description?: string;
  type: "string" | "number" | "boolean" | "password" | "select";
  default?: string | number | boolean;
  required?: boolean;
  options?: { label: string; value: string }[];
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
  };
}

export interface ParsedTemplate {
  template: ServiceTemplate;
  variables: TemplateVariable[];
  services: {
    name: string;
    image: string;
    type: "application" | "database" | "cache" | "other";
    exposedPorts: number[];
    volumes: string[];
    environment: Record<string, string>;
  }[];
}

class TemplateService {
  private templatesDir: string;
  private templateCache: Map<string, ParsedTemplate> = new Map();

  constructor() {
    // Default templates directory - can be overridden
    this.templatesDir = process.env.TEMPLATES_DIR ?? "/templates/compose";
  }

  /**
   * Load all available templates
   */
  async loadTemplates(): Promise<ServiceTemplate[]> {
    const templates: ServiceTemplate[] = [];

    try {
      const files = await fs.readdir(this.templatesDir);
      const yamlFiles = files.filter(
        (f) => f.endsWith(".yaml") || f.endsWith(".yml")
      );

      for (const file of yamlFiles) {
        try {
          const template = await this.loadTemplate(file);
          if (template) {
            templates.push(template);
          }
        } catch (error) {
          logger.warn(`Failed to load template: ${file}`, { error });
        }
      }

      logger.info(`Loaded ${templates.length} service templates`);
      return templates;
    } catch (error) {
      logger.error("Failed to load templates", { error });
      return [];
    }
  }

  /**
   * Load a single template by filename
   */
  async loadTemplate(filename: string): Promise<ServiceTemplate | null> {
    const filePath = path.join(this.templatesDir, filename);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const parsed = YAML.parse(content);

      // Extract template metadata from comments or dedicated fields
      const template: ServiceTemplate = {
        id: filename.replace(/\.(yaml|yml)$/, ""),
        name: this.extractName(parsed, filename),
        description: parsed.description ?? "",
        documentation: parsed.documentation ?? "",
        logo: parsed.logo,
        tags: parsed.tags ?? [],
        minversion: parsed.minversion,
        compose: {
          version: parsed.version,
          services: parsed.services ?? {},
          networks: parsed.networks,
          volumes: parsed.volumes,
        },
      };

      return template;
    } catch (error) {
      logger.error(`Failed to load template: ${filename}`, { error });
      return null;
    }
  }

  /**
   * Parse a template and extract variables and service info
   */
  parseTemplate(template: ServiceTemplate): ParsedTemplate {
    // Check cache first
    if (this.templateCache.has(template.id)) {
      return this.templateCache.get(template.id)!;
    }

    const variables: TemplateVariable[] = [];
    const services: ParsedTemplate["services"] = [];

    // Extract variables from environment values
    const variablePattern = /\$\{?([A-Z_][A-Z0-9_]*)\}?/g;
    const seenVariables = new Set<string>();

    for (const [serviceName, service] of Object.entries(
      template.compose.services
    )) {
      // Determine service type
      const serviceType = this.inferServiceType(serviceName, service.image);

      // Extract exposed ports
      const exposedPorts: number[] = [];
      if (service.ports) {
        for (const port of service.ports) {
          const match = port.match(/:(\d+)/);
          if (match) {
            exposedPorts.push(parseInt(match[1], 10));
          }
        }
      }

      // Extract environment variables
      const environment: Record<string, string> = {};
      if (service.environment) {
        const envArray = Array.isArray(service.environment)
          ? service.environment
          : Object.entries(service.environment).map(
              ([k, v]) => `${k}=${v}`
            );

        for (const envStr of envArray) {
          const [key, ...valueParts] = envStr.split("=");
          const value = valueParts.join("=");

          if (key) {
            environment[key] = value;

            // Extract template variables
            const matches = value.matchAll(variablePattern);
            for (const match of matches) {
              const varName = match[1];
              if (varName && !seenVariables.has(varName)) {
                seenVariables.add(varName);
                variables.push(this.inferVariable(varName, key, value));
              }
            }
          }
        }
      }

      services.push({
        name: serviceName,
        image: service.image,
        type: serviceType,
        exposedPorts,
        volumes: service.volumes ?? [],
        environment,
      });
    }

    const parsed: ParsedTemplate = {
      template,
      variables,
      services,
    };

    // Cache the result
    this.templateCache.set(template.id, parsed);

    return parsed;
  }

  /**
   * Generate a deployable Docker Compose configuration from a template
   */
  generateComposeConfig(
    template: ServiceTemplate,
    variables: Record<string, string | number | boolean>,
    options: {
      projectName: string;
      network?: string;
      domainSuffix?: string;
    }
  ): DockerComposeTemplate {
    // Deep clone the template
    const config: DockerComposeTemplate = JSON.parse(
      JSON.stringify(template.compose)
    );

    // Replace variables in all services
    for (const service of Object.values(config.services)) {
      // Replace in environment
      if (service.environment) {
        if (Array.isArray(service.environment)) {
          service.environment = service.environment.map((env) =>
            this.replaceVariables(env, variables)
          );
        } else {
          for (const [key, value] of Object.entries(service.environment)) {
            service.environment[key] = this.replaceVariables(
              String(value),
              variables
            );
          }
        }
      }

      // Replace in image
      service.image = this.replaceVariables(service.image, variables);

      // Replace in command
      if (typeof service.command === "string") {
        service.command = this.replaceVariables(service.command, variables);
      } else if (Array.isArray(service.command)) {
        service.command = service.command.map((c) =>
          this.replaceVariables(c, variables)
        );
      }

      // Add Coolify labels
      service.labels = {
        ...service.labels,
        "coolify.managed": "true",
        "coolify.project": options.projectName,
        "coolify.template": template.id,
      };

      // Add to Coolify network
      if (options.network) {
        service.networks = [...(service.networks ?? []), options.network];
      }
    }

    // Add Coolify network to networks
    if (options.network) {
      config.networks = {
        ...config.networks,
        [options.network]: {
          external: true,
        },
      };
    }

    return config;
  }

  /**
   * Validate template variables
   */
  validateVariables(
    template: ParsedTemplate,
    values: Record<string, unknown>
  ): { valid: boolean; errors: Record<string, string> } {
    const errors: Record<string, string> = {};

    for (const variable of template.variables) {
      const value = values[variable.name];

      // Check required
      if (variable.required && (value === undefined || value === "")) {
        errors[variable.name] = `${variable.label} is required`;
        continue;
      }

      // Skip validation if not required and empty
      if (value === undefined || value === "") {
        continue;
      }

      // Type validation
      switch (variable.type) {
        case "number":
          if (typeof value !== "number" && isNaN(Number(value))) {
            errors[variable.name] = `${variable.label} must be a number`;
          } else if (variable.validation) {
            const num = Number(value);
            if (variable.validation.min !== undefined && num < variable.validation.min) {
              errors[variable.name] = `${variable.label} must be at least ${variable.validation.min}`;
            }
            if (variable.validation.max !== undefined && num > variable.validation.max) {
              errors[variable.name] = `${variable.label} must be at most ${variable.validation.max}`;
            }
          }
          break;

        case "string":
        case "password":
          if (variable.validation?.pattern) {
            const regex = new RegExp(variable.validation.pattern);
            if (!regex.test(String(value))) {
              errors[variable.name] = `${variable.label} has invalid format`;
            }
          }
          break;

        case "select":
          if (variable.options) {
            const validValues = variable.options.map((o) => o.value);
            if (!validValues.includes(String(value))) {
              errors[variable.name] = `${variable.label} must be one of: ${validValues.join(", ")}`;
            }
          }
          break;
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
    };
  }

  /**
   * Search templates by name, tags, or description
   */
  async searchTemplates(query: string): Promise<ServiceTemplate[]> {
    const templates = await this.loadTemplates();
    const lowerQuery = query.toLowerCase();

    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(lowerQuery) ||
        t.description.toLowerCase().includes(lowerQuery) ||
        t.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get template by ID
   */
  async getTemplateById(id: string): Promise<ServiceTemplate | null> {
    const templates = await this.loadTemplates();
    return templates.find((t) => t.id === id) ?? null;
  }

  /**
   * Get templates by tag
   */
  async getTemplatesByTag(tag: string): Promise<ServiceTemplate[]> {
    const templates = await this.loadTemplates();
    return templates.filter((t) =>
      t.tags.some((t) => t.toLowerCase() === tag.toLowerCase())
    );
  }

  // Helper methods

  private extractName(parsed: Record<string, unknown>, filename: string): string {
    // Try to extract name from template metadata or filename
    if (typeof parsed.name === "string") {
      return parsed.name;
    }

    // Convert filename to title case
    return filename
      .replace(/\.(yaml|yml)$/, "")
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private inferServiceType(
    serviceName: string,
    image: string
  ): "application" | "database" | "cache" | "other" {
    const lowerName = serviceName.toLowerCase();
    const lowerImage = image.toLowerCase();

    // Database patterns
    const dbPatterns = [
      "postgres",
      "mysql",
      "mariadb",
      "mongodb",
      "mongo",
      "sqlite",
      "cockroach",
      "clickhouse",
      "influxdb",
      "timescale",
    ];
    if (dbPatterns.some((p) => lowerName.includes(p) || lowerImage.includes(p))) {
      return "database";
    }

    // Cache patterns
    const cachePatterns = [
      "redis",
      "memcached",
      "keydb",
      "dragonfly",
      "valkey",
    ];
    if (cachePatterns.some((p) => lowerName.includes(p) || lowerImage.includes(p))) {
      return "cache";
    }

    return "application";
  }

  private inferVariable(
    varName: string,
    envKey: string,
    envValue: string
  ): TemplateVariable {
    const lowerName = varName.toLowerCase();
    const lowerKey = envKey.toLowerCase();

    // Determine type based on name patterns
    let type: TemplateVariable["type"] = "string";
    let required = true;

    // Password detection
    if (
      lowerName.includes("password") ||
      lowerName.includes("secret") ||
      lowerName.includes("key") ||
      lowerKey.includes("password") ||
      lowerKey.includes("secret")
    ) {
      type = "password";
    }

    // Boolean detection
    if (
      lowerName.includes("enable") ||
      lowerName.includes("disable") ||
      lowerName.includes("debug")
    ) {
      type = "boolean";
    }

    // Number detection
    if (lowerName.includes("port") || lowerName.includes("count") || lowerName.includes("limit")) {
      type = "number";
    }

    // Generate label from variable name
    const label = varName
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    // Extract default value if not a variable reference
    let defaultValue: string | undefined;
    if (!envValue.includes("$")) {
      defaultValue = envValue;
    }

    return {
      name: varName,
      label,
      type,
      required,
      default: defaultValue,
    };
  }

  private replaceVariables(
    value: string,
    variables: Record<string, string | number | boolean>
  ): string {
    return value.replace(
      /\$\{?([A-Z_][A-Z0-9_]*)\}?/g,
      (match, varName) => {
        const replacement = variables[varName];
        if (replacement !== undefined) {
          return String(replacement);
        }
        return match;
      }
    );
  }

  /**
   * Generate random values for password/secret variables
   */
  generateSecureDefaults(
    variables: TemplateVariable[]
  ): Record<string, string> {
    const defaults: Record<string, string> = {};

    for (const variable of variables) {
      if (variable.type === "password" && variable.required) {
        // Generate a secure random password
        defaults[variable.name] = this.generateSecurePassword();
      }
    }

    return defaults;
  }

  private generateSecurePassword(length = 32): string {
    const chars =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    const randomValues = new Uint32Array(length);
    crypto.getRandomValues(randomValues);
    return Array.from(randomValues)
      .map((v) => chars[v % chars.length])
      .join("");
  }
}

export const templateService = new TemplateService();
