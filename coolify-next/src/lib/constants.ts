/**
 * Application constants
 */
export const APP_NAME = "Coolify";
export const APP_DESCRIPTION = "Self-hosted cloud platform";

/**
 * Default Docker images for databases
 */
export const DATABASE_IMAGES = {
  postgresql: "postgres:16-alpine",
  mysql: "mysql:8",
  mariadb: "mariadb:11",
  mongodb: "mongo:7",
  redis: "redis:7-alpine",
  clickhouse: "clickhouse/clickhouse-server:latest",
  keydb: "eqalpha/keydb:latest",
  dragonfly: "docker.dragonflydb.io/dragonflydb/dragonfly:latest",
} as const;

/**
 * Default ports for databases
 */
export const DATABASE_PORTS = {
  postgresql: 5432,
  mysql: 3306,
  mariadb: 3306,
  mongodb: 27017,
  redis: 6379,
  clickhouse: 8123,
  keydb: 6379,
  dragonfly: 6379,
} as const;

/**
 * Build pack options
 */
export const BUILD_PACKS = [
  { value: "nixpacks", label: "Nixpacks", description: "Auto-detect and build" },
  { value: "dockerfile", label: "Dockerfile", description: "Use custom Dockerfile" },
  { value: "dockercompose", label: "Docker Compose", description: "Multi-container apps" },
  { value: "dockerimage", label: "Docker Image", description: "Deploy existing image" },
  { value: "static", label: "Static", description: "Static HTML/JS sites" },
] as const;

/**
 * Proxy types
 */
export const PROXY_TYPES = [
  { value: "traefik", label: "Traefik", description: "Modern HTTP reverse proxy" },
  { value: "caddy", label: "Caddy", description: "Automatic HTTPS" },
  { value: "none", label: "None", description: "No reverse proxy" },
] as const;

/**
 * Container status colors
 */
export const STATUS_COLORS = {
  running: "text-green-500",
  starting: "text-yellow-500",
  restarting: "text-yellow-500",
  exited: "text-red-500",
  paused: "text-gray-500",
  dead: "text-red-700",
  created: "text-blue-500",
  removing: "text-orange-500",
} as const;

/**
 * Deployment status
 */
export const DEPLOYMENT_STATUS = {
  queued: { label: "Queued", color: "bg-gray-500" },
  in_progress: { label: "In Progress", color: "bg-blue-500" },
  finished: { label: "Finished", color: "bg-green-500" },
  failed: { label: "Failed", color: "bg-red-500" },
  cancelled: { label: "Cancelled", color: "bg-yellow-500" },
} as const;

/**
 * Default resource limits
 */
export const DEFAULT_LIMITS = {
  memory: "0", // 0 means no limit
  memorySwap: "0",
  cpus: "0",
  cpuShares: 1024,
} as const;

/**
 * Coolify directories on remote servers
 */
export const COOLIFY_DIRS = {
  base: "/data/coolify",
  applications: "/data/coolify/applications",
  databases: "/data/coolify/databases",
  services: "/data/coolify/services",
  backups: "/data/coolify/backups",
  proxy: "/data/coolify/proxy",
  ssh: "/data/coolify/ssh",
} as const;

/**
 * Network names
 */
export const NETWORKS = {
  coolify: "coolify",
} as const;

/**
 * API rate limits
 */
export const RATE_LIMITS = {
  api: {
    requests: 100,
    window: "1m",
  },
  auth: {
    requests: 10,
    window: "1m",
  },
  deploy: {
    requests: 10,
    window: "1m",
  },
} as const;
