import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuthStore } from "../stores/authStore";
import type { AuthUser } from "@vendi/shared";
import { useEffect } from "react";
import type { AxiosError } from "axios";

export function useAuth() {
  const { user, isLoading, setUser, setLoading } = useAuthStore();

  const query = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const { data } = await api.get<AuthUser>("/auth/me");
      return data;
    },
    retry: (failureCount, error) => {
      // Don't retry on 401 (genuinely logged out)
      if ((error as AxiosError)?.response?.status === 401) return false;
      // Retry transient errors up to 3 times
      return failureCount < 3;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  useEffect(() => {
    if (query.data) setUser(query.data);
    // Only clear user on 401 (actual auth failure), not transient errors
    if (query.isError) {
      const status = (query.error as AxiosError)?.response?.status;
      if (status === 401) setUser(null);
    }
    setLoading(query.isLoading);
  }, [query.data, query.isError, query.isLoading, query.error, setUser, setLoading]);

  return { user, isLoading, isAuthenticated: !!user };
}
