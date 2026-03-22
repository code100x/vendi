import { Outlet, Navigate, useParams, useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { Organization } from "@vendi/shared";

interface OrgContext {
  org: Organization;
}

export function useOrg() {
  return useOutletContext<OrgContext>();
}

export function OrgLayout() {
  const { orgId } = useParams<{ orgId: string }>();

  const {
    data: org,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["orgs", orgId],
    queryFn: async () => {
      const { data } = await api.get<Organization>(`/orgs/${orgId}`);
      return data;
    },
    enabled: !!orgId,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-gray-300 border-t-gray-900 rounded-full" />
      </div>
    );
  }

  if (isError || !org) {
    return <Navigate to="/orgs" replace />;
  }

  return <Outlet context={{ org } satisfies OrgContext} />;
}
