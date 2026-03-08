# Coolify Next - Migration Roadmap

## Overview

This document outlines the complete migration strategy from Coolify (Laravel/PHP) to Coolify Next (Next.js/TypeScript/Rust). The goal is to create a modern, scalable, cloud-native platform that matches and exceeds the capabilities of the original.

## Technology Stack

### Frontend
| Technology | Purpose | Rationale |
|------------|---------|-----------|
| **Next.js 14** | Framework | App Router, Server Components, Edge Runtime |
| **React 18** | UI Library | Concurrent features, Suspense |
| **TypeScript 5** | Language | Type safety, better DX |
| **Tailwind CSS 4** | Styling | Utility-first, consistent with original |
| **shadcn/ui** | Components | Accessible, customizable, Radix-based |
| **TanStack Query** | Data Fetching | Caching, background updates |
| **Zustand** | State Management | Lightweight, TypeScript-first |

### Backend
| Technology | Purpose | Rationale |
|------------|---------|-----------|
| **Next.js API Routes** | REST API | Co-located with frontend |
| **tRPC** | Type-safe API | End-to-end type safety |
| **Drizzle ORM** | Database | Type-safe, performant, PostgreSQL |
| **PostgreSQL 16** | Database | ACID, JSON support, proven |
| **Redis 7** | Cache/Queue | Pub/Sub, job queues |
| **BullMQ** | Job Queue | Redis-based, reliable |

### Infrastructure
| Technology | Purpose | Rationale |
|------------|---------|-----------|
| **Docker** | Containerization | Consistent environments |
| **V8 Isolates** | Sandboxed Execution | Secure code execution |
| **WebAssembly** | Performance-critical | SSH/crypto operations |
| **ssh2** | SSH Client | Node.js native SSH |
| **Dockerode** | Docker API | Container management |

### Observability
| Technology | Purpose | Rationale |
|------------|---------|-----------|
| **OpenTelemetry** | Tracing/Metrics | Vendor-agnostic |
| **Pino** | Logging | Fast, structured |
| **Prometheus** | Metrics | Industry standard |
| **Grafana** | Dashboards | Visualization |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         COOLIFY NEXT                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    FRONTEND (Next.js)                    │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐   │   │
│  │  │Dashboard│ │Servers  │ │Projects │ │Applications │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────────┘   │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐   │   │
│  │  │Databases│ │Services │ │Settings │ │   Teams     │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    API LAYER (tRPC)                      │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │   │
│  │  │  Auth    │ │  Server  │ │  Deploy  │ │ Database │   │   │
│  │  │  Router  │ │  Router  │ │  Router  │ │  Router  │   │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   SERVICE LAYER                          │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │   │
│  │  │   SSH    │ │  Docker  │ │  Proxy   │ │  Queue   │   │   │
│  │  │ Service  │ │ Service  │ │ Service  │ │ Service  │   │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  PostgreSQL  │  │    Redis     │  │    BullMQ Workers    │  │
│  │   Database   │  │ Cache/PubSub │  │   (Deployments)      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Migration Phases

### Phase 1: Foundation (Week 1-2)
**Goal**: Establish project structure, database schema, and authentication

| Task | Priority | Status | Laravel Equivalent |
|------|----------|--------|-------------------|
| Project setup (Next.js, TypeScript, Tailwind) | P0 | Pending | - |
| Database schema (Drizzle migrations) | P0 | Pending | 268 migrations |
| Authentication (NextAuth.js) | P0 | Pending | Fortify |
| Team/User management | P0 | Pending | Team model |
| Base UI components (shadcn) | P0 | Pending | Blade components |

### Phase 2: Core Infrastructure (Week 3-4)
**Goal**: Server management and SSH execution

| Task | Priority | Status | Laravel Equivalent |
|------|----------|--------|-------------------|
| Server model & CRUD | P0 | Pending | Server.php |
| SSH connection service | P0 | Pending | SshMultiplexingHelper |
| Private key management | P0 | Pending | PrivateKey model |
| Server validation | P0 | Pending | ValidateServer action |
| Docker installation | P1 | Pending | InstallDocker action |

### Phase 3: Project Management (Week 5-6)
**Goal**: Projects, environments, and resources

| Task | Priority | Status | Laravel Equivalent |
|------|----------|--------|-------------------|
| Project CRUD | P0 | Pending | Project model |
| Environment management | P0 | Pending | Environment model |
| Destination (Docker) setup | P0 | Pending | StandaloneDocker |
| Resource navigation | P1 | Pending | Livewire components |

### Phase 4: Application Deployment (Week 7-10)
**Goal**: Full application deployment pipeline

