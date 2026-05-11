/**
 * Kubernetes Service
 *
 * Handles Kubernetes cluster management and deployments.
 */

import { logger } from "@/lib/logger";
import * as https from "https";
import * as http from "http";

export interface KubernetesConfig {
  apiServer: string;
  token?: string;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  namespace?: string;
}

export interface KubernetesDeployment {
  name: string;
  namespace: string;
  replicas: number;
  image: string;
  ports: { containerPort: number; protocol?: string }[];
  env?: { name: string; value: string }[];
  resources?: {
    limits?: { cpu?: string; memory?: string };
    requests?: { cpu?: string; memory?: string };
  };
  labels?: Record<string, string>;
}

export interface KubernetesService {
  name: string;
  namespace: string;
  type: "ClusterIP" | "NodePort" | "LoadBalancer";
  selector: Record<string, string>;
  ports: { port: number; targetPort: number; protocol?: string; nodePort?: number }[];
}

export interface KubernetesPod {
  name: string;
  namespace: string;
  status: string;
  phase: string;
  hostIP: string;
  podIP: string;
  startTime: string;
  containers: {
    name: string;
    image: string;
    ready: boolean;
    restartCount: number;
  }[];
}

class KubernetesService {
  private config: KubernetesConfig | null = null;

  /**
   * Initialize connection to Kubernetes cluster
   */
  async connect(config: KubernetesConfig): Promise<void> {
    this.config = {
      ...config,
      namespace: config.namespace ?? "default",
    };

    // Test connection
    await this.getNamespaces();
    logger.info("Connected to Kubernetes cluster", { apiServer: config.apiServer });
  }

  /**
   * Make authenticated request to Kubernetes API
   */
  private async apiRequest<T>(
    method: string,
    path: string,
    body?: object
  ): Promise<T> {
    if (!this.config) {
      throw new Error("Kubernetes not configured");
    }

    const url = new URL(path, this.config.apiServer);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }

    const agent = new https.Agent({
      ca: this.config.caCert,
      cert: this.config.clientCert,
      key: this.config.clientKey,
      rejectUnauthorized: !!this.config.caCert,
    });

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      // @ts-expect-error - agent not in standard fetch types
      agent: url.protocol === "https:" ? agent : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Kubernetes API error: ${response.status} ${text}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get all namespaces
   */
  async getNamespaces(): Promise<string[]> {
    const result = await this.apiRequest<{
      items: { metadata: { name: string } }[];
    }>("GET", "/api/v1/namespaces");

    return result.items.map((ns) => ns.metadata.name);
  }

