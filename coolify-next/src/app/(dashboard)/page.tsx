"use client";

import {
  Server,
  Rocket,
  Database,
  Boxes,
  Activity,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";
import { trpc } from "@/components/providers/trpc-provider";

export default function DashboardPage() {
  const servers = trpc.servers.list.useQuery();
  const applications = trpc.applications.list.useQuery();
  const databases = trpc.databases.list.useQuery();
  const services = trpc.services.list.useQuery();

  const isLoading =
    servers.isLoading ||
    applications.isLoading ||
    databases.isLoading ||
    services.isLoading;

  const stats = [
    {
      name: "Servers",
      value: servers.data?.length ?? 0,
      icon: Server,
      running: servers.data?.filter((s) => s.isReachable).length ?? 0,
    },
    {
      name: "Applications",
      value: applications.data?.length ?? 0,
      icon: Rocket,
      running: applications.data?.filter((a) => a.status === "running").length ?? 0,
    },
    {
      name: "Databases",
      value: databases.data?.length ?? 0,
      icon: Database,
      running: databases.data?.filter((d) => d.status === "running").length ?? 0,
    },
    {
      name: "Services",
      value: services.data?.length ?? 0,
      icon: Boxes,
      running: services.data?.filter((s) => s.status === "running").length ?? 0,
    },
  ];

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your infrastructure</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.name}
            className="rounded-lg border bg-card p-6 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">
                {stat.name}
              </p>
              <stat.icon className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="mt-2 text-3xl font-bold text-foreground">
              {stat.value}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {stat.running} running
            </p>
          </div>
        ))}
      </div>

      {/* Recent Applications */}
      <div className="rounded-lg border bg-card shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">Applications</h2>
        </div>
        <div className="divide-y">
          {(applications.data ?? []).length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">
              No applications yet. Create one to get started.
            </div>
          ) : (
            (applications.data ?? []).slice(0, 10).map((app) => (
              <div
                key={app.id}
                className="flex items-center justify-between px-6 py-3"
              >
                <div className="flex items-center gap-3">
                  <StatusDot status={app.status ?? "exited"} />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {app.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {app.environment?.project?.name} / {app.environment?.name}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">
                  {app.buildPack}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Servers */}
      <div className="rounded-lg border bg-card shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">Servers</h2>
        </div>
        <div className="divide-y">
          {(servers.data ?? []).length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">
              No servers yet. Add one to get started.
            </div>
          ) : (
            (servers.data ?? []).map((server) => (
              <div
                key={server.id}
                className="flex items-center justify-between px-6 py-3"
              >
                <div className="flex items-center gap-3">
                  <StatusDot
                    status={server.isReachable ? "running" : "exited"}
                  />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {server.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {server.ip}:{server.port}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground capitalize">
                  {server.validationStatus}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "running"
      ? "bg-green-500"
      : status === "in_progress"
        ? "bg-yellow-500"
        : "bg-red-500";

  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}