| Task | Priority | Status | Laravel Equivalent |
|------|----------|--------|-------------------|
| Application model | P0 | Pending | Application.php |
| Git source integration | P0 | Pending | GithubApp, GitlabApp |
| Build pack support (Nixpacks) | P0 | Pending | Build pack enums |
| Dockerfile builds | P0 | Pending | Dockerfile support |
| Docker Compose deployments | P1 | Pending | dockercompose pack |
| Deployment queue/jobs | P0 | Pending | ApplicationDeploymentJob |
| Deployment logs streaming | P0 | Pending | Real-time logs |
| Health checks | P1 | Pending | Health check config |
| Rollback support | P1 | Pending | Deployment history |

### Phase 5: Database Services (Week 11-12)
**Goal**: Managed database deployments

| Task | Priority | Status | Laravel Equivalent |
|------|----------|--------|-------------------|
| PostgreSQL deployments | P0 | Pending | StandalonePostgresql |
| MySQL/MariaDB deployments | P0 | Pending | StandaloneMysql |
| Redis deployments | P0 | Pending | StandaloneRedis |
| MongoDB deployments | P1 | Pending | StandaloneMongodb |
| Database backups | P0 | Pending | ScheduledDatabaseBackup |
| Database proxy | P1 | Pending | StartDatabaseProxy |

### Phase 6: Proxy & Networking (Week 13-14) ✅
**Goal**: Reverse proxy and domain management

| Task | Priority | Status | Laravel Equivalent |
|------|----------|--------|-------------------|
| Traefik integration | P0 | **Done** | Proxy actions |
| Caddy integration | P1 | **Done** | ProxyTypes enum |
| SSL/TLS certificates | P0 | **Done** | SslHelper |
| Domain management | P0 | **Done** | FQDN handling |
| Wildcard domains | P1 | **Done** | Wildcard support |

### Phase 7: Services & Templates (Week 15-16) ✅
**Goal**: One-click service deployments

| Task | Priority | Status | Laravel Equivalent |
|------|----------|--------|-------------------|
| Service model | P0 | **Done** | Service.php |
| Template parser | P0 | **Done** | templates/compose/ |
| Service deployments | P0 | **Done** | StartService action |
| 100+ service templates | P1 | Pending | YAML templates |

### Phase 8: Real-time & Notifications (Week 17-18) ✅
**Goal**: Live updates and alerts

| Task | Priority | Status | Laravel Equivalent |
|------|----------|--------|-------------------|
| WebSocket server | P0 | **Done** | Soketi/Pusher |
| Real-time container status | P0 | **Done** | ServerCheck action |
| Email notifications | P0 | **Done** | Email notifications |
| Slack/Discord/Telegram | P1 | **Done** | Notification channels |
| Webhook support | P1 | **Done** | Webhook routes |

### Phase 9: API & Integrations (Week 19-20) ✅
**Goal**: External API and webhooks

| Task | Priority | Status | Laravel Equivalent |
|------|----------|--------|-------------------|
| REST API v1 | P0 | **Done** | routes/api.php |
| API authentication | P0 | **Done** | Sanctum |
| GitHub webhooks | P0 | **Done** | GitHub controller |
| GitLab webhooks | P1 | **Done** | GitLab controller |
| Bitbucket/Gitea webhooks | P2 | Pending | Other webhooks |

### Phase 10: Advanced Features (Week 21-24)
**Goal**: Enterprise features and optimization

| Task | Priority | Status | Laravel Equivalent |
|------|----------|--------|-------------------|
| Scheduled tasks | P1 | Pending | ScheduledTask model |
| Activity logging | P1 | Pending | Spatie Activity Log |
| S3 storage integration | P1 | Pending | S3Storage model |
| Kubernetes support | P2 | Pending | Kubernetes model |
| Swarm mode | P2 | Pending | SwarmDocker |
| Cloudflare tunnels | P2 | Pending | ConfigureCloudflared |

---

## Database Schema Mapping

### Core Models

| Laravel Model | Drizzle Table | Notes |
|---------------|---------------|-------|
| User | users | Auth, profile, 2FA |
| Team | teams | Multi-tenancy |
| TeamInvitation | team_invitations | Invite system |
| Project | projects | Project container |
| Environment | environments | Env grouping |
| Server | servers | Remote servers |
| PrivateKey | private_keys | SSH keys |

### Application Models

| Laravel Model | Drizzle Table | Notes |
|---------------|---------------|-------|
| Application | applications | App deployments |
| ApplicationDeploymentQueue | deployment_queue | Job queue |
| ApplicationPreview | application_previews | PR previews |
| ApplicationSetting | application_settings | App config |