  /**
   * Create or update a namespace
   */
  async ensureNamespace(name: string): Promise<void> {
    try {
      await this.apiRequest("GET", `/api/v1/namespaces/${name}`);
    } catch {
      await this.apiRequest("POST", "/api/v1/namespaces", {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name },
      });
      logger.info("Created Kubernetes namespace", { name });
    }
  }

  /**
   * Deploy an application
   */
  async deploy(deployment: KubernetesDeployment): Promise<void> {
    const namespace = deployment.namespace || this.config?.namespace || "default";

    // Ensure namespace exists
    await this.ensureNamespace(namespace);

    const deploymentManifest = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: deployment.name,
        namespace,
        labels: {
          app: deployment.name,
          "app.kubernetes.io/managed-by": "coolify",
          ...deployment.labels,
        },
      },
      spec: {
        replicas: deployment.replicas,
        selector: {
          matchLabels: { app: deployment.name },
        },
        template: {
          metadata: {
            labels: {
              app: deployment.name,
              ...deployment.labels,
            },
          },
          spec: {
            containers: [
              {
                name: deployment.name,
                image: deployment.image,
                ports: deployment.ports,
                env: deployment.env,
                resources: deployment.resources,
              },
            ],
          },
        },
      },
    };

    // Try to update, create if not exists
    try {
      await this.apiRequest(
        "PUT",
        `/apis/apps/v1/namespaces/${namespace}/deployments/${deployment.name}`,
        deploymentManifest
      );
      logger.info("Updated Kubernetes deployment", { name: deployment.name, namespace });
    } catch {
      await this.apiRequest(
        "POST",
        `/apis/apps/v1/namespaces/${namespace}/deployments`,
        deploymentManifest
      );
      logger.info("Created Kubernetes deployment", { name: deployment.name, namespace });
    }
  }

  /**
   * Create or update a service
   */
  async createService(service: KubernetesService): Promise<void> {
    const namespace = service.namespace || this.config?.namespace || "default";

    const serviceManifest = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: service.name,
        namespace,
        labels: {
          "app.kubernetes.io/managed-by": "coolify",
        },
      },
      spec: {
        type: service.type,
        selector: service.selector,
        ports: service.ports,
      },
    };

    try {
      await this.apiRequest(
        "PUT",
        `/api/v1/namespaces/${namespace}/services/${service.name}`,
        serviceManifest
      );
    } catch {
      await this.apiRequest(
        "POST",
        `/api/v1/namespaces/${namespace}/services`,
        serviceManifest
      );
    }

    logger.info("Created/updated Kubernetes service", { name: service.name, namespace });
  }

  /**
   * Get pods for a deployment
   */
  async getPods(deploymentName: string, namespace?: string): Promise<KubernetesPod[]> {
    const ns = namespace || this.config?.namespace || "default";

    const result = await this.apiRequest<{
      items: {
        metadata: { name: string; namespace: string };
        status: {
          phase: string;
          hostIP: string;
          podIP: string;
          startTime: string;
          containerStatuses?: {
            name: string;
            image: string;
            ready: boolean;
            restartCount: number;
          }[];
        };
      }[];
    }>("GET", `/api/v1/namespaces/${ns}/pods?labelSelector=app=${deploymentName}`);

    return result.items.map((pod) => ({
      name: pod.metadata.name,
      namespace: pod.metadata.namespace,
      status: pod.status.phase,
      phase: pod.status.phase,
      hostIP: pod.status.hostIP,
      podIP: pod.status.podIP,
      startTime: pod.status.startTime,
      containers:
        pod.status.containerStatuses?.map((c) => ({
          name: c.name,
          image: c.image,
          ready: c.ready,
          restartCount: c.restartCount,
        })) ?? [],
    }));
  }

  /**
   * Scale a deployment
   */
  async scale(deploymentName: string, replicas: number, namespace?: string): Promise<void> {
    const ns = namespace || this.config?.namespace || "default";

    await this.apiRequest(
      "PATCH",
      `/apis/apps/v1/namespaces/${ns}/deployments/${deploymentName}/scale`,
      {
        spec: { replicas },
      }
    );

    logger.info("Scaled Kubernetes deployment", { name: deploymentName, replicas });
  }

  /**
   * Delete a deployment and its service
   */
  async deleteDeployment(name: string, namespace?: string): Promise<void> {
    const ns = namespace || this.config?.namespace || "default";

    // Delete deployment
    try {
      await this.apiRequest("DELETE", `/apis/apps/v1/namespaces/${ns}/deployments/${name}`);
      logger.info("Deleted Kubernetes deployment", { name, namespace: ns });
    } catch (error) {
      logger.warn("Failed to delete deployment", { name, error });
    }

    // Delete service
    try {
      await this.apiRequest("DELETE", `/api/v1/namespaces/${ns}/services/${name}`);
      logger.info("Deleted Kubernetes service", { name, namespace: ns });
    } catch {
      // Service may not exist
    }
  }

  /**
   * Get deployment status
   */
  async getDeploymentStatus(
    name: string,
    namespace?: string
  ): Promise<{
    ready: boolean;
    replicas: number;
    availableReplicas: number;
    unavailableReplicas: number;
  }> {
    const ns = namespace || this.config?.namespace || "default";

    const result = await this.apiRequest<{
      status: {
        replicas: number;
        availableReplicas: number;
        unavailableReplicas: number;
        readyReplicas: number;
      };
    }>("GET", `/apis/apps/v1/namespaces/${ns}/deployments/${name}`);

    return {
      ready: result.status.readyReplicas === result.status.replicas,
      replicas: result.status.replicas || 0,
      availableReplicas: result.status.availableReplicas || 0,
      unavailableReplicas: result.status.unavailableReplicas || 0,
    };
  }

  /**
   * Get pod logs
   */
  async getLogs(
    podName: string,
    namespace?: string,
    options?: { container?: string; tailLines?: number }
  ): Promise<string> {
    const ns = namespace || this.config?.namespace || "default";
    let path = `/api/v1/namespaces/${ns}/pods/${podName}/log`;

    const params = new URLSearchParams();
    if (options?.container) params.set("container", options.container);
    if (options?.tailLines) params.set("tailLines", options.tailLines.toString());

    if (params.toString()) {
      path += `?${params.toString()}`;
    }

    const result = await this.apiRequest<string>("GET", path);
    return result;
  }

  /**
   * Create an ingress for a service
   */
  async createIngress(options: {
    name: string;
    namespace?: string;
    host: string;
    serviceName: string;
    servicePort: number;
    tlsEnabled?: boolean;
    tlsSecretName?: string;
    annotations?: Record<string, string>;
  }): Promise<void> {
    const namespace = options.namespace || this.config?.namespace || "default";

    const ingressManifest = {
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: {
        name: options.name,
        namespace,
        labels: {
          "app.kubernetes.io/managed-by": "coolify",
        },
        annotations: {
          "kubernetes.io/ingress.class": "nginx",
          ...options.annotations,
        },
      },
      spec: {
        rules: [
          {
            host: options.host,
            http: {
              paths: [
                {
                  path: "/",
                  pathType: "Prefix",
                  backend: {
                    service: {
                      name: options.serviceName,
                      port: { number: options.servicePort },
                    },
                  },
                },
              ],
            },
          },
        ],
        ...(options.tlsEnabled && {
          tls: [
            {
              hosts: [options.host],
              secretName: options.tlsSecretName || `${options.name}-tls`,
            },
          ],
        }),
      },
    };

    try {
      await this.apiRequest(
        "PUT",
        `/apis/networking.k8s.io/v1/namespaces/${namespace}/ingresses/${options.name}`,
        ingressManifest
      );
    } catch {
      await this.apiRequest(
        "POST",
        `/apis/networking.k8s.io/v1/namespaces/${namespace}/ingresses`,
        ingressManifest
      );
    }

    logger.info("Created/updated Kubernetes ingress", { name: options.name, host: options.host });
  }
}

export const kubernetesService = new KubernetesService();
