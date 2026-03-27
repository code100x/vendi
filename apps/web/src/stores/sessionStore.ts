import { create } from "zustand";
import type { ChatMessage, SessionStatus } from "@vendi/shared";

interface SessionState {
  messages: ChatMessage[];
  status: SessionStatus | null;
  previewUrl: string | null;
  totalCostUsd: number;
  setMessages: (msgs: ChatMessage[]) => void;
  setStatus: (status: SessionStatus) => void;
  setPreviewUrl: (url: string) => void;
  setCost: (cost: number) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  messages: [],
  status: null,
  previewUrl: null,
  totalCostUsd: 0,
  setMessages: (messages) => set({ messages }),
  setStatus: (status) => set({ status }),
  setPreviewUrl: (previewUrl) => set({ previewUrl }),
  setCost: (totalCostUsd) => set({ totalCostUsd }),
  reset: () => set({ messages: [], status: null, previewUrl: null, totalCostUsd: 0 }),
}));
