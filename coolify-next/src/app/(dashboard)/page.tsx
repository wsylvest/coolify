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
} from "lucide-react";

// Mock data - would come from tRPC in real implementation
const stats = [
  { name: "Servers", value: 5, icon: Server, change: "+1", changeType: "positive" },
  { name: "Applications", value: 23, icon: Rocket, change: "+3", changeType: "positive" },
  { name: "Databases", value: 8, icon: Database, change: "0", changeType: "neutral" },
  { name: "Services", value: 12, icon: Boxes, change: "-1", changeType: "negative" },
];

const recentDeployments = [
  { id: "1", application: "api-gateway", status: "completed", time: "2 min ago", commit: "abc1234" },
  { id: "2", application: "web-frontend", status: "completed", time: "15 min ago", commit: "def5678" },
  { id: "3", application: "worker-service", status: "failed", time: "32 min ago", commit: "ghi9012" },
  { id: "4", application: "auth-service", status: "completed", time: "1 hour ago", commit: "jkl3456" },
  { id: "5", application: "notification-svc", status: "in_progress", time: "Just now", commit: "mno7890" },
];

const serverStatus = [
  { id: "1", name: "Production Server", status: "online", cpu: 45, memory: 62, disk: 38 },
  { id: "2", name: "Staging Server", status: "online", cpu: 23, memory: 41, disk: 55 },
  { id: "3", name: "Dev Server", status: "offline", cpu: 0, memory: 0, disk: 72 },
];

const recentActivity = [
  { id: "1", action: "Deployed", resource: "api-gateway", user: "admin", time: "2 min ago" },
  { id: "2", action: "Created", resource: "new-database", user: "developer", time: "15 min ago" },
  { id: "3", action: "Updated settings", resource: "web-frontend", user: "admin", time: "1 hour ago" },
  { id: "4", action: "Backup completed", resource: "postgres-main", user: "system", time: "2 hours ago" },
];

function getStatusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case "failed":
      return <XCircle className="h-5 w-5 text-red-500" />;
    case "in_progress":
      return <Clock className="h-5 w-5 text-yellow-500 animate-pulse" />;
    default:
      return <AlertTriangle className="h-5 w-5 text-gray-500" />;
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case "online":
      return "bg-green-500";
    case "offline":
      return "bg-red-500";
    default:
      return "bg-gray-500";
  }
}

export default function DashboardPage() {
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
                <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">
                  {stat.value}
                </p>
              </div>
              <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                <stat.icon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
            </div>
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
              <span className="text-gray-500 dark:text-gray-400 ml-2">
                from last week
              </span>
            </div>
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
            {recentDeployments.map((deployment) => (
              <div
                key={deployment.id}
                className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-center space-x-4">
                  {getStatusIcon(deployment.status)}
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {deployment.application}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {deployment.commit}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {deployment.time}
                  </p>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      deployment.status === "completed"
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
            ))}
          </div>
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700">
            <a
              href="/deployments"
              className="text-sm text-purple-600 dark:text-purple-400 hover:underline"
            >
              View all deployments →
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
            {serverStatus.map((server) => (
              <div key={server.id} className="px-6 py-4">
                <div className="flex items-center justify-between mb-3">
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
                {server.status === "online" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">CPU</span>
                      <span className="text-gray-900 dark:text-white">{server.cpu}%</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                      <div
                        className="bg-purple-600 h-1.5 rounded-full"
                        style={{ width: `${server.cpu}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Memory</span>
                      <span className="text-gray-900 dark:text-white">{server.memory}%</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                      <div
                        className="bg-blue-600 h-1.5 rounded-full"
                        style={{ width: `${server.memory}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700">
            <a
              href="/servers"
              className="text-sm text-purple-600 dark:text-purple-400 hover:underline"
            >
              View all servers →
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
          <div className="flow-root">
            <ul className="-mb-8">
              {recentActivity.map((activity, index) => (
                <li key={activity.id}>
                  <div className="relative pb-8">
                    {index !== recentActivity.length - 1 && (
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
                            <span className="font-medium">{activity.user}</span>{" "}
                            {activity.action}{" "}
                            <span className="font-medium">{activity.resource}</span>
                          </p>
                          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                            {activity.time}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
