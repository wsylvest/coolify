# Coolify Next

A modern rewrite of [Coolify](https://coolify.io) - an open-source, self-hostable alternative to Heroku, Netlify, and Vercel.

## Technology Stack

### Frontend
- **Next.js 14** - React framework with App Router
- **React 18** - UI library with concurrent features
- **TypeScript 5** - Type-safe JavaScript
- **Tailwind CSS 4** - Utility-first CSS
- **shadcn/ui** - Accessible component library
- **TanStack Query** - Data fetching and caching

### Backend
- **tRPC** - End-to-end type-safe API
- **Drizzle ORM** - Type-safe database access
- **PostgreSQL 16** - Primary database
- **Redis 7** - Cache and job queue
- **BullMQ** - Background job processing

### Infrastructure
- **Docker** - Container runtime
- **SSH2** - Remote server management
- **Socket.IO** - Real-time updates

## Getting Started

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- PostgreSQL 16
- Redis 7

### Installation

```bash
# Clone the repository
git clone https://github.com/coollabsio/coolify.git
cd coolify/coolify-next

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start development services
docker compose up -d postgres redis

# Run database migrations
npm run db:push

# Start development server
npm run dev
```

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://coolify:password@localhost:5432/coolify_next

# Redis
REDIS_URL=redis://localhost:6379

# Authentication
AUTH_SECRET=your-32-char-secret-key
AUTH_URL=http://localhost:3000

# OAuth (optional)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

## Project Structure

```
coolify-next/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (auth)/            # Authentication pages
│   │   ├── (dashboard)/       # Protected dashboard
│   │   └── api/               # API routes
│   ├── components/
│   │   ├── ui/                # shadcn/ui components
│   │   └── providers/         # React providers
│   ├── server/
│   │   ├── api/               # tRPC routers
│   │   ├── db/                # Drizzle schema
│   │   ├── services/          # Business logic
│   │   └── queue/             # BullMQ jobs
│   ├── lib/                   # Utilities
│   └── hooks/                 # React hooks
├── docker-compose.yml
├── Dockerfile
└── package.json
```

## Features

### Implemented
- [x] Database schema (PostgreSQL with Drizzle)
- [x] Authentication (NextAuth.js)
- [x] Team management
- [x] Server management
- [x] Project/Environment structure
- [x] Application deployment API
- [x] Database deployment API
- [x] Service deployment API
- [x] SSH service for remote execution
- [x] Docker service for container management
- [x] Background job queue (BullMQ)

### Planned
- [ ] Real-time WebSocket updates
- [ ] Proxy configuration (Traefik/Caddy)
- [ ] SSL certificate management
- [ ] GitHub/GitLab webhooks
- [ ] Multi-channel notifications
- [ ] Service templates (100+)
- [ ] Kubernetes support
- [ ] OpenTelemetry observability

## API

The API is built with tRPC for end-to-end type safety:

```typescript
// Client usage
import { trpc } from "@/components/providers/trpc-provider";

// Query
const { data: servers } = trpc.servers.list.useQuery();

// Mutation
const createServer = trpc.servers.create.useMutation();
await createServer.mutateAsync({
  name: "My Server",
  ip: "192.168.1.1",
  port: 22,
  user: "root",
  privateKeyId: "key-id",
});
```

## Development

```bash
# Run development server
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint

# Format code
npm run format

# Run tests
npm run test

# Database migrations
npm run db:generate  # Generate migration
npm run db:migrate   # Apply migrations
npm run db:studio    # Open Drizzle Studio
```

## Docker Deployment

```bash
# Build and start all services
docker compose up -d

# View logs
docker compose logs -f app

# Run migrations
docker compose exec app npm run db:push
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License

Apache-2.0 License - see [LICENSE](../LICENSE) for details.

## Credits

This is a modern rewrite of the original [Coolify](https://github.com/coollabsio/coolify) project created by [Andras Bacsai](https://github.com/andrasbacsai).