### Database Models

| Laravel Model | Drizzle Table | Notes |
|---------------|---------------|-------|
| StandalonePostgresql | databases | type: postgresql |
| StandaloneMysql | databases | type: mysql |
| StandaloneMariadb | databases | type: mariadb |
| StandaloneRedis | databases | type: redis |
| StandaloneMongodb | databases | type: mongodb |
| ScheduledDatabaseBackup | database_backups | Backup config |

### Service Models

| Laravel Model | Drizzle Table | Notes |
|---------------|---------------|-------|
| Service | services | Docker Compose |
| ServiceApplication | service_applications | Service apps |
| ServiceDatabase | service_databases | Service DBs |

---

## File Structure

```
coolify-next/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (auth)/            # Auth routes (login, register)
│   │   ├── (dashboard)/       # Protected dashboard routes
│   │   │   ├── servers/       # Server management
│   │   │   ├── projects/      # Project management
│   │   │   ├── applications/  # Application deployments
│   │   │   ├── databases/     # Database management
│   │   │   ├── services/      # Service deployments
│   │   │   ├── settings/      # User/team settings
│   │   │   └── page.tsx       # Dashboard home
│   │   ├── api/               # API routes
│   │   │   ├── trpc/          # tRPC handler
│   │   │   ├── webhooks/      # GitHub/GitLab webhooks
│   │   │   └── v1/            # REST API v1
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── ui/                # shadcn/ui components
│   │   ├── forms/             # Form components
│   │   ├── tables/            # Data tables
│   │   ├── modals/            # Modal dialogs
│   │   └── layouts/           # Layout components
│   ├── server/
│   │   ├── api/               # tRPC routers
│   │   │   ├── routers/       # Domain routers
│   │   │   ├── trpc.ts        # tRPC setup
│   │   │   └── root.ts        # Root router
│   │   ├── db/
│   │   │   ├── schema/        # Drizzle schemas
│   │   │   ├── migrations/    # SQL migrations
│   │   │   └── index.ts       # DB client
│   │   ├── services/          # Business logic
│   │   │   ├── ssh/           # SSH operations
│   │   │   ├── docker/        # Docker operations
│   │   │   ├── deployment/    # Deployment logic
│   │   │   ├── proxy/         # Proxy management
│   │   │   └── notification/  # Notifications
│   │   ├── queue/             # BullMQ jobs
│   │   │   ├── workers/       # Job workers
│   │   │   └── jobs/          # Job definitions
│   │   └── auth/              # Auth utilities
│   ├── lib/
│   │   ├── utils.ts           # Utility functions
│   │   ├── constants.ts       # App constants
│   │   └── validations/       # Zod schemas
│   ├── hooks/                 # React hooks
│   ├── stores/                # Zustand stores
│   └── types/                 # TypeScript types
├── templates/                 # Docker Compose templates
├── workers/                   # Background workers
├── docker/                    # Docker configs
├── tests/                     # Test files
├── drizzle.config.ts
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── docker-compose.yml
```

---

## Quality Standards

### Code Quality
- TypeScript strict mode enabled
- ESLint with strict rules
- Prettier for formatting
- 100% type coverage on public APIs
- No `any` types except for external libraries

### Testing
- Unit tests with Vitest
- Integration tests with Playwright
- API tests with supertest
- Minimum 80% code coverage

### Performance
- Core Web Vitals targets: LCP < 2.5s, FID < 100ms, CLS < 0.1
- Server response time < 200ms (p95)
- Deployment time competitive with original

### Security
- OWASP Top 10 compliance
- Rate limiting on all endpoints
- Input validation with Zod
- SQL injection prevention (parameterized queries)
- XSS prevention (React's built-in escaping)

---

## Success Criteria

### MVP (Phase 1-5)
- [ ] User can register/login
- [ ] User can add a server via SSH
- [ ] User can create projects/environments
- [ ] User can deploy an application from Git
- [ ] User can deploy a database
- [ ] Basic monitoring and logs

### Full Feature Parity (Phase 6-9)
- [ ] All 100+ service templates working
- [ ] Proxy configuration (Traefik/Caddy)
- [ ] SSL certificates auto-provisioned
- [ ] Webhooks for CI/CD
- [ ] Multi-channel notifications
- [ ] Full REST API

### Enhanced (Phase 10+)
- [ ] Improved performance over original
- [ ] Better observability
- [ ] Enhanced security features
- [ ] Kubernetes support
- [ ] Multi-region deployments
