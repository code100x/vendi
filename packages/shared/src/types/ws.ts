import type { SessionStatus, ChatMessage } from "./session";

// Client → Server
export type WsClientMessage =
  | { type: "join_session"; sessionId: string }
  | { type: "leave_session"; sessionId: string }
  | { type: "chat_message"; sessionId: string; content: string }
  | { type: "stop_session"; sessionId: string }
  | { type: "setup_message"; projectId: string; content: string };

// Server → Client
export type WsServerMessage =
  | { type: "session_status"; sessionId: string; status: SessionStatus; previewUrl?: string }
  | { type: "chat_message"; sessionId: string; message: ChatMessage }
  | { type: "agent_status"; sessionId: string; status: string }
  | { type: "agent_streaming"; sessionId: string; delta: string }
  | { type: "preview_updated"; sessionId: string }
  | { type: "cost_update"; sessionId: string; totalCostUsd: number; totalTokensIn: number; totalTokensOut: number }
  | { type: "error"; sessionId: string; message: string }
  | { type: "conflict_warning"; sessionId: string; otherSessions: { id: string; userName: string }[] };
