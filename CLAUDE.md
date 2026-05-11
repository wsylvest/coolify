# CLAUDE.md - AI Assistant Guide for Coolify

This document provides guidance for AI assistants working with the Coolify codebase.

## Project Overview

**Coolify** is an open-source, self-hostable alternative to Heroku/Netlify/Vercel. It enables users to manage servers, deploy applications, and run databases on their own infrastructure via SSH connections.

- **Website**: https://coolify.io
- **License**: Apache-2.0
- **Main Repository**: https://github.com/coollabsio/coolify

## Technology Stack

### Backend
- **Framework**: Laravel 12 (PHP 8.4)
- **Database**: PostgreSQL 15
- **Cache/Queue**: Redis 7 with Laravel Horizon
- **WebSockets**: Soketi (Pusher-compatible)

### Frontend
- **Reactive UI**: Livewire 3 + Alpine.js
- **Templating**: Blade
- **Styling**: Tailwind CSS 4
- **Build Tool**: Vite
- **Components**: Monaco Editor (code), XTerm.js (terminal)

### Infrastructure
- **Containers**: Docker & Docker Compose
- **Web Server**: Nginx
- **Process Manager**: S6 Overlay
- **CI/CD**: GitHub Actions

## Directory Structure

```
coolify/
├── app/                    # Application core
│   ├── Actions/           # Domain-driven action classes (server, database, proxy, etc.)
│   ├── Console/Commands/  # Artisan CLI commands
│   ├── Data/              # Data Transfer Objects
│   ├── Enums/             # Application enums
│   ├── Events/            # Domain events
│   ├── Exceptions/        # Exception handlers
│   ├── Helpers/           # Helper classes (SSH, SSL)
│   ├── Http/
│   │   ├── Controllers/   # API and webhook controllers
│   │   └── Middleware/    # Request middleware
│   ├── Jobs/              # Queue jobs (deployments, backups, notifications)
│   ├── Listeners/         # Event listeners
│   ├── Livewire/          # Livewire components (UI)
│   ├── Models/            # Eloquent models
│   ├── Notifications/     # Multi-channel notifications
│   ├── Policies/          # Authorization policies
│   ├── Providers/         # Service providers
│   ├── Services/          # Business logic services
│   ├── Traits/            # Reusable traits
│   └── View/Components/   # Blade view components
├── bootstrap/             # Application bootstrapping
├── config/                # Configuration files
├── database/
│   ├── factories/         # Model factories for testing
│   ├── migrations/        # Database migrations
│   └── seeders/           # Database seeders
├── docker/                # Docker configurations
│   ├── coolify-helper/    # Helper container
│   ├── coolify-realtime/  # WebSocket server (Node.js + Soketi)
│   ├── development/       # Development Dockerfile
│   ├── production/        # Production Dockerfile with S6 overlay
│   └── testing-host/      # Docker-in-Docker test environment
├── hooks/                 # Git hooks (pre-commit with Pint)
├── lang/                  # Translation files
├── public/                # Public assets
├── resources/
│   ├── css/               # Stylesheets
│   ├── js/                # JavaScript
│   └── views/             # Blade templates
├── routes/
│   ├── api.php            # REST API v1 routes
│   ├── channels.php       # WebSocket broadcast channels
│   ├── console.php        # Console/scheduled commands
│   ├── web.php            # Web routes (Livewire pages)
│   └── webhooks.php       # External webhook routes
├── scripts/               # Installation and maintenance scripts
├── storage/               # Application storage
├── templates/compose/     # 100+ Docker Compose templates for services
└── tests/
    ├── Browser/           # Laravel Dusk browser tests
    ├── Feature/           # Feature tests
    └── Unit/              # Unit tests
```

## Key Architectural Patterns

### 1. Actions Pattern
Business logic is encapsulated in Action classes using `lorisleiva/laravel-actions`:

```php
use Lorisleiva\Actions\Concerns\AsAction;

class ServerCheck
{
    use AsAction;

    public function handle(Server $server, $data = null)
    {
        // Business logic here
    }
}

// Usage:
ServerCheck::run($server);
ServerCheck::dispatch($server); // As a job
```

**Action directories by domain**:
- `App\Actions\Server\` - Server operations
- `App\Actions\Database\` - Database management
- `App\Actions\Application\` - Application lifecycle
- `App\Actions\Service\` - Service management
- `App\Actions\Proxy\` - Traefik/Caddy proxy

### 2. Livewire Components
UI components are Livewire 3 classes with reactive properties:

```php
use Livewire\Component;
use Livewire\Attributes\Locked;
use Livewire\Attributes\Validate;

class ServerShow extends Component
{
    #[Locked]
    public Server $server;

    #[Validate('required|string')]
    public string $name;

    public function save()
    {
        $this->validate();
        // Save logic
    }
}
```

### 3. Model Relationships
Key model hierarchy:
- **Team** → has many **Projects** → has many **Environments**
- **Environment** → has many **Applications**, **Services**, **Databases**
- **Server** → has many **Destinations** (Docker/Swarm/Kubernetes)
- All resources use **UUID** for external identification (CUID2 format)

### 4. Event-Driven Architecture
Domain events trigger real-time UI updates:
```php
// Events: ApplicationStatusChanged, DatabaseStatusChanged, etc.
event(new ApplicationStatusChanged($application));
```

### 5. Polymorphic Relationships
Resources like storage and destinations use polymorphic relationships:
```php
// Destination can be StandaloneDocker, SwarmDocker, or Kubernetes
$application->destination(); // MorphTo relationship
```

## Development Setup

### Prerequisites
- Docker or Docker Desktop
- [Spin](https://serversideup.net/open-source/spin/) (development tool)

### Quick Start
```bash
# 1. Copy environment file
cp .env.development.example .env

