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
  Loader2,
  XCircle,
  RefreshCw,
} from "lucide-react";
import { trpc } from "@/components/providers/trpc-provider";
import { formatDistanceToNow } from "date-fns";

export default function ProjectsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const { data: projects, isLoading, error, refetch } = trpc.projects.list.useQuery();
  const deleteProject = trpc.projects.delete.useMutation({
    onSuccess: () => refetch(),
  });

  const filteredProjects = (projects ?? []).filter(
    (project) =>
      project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (project.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
  );

  const handleDelete = async (projectId: string) => {
    if (confirm("Are you sure you want to delete this project and all its resources?")) {
      await deleteProject.mutateAsync({ projectId });
      setSelectedProject(null);
    }
  };

  if (error) {
    return (
      <div className="text-center py-12">
        <XCircle className="h-12 w-12 mx-auto text-red-500 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          Failed to load projects
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
            Projects
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            Organize your applications and resources
          </p>
        </div>
        <Link
          href="/projects/new"
          className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
        >
          <Plus className="h-5 w-5 mr-2" />
          New Project
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
        <input
          type="text"
          placeholder="Search projects..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
        </div>
      )}

      {/* Project cards */}
      {!isLoading && filteredProjects.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredProjects.map((project) => {
            const envCount = project.environments?.length ?? 0;

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
                        {project.description && (
                          <p className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                            {project.description}
                          </p>
                        )}
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
                            href={`/projects/${project.id}`}
                            className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            <Settings className="h-4 w-4 mr-2" />
                            Settings
                          </Link>
                          <button
                            onClick={() => handleDelete(project.id)}
                            disabled={deleteProject.isPending}
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
                  <div className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    {envCount} environment{envCount !== 1 ? "s" : ""}
                  </div>

                  {/* Environments list */}
                  <div className="space-y-2">
                    {project.environments?.slice(0, 3).map((env) => (
                      <Link
                        key={env.id}
                        href={`/projects/${project.id}/environments/${env.id}`}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        <span className="font-medium text-gray-900 dark:text-white text-sm">
                          {env.name}
                        </span>
                        <div className="flex items-center space-x-3 text-xs text-gray-500">
                          <span className="flex items-center">
                            <Rocket className="h-3 w-3 mr-1" />
                            apps
                          </span>
                          <span className="flex items-center">
                            <Database className="h-3 w-3 mr-1" />
                            dbs
                          </span>
                        </div>
                      </Link>
                    ))}
                    {envCount > 3 && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 pl-2">
                        +{envCount - 3} more environment{envCount - 3 !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                </div>

                {/* Card footer */}
                <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">
                      Updated {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}
                    </span>
                    <Link
                      href={`/projects/${project.id}`}
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
      {!isLoading && filteredProjects.length === 0 && (
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
            <Link
              href="/projects/new"
              className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
            >
              <Plus className="h-5 w-5 mr-2" />
              New Project
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
