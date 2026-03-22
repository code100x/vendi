import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuthStore } from "../stores/authStore";
import type { AuthUser } from "@vendi/shared";
import { useEffect } from "react";

export function useAuth() {
  const { user, isLoading, setUser, setLoading } = useAuthStore();

  const query = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const { data } = await api.get<AuthUser>("/auth/me");
      return data;
    },
    retry: false,
  });

  useEffect(() => {
    if (query.data) setUser(query.data);
    if (query.isError) setUser(null);
    setLoading(query.isLoading);
  }, [query.data, query.isError, query.isLoading, setUser, setLoading]);

  return { user, isLoading, isAuthenticated: !!user };
}
