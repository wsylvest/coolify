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
  Play,
  Square,
  RefreshCw,
  ExternalLink,
  GitBranch,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";

// Mock data
const applications = [
  {
    id: "1",
    uuid: "app-abc123",
    name: "API Gateway",
    project: "E-Commerce Platform",
    environment: "production",
    status: "running",
    buildPack: "nixpacks",
    gitRepository: "org/api-gateway",
    branch: "main",
    domain: "api.example.com",
    lastDeployedAt: "2024-01-15T10:30:00Z",
    deploymentStatus: "completed",
  },
  {
    id: "2",
    uuid: "app-def456",
    name: "Web Frontend",
    project: "E-Commerce Platform",
    environment: "production",
    status: "running",
    buildPack: "nixpacks",
    gitRepository: "org/web-frontend",
    branch: "main",
    domain: "www.example.com",
    lastDeployedAt: "2024-01-15T09:00:00Z",
    deploymentStatus: "completed",
  },
  {
    id: "3",
    uuid: "app-ghi789",
    name: "Worker Service",
    project: "E-Commerce Platform",
    environment: "production",
    status: "stopped",
    buildPack: "dockerfile",
    gitRepository: "org/worker-service",
    branch: "main",
    domain: null,
    lastDeployedAt: "2024-01-14T18:00:00Z",
    deploymentStatus: "failed",
  },
  {
    id: "4",
    uuid: "app-jkl012",
    name: "Analytics Backend",
    project: "Analytics Dashboard",
    environment: "production",
    status: "deploying",
    buildPack: "nixpacks",
    gitRepository: "org/analytics-backend",
    branch: "main",
    domain: "analytics-api.example.com",
    lastDeployedAt: "2024-01-15T10:35:00Z",
    deploymentStatus: "in_progress",
  },
];

function getStatusIcon(status: string) {
  switch (status) {
    case "running":
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case "stopped":
      return <XCircle className="h-5 w-5 text-red-500" />;
    case "deploying":
      return <Loader2 className="h-5 w-5 text-yellow-500 animate-spin" />;
    default:
      return <Clock className="h-5 w-5 text-gray-500" />;
  }
}

function getStatusBadge(status: string) {
  const classes = {
    running: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    stopped: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    deploying: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  };
  return classes[status as keyof typeof classes] || "bg-gray-100 text-gray-800";
}

export default function ApplicationsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");

  const filteredApplications = applications.filter((app) => {
    const matchesSearch =
      app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.project.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.gitRepository.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || app.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

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
        <button className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors">
          <Plus className="h-5 w-5 mr-2" />
          New Application
        </button>
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
          <option value="stopped">Stopped</option>
          <option value="deploying">Deploying</option>
        </select>
      </div>

      {/* Applications table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Application
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Project / Environment
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Domain
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Last Deployed
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredApplications.map((app) => (
                <tr
                  key={app.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg mr-3">
                        <Rocket className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div>
                        <Link
                          href={`/applications/${app.id}`}
                          className="font-medium text-gray-900 dark:text-white hover:text-purple-600 dark:hover:text-purple-400"
                        >
                          {app.name}
                        </Link>
                        <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                          <GitBranch className="h-3.5 w-3.5 mr-1" />
                          {app.gitRepository} / {app.branch}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900 dark:text-white">
                      {app.project}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {app.environment}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(
                        app.status
                      )}`}
                    >
                      {getStatusIcon(app.status)}
                      <span className="ml-1.5 capitalize">{app.status}</span>
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {app.domain ? (
                      <a
                        href={`https://${app.domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center text-sm text-purple-600 dark:text-purple-400 hover:underline"
                      >
                        {app.domain}
                        <ExternalLink className="h-3.5 w-3.5 ml-1" />
                      </a>
                    ) : (
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        No domain
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900 dark:text-white">
                      {new Date(app.lastDeployedAt).toLocaleDateString()}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {new Date(app.lastDeployedAt).toLocaleTimeString()}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end space-x-2">
                      {app.status === "running" ? (
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
                        title="Redeploy"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>
                      <Link
                        href={`/applications/${app.id}/settings`}
                        className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        title="Settings"
                      >
                        <Settings className="h-4 w-4" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filteredApplications.length === 0 && (
        <div className="text-center py-12">
          <Rocket className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No applications found
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {searchQuery || statusFilter !== "all"
              ? "Try adjusting your filters"
              : "Get started by deploying your first application"}
          </p>
          {!searchQuery && statusFilter === "all" && (
            <button className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors">
              <Plus className="h-5 w-5 mr-2" />
              New Application
            </button>
          )}
        </div>
      )}
    </div>
  );
}
