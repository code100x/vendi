import { Link, useLocation, useParams } from "react-router-dom";
import {
  LayoutDashboard,
  Settings,
  Building2,
  History,
  ChevronLeft,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { Organization } from "@vendi/shared";

const globalNavItems = [
  { label: "Organizations", href: "/orgs", icon: Building2 },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const location = useLocation();
  const { orgId } = useParams<{ orgId: string }>();

  const isInOrg = !!orgId;

  const { data: org } = useQuery({
    queryKey: ["orgs", orgId],
    queryFn: async () => {
      const { data } = await api.get<Organization>(`/orgs/${orgId}`);
      return data;
    },
    enabled: isInOrg,
  });

  const orgNavItems = orgId
    ? [
        {
          label: "Dashboard",
          href: `/orgs/${orgId}`,
          icon: LayoutDashboard,
          exact: true,
        },
        {
          label: "Sessions",
          href: `/orgs/${orgId}/sessions`,
          icon: History,
          exact: false,
        },
        {
          label: "Settings",
          href: `/orgs/${orgId}/settings`,
          icon: Settings,
          exact: false,
        },
      ]
    : [];

  return (
    <aside className="w-64 border-r bg-white flex flex-col">
      <div className="p-4 border-b">
        <Link to="/orgs" className="text-xl font-bold text-gray-900 hover:text-gray-700 transition-colors">
          Vendi
        </Link>
      </div>

      {isInOrg && (
        <div className="border-b">
          <Link
            to="/orgs"
            className="flex items-center gap-2 px-4 py-2 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ChevronLeft className="h-3 w-3" />
            All Organizations
          </Link>
          <div className="px-4 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-xs font-semibold text-gray-600">
                {(org?.name || "O").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {org?.name || "Loading..."}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  /{org?.slug || "..."}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <nav className="flex-1 p-2 space-y-1">
        {isInOrg
          ? orgNavItems.map((item) => {
              const isActive = item.exact
                ? location.pathname === item.href
                : location.pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-gray-100 text-gray-900 font-medium"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })
          : globalNavItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  location.pathname.startsWith(item.href)
                    ? "bg-gray-100 text-gray-900 font-medium"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
      </nav>
    </aside>
  );
}
