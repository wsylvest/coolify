"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Settings,
  Bell,
  Key,
  HardDrive,
  Clock,
  Users,
  Shield,
  Globe,
  Palette,
  Save,
} from "lucide-react";

const settingsSections = [
  {
    id: "notifications",
    name: "Notifications",
    description: "Configure notification channels and preferences",
    icon: Bell,
    href: "/settings/notifications",
  },
  {
    id: "keys",
    name: "SSH Keys",
    description: "Manage private keys for server connections",
    icon: Key,
    href: "/settings/keys",
  },
  {
    id: "storage",
    name: "S3 Storage",
    description: "Configure S3-compatible storage for backups",
    icon: HardDrive,
    href: "/settings/storage",
  },
  {
    id: "tasks",
    name: "Scheduled Tasks",
    description: "Manage scheduled tasks and cron jobs",
    icon: Clock,
    href: "/settings/tasks",
  },
  {
    id: "team",
    name: "Team",
    description: "Manage team members and permissions",
    icon: Users,
    href: "/settings/team",
  },
  {
    id: "security",
    name: "Security",
    description: "API tokens and security settings",
    icon: Shield,
    href: "/settings/security",
  },
];

export default function SettingsPage() {
  const [teamName, setTeamName] = useState("My Team");
  const [timezone, setTimezone] = useState("UTC");
  const [theme, setTheme] = useState("system");

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Settings
        </h1>
        <p className="text-gray-500 dark:text-gray-400">
          Manage your team and application settings
        </p>
      </div>

      {/* General settings card */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            General Settings
          </h2>
        </div>
        <div className="p-6 space-y-6">
          {/* Team name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Team Name
            </label>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="w-full max-w-md px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          {/* Timezone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Timezone
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full max-w-md px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="UTC">UTC</option>
              <option value="America/New_York">Eastern Time (US)</option>
              <option value="America/Los_Angeles">Pacific Time (US)</option>
              <option value="Europe/London">London</option>
              <option value="Europe/Paris">Paris</option>
              <option value="Asia/Tokyo">Tokyo</option>
            </select>
          </div>

          {/* Theme */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Theme
            </label>
            <div className="flex gap-4">
              {["light", "dark", "system"].map((t) => (
                <label
                  key={t}
                  className={`flex items-center px-4 py-2 rounded-lg border cursor-pointer transition-colors ${
                    theme === t
                      ? "border-purple-500 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                      : "border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={t}
                    checked={theme === t}
                    onChange={(e) => setTheme(e.target.value)}
                    className="sr-only"
                  />
                  <Palette className="h-4 w-4 mr-2" />
                  <span className="capitalize">{t}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="pt-4">
            <button className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors">
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </button>
          </div>
        </div>
      </div>

      {/* Settings sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {settingsSections.map((section) => (
          <Link
            key={section.id}
            href={section.href}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 hover:shadow-md hover:border-purple-300 dark:hover:border-purple-700 transition-all"
          >
            <div className="flex items-start space-x-4">
              <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                <section.icon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  {section.name}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {section.description}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Danger zone */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-red-200 dark:border-red-900/50">
        <div className="px-6 py-4 border-b border-red-200 dark:border-red-900/50">
          <h2 className="text-lg font-semibold text-red-600 dark:text-red-400">
            Danger Zone
          </h2>
        </div>
        <div className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-gray-900 dark:text-white">
                Delete Team
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Permanently delete this team and all its data. This action cannot be undone.
              </p>
            </div>
            <button className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors">
              Delete Team
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