# 2. Start development environment
spin up

# 3. Access the application
# URL: http://localhost:8000
# Login: test@example.com
# Password: password
```

### Development Services
| Service | URL | Purpose |
|---------|-----|---------|
| Coolify | http://localhost:8000 | Main application |
| Mailpit | http://localhost:8025 | Email testing |
| Laravel Horizon | http://localhost:8000/horizon | Queue monitoring |
| Telescope | http://localhost:8000/telescope | Debug tool (enable in .env) |

### Common Commands
```bash
# Run database migrations
docker exec -it coolify php artisan migrate

# Reset database with seed data
docker exec -it coolify php artisan migrate:fresh --seed

# Run tests
docker exec -it coolify php artisan test

# Format code (Laravel Pint)
./vendor/bin/pint
```

## Code Style & Conventions

### PHP Standards
- **Formatter**: Laravel Pint (PSR-12 based)
- **Pre-commit hook**: Automatically formats staged PHP files
- Configuration: `pint.json` uses Laravel preset

### Naming Conventions
- **Models**: Singular PascalCase (`Application`, `Server`)
- **Actions**: Verb + Noun (`StartDatabase`, `ServerCheck`)
- **Jobs**: Noun + Job suffix (`ApplicationDeploymentJob`)
- **Events**: Entity + Action + Past tense (`ApplicationStatusChanged`)
- **Livewire**: Path-based naming matching route (`Project/Application/Configuration`)

### Database Conventions
- Primary keys: `id` (auto-increment)
- External identifiers: `uuid` (CUID2 format)
- Timestamps: `created_at`, `updated_at`
- Soft deletes: `deleted_at` where applicable
- Foreign keys: `{model}_id` with cascading deletes
- Flexible data: Schemaless JSON columns (Spatie)

### API Design
- Version prefix: `/api/v1/`
- Authentication: Laravel Sanctum (token-based)
- Abilities: `read`, `write`, `deploy`
- Response format: JSON with consistent structure

## Important Files to Know

### Configuration
- `config/constants.php` - Application constants, paths, defaults
- `config/horizon.php` - Queue worker configuration
- `.env.development.example` - Development environment template

### Entry Points
- `routes/web.php` - All web routes (Livewire pages)
- `routes/api.php` - REST API endpoints
- `routes/webhooks.php` - GitHub/GitLab/Stripe webhooks

### Key Models
- `app/Models/Server.php` - Server management
- `app/Models/Application.php` - Application deployments
- `app/Models/Service.php` - Docker Compose services
- `app/Models/Team.php` - Multi-tenancy

### Deployment Logic
- `app/Jobs/ApplicationDeploymentJob.php` - Main deployment job
- `app/Actions/Server/ServerCheck.php` - Server health monitoring
- `app/Services/ConfigurationGenerator.php` - Docker config generation

## Testing

### Test Frameworks
- **Unit/Feature**: Pest PHP
- **Browser**: Laravel Dusk

### Running Tests
```bash
# All tests
docker exec -it coolify php artisan test

# Specific test file
docker exec -it coolify php artisan test tests/Feature/DockerComposeParseTest.php

# Browser tests (requires Selenium)
docker exec -it coolify php artisan dusk
```

### Test Database
Tests use in-memory SQLite (`DB_CONNECTION=testing` in phpunit.xml).

## Git Workflow

### Branch Strategy
- **main**: Production releases
- **next**: Development branch (target for PRs)

### Pull Request Requirements
1. Target the `next` branch, not `main`
2. List all changes in PR description
3. Reference related issues (`fix #123`)
4. Test changes locally
5. Consider backwards compatibility

### Commit Messages
Keep commits focused and descriptive. The pre-commit hook will format PHP code automatically.

## Docker & Containers

### Development Containers
Defined in `docker-compose.dev.yml`:
- `coolify` - Main Laravel application
- `postgres` - Database
- `redis` - Cache and queues
- `soketi` - WebSocket server
- `vite` - Frontend build server
- `mailpit` - Email catcher
- `minio` - S3-compatible storage (optional)
- `testing-host` - Docker-in-Docker for testing

### Production Build
The production Dockerfile (`docker/production/Dockerfile`) uses:
- Multi-stage build for optimization
- S6 Overlay for process supervision
- Nginx for web serving
- Horizon for queue processing

## Service Templates

The `templates/compose/` directory contains 100+ pre-built Docker Compose configurations for deploying popular services like:
- Databases: PostgreSQL, MySQL, MongoDB, Redis
- CMS: WordPress, Ghost, Strapi
- DevOps: Gitea, Jenkins, n8n
- Monitoring: Grafana, Prometheus, Uptime Kuma
- And many more...

## Troubleshooting

### Reset Development Environment
```bash
# Stop containers
docker rm coolify coolify-db coolify-redis coolify-realtime coolify-testing-host coolify-minio coolify-vite-1 coolify-mail

# Remove volumes
docker volume rm coolify_dev_backups_data coolify_dev_postgres_data coolify_dev_redis_data coolify_dev_coolify_data coolify_dev_minio_data

# Restart
spin up
docker exec -it coolify php artisan migrate:fresh --seed
```

### Common Issues
1. **Database connection errors**: Check `DB_HOST` in `.env` matches container networking
2. **Permission errors on macOS**: Use `sudo spin up`
3. **Queue not processing**: Check Horizon is running at `/horizon`
4. **WebSocket issues**: Verify Soketi container is running

## Additional Resources

- [Contributing Guide](CONTRIBUTING.md)
- [Tech Stack Details](TECH_STACK.md)
- [Adding New Services](https://coolify.io/docs/get-started/contribute/service)
- [API Documentation](openapi.yaml)
- [Discord Community](https://coollabs.io/discord) - #contribute channel
