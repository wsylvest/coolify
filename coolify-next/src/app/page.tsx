import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-background to-muted">
      <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
        {/* Logo */}
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-xl bg-coolify-500 flex items-center justify-center">
            <span className="text-3xl font-bold text-white">C</span>
          </div>
          <h1 className="text-5xl font-bold tracking-tight text-foreground">
            Coolify
          </h1>
        </div>

        {/* Tagline */}
        <p className="text-center text-xl text-muted-foreground max-w-2xl">
          An open-source & self-hostable alternative to Heroku, Netlify, and
          Vercel. Deploy your applications, databases, and services on your own
          infrastructure.
        </p>

        {/* Features */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl">
          <FeatureCard
            title="Deploy Anything"
            description="Applications, databases, services - deploy anything with Docker"
          />
          <FeatureCard
            title="Your Infrastructure"
            description="Use your own servers - VPS, bare metal, or cloud"
          />
          <FeatureCard
            title="Automatic SSL"
            description="Free SSL certificates with Let's Encrypt"
          />
          <FeatureCard
            title="Git Integration"
            description="Deploy from GitHub, GitLab, or any Git repository"
          />
          <FeatureCard
            title="Real-time Logs"
            description="Watch your deployments and containers in real-time"
          />
          <FeatureCard
            title="100+ Templates"
            description="One-click deployment for popular services"
          />
        </div>

        {/* CTA */}
        <div className="flex gap-4">
          <Link href="/login">
            <Button size="lg" variant="default">
              Get Started
            </Button>
          </Link>
          <Link href="/register">
            <Button size="lg" variant="outline">
              Create Account
            </Button>
          </Link>
        </div>

        {/* Tech Stack */}
        <div className="text-center text-sm text-muted-foreground">
          <p>
            Built with Next.js, TypeScript, Tailwind CSS, PostgreSQL, and Redis
          </p>
          <p className="mt-2">Coolify Next - A modern rewrite of Coolify</p>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-card-foreground">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
