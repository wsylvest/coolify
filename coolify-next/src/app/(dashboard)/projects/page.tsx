"use client";

import { useState } from "react";
import Link from "next/link";
import {
  FolderKanban,
  Plus,
  Search,
  MoreVertical,
  Settings,
  Trash2,
  Rocket,
  Database,
  Boxes,
  GitBranch,
} from "lucide-react";

// Mock data
const projects = [
  {
    id: "1",
    uuid: "prj-abc123",
    name: "E-Commerce Platform",
    description: "Main e-commerce application",
    environments: [
      { id: "1", name: "production", applications: 4, databases: 2, services: 1 },
      { id: "2", name: "staging", applications: 4, databases: 2, services: 1 },
      { id: "3", name: "development", applications: 4, databases: 1, services: 0 },
    ],
    updatedAt: "2024-01-15T10:30:00Z",
  },
  {
    id: "2",
    uuid: "prj-def456",
    name: "Analytics Dashboard",
    description: "Real-time analytics and reporting",
    environments: [
      { id: "4", name: "production", applications: 2, databases: 1, services: 3 },
      { id: "5", name: "staging", applications: 2, databases: 1, services: 3 },
    ],
    updatedAt: "2024-01-14T18:00:00Z",
  },
  {
    id: "3",
    uuid: "prj-ghi789",
    name: "Mobile Backend",
    description: "Backend services for mobile app",
    environments: [
      { id: "6", name: "production", applications: 3, databases: 2, services: 2 },
    ],
    updatedAt: "2024-01-13T12:00:00Z",
  },
  {
    id: "4",
    uuid: "prj-jkl012",
    name: "Internal Tools",
    description: "Company internal tools and utilities",
    environments: [
      { id: "7", name: "production", applications: 5, databases: 1, services: 0 },
    ],
    updatedAt: "2024-01-12T09:00:00Z",
  },
];

export default function ProjectsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const filteredProjects = projects.filter(
    (project) =>
      project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getTotalResources = (project: typeof projects[0]) => {
    return project.environments.reduce(
      (acc, env) => ({
        applications: acc.applications + env.applications,
        databases: acc.databases + env.databases,
        services: acc.services + env.services,
      }),
      { applications: 0, databases: 0, services: 0 }
    );
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Projects
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            Organize your applications and resources
          </p>
        </div>
        <button className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors">
          <Plus className="h-5 w-5 mr-2" />
          New Project
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
        <input
          type="text"
          placeholder="Search projects..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full max-w-md pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </div>

      {/* Project cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredProjects.map((project) => {
          const totals = getTotalResources(project);
          return (
            <div
              key={project.id}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-md transition-shadow"
            >
              {/* Card header */}
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                      <FolderKanban className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">
                        {project.name}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {project.description}
                      </p>
                    </div>
                  </div>
                  <div className="relative">
                    <button
                      onClick={() =>
                        setSelectedProject(
                          selectedProject === project.id ? null : project.id
                        )
                      }
                      className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <MoreVertical className="h-5 w-5 text-gray-500" />
                    </button>
                    {selectedProject === project.id && (
                      <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-10">
                        <Link
                          href={`/projects/${project.id}/settings`}
                          className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <Settings className="h-4 w-4 mr-2" />
                          Settings
                        </Link>
                        <button className="w-full flex items-center px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700">
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Resource stats */}
              <div className="px-6 py-4">
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="text-center">
                    <div className="flex items-center justify-center space-x-1 text-gray-500 dark:text-gray-400 mb-1">
                      <Rocket className="h-4 w-4" />
                      <span className="text-xs">Apps</span>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {totals.applications}
                    </p>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center space-x-1 text-gray-500 dark:text-gray-400 mb-1">
                      <Database className="h-4 w-4" />
                      <span className="text-xs">DBs</span>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {totals.databases}
                    </p>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center space-x-1 text-gray-500 dark:text-gray-400 mb-1">
                      <Boxes className="h-4 w-4" />
                      <span className="text-xs">Services</span>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {totals.services}
                    </p>
                  </div>
                </div>

                {/* Environments */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Environments
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {project.environments.map((env) => (
                      <Link
                        key={env.id}
                        href={`/projects/${project.id}/${env.name}`}
                        className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                      >
                        <GitBranch className="h-3.5 w-3.5 mr-1.5" />
                        {env.name}
                        <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-200 dark:bg-gray-600 rounded">
                          {env.applications + env.databases + env.services}
                        </span>
                      </Link>
                    ))}
                    <button className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-purple-500 hover:text-purple-500 dark:hover:border-purple-400 dark:hover:text-purple-400 transition-colors">
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Card footer */}
              <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">
                    Updated {new Date(project.updatedAt).toLocaleDateString()}
                  </span>
                  <Link
                    href={`/projects/${project.id}`}
                    className="text-purple-600 dark:text-purple-400 hover:underline"
                  >
                    View Project →
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredProjects.length === 0 && (
        <div className="text-center py-12">
          <FolderKanban className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No projects found
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {searchQuery
              ? "Try adjusting your search query"
              : "Get started by creating your first project"}
          </p>
          {!searchQuery && (
            <button className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors">
              <Plus className="h-5 w-5 mr-2" />
              New Project
            </button>
          )}
        </div>
      )}
    </div>
  );
}
