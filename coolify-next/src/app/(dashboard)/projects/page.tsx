"use client";

import { useState } from "react";
import {
  FolderOpen,
  Plus,
  Search,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/components/providers/trpc-provider";

export default function ProjectsPage() {
  const [search, setSearch] = useState("");
  const projects = trpc.projects.list.useQuery();
  const utils = trpc.useUtils();

  const filtered = (projects.data ?? []).filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Projects</h1>
          <p className="text-muted-foreground">
            Organize your resources by project and environment
          </p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => utils.projects.list.invalidate()}
        >
          <RefreshCw className={`h-4 w-4 ${projects.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {projects.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border bg-card py-12">
          <FolderOpen className="h-12 w-12 text-muted-foreground" />
          <p className="mt-4 text-lg font-medium text-foreground">
            {search ? "No projects match your search" : "No projects yet"}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {search
              ? "Try a different search term"
              : "Create a project to start organizing your resources"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project) => (
            <div
              key={project.id}
              className="rounded-lg border bg-card p-6 shadow-sm transition-colors hover:bg-accent/50"
            >
              <h3 className="font-semibold text-foreground">{project.name}</h3>
              {project.description && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {project.description}
                </p>
              )}
              <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                <span>
                  {project.environments?.length ?? 0} environment
                  {(project.environments?.length ?? 0) !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
