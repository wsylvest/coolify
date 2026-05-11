"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Database,
  Plus,
  Search,
  MoreVertical,
  Settings,
  Trash2,
  Play,
  Square,
  Download,
  Terminal,
  CheckCircle,
  XCircle,
  HardDrive,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { trpc } from "@/components/providers/trpc-provider";
import { formatDistanceToNow } from "date-fns";

const DB_ICONS: Record<string, string> = {
  postgresql: "P",
  mysql: "M",
  mariadb: "Ma",
  redis: "R",
  mongodb: "Mo",
  keydb: "K",
  dragonfly: "D",
  clickhouse: "C",
};

const DB_COLORS: Record<string, string> = {
  postgresql: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  mysql: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
  mariadb: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
  redis: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  mongodb: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
  keydb: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  dragonfly: "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
  clickhouse: "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400",
};

function getStatusIcon(status: string | null) {
  switch (status) {
    case "running":
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case "exited":
    case "stopped":
      return <XCircle className="h-5 w-5 text-red-500" />;
    default:
      return <HardDrive className="h-5 w-5 text-gray-500" />;
  }
}

function getStatusBadge(status: string | null) {
  const classes: Record<string, string> = {
    running: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    exited: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    stopped: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };
  return classes[status ?? ""] || "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400";
}

export default function DatabasesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedDb, setSelectedDb] = useState<string | null>(null);

  const { data: databases, isLoading, error, refetch } = trpc.databases.list.useQuery();
  const deleteDb = trpc.databases.delete.useMutation({
    onSuccess: () => refetch(),
  });

  const filteredDbs = (databases ?? []).filter((db) => {
    const matchesSearch =
      db.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      db.type.toLowerCase().includes(searchQuery.toLowerCase());

    if (typeFilter === "all") return matchesSearch;
    return matchesSearch && db.type === typeFilter;
  });

  const dbTypes = [...new Set((databases ?? []).map((db) => db.type))];

  const handleDelete = async (databaseId: string) => {
    if (confirm("Are you sure you want to delete this database? This action cannot be undone.")) {
      await deleteDb.mutateAsync({ databaseId });
      setSelectedDb(null);
    }
  };

  if (error) {
    return (
      <div className="text-center py-12">
        <XCircle className="h-12 w-12 mx-auto text-red-500 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          Failed to load databases
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
            Databases
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            Manage your database instances
          </p>
        </div>
        <Link
          href="/databases/new"
          className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
        >
          <Plus className="h-5 w-5 mr-2" />
          New Database
        </Link>
      </div>

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search databases..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="all">All Types</option>
          {dbTypes.map((type) => (
            <option key={type} value={type}>
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
        </div>
      )}

      {/* Database cards */}
      {!isLoading && filteredDbs.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredDbs.map((db) => (
            <div
              key={db.id}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-md transition-shadow"
            >
              {/* Card header */}
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm ${
                        DB_COLORS[db.type] || "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {DB_ICONS[db.type] || "DB"}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">
                        {db.name}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {db.type} {db.dbVersion && `v${db.dbVersion}`}
                      </p>
                    </div>
                  </div>
                  <div className="relative">
                    <button
                      onClick={() =>
                        setSelectedDb(selectedDb === db.id ? null : db.id)
                      }
                      className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <MoreVertical className="h-5 w-5 text-gray-500" />
                    </button>
                    {selectedDb === db.id && (
                      <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-10">
                        <Link
                          href={`/databases/${db.id}`}
                          className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <Settings className="h-4 w-4 mr-2" />
                          Settings
                        </Link>
                        <button className="w-full flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                          <Terminal className="h-4 w-4 mr-2" />
                          Console
                        </button>
                        <button className="w-full flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                          <Download className="h-4 w-4 mr-2" />
                          Backup Now
                        </button>
                        {db.status === "running" ? (
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
                          onClick={() => handleDelete(db.id)}
                          disabled={deleteDb.isPending}
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
                      db.status
                    )}`}
                  >
                    {getStatusIcon(db.status)}
                    <span className="ml-1">{db.status || "unknown"}</span>
                  </span>
                  {db.publicPort && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Port: {db.publicPort}
                    </span>
                  )}
                </div>

                {db.description && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-2 truncate">
                    {db.description}
                  </p>
                )}

                <div className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
                  {db.dbName && (
                    <p>
                      Database: <span className="font-mono">{db.dbName}</span>
                    </p>
                  )}
                  {db.dbUser && (
                    <p>
                      User: <span className="font-mono">{db.dbUser}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Card footer */}
              <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">
                    {db.environment?.project?.name ?? "No project"} / {db.environment?.name ?? "No env"}
                  </span>
                  <Link
                    href={`/databases/${db.id}`}
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
      {!isLoading && filteredDbs.length === 0 && (
        <div className="text-center py-12">
          <Database className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No databases found
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {searchQuery
              ? "Try adjusting your search query"
              : "Get started by creating your first database"}
          </p>
          {!searchQuery && (
            <Link
              href="/databases/new"
              className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
            >
              <Plus className="h-5 w-5 mr-2" />
              New Database
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
