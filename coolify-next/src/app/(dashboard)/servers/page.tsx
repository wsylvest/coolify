"use client";

import { useState } from "react";
import {
  Server,
  Plus,
  Search,
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/components/providers/trpc-provider";

export default function ServersPage() {
  const [search, setSearch] = useState("");
  const servers = trpc.servers.list.useQuery();
  const utils = trpc.useUtils();

  const filtered = (servers.data ?? []).filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.ip.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Servers</h1>
          <p className="text-muted-foreground">Manage your remote servers</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Server
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search servers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => utils.servers.list.invalidate()}
        >
          <RefreshCw className={`h-4 w-4 ${servers.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {servers.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border bg-card py-12">
          <Server className="h-12 w-12 text-muted-foreground" />
          <p className="mt-4 text-lg font-medium text-foreground">
            {search ? "No servers match your search" : "No servers yet"}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {search
              ? "Try a different search term"
              : "Add a server to start deploying"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((server) => (
            <div
              key={server.id}
              className="rounded-lg border bg-card p-6 shadow-sm transition-colors hover:bg-accent/50"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {server.isReachable ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-500" />
                  )}
                  <div>
                    <h3 className="font-semibold text-foreground">
                      {server.name}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {server.ip}:{server.port}
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="capitalize">{server.proxyType}</span>
                <span className="capitalize">{server.validationStatus}</span>
                {server.isBuildServer && (
                  <span className="rounded bg-blue-500/10 px-2 py-0.5 text-blue-500">
                    Build
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
