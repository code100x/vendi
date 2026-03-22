export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  hasApiKey: boolean;
  hasGithubLinked: boolean;
}

export interface AuthSession {
  user: AuthUser;
  expiresAt: string;
}
