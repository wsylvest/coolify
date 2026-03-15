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
  Activity,
  HardDrive,
  Cpu,
  MemoryStick,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";

// Mock data
const servers = [
  {
    id: "1",
    uuid: "srv-abc123",
    name: "Production Server",
    description: "Main production server",
    ip: "192.168.1.100",
    status: "online",
    proxyType: "traefik",
    cpu: 45,
    memory: 62,
    disk: 38,
    containers: 12,
    lastOnlineAt: "2024-01-15T10:30:00Z",
  },
  {
    id: "2",
    uuid: "srv-def456",
    name: "Staging Server",
    description: "Staging environment",
    ip: "192.168.1.101",
    status: "online",
    proxyType: "traefik",
    cpu: 23,
    memory: 41,
    disk: 55,
    containers: 8,
    lastOnlineAt: "2024-01-15T10:29:00Z",
  },
  {
    id: "3",
    uuid: "srv-ghi789",
    name: "Development Server",
    description: "Dev environment",
    ip: "192.168.1.102",
    status: "offline",
    proxyType: "caddy",
    cpu: 0,
    memory: 0,
    disk: 72,
    containers: 0,
    lastOnlineAt: "2024-01-14T18:00:00Z",
  },
  {
    id: "4",
    uuid: "srv-jkl012",
    name: "Database Server",
    description: "Dedicated database server",
    ip: "192.168.1.103",
    status: "online",
    proxyType: "none",
    cpu: 67,
    memory: 78,
    disk: 45,
    containers: 3,
    lastOnlineAt: "2024-01-15T10:30:00Z",
  },
];

function getStatusIcon(status: string) {
  switch (status) {
    case "online":
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case "offline":
      return <XCircle className="h-5 w-5 text-red-500" />;
    default:
      return <Clock className="h-5 w-5 text-yellow-500" />;
  }
}

function getStatusBadge(status: string) {
  const classes = {
    online: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    offline: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    validating: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  };
  return classes[status as keyof typeof classes] || classes.offline;
}

export default function ServersPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedServer, setSelectedServer] = useState<string | null>(null);

  const filteredServers = servers.filter(
    (server) =>
      server.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      server.ip.includes(searchQuery)
  );

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
        <button className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors">
          <Plus className="h-5 w-5 mr-2" />
          Add Server
        </button>
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
        <select className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
          <option value="all">All Status</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
        </select>
      </div>

      {/* Server cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredServers.map((server) => (
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
                      {server.ip}
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
                      <button className="w-full flex items-center px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700">
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
                    server.status
                  )}`}
                >
                  {server.status}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {server.containers} containers
                </span>
              </div>

              {server.status === "online" && (
                <div className="space-y-3">
                  {/* CPU */}
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center text-gray-500 dark:text-gray-400">
                        <Cpu className="h-4 w-4 mr-1" />
                        CPU
                      </div>
                      <span className="text-gray-900 dark:text-white">
                        {server.cpu}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${
                          server.cpu > 80
                            ? "bg-red-500"
                            : server.cpu > 60
                            ? "bg-yellow-500"
                            : "bg-green-500"
                        }`}
                        style={{ width: `${server.cpu}%` }}
                      />
                    </div>
                  </div>

                  {/* Memory */}
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center text-gray-500 dark:text-gray-400">
                        <MemoryStick className="h-4 w-4 mr-1" />
                        Memory
                      </div>
                      <span className="text-gray-900 dark:text-white">
                        {server.memory}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${
                          server.memory > 80
                            ? "bg-red-500"
                            : server.memory > 60
                            ? "bg-yellow-500"
                            : "bg-blue-500"
                        }`}
                        style={{ width: `${server.memory}%` }}
                      />
                    </div>
                  </div>

                  {/* Disk */}
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center text-gray-500 dark:text-gray-400">
                        <HardDrive className="h-4 w-4 mr-1" />
                        Disk
                      </div>
                      <span className="text-gray-900 dark:text-white">
                        {server.disk}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${
                          server.disk > 80
                            ? "bg-red-500"
                            : server.disk > 60
                            ? "bg-yellow-500"
                            : "bg-purple-500"
                        }`}
                        style={{ width: `${server.disk}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {server.status === "offline" && (
                <div className="flex flex-col items-center justify-center py-4 text-center">
                  <XCircle className="h-8 w-8 text-red-500 mb-2" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Server is offline
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    Last seen: {new Date(server.lastOnlineAt).toLocaleString()}
                  </p>
                </div>
              )}
            </div>

            {/* Card footer */}
            <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">
                  Proxy: {server.proxyType}
                </span>
                <Link
                  href={`/servers/${server.id}`}
                  className="text-purple-600 dark:text-purple-400 hover:underline"
                >
                  View Details →
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredServers.length === 0 && (
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
            <button className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors">
              <Plus className="h-5 w-5 mr-2" />
              Add Server
            </button>
          )}
        </div>
      )}
    </div>
  );
}
