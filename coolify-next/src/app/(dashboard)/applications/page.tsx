"use client";

import { useState } from "react";
import {
  Rocket,
  Plus,
  Search,
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/components/providers/trpc-provider";

export default function ApplicationsPage() {
  const [search, setSearch] = useState("");
  const applications = trpc.applications.list.useQuery();
  const utils = trpc.useUtils();

  const filtered = (applications.data ?? []).filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.gitRepository ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Applications</h1>
          <p className="text-muted-foreground">
            Deploy and manage your applications
          </p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New Application
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search applications..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => utils.applications.list.invalidate()}
        >
          <RefreshCw className={`h-4 w-4 ${applications.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {applications.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border bg-card py-12">
          <Rocket className="h-12 w-12 text-muted-foreground" />
          <p className="mt-4 text-lg font-medium text-foreground">
            {search ? "No applications match your search" : "No applications yet"}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {search
              ? "Try a different search term"
              : "Create an application to deploy from Git or Docker"}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-sm text-muted-foreground">
                <th className="px-6 py-3 font-medium">Name</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Build Pack</th>
                <th className="px-6 py-3 font-medium">Repository</th>
                <th className="px-6 py-3 font-medium">Domain</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((app) => (
                <tr key={app.id} className="hover:bg-accent/50">
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-medium text-foreground">{app.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {app.environment?.project?.name} / {app.environment?.name}
                      </p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={app.status ?? "exited"} />
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {app.buildPack}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {app.gitRepository ? (
                      <span>
                        {app.gitRepository}
                        {app.gitBranch ? `:${app.gitBranch}` : ""}
                      </span>
                    ) : (
                      <span className="italic">No repo</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {app.fqdn ? (
                      <a
                        href={app.fqdn.startsWith("http") ? app.fqdn : `https://${app.fqdn}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary hover:underline"
                      >
                        {app.fqdn.replace(/^https?:\/\//, "")}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    running: "bg-green-500/10 text-green-500",
    exited: "bg-red-500/10 text-red-500",
    in_progress: "bg-yellow-500/10 text-yellow-500",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${styles[status] ?? styles.exited}`}
    >
      {status === "running" && <CheckCircle className="mr-1 h-3 w-3" />}
      {status === "exited" && <XCircle className="mr-1 h-3 w-3" />}
      {status}
    </span>
  );
}
