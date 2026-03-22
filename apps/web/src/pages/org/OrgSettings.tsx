import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { Organization, OrgMember, OrgInvite, OrgRole } from "@vendi/shared";
import { toast } from "sonner";
import {
  Users,
  Mail,
  Settings,
  Trash2,
  Copy,
  Plus,
  Loader2,
  X,
  ChevronDown,
  AlertTriangle,
  Check,
} from "lucide-react";

type Tab = "members" | "invites" | "general";

export function OrgSettings() {
  const { orgId } = useParams<{ orgId: string }>();
  const [activeTab, setActiveTab] = useState<Tab>("members");

  const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: "members", label: "Members", icon: Users },
    { id: "invites", label: "Invites", icon: Mail },
    { id: "general", label: "General", icon: Settings },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        Organization Settings
      </h1>

      <div className="flex gap-1 border-b mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.id
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "members" && <MembersSection orgId={orgId!} />}
      {activeTab === "invites" && <InvitesSection orgId={orgId!} />}
      {activeTab === "general" && <GeneralSection orgId={orgId!} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Members Section                                                    */
/* ------------------------------------------------------------------ */

function MembersSection({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();

  const { data: members, isLoading } = useQuery({
    queryKey: ["orgs", orgId, "members"],
    queryFn: async () => {
      const { data } = await api.get<OrgMember[]>(`/orgs/${orgId}/members`);
      return data;
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({
      memberId,
      role,
    }: {
      memberId: string;
      role: OrgRole;
    }) => {
      await api.put(`/orgs/${orgId}/members/${memberId}/role`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "members"] });
      toast.success("Member role updated");
    },
    onError: (error: any) => {
      toast.error(
        error?.response?.data?.message || "Failed to update member role"
      );
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (memberId: string) => {
      await api.delete(`/orgs/${orgId}/members/${memberId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "members"] });
      toast.success("Member removed");
    },
    onError: (error: any) => {
      toast.error(
        error?.response?.data?.message || "Failed to remove member"
      );
    },
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="p-6 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 animate-pulse">
              <div className="h-10 w-10 rounded-full bg-gray-200" />
              <div className="flex-1">
                <div className="h-4 w-32 bg-gray-200 rounded mb-1" />
                <div className="h-3 w-48 bg-gray-100 rounded" />
              </div>
              <div className="h-8 w-24 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-white shadow-sm">
      <div className="px-6 py-4 border-b">
        <h2 className="text-sm font-semibold text-gray-900">
          Members ({members?.length ?? 0})
        </h2>
      </div>
      {members && members.length > 0 ? (
        <div className="divide-y">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-4 px-6 py-4"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-600 shrink-0">
                {(member.user.name || member.user.email)
                  .charAt(0)
                  .toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {member.user.name || "Unnamed"}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {member.user.email}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <RoleDropdown
                  currentRole={member.role}
                  isLoading={updateRoleMutation.isPending}
                  onChange={(role) =>
                    updateRoleMutation.mutate({
                      memberId: member.id,
                      role,
                    })
                  }
                />
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove ${member.user.name || member.user.email} from this organization?`
                      )
                    ) {
                      removeMutation.mutate(member.id);
                    }
                  }}
                  className="rounded-lg p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  title="Remove member"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-6 text-center text-sm text-gray-500">
          No members found.
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Role Dropdown                                                      */
/* ------------------------------------------------------------------ */

function RoleDropdown({
  currentRole,
  isLoading,
  onChange,
}: {
  currentRole: OrgRole;
  isLoading: boolean;
  onChange: (role: OrgRole) => void;
}) {
  const [open, setOpen] = useState(false);
  const roles: OrgRole[] = ["ADMIN", "MEMBER"];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={isLoading}
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
      >
        {isLoading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <>
            {currentRole}
            <ChevronDown className="h-3 w-3" />
          </>
        )}
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-20 w-32 rounded-lg border bg-white shadow-lg py-1">
            {roles.map((role) => (
              <button
                key={role}
                onClick={() => {
                  if (role !== currentRole) onChange(role);
                  setOpen(false);
                }}
                className="flex items-center justify-between w-full px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors"
              >
                {role}
                {role === currentRole && (
                  <Check className="h-3 w-3 text-gray-500" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Invites Section                                                    */
/* ------------------------------------------------------------------ */

function InvitesSection({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("MEMBER");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: invites, isLoading } = useQuery({
    queryKey: ["orgs", orgId, "invites"],
    queryFn: async () => {
      const { data } = await api.get<OrgInvite[]>(`/orgs/${orgId}/invites`);
      return data;
    },
  });

  const createInviteMutation = useMutation({
    mutationFn: async (input: { email?: string; role: OrgRole }) => {
      const { data } = await api.post(`/orgs/${orgId}/invites`, input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "invites"] });
      toast.success("Invite created");
      setEmail("");
      setRole("MEMBER");
      setShowForm(false);
    },
    onError: (error: any) => {
      toast.error(
        error?.response?.data?.message || "Failed to create invite"
      );
    },
  });

  const deleteInviteMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      await api.delete(`/orgs/${orgId}/invites/${inviteId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "invites"] });
      toast.success("Invite revoked");
    },
    onError: (error: any) => {
      toast.error(
        error?.response?.data?.message || "Failed to revoke invite"
      );
    },
  });

  function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    const input: { email?: string; role: OrgRole } = { role };
    if (email.trim()) {
      input.email = email.trim();
    }
    createInviteMutation.mutate(input);
  }

  function copyInviteLink(invite: OrgInvite) {
    const link = `${window.location.origin}/invite/${invite.token}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedId(invite.id);
      toast.success("Invite link copied to clipboard");
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="p-6 space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 animate-pulse">
              <div className="flex-1">
                <div className="h-4 w-48 bg-gray-200 rounded mb-1" />
                <div className="h-3 w-32 bg-gray-100 rounded" />
              </div>
              <div className="h-8 w-20 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Create invite form */}
      {showForm ? (
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">
              Create New Invite
            </h3>
            <button
              onClick={() => setShowForm(false)}
              className="rounded-lg p-1 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <form onSubmit={handleCreateInvite} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Email (optional)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="rounded-lg border px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              <p className="mt-1 text-xs text-gray-400">
                Leave empty to create a shareable invite link
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Role
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as OrgRole)}
                className="rounded-lg border px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
              >
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={createInviteMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                {createInviteMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Send Invite
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create Invite
        </button>
      )}

      {/* Invites list */}
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="px-6 py-4 border-b">
          <h2 className="text-sm font-semibold text-gray-900">
            Pending Invites ({invites?.filter((i) => !i.acceptedAt).length ?? 0})
          </h2>
        </div>
        {invites && invites.filter((i) => !i.acceptedAt).length > 0 ? (
          <div className="divide-y">
            {invites
              .filter((i) => !i.acceptedAt)
              .map((invite) => {
                const isExpired =
                  new Date(invite.expiresAt) < new Date();
                return (
                  <div
                    key={invite.id}
                    className="flex items-center gap-4 px-6 py-4"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-sm text-gray-500 shrink-0">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {invite.email || "Open invite link"}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-500">
                          {invite.role}
                        </span>
                        <span className="text-xs text-gray-300">|</span>
                        {isExpired ? (
                          <span className="text-xs text-red-500">Expired</span>
                        ) : (
                          <span className="text-xs text-gray-500">
                            Expires{" "}
                            {new Date(invite.expiresAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => copyInviteLink(invite)}
                        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-gray-50 transition-colors"
                        title="Copy invite link"
                      >
                        {copiedId === invite.id ? (
                          <>
                            <Check className="h-3 w-3 text-green-600" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            Copy Link
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          if (
                            window.confirm(
                              "Are you sure you want to revoke this invite?"
                            )
                          ) {
                            deleteInviteMutation.mutate(invite.id);
                          }
                        }}
                        className="rounded-lg p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Revoke invite"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        ) : (
          <div className="p-6 text-center text-sm text-gray-500">
            No pending invites.
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  General Section                                                    */
/* ------------------------------------------------------------------ */

function GeneralSection({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const { data: org, isLoading } = useQuery({
    queryKey: ["orgs", orgId],
    queryFn: async () => {
      const { data } = await api.get<Organization>(`/orgs/${orgId}`);
      return data;
    },
  });

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({});
  const [formInitialized, setFormInitialized] = useState(false);

  useEffect(() => {
    if (org && !formInitialized) {
      setName(org.name);
      setSlug(org.slug);
      setFormInitialized(true);
    }
  }, [org, formInitialized]);

  const updateMutation = useMutation({
    mutationFn: async (input: { name: string; slug: string }) => {
      const { data } = await api.put(`/orgs/${orgId}`, input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgs", orgId] });
      queryClient.invalidateQueries({ queryKey: ["orgs"] });
      toast.success("Organization updated");
    },
    onError: (error: any) => {
      toast.error(
        error?.response?.data?.message || "Failed to update organization"
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/orgs/${orgId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgs"] });
      toast.success("Organization deleted");
      navigate("/orgs");
    },
    onError: (error: any) => {
      toast.error(
        error?.response?.data?.message || "Failed to delete organization"
      );
    },
  });

  function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    setNameErrors({});

    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();

    if (!trimmedName) {
      setNameErrors({ name: "Name is required" });
      return;
    }
    if (!trimmedSlug || !/^[a-z0-9-]+$/.test(trimmedSlug)) {
      setNameErrors({ slug: "Slug must only contain lowercase letters, numbers, and hyphens" });
      return;
    }

    updateMutation.mutate({ name: trimmedName, slug: trimmedSlug });
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border bg-white p-6 shadow-sm animate-pulse">
          <div className="h-5 w-32 bg-gray-200 rounded mb-4" />
          <div className="space-y-4">
            <div className="h-10 w-full bg-gray-100 rounded" />
            <div className="h-10 w-full bg-gray-100 rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Edit org */}
      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">
          Organization Details
        </h3>
        <form onSubmit={handleUpdate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`rounded-lg border px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-gray-900 ${
                nameErrors.name ? "border-red-400" : ""
              }`}
            />
            {nameErrors.name && (
              <p className="mt-1 text-xs text-red-600">{nameErrors.name}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Slug
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className={`rounded-lg border px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-gray-900 ${
                nameErrors.slug ? "border-red-400" : ""
              }`}
            />
            {nameErrors.slug ? (
              <p className="mt-1 text-xs text-red-600">{nameErrors.slug}</p>
            ) : (
              <p className="mt-1 text-xs text-gray-400">
                Only lowercase letters, numbers, and hyphens
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {updateMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Save Changes
          </button>
        </form>
      </div>

      {/* Danger zone */}
      <div className="rounded-xl border border-red-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-4 w-4 text-red-500" />
          <h3 className="text-sm font-semibold text-red-600">Danger Zone</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Deleting this organization will permanently remove all projects,
          sessions, and data. This action cannot be undone.
        </p>

        {showDeleteConfirm ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              Type <span className="font-mono font-semibold">{org?.slug}</span>{" "}
              to confirm deletion:
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={org?.slug}
              className="rounded-lg border border-red-200 px-3 py-2 text-sm w-full max-w-xs focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={
                  deleteConfirmText !== org?.slug ||
                  deleteMutation.isPending
                }
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleteMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Delete Organization
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmText("");
                }}
                className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            Delete Organization
          </button>
        )}
      </div>
    </div>
  );
}
