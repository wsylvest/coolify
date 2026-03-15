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
} from "lucide-react";

// Mock data
const databases = [
  {
    id: "1",
    uuid: "db-abc123",
    name: "postgres-main",
    type: "postgresql",
    version: "15.4",
    project: "E-Commerce Platform",
    environment: "production",
    status: "running",
    size: "2.4 GB",
    connections: 12,
    lastBackupAt: "2024-01-15T06:00:00Z",
  },
  {
    id: "2",
    uuid: "db-def456",
    name: "redis-cache",
    type: "redis",
    version: "7.2",
    project: "E-Commerce Platform",
    environment: "production",
    status: "running",
    size: "512 MB",
    connections: 45,
    lastBackupAt: null,
  },
  {
    id: "3",
    uuid: "db-ghi789",
    name: "mysql-legacy",
    type: "mysql",
    version: "8.0",
    project: "Internal Tools",
    environment: "production",
    status: "stopped",
    size: "1.8 GB",
    connections: 0,
    lastBackupAt: "2024-01-14T06:00:00Z",
  },
  {
    id: "4",
    uuid: "db-jkl012",
    name: "mongodb-analytics",
    type: "mongodb",
    version: "7.0",
    project: "Analytics Dashboard",
    environment: "production",
    status: "running",
    size: "5.2 GB",
    connections: 8,
    lastBackupAt: "2024-01-15T06:00:00Z",
  },
];

const databaseIcons: Record<string, string> = {
  postgresql: "🐘",
  mysql: "🐬",
  mariadb: "🦭",
  mongodb: "🍃",
  redis: "🔴",
  clickhouse: "🏠",
};

function getStatusBadge(status: string) {
  const classes = {
    running: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    stopped: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };
  return classes[status as keyof typeof classes] || "bg-gray-100 text-gray-800";
}

export default function DatabasesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const filteredDatabases = databases.filter((db) => {
    const matchesSearch =
      db.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      db.project.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === "all" || db.type === typeFilter;
    return matchesSearch && matchesType;
  });

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
        <button className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors">
          <Plus className="h-5 w-5 mr-2" />
          New Database
        </button>
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
          <option value="postgresql">PostgreSQL</option>
          <option value="mysql">MySQL</option>
          <option value="mongodb">MongoDB</option>
          <option value="redis">Redis</option>
        </select>
      </div>

      {/* Database cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredDatabases.map((db) => (
          <div
            key={db.id}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-md transition-shadow"
          >
            {/* Card header */}
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="text-2xl">
                    {databaseIcons[db.type] || "📦"}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                      {db.name}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {db.type} {db.version}
                    </p>
                  </div>
                </div>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(
                    db.status
                  )}`}
                >
                  {db.status === "running" ? (
                    <CheckCircle className="h-3.5 w-3.5 mr-1" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 mr-1" />
                  )}
                  {db.status}
                </span>
              </div>
            </div>

            {/* Card body */}
            <div className="px-6 py-4">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                    Size
                  </p>
                  <div className="flex items-center text-gray-900 dark:text-white">
                    <HardDrive className="h-4 w-4 mr-1.5 text-gray-400" />
                    {db.size}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                    Connections
                  </p>
                  <p className="text-gray-900 dark:text-white">
                    {db.connections} active
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">Project</span>
                  <span className="text-gray-900 dark:text-white">{db.project}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">Environment</span>
                  <span className="text-gray-900 dark:text-white capitalize">
                    {db.environment}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">Last Backup</span>
                  <span className="text-gray-900 dark:text-white">
                    {db.lastBackupAt
                      ? new Date(db.lastBackupAt).toLocaleDateString()
                      : "Never"}
                  </span>
                </div>
              </div>
            </div>

            {/* Card footer */}
            <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {db.status === "running" ? (
                    <button
                      className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                      title="Stop"
                    >
                      <Square className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors"
                      title="Start"
                    >
                      <Play className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded-lg transition-colors"
                    title="Backup"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <button
                    className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    title="Terminal"
                  >
                    <Terminal className="h-4 w-4" />
                  </button>
                </div>
                <Link
                  href={`/databases/${db.id}`}
                  className="text-sm text-purple-600 dark:text-purple-400 hover:underline"
                >
                  View Details →
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredDatabases.length === 0 && (
        <div className="text-center py-12">
          <Database className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No databases found
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {searchQuery || typeFilter !== "all"
              ? "Try adjusting your filters"
              : "Get started by creating your first database"}
          </p>
          {!searchQuery && typeFilter === "all" && (
            <button className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors">
              <Plus className="h-5 w-5 mr-2" />
              New Database
            </button>
          )}
        </div>
      )}
    </div>
  );
}
