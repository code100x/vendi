export type OrgRole = "ADMIN" | "MEMBER";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface OrgMember {
  id: string;
  userId: string;
  orgId: string;
  role: OrgRole;
  joinedAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
  };
}

export interface OrgInvite {
  id: string;
  orgId: string;
  email: string | null;
  token: string;
  role: OrgRole;
  expiresAt: string;
  acceptedAt: string | null;
}
