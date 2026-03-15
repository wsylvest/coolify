"use client";

import { useState } from "react";
import {
  Bell,
  Mail,
  MessageSquare,
  Send,
  Smartphone,
  Webhook,
  Save,
  TestTube,
  CheckCircle,
  XCircle,
} from "lucide-react";

const notificationChannels = [
  { id: "email", name: "Email", icon: Mail, description: "Send notifications via email" },
  { id: "discord", name: "Discord", icon: MessageSquare, description: "Send to Discord webhook" },
  { id: "slack", name: "Slack", icon: Send, description: "Send to Slack channel" },
  { id: "telegram", name: "Telegram", icon: Send, description: "Send to Telegram bot" },
  { id: "pushover", name: "Pushover", icon: Smartphone, description: "Push notifications via Pushover" },
];

const eventTypes = [
  { id: "deployment_success", name: "Deployment Success", category: "Deployments" },
  { id: "deployment_failed", name: "Deployment Failed", category: "Deployments" },
  { id: "server_unreachable", name: "Server Unreachable", category: "Servers" },
  { id: "server_reachable", name: "Server Reachable", category: "Servers" },
  { id: "database_backup_success", name: "Backup Success", category: "Databases" },
  { id: "database_backup_failed", name: "Backup Failed", category: "Databases" },
  { id: "ssl_expiring", name: "SSL Expiring Soon", category: "SSL" },
  { id: "ssl_expired", name: "SSL Expired", category: "SSL" },
  { id: "high_disk_usage", name: "High Disk Usage", category: "Resources" },
  { id: "high_memory_usage", name: "High Memory Usage", category: "Resources" },
];

export default function NotificationsSettingsPage() {
  const [activeChannel, setActiveChannel] = useState("email");
  const [enabledChannels, setEnabledChannels] = useState<Record<string, boolean>>({
    email: true,
    discord: false,
    slack: false,
    telegram: false,
    pushover: false,
  });
  const [subscriptions, setSubscriptions] = useState<Record<string, Record<string, boolean>>>({
    email: {
      deployment_success: true,
      deployment_failed: true,
      server_unreachable: true,
    },
  });
  const [testStatus, setTestStatus] = useState<Record<string, "success" | "failed" | null>>({});

  const toggleChannel = (channelId: string) => {
    setEnabledChannels((prev) => ({
      ...prev,
      [channelId]: !prev[channelId],
    }));
  };

  const toggleSubscription = (channelId: string, eventId: string) => {
    setSubscriptions((prev) => ({
      ...prev,
      [channelId]: {
        ...(prev[channelId] || {}),
        [eventId]: !(prev[channelId]?.[eventId] || false),
      },
    }));
  };

  const testChannel = (channelId: string) => {
    // Simulate test
    setTimeout(() => {
      setTestStatus((prev) => ({
        ...prev,
        [channelId]: Math.random() > 0.3 ? "success" : "failed",
      }));
    }, 1000);
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Notification Settings
        </h1>
        <p className="text-gray-500 dark:text-gray-400">
          Configure how and when you receive notifications
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Channel list */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Channels
            </h2>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {notificationChannels.map((channel) => (
              <button
                key={channel.id}
                onClick={() => setActiveChannel(channel.id)}
                className={`w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                  activeChannel === channel.id
                    ? "bg-purple-50 dark:bg-purple-900/20"
                    : ""
                }`}
              >
                <div className="flex items-center space-x-3">
                  <channel.icon
                    className={`h-5 w-5 ${
                      activeChannel === channel.id
                        ? "text-purple-600 dark:text-purple-400"
                        : "text-gray-400"
                    }`}
                  />
                  <span
                    className={`font-medium ${
                      activeChannel === channel.id
                        ? "text-purple-600 dark:text-purple-400"
                        : "text-gray-900 dark:text-white"
                    }`}
                  >
                    {channel.name}
                  </span>
                </div>
                <div
                  className={`w-2 h-2 rounded-full ${
                    enabledChannels[channel.id]
                      ? "bg-green-500"
                      : "bg-gray-300 dark:bg-gray-600"
                  }`}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Channel configuration */}
        <div className="lg:col-span-2 space-y-6">
          {/* Channel settings */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white capitalize">
                {activeChannel} Settings
              </h2>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabledChannels[activeChannel]}
                  onChange={() => toggleChannel(activeChannel)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 dark:peer-focus:ring-purple-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-purple-600"></div>
                <span className="ml-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                  Enabled
                </span>
              </label>
            </div>
            <div className="p-6 space-y-4">
              {activeChannel === "email" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      SMTP Host
                    </label>
                    <input
                      type="text"
                      placeholder="smtp.example.com"
                      className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        SMTP Port
                      </label>
                      <input
                        type="text"
                        placeholder="587"
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Encryption
                      </label>
                      <select className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                        <option value="tls">TLS</option>
                        <option value="ssl">SSL</option>
                        <option value="none">None</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Recipients (comma-separated)
                    </label>
                    <input
                      type="text"
                      placeholder="admin@example.com, dev@example.com"
                      className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </>
              )}

              {activeChannel === "discord" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Webhook URL
                  </label>
                  <input
                    type="text"
                    placeholder="https://discord.com/api/webhooks/..."
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              )}

              {activeChannel === "slack" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Webhook URL
                    </label>
                    <input
                      type="text"
                      placeholder="https://hooks.slack.com/services/..."
                      className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Channel (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="#alerts"
                      className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </>
              )}

              {activeChannel === "telegram" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Bot Token
                    </label>
                    <input
                      type="password"
                      placeholder="1234567890:ABC..."
                      className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Chat ID
                    </label>
                    <input
                      type="text"
                      placeholder="-1001234567890"
                      className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </>
              )}

              <div className="flex items-center justify-between pt-4">
                <button
                  onClick={() => testChannel(activeChannel)}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <TestTube className="h-4 w-4 mr-2" />
                  Test Channel
                  {testStatus[activeChannel] === "success" && (
                    <CheckCircle className="h-4 w-4 ml-2 text-green-500" />
                  )}
                  {testStatus[activeChannel] === "failed" && (
                    <XCircle className="h-4 w-4 ml-2 text-red-500" />
                  )}
                </button>
                <button className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors">
                  <Save className="h-4 w-4 mr-2" />
                  Save Settings
                </button>
              </div>
            </div>
          </div>

          {/* Event subscriptions */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Event Subscriptions
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Choose which events trigger notifications for this channel
              </p>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {eventTypes.map((event) => (
                  <label
                    key={event.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                  >
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {event.name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {event.category}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={subscriptions[activeChannel]?.[event.id] || false}
                      onChange={() => toggleSubscription(activeChannel, event.id)}
                      className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
