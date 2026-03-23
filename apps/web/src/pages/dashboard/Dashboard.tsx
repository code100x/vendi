import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { toast } from "sonner";
import type { Project, GitHubRepo } from "@vendi/shared";
import {
  Plus,
  Search,
  FolderGit2,
  Play,
  Settings,
  GitBranch,
  Loader2,
  X,
  Lock,
  Globe,
  Users,
  RotateCcw,
} from "lucide-react";

function TemplateStatusBadge({ status }: { status: Project["templateStatus"] }) {
  const config = {
    PENDING: { label: "Pending", className: "bg-gray-100 text-gray-600" },
    BUILDING: { label: "Building", className: "bg-yellow-100 text-yellow-700" },
    READY: { label: "Ready", className: "bg-green-100 text-green-700" },
    FAILED: { label: "Failed", className: "bg-red-100 text-red-700" },
  };
  const { label, className } = config[status];
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", className)}>
      {status === "BUILDING" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
      {label}
    </span>
  );
}

function AddProjectModal({
  orgId,
  onClose,
}: {
  orgId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: repos, isLoading: reposLoading, isError: reposError } = useQuery({
    queryKey: ["github", "repos"],
    queryFn: async () => {
      const { data } = await api.get<GitHubRepo[]>("/github/repos");
      return data;
    },
  });

  const createProject = useMutation({
    mutationFn: async (repo: GitHubRepo) => {
      const { data } = await api.post<Project>(`/orgs/${orgId}/projects`, {
        name: repo.name,
        githubRepoFullName: repo.fullName,
        githubRepoUrl: repo.url,
        defaultBranch: repo.defaultBranch,
      });
      return data;
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "projects"] });
      toast.success("Project created successfully");
      navigate(`/orgs/${orgId}/projects/${project.id}/setup`);
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error || "Failed to create project";
      toast.error(msg);
    },
  });

  const filteredRepos = useMemo(() => {
    if (!repos) return [];
    if (!search.trim()) return repos;
    const q = search.toLowerCase();
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.language && r.language.toLowerCase().includes(q))
    );
  }, [repos, search]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-xl border bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Add Project</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-4">
          <p className="text-sm text-gray-500 mb-4">
            Select a GitHub repository to create a project from.
          </p>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search repositories..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              autoFocus
            />
          </div>

          <div className="max-h-80 overflow-y-auto -mx-2">
            {reposLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : reposError ? (
              <div className="py-8 text-center">
                <p className="text-sm text-red-600 mb-1">
                  Failed to load repositories.
                </p>
                <p className="text-xs text-gray-500">
                  Make sure your GitHub account is connected.
                </p>
              </div>
            ) : filteredRepos.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-gray-500">
                  {search ? "No repositories match your search." : "No repositories found."}
                </p>
              </div>
            ) : (
              <div className="space-y-1 px-2">
                {filteredRepos.map((repo) => (
                  <button
                    key={repo.id}
                    onClick={() => createProject.mutate(repo)}
                    disabled={createProject.isPending}
                    className="w-full flex items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    <FolderGit2 className="h-5 w-5 flex-shrink-0 text-gray-400" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {repo.fullName}
                        </span>
                        {repo.private ? (
                          <Lock className="h-3 w-3 flex-shrink-0 text-gray-400" />
                        ) : (
                          <Globe className="h-3 w-3 flex-shrink-0 text-gray-400" />
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {repo.language && (
                          <span className="text-xs text-gray-500">{repo.language}</span>
                        )}
                        <span className="text-xs text-gray-400">
                          <GitBranch className="inline h-3 w-3 mr-0.5" />
                          {repo.defaultBranch}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const [showAddProject, setShowAddProject] = useState(false);

  const {
    data: projects,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["orgs", orgId, "projects"],
    queryFn: async () => {
      const { data } = await api.get<Project[]>(`/orgs/${orgId}/projects`);
      return data;
    },
    enabled: !!orgId,
  });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage your development projects and sessions
          </p>
        </div>
        <button
          onClick={() => setShowAddProject(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Project
        </button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border bg-white p-6 shadow-sm animate-pulse">
              <div className="h-5 w-40 bg-gray-200 rounded mb-2" />
              <div className="h-4 w-28 bg-gray-100 rounded mb-4" />
              <div className="h-5 w-16 bg-gray-100 rounded mb-6" />
              <div className="flex gap-2">
                <div className="h-9 flex-1 bg-gray-100 rounded-lg" />
                <div className="h-9 w-24 bg-gray-100 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border bg-white p-12 shadow-sm text-center">
          <p className="text-sm text-red-600">Failed to load projects. Please try again.</p>
        </div>
      ) : projects && projects.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              orgId={orgId!}
              onStartSession={async () => {
                try {
                  toast.info("Starting session...");
                  const { data } = await api.post("/sessions", { projectId: project.id });
                  navigate(`/session/${data.id}`);
                } catch (err: any) {
                  toast.error("Failed to start session: " + (err.response?.data?.error || err.message));
                }
              }}
              onConfigure={() => {
                navigate(`/orgs/${orgId}/projects/${project.id}/setup`);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border bg-white p-12 shadow-sm text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 mb-4">
            <FolderGit2 className="h-6 w-6 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            No projects yet
          </h3>
          <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">
            Add a GitHub repository to create your first project and start coding with AI.
          </p>
          <button
            onClick={() => setShowAddProject(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Project
          </button>
        </div>
      )}

      {showAddProject && orgId && (
        <AddProjectModal orgId={orgId} onClose={() => setShowAddProject(false)} />
      )}
    </div>
  );
}

function ProjectCard({
  project,
  orgId,
  onStartSession,
  onConfigure,
}: {
  project: Project;
  orgId: string;
  onStartSession: () => void;
  onConfigure: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showReconfigureConfirm, setShowReconfigureConfirm] = useState(false);

  const { data: activeSessions } = useQuery({
    queryKey: ["orgs", orgId, "projects", project.id, "active-sessions"],
    queryFn: async () => {
      const { data } = await api.get<any[]>(
        `/orgs/${orgId}/projects/${project.id}/active-sessions`
      );
      return data;
    },
    refetchInterval: 30000,
  });

  const reconfigure = useMutation({
    mutationFn: async () => {
      await api.post(`/orgs/${orgId}/projects/${project.id}/setup/reset`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "projects"] });
      toast.success("Project reset. Starting fresh setup...");
      navigate(`/orgs/${orgId}/projects/${project.id}/setup`);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || "Failed to reset project");
    },
  });

  const activeCount = activeSessions?.length ?? 0;
  const isReady = project.templateStatus === "READY";
  const isConfigured = project.templateStatus !== "PENDING";

  return (
    <>
      <div className="rounded-xl border bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
        <div className="mb-4">
          <h3 className="font-semibold text-gray-900 truncate">{project.name}</h3>
          <p className="text-xs text-gray-400 mt-0.5 truncate">
            {project.githubRepoFullName}
          </p>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <TemplateStatusBadge status={project.templateStatus} />
          {activeCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
              <Users className="h-3 w-3" />
              {activeCount} active
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onStartSession}
            disabled={!isReady}
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isReady
                ? "bg-gray-900 text-white hover:bg-gray-800"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            )}
          >
            <Play className="h-3.5 w-3.5" />
            Start Session
          </button>
          <button
            onClick={onConfigure}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
            Configure
          </button>
          {isConfigured && (
            <button
              onClick={() => setShowReconfigureConfirm(true)}
              title="Re-configure from scratch"
              className="inline-flex items-center justify-center rounded-lg border px-2 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {showReconfigureConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-xl border bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Re-configure project?
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              This will clear all existing configuration (environment variables,
              services, startup commands) and restart the setup from scratch.
              The template will need to be rebuilt.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowReconfigureConfirm(false)}
                className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowReconfigureConfirm(false);
                  reconfigure.mutate();
                }}
                disabled={reconfigure.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {reconfigure.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Re-configure
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
