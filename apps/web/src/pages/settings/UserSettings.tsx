import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { useAuthStore } from "../../stores/authStore";
import { toast } from "sonner";
import {
  Key,
  LogOut,
  Loader2,
  Trash2,
  Check,
  User,
  Github,
  Mail,
} from "lucide-react";

export function UserSettings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const setUser = useAuthStore((s) => s.setUser);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your account and preferences</p>
      </div>

      <div className="space-y-6">
        {/* Profile Section */}
        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Profile</h2>
          <div className="flex items-start gap-4">
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name || "Avatar"}
                className="h-14 w-14 rounded-full border"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
                <User className="h-7 w-7 text-gray-400" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-base font-medium text-gray-900">
                {user?.name || "Unnamed User"}
              </p>
              <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
                <Mail className="h-3.5 w-3.5" />
                {user?.email}
              </p>
              <div className="flex items-center gap-2 mt-3">
                {user?.hasGithubLinked && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                    <Github className="h-3 w-3" />
                    GitHub connected
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                  <svg className="h-3 w-3" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Google connected
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* API Key Section */}
        <ApiKeySection />

        {/* Logout Section */}
        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-2">Sign Out</h2>
          <p className="text-sm text-gray-500 mb-4">
            Sign out of your account on this device.
          </p>
          <LogoutButton />
        </section>
      </div>
    </div>
  );
}

function ApiKeySection() {
  const queryClient = useQueryClient();
  const [apiKeyInput, setApiKeyInput] = useState("");

  const { data: keyStatus, isLoading: statusLoading } = useQuery({
    queryKey: ["users", "api-key", "status"],
    queryFn: async () => {
      const { data } = await api.get<{ hasApiKey: boolean }>("/users/api-key/status");
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (apiKey: string) => {
      await api.put("/users/api-key", { apiKey });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", "api-key", "status"] });
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      setApiKeyInput("");
      toast.success("API key saved successfully");
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || "Failed to save API key");
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      await api.delete("/users/api-key");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", "api-key", "status"] });
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      toast.success("API key removed");
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || "Failed to remove API key");
    },
  });

  const handleSave = () => {
    if (!apiKeyInput.trim()) {
      toast.error("Please enter an API key");
      return;
    }
    if (!apiKeyInput.startsWith("sk-ant-")) {
      toast.error("API key must start with sk-ant-");
      return;
    }
    saveMutation.mutate(apiKeyInput.trim());
  };

  const hasKey = keyStatus?.hasApiKey;

  return (
    <section className="rounded-xl border bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold mb-2">Anthropic API Key</h2>
      <p className="text-sm text-gray-500 mb-4">
        Enter your API key from{" "}
        <a
          href="https://console.anthropic.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 underline"
        >
          console.anthropic.com
        </a>{" "}
        to use Claude in sessions.
      </p>

      {statusLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking API key status...
        </div>
      ) : hasKey ? (
        <div className="flex items-center justify-between rounded-lg bg-green-50 border border-green-200 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-green-700">
            <Check className="h-4 w-4" />
            <span className="font-medium">API key is configured</span>
          </div>
          <button
            onClick={() => removeMutation.mutate()}
            disabled={removeMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            {removeMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Remove
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="password"
              placeholder="sk-ant-..."
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              className="w-full rounded-lg border pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending || !apiKeyInput.trim()}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Save"
            )}
          </button>
        </div>
      )}
    </section>
  );
}

function LogoutButton() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await api.post("/auth/logout");
    },
    onSuccess: () => {
      setUser(null);
      queryClient.clear();
      navigate("/signin", { replace: true });
    },
    onError: () => {
      toast.error("Failed to sign out. Please try again.");
    },
  });

  return (
    <button
      onClick={() => logoutMutation.mutate()}
      disabled={logoutMutation.isPending}
      className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
    >
      {logoutMutation.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <LogOut className="h-4 w-4" />
      )}
      Sign Out
    </button>
  );
}
