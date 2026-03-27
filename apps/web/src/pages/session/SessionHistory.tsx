import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";
import type { Session } from "@vendi/shared";
import {
  History,
  GitPullRequest,
  GitMerge,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Clock,
  DollarSign,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

interface SessionWithExtras extends Session {
  user?: {
    id: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
  };
  project?: {
    id: string;
    name: string;
  };
}

interface PaginatedResponse {
  sessions: SessionWithExtras[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const diffMs = end - start;
  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);

  if (minutes < 1) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Status badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    STARTING: "bg-yellow-100 text-yellow-800",
    RUNNING: "bg-green-100 text-green-800",
    STOPPING: "bg-orange-100 text-orange-800",
    COMPLETED: "bg-blue-100 text-blue-800",
    ERRORED: "bg-red-100 text-red-800",
    TIMED_OUT: "bg-gray-100 text-gray-800",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        styles[status] ?? "bg-gray-100 text-gray-700"
      )}
    >
      {status === "RUNNING" && (
        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
      )}
      {status.replace("_", " ")}
    </span>
  );
}

// ── Outcome badge ───────────────────────────────────────────────────────────

function OutcomeBadge({
  outcome,
  prUrl,
}: {
  outcome: string | null;
  prUrl: string | null;
}) {
  if (!outcome) {
    return <span className="text-xs text-gray-400">--</span>;
  }

  if (outcome === "PR_CREATED") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700">
        <GitPullRequest className="h-3.5 w-3.5" />
        PR Created
        {prUrl && (
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="ml-1 text-blue-500 hover:text-blue-700"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </span>
    );
  }

  if (outcome === "COMMITTED_TO_MAIN") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
        <GitMerge className="h-3.5 w-3.5" />
        Committed to Main
      </span>
    );
  }

  if (outcome === "DISCARDED") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500">
        <Trash2 className="h-3.5 w-3.5" />
        Discarded
      </span>
    );
  }

  return null;
}

// ── Avatar ──────────────────────────────────────────────────────────────────

function UserAvatar({
  user,
}: {
  user?: { name: string | null; email: string; avatarUrl: string | null };
}) {
  if (!user) return null;

  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user.email[0].toUpperCase();

  return (
    <div className="flex items-center gap-2">
      {user.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt={user.name ?? user.email}
          className="h-6 w-6 rounded-full"
        />
      ) : (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-[10px] font-medium text-gray-600">
          {initials}
        </div>
      )}
      <span className="text-sm text-gray-700 truncate max-w-[120px]">
        {user.name ?? user.email}
      </span>
    </div>
  );
}

// ── Skeleton row ────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      <td className="px-4 py-3">
        <div className="h-4 w-32 bg-gray-200 rounded" />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-gray-200" />
          <div className="h-4 w-20 bg-gray-200 rounded" />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="h-5 w-16 bg-gray-200 rounded-full" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-24 bg-gray-200 rounded" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-28 bg-gray-200 rounded" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-12 bg-gray-200 rounded" />
      </td>
    </tr>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

export function SessionHistory() {
  const { orgId } = useParams<{ orgId: string }>();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["sessions", orgId, page],
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse>(
        `/sessions/by-org/${orgId}`,
        { params: { page, pageSize: PAGE_SIZE } }
      );
      return data;
    },
    enabled: !!orgId,
  });

  const sessions = data?.sessions ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Session History</h1>
          <p className="text-sm text-gray-500 mt-1">
            View past AI coding sessions across your projects
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Project
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Outcome
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Started / Duration
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : sessions.length > 0 ? (
                sessions.map((session) => (
                  <tr
                    key={session.id}
                    className="group hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/session/${session.id}`}
                        className="text-sm font-medium text-gray-900 hover:text-blue-600 transition-colors"
                      >
                        {session.project?.name ?? "Unknown Project"}
                      </Link>
                      <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[200px]">
                        {session.branchName}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <UserAvatar user={session.user} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={session.status} />
                    </td>
                    <td className="px-4 py-3">
                      <OutcomeBadge
                        outcome={session.outcome}
                        prUrl={session.prUrl}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-sm text-gray-600">
                        <Clock className="h-3.5 w-3.5 text-gray-400" />
                        <span>{formatDate(session.startedAt)}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {formatDuration(session.startedAt, session.endedAt)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 tabular-nums">
                        <DollarSign className="h-3.5 w-3.5 text-gray-400" />
                        {session.totalCostUsd.toFixed(2)}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 mb-4">
                      <History className="h-6 w-6 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      No sessions yet
                    </h3>
                    <p className="text-sm text-gray-500 max-w-sm mx-auto">
                      Sessions will appear here once you start an AI coding
                      session on one of your projects.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
            <p className="text-sm text-gray-500">
              Showing{" "}
              <span className="font-medium text-gray-700">
                {(page - 1) * PAGE_SIZE + 1}
              </span>{" "}
              to{" "}
              <span className="font-medium text-gray-700">
                {Math.min(page * PAGE_SIZE, total)}
              </span>{" "}
              of <span className="font-medium text-gray-700">{total}</span>{" "}
              sessions
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors",
                  page <= 1
                    ? "text-gray-300 cursor-not-allowed"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                )}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium transition-colors",
                      pageNum === page
                        ? "bg-gray-900 text-white"
                        : "text-gray-600 hover:bg-gray-100"
                    )}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors",
                  page >= totalPages
                    ? "text-gray-300 cursor-not-allowed"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                )}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
