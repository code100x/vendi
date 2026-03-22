export type SessionStatus =
  | "STARTING"
  | "RUNNING"
  | "STOPPING"
  | "COMPLETED"
  | "ERRORED"
  | "TIMED_OUT";

export type SessionOutcome =
  | "PR_CREATED"
  | "COMMITTED_TO_MAIN"
  | "DISCARDED";

export type MessageRole = "USER" | "ASSISTANT" | "SYSTEM";

export interface Session {
  id: string;
  projectId: string;
  userId: string;
  branchName: string;
  status: SessionStatus;
  sandboxId: string | null;
  previewUrl: string | null;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  outcome: SessionOutcome | null;
  prUrl: string | null;
  commitSha: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  metadata: {
    filesChanged?: string[];
    toolsUsed?: string[];
    hasErrors?: boolean;
  } | null;
  createdAt: string;
}
