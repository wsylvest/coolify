"use client";

import {
  Server,
  Rocket,
  Database,
  Boxes,
  Activity,
  ArrowUp,
  ArrowDown,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { trpc } from "@/components/providers/trpc-provider";
import { formatDistanceToNow } from "date-fns";

function getStatusIcon(status: string) {
  switch (status) {
    case "finished":
    case "completed":
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case "failed":
      return <XCircle className="h-5 w-5 text-red-500" />;
    case "in_progress":
    case "queued":
      return <Clock className="h-5 w-5 text-yellow-500 animate-pulse" />;
    default:
      return <AlertTriangle className="h-5 w-5 text-gray-500" />;
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case "running":
    case "reachable":
      return "bg-green-500";
    case "unreachable":
    case "offline":
    case "exited":
      return "bg-red-500";
    default:
      return "bg-gray-500";
  }
}

function formatTime(date: Date | string | null | undefined) {
  if (!date) return "Unknown";
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true });
  } catch {
    return "Unknown";
  }
}

export default function DashboardPage() {
  // Fetch data from tRPC
  const { data: servers, isLoading: serversLoading } = trpc.servers.list.useQuery();
  const { data: applications, isLoading: appsLoading } = trpc.applications.list.useQuery();
  const { data: databases, isLoading: dbsLoading } = trpc.databases.list.useQuery();
  const { data: services, isLoading: servicesLoading } = trpc.services.list.useQuery();
  const { data: recentDeployments, isLoading: deploymentsLoading } = trpc.deployments.listRecent.useQuery({ limit: 5 });

  const isLoading = serversLoading || appsLoading || dbsLoading || servicesLoading || deploymentsLoading;

  // Compute stats
  const stats = [
    {
      name: "Servers",
      value: servers?.length ?? 0,
      icon: Server,
      change: "",
      changeType: "neutral" as const,
    },
    {
      name: "Applications",
      value: applications?.length ?? 0,
      icon: Rocket,
      change: "",
      changeType: "neutral" as const,
    },
    {
      name: "Databases",
      value: databases?.length ?? 0,
      icon: Database,
      change: "",
      changeType: "neutral" as const,
    },
    {
      name: "Services",
      value: services?.length ?? 0,
      icon: Boxes,
      change: "",
      changeType: "neutral" as const,
    },
  ];

  // Get online/offline servers for status display
  const serverStatus = (servers ?? []).slice(0, 3).map((server) => ({
    id: server.id,
    name: server.name,
    status: server.validationLogs?.includes("success") ? "online" : "offline",
    ip: server.ip,
  }));

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Dashboard
        </h1>
        <p className="text-gray-500 dark:text-gray-400">
          Overview of your infrastructure
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.name}
            className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  {stat.name}
                </p>
                {isLoading ? (
                  <Loader2 className="h-8 w-8 animate-spin text-gray-400 mt-2" />
                ) : (
                  <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">
                    {stat.value}
                  </p>
                )}
              </div>
              <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                <stat.icon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
            </div>
            {stat.change && (
              <div className="mt-4 flex items-center text-sm">
                {stat.changeType === "positive" && (
                  <ArrowUp className="h-4 w-4 text-green-500 mr-1" />
                )}
                {stat.changeType === "negative" && (
                  <ArrowDown className="h-4 w-4 text-red-500 mr-1" />
                )}
                <span
                  className={
                    stat.changeType === "positive"
                      ? "text-green-500"
                      : stat.changeType === "negative"
                      ? "text-red-500"
                      : "text-gray-500"
                  }
                >
                  {stat.change}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent deployments */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Recent Deployments
            </h2>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {deploymentsLoading ? (
              <div className="px-6 py-8 flex justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              </div>
            ) : !recentDeployments?.length ? (
              <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                No deployments yet. Deploy your first application to get started.
              </div>
            ) : (
              recentDeployments.map((deployment) => (
                <div
                  key={deployment.id}
                  className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <div className="flex items-center space-x-4">
                    {getStatusIcon(deployment.status)}
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {deployment.application?.name ?? "Unknown App"}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {deployment.commitSha?.slice(0, 7) ?? "No commit"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {formatTime(deployment.createdAt)}
                    </p>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        deployment.status === "finished"
                          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                          : deployment.status === "failed"
                          ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                          : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                      }`}
                    >
                      {deployment.status.replace("_", " ")}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700">
            <a
              href="/deployments"
              className="text-sm text-purple-600 dark:text-purple-400 hover:underline"
            >
              View all deployments &rarr;
            </a>
          </div>
        </div>

        {/* Server status */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Server Status
            </h2>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {serversLoading ? (
              <div className="px-6 py-8 flex justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              </div>
            ) : !serverStatus.length ? (
              <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                No servers configured yet.
              </div>
            ) : (
              serverStatus.map((server) => (
                <div key={server.id} className="px-6 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`h-2 w-2 rounded-full ${getStatusColor(
                          server.status
                        )}`}
                      />
                      <span className="font-medium text-gray-900 dark:text-white">
                        {server.name}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                      {server.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {server.ip}
                  </p>
                </div>
              ))
            )}
          </div>
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700">
            <a
              href="/servers"
              className="text-sm text-purple-600 dark:text-purple-400 hover:underline"
            >
              View all servers &rarr;
            </a>
          </div>
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Recent Activity
          </h2>
        </div>
        <div className="px-6 py-4">
          {deploymentsLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : !recentDeployments?.length ? (
            <p className="text-center text-gray-500 dark:text-gray-400 py-4">
              No recent activity
            </p>
          ) : (
            <div className="flow-root">
              <ul className="-mb-8">
                {recentDeployments.slice(0, 4).map((deployment, index) => (
                  <li key={deployment.id}>
                    <div className="relative pb-8">
                      {index !== Math.min(recentDeployments.length - 1, 3) && (
                        <span
                          className="absolute top-5 left-5 -ml-px h-full w-0.5 bg-gray-200 dark:bg-gray-700"
                          aria-hidden="true"
                        />
                      )}
                      <div className="relative flex items-start space-x-3">
                        <div className="relative">
                          <div className="h-10 w-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                            <Activity className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div>
                            <p className="text-sm text-gray-900 dark:text-white">
                              <span className="font-medium">Deployment</span>{" "}
                              {deployment.status === "finished" ? "completed" : deployment.status}{" "}
                              <span className="font-medium">{deployment.application?.name}</span>
                            </p>
                            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                              {formatTime(deployment.createdAt)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
