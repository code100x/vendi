import { create } from "zustand";
import type { ChatMessage, SessionStatus } from "@vendi/shared";

interface SessionState {
  messages: ChatMessage[];
  status: SessionStatus | null;
  previewUrl: string | null;
  agentStatus: string | null;
  totalCostUsd: number;
  addMessage: (msg: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  setStatus: (status: SessionStatus) => void;
  setPreviewUrl: (url: string) => void;
  setAgentStatus: (status: string | null) => void;
  setCost: (cost: number) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  messages: [],
  status: null,
  previewUrl: null,
  agentStatus: null,
  totalCostUsd: 0,
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setMessages: (messages) => set({ messages }),
  setStatus: (status) => set({ status }),
  setPreviewUrl: (previewUrl) => set({ previewUrl }),
  setAgentStatus: (agentStatus) => set({ agentStatus }),
  setCost: (totalCostUsd) => set({ totalCostUsd }),
  reset: () => set({ messages: [], status: null, previewUrl: null, agentStatus: null, totalCostUsd: 0 }),
}));
