"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Server,
  Plus,
  Search,
  MoreVertical,
  Settings,
  Trash2,
  RefreshCw,
  Terminal,
  HardDrive,
  Cpu,
  MemoryStick,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
} from "lucide-react";
import { trpc } from "@/components/providers/trpc-provider";
import { formatDistanceToNow } from "date-fns";

function getStatusBadge(status: string | null) {
  const classes = {
    reachable: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    unreachable: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    validating: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  };
  return classes[status as keyof typeof classes] || classes.unreachable;
}

function getServerStatus(server: { validationLogs?: string | null; unreachableCount?: number | null }) {
  if (server.validationLogs?.includes("success")) return "reachable";
  if (server.unreachableCount && server.unreachableCount > 0) return "unreachable";
  return "unknown";
}

export default function ServersPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: servers, isLoading, error, refetch } = trpc.servers.list.useQuery();
  const deleteServer = trpc.servers.delete.useMutation({
    onSuccess: () => refetch(),
  });

  const filteredServers = (servers ?? []).filter((server) => {
    const matchesSearch =
      server.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      server.ip.includes(searchQuery);

    if (statusFilter === "all") return matchesSearch;

    const status = getServerStatus(server);
    if (statusFilter === "online") return matchesSearch && status === "reachable";
    if (statusFilter === "offline") return matchesSearch && status === "unreachable";

    return matchesSearch;
  });

  const handleDelete = async (serverId: string) => {
    if (confirm("Are you sure you want to delete this server?")) {
      await deleteServer.mutateAsync({ serverId });
      setSelectedServer(null);
    }
  };

  if (error) {
    return (
      <div className="text-center py-12">
        <XCircle className="h-12 w-12 mx-auto text-red-500 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          Failed to load servers
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
            Servers
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            Manage your connected servers
          </p>
        </div>
        <Link
          href="/servers/new"
          className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
        >
          <Plus className="h-5 w-5 mr-2" />
          Add Server
        </Link>
      </div>

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search servers..."
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
          <option value="online">Online</option>
          <option value="offline">Offline</option>
        </select>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
        </div>
      )}

      {/* Server cards */}
      {!isLoading && filteredServers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredServers.map((server) => {
            const status = getServerStatus(server);
            const isOnline = status === "reachable";

            return (
              <div
                key={server.id}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-md transition-shadow"
              >
                {/* Card header */}
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                        <Server className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white">
                          {server.name}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {server.ip}:{server.port}
                        </p>
                      </div>
                    </div>
                    <div className="relative">
                      <button
                        onClick={() =>
                          setSelectedServer(
                            selectedServer === server.id ? null : server.id
                          )
                        }
                        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <MoreVertical className="h-5 w-5 text-gray-500" />
                      </button>
                      {selectedServer === server.id && (
                        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-10">
                          <Link
                            href={`/servers/${server.id}`}
                            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            <Settings className="h-4 w-4 mr-2" />
                            Settings
                          </Link>
                          <button className="w-full flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                            <Terminal className="h-4 w-4 mr-2" />
                            Terminal
                          </button>
                          <button className="w-full flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Validate
                          </button>
                          <button
                            onClick={() => handleDelete(server.id)}
                            disabled={deleteServer.isPending}
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
                        status
                      )}`}
                    >
                      {status}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {server.user}@{server.ip}
                    </span>
                  </div>

                  {server.description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                      {server.description}
                    </p>
                  )}

                  {!isOnline && (
                    <div className="flex flex-col items-center justify-center py-4 text-center">
                      <XCircle className="h-8 w-8 text-red-500 mb-2" />
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Server is unreachable
                      </p>
                      {server.lastOnlineAt && (
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          Last seen: {formatDistanceToNow(new Date(server.lastOnlineAt), { addSuffix: true })}
                        </p>
                      )}
                    </div>
                  )}

                  {isOnline && (
                    <div className="text-center py-4">
                      <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" />
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Server is reachable
                      </p>
                    </div>
                  )}
                </div>

                {/* Card footer */}
                <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">
                      Proxy: {server.proxyType || "none"}
                    </span>
                    <Link
                      href={`/servers/${server.id}`}
                      className="text-purple-600 dark:text-purple-400 hover:underline"
                    >
                      View Details &rarr;
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filteredServers.length === 0 && (
        <div className="text-center py-12">
          <Server className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No servers found
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {searchQuery
              ? "Try adjusting your search query"
              : "Get started by adding your first server"}
          </p>
          {!searchQuery && (
            <Link
              href="/servers/new"
              className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
            >
              <Plus className="h-5 w-5 mr-2" />
              Add Server
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
