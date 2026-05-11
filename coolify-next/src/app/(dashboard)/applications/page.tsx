"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Rocket,
  Plus,
  Search,
  MoreVertical,
  Settings,
  Trash2,
  RefreshCw,
  Play,
  Square,
  ExternalLink,
  GitBranch,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
} from "lucide-react";
import { trpc } from "@/components/providers/trpc-provider";
import { formatDistanceToNow } from "date-fns";

function getStatusIcon(status: string | null) {
  switch (status) {
    case "running":
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case "exited":
    case "stopped":
      return <XCircle className="h-5 w-5 text-red-500" />;
    case "starting":
    case "restarting":
      return <Clock className="h-5 w-5 text-yellow-500 animate-pulse" />;
    default:
      return <Clock className="h-5 w-5 text-gray-500" />;
  }
}

function getStatusBadge(status: string | null) {
  const classes: Record<string, string> = {
    running: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    exited: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    stopped: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    starting: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    restarting: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  };
  return classes[status ?? ""] || "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400";
}

export default function ApplicationsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedApp, setSelectedApp] = useState<string | null>(null);

  const { data: applications, isLoading, error, refetch } = trpc.applications.list.useQuery();
  const deleteApp = trpc.applications.delete.useMutation({
    onSuccess: () => refetch(),
  });

  const filteredApps = (applications ?? []).filter((app) => {
    const matchesSearch =
      app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (app.fqdn?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);

    if (statusFilter === "all") return matchesSearch;
    return matchesSearch && app.status === statusFilter;
  });

  const handleDelete = async (applicationId: string) => {
    if (confirm("Are you sure you want to delete this application?")) {
      await deleteApp.mutateAsync({ applicationId });
      setSelectedApp(null);
    }
  };

  if (error) {
    return (
      <div className="text-center py-12">
        <XCircle className="h-12 w-12 mx-auto text-red-500 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          Failed to load applications
        </h3>
        <p className="text-gray-500 dark:text-gray-400 mb-4">
          {error.message}
        </p>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
        >
          <RefreshCw className="h-5 w-5 mr-2" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Applications
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            Manage your deployed applications
          </p>
        </div>
        <Link
          href="/applications/new"
          className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
        >
          <Plus className="h-5 w-5 mr-2" />
          New Application
        </Link>
      </div>

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search applications..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="all">All Status</option>
          <option value="running">Running</option>
          <option value="exited">Stopped</option>
        </select>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
        </div>
      )}

      {/* Application cards */}
      {!isLoading && filteredApps.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredApps.map((app) => (
            <div
              key={app.id}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-md transition-shadow"
            >
              {/* Card header */}
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                      <Rocket className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">
                        {app.name}
                      </h3>
                      {app.fqdn && (
                        <a
                          href={`https://${app.fqdn}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-purple-600 dark:text-purple-400 hover:underline flex items-center"
                        >
                          {app.fqdn}
                          <ExternalLink className="h-3 w-3 ml-1" />
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="relative">
                    <button
                      onClick={() =>
                        setSelectedApp(selectedApp === app.id ? null : app.id)
                      }
                      className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <MoreVertical className="h-5 w-5 text-gray-500" />
                    </button>
                    {selectedApp === app.id && (
                      <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-10">
                        <Link
                          href={`/applications/${app.id}`}
                          className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <Settings className="h-4 w-4 mr-2" />
                          Settings
                        </Link>
                        <button className="w-full flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Redeploy
                        </button>
                        {app.status === "running" ? (
                          <button className="w-full flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                            <Square className="h-4 w-4 mr-2" />
                            Stop
                          </button>
                        ) : (
                          <button className="w-full flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                            <Play className="h-4 w-4 mr-2" />
                            Start
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(app.id)}
                          disabled={deleteApp.isPending}
                          className="w-full flex items-center px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Card body */}
              <div className="px-6 py-4">
                <div className="flex items-center justify-between mb-4">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(
                      app.status
                    )}`}
                  >
                    {getStatusIcon(app.status)}
                    <span className="ml-1">{app.status || "unknown"}</span>
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">
                    {app.buildPack}
                  </span>
                </div>

                {app.gitRepository && (
                  <div className="flex items-center text-sm text-gray-500 dark:text-gray-400 mb-2">
                    <GitBranch className="h-4 w-4 mr-2" />
                    <span className="truncate">{app.gitRepository}</span>
                  </div>
                )}

                {app.gitBranch && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 ml-6">
                    Branch: {app.gitBranch}
                    {app.gitCommitSha && ` (${app.gitCommitSha.slice(0, 7)})`}
                  </p>
                )}

                {app.description && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 truncate">
                    {app.description}
                  </p>
                )}
              </div>

              {/* Card footer */}
              <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">
                    {app.environment?.project?.name ?? "No project"} / {app.environment?.name ?? "No env"}
                  </span>
                  <Link
                    href={`/applications/${app.id}`}
                    className="text-purple-600 dark:text-purple-400 hover:underline"
                  >
                    View Details &rarr;
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filteredApps.length === 0 && (
        <div className="text-center py-12">
          <Rocket className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No applications found
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {searchQuery
              ? "Try adjusting your search query"
              : "Get started by deploying your first application"}
          </p>
          {!searchQuery && (
            <Link
              href="/applications/new"
              className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
            >
              <Plus className="h-5 w-5 mr-2" />
              New Application
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
