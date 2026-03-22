import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { useSessionStore } from "../../stores/sessionStore";
import { VncPreview } from "../../components/preview/VncPreview";
import type { Session, ChatMessage, Project } from "@vendi/shared";
import { toast } from "sonner";
import {
  ArrowLeft,
  Send,
  RefreshCw,
  GitPullRequest,
  GitMerge,
  Trash2,
  Loader2,
  StopCircle,
  FileCode2,
} from "lucide-react";

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
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
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

// ── Chat message ────────────────────────────────────────────────────────────

function ChatBubble({ message }: { message: ChatMessage }) {
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const filesChanged = message.metadata?.filesChanged;

  if (message.role === "SYSTEM") {
    return (
      <div className="flex justify-center my-3">
        <div className="max-w-md text-center text-xs text-gray-400 bg-gray-50 rounded-full px-4 py-1.5">
          {message.content}
          <span className="ml-2 text-gray-300">{time}</span>
        </div>
      </div>
    );
  }

  const isUser = message.role === "USER";

  return (
    <div className={cn("flex mb-3", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-gray-900 text-white rounded-br-md"
            : "bg-white border border-gray-200 text-gray-800 rounded-bl-md shadow-sm"
        )}
      >
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
        {filesChanged && filesChanged.length > 0 && (
          <div
            className={cn(
              "mt-2 flex items-center gap-1 text-xs",
              isUser ? "text-gray-300" : "text-gray-400"
            )}
          >
            <FileCode2 className="h-3 w-3" />
            <span>
              {filesChanged.length} file{filesChanged.length !== 1 ? "s" : ""}{" "}
              changed
            </span>
          </div>
        )}
        <div className={cn("mt-1 text-[10px]", isUser ? "text-gray-400" : "text-gray-300")}>
          {time}
        </div>
      </div>
    </div>
  );
}

// ── Typing indicator ────────────────────────────────────────────────────────

function TypingIndicator({ status }: { status: string }) {
  return (
    <div className="flex justify-start mb-3">
      <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
            <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
            <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
          </div>
          <span className="text-xs text-gray-400 ml-1">{status}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [vncKey, setVncKey] = useState(0);
  const [input, setInput] = useState("");

  const {
    messages,
    status,
    previewUrl,
    agentStatus,
    totalCostUsd,
    setMessages,
    setStatus,
    setPreviewUrl,
    setCost,
    reset,
  } = useSessionStore();

  // Fetch session details (poll every 2s for status updates)
  const { data: session } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: async () => {
      const { data } = await api.get<Session>(`/sessions/${sessionId}`);
      return data;
    },
    enabled: !!sessionId,
    refetchInterval: 2000,
  });

  // Project comes from the session response (includes project with org)
  const project = (session as any)?.project as Project | undefined;

  // Poll messages every second
  const prevMsgCountRef = useRef(0);
  const { data: polledMessages } = useQuery({
    queryKey: ["session-messages", sessionId],
    queryFn: async () => {
      const { data } = await api.get<ChatMessage[]>(
        `/sessions/${sessionId}/messages`
      );
      return data;
    },
    enabled: !!sessionId,
    refetchInterval: 1000,
  });

  // Sync session data to store
  useEffect(() => {
    if (session) {
      setStatus(session.status);
      if (session.previewUrl) setPreviewUrl(session.previewUrl);
      setCost(session.totalCostUsd);
    }
  }, [session, setStatus, setPreviewUrl, setCost]);

  // Sync messages
  useEffect(() => {
    if (polledMessages && polledMessages.length > 0) {
      setMessages(polledMessages);
    }
  }, [polledMessages, setMessages]);

  // Reset store on unmount
  useEffect(() => {
    return () => reset();
  }, [reset]);

  // Send message via REST
  const sendMessage = useCallback(
    (content: string) => {
      if (!sessionId) return;
      api.post(`/sessions/${sessionId}/chat`, { content }).catch((err) => {
        toast.error("Failed to send: " + (err.response?.data?.error || err.message));
      });
    },
    [sessionId]
  );

  // Auto-scroll only on new messages
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMsgCountRef.current = messages.length;
  }, [messages.length]);

  // Auto-resize textarea
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    },
    []
  );

  // Submit message
  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || agentStatus) return;
    sendMessage(trimmed);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, agentStatus, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // ── Action mutations ──────────────────────────────────────────────────────

  const createPr = useMutation({
    mutationFn: () =>
      api.post(`/sessions/${sessionId}/create-pr`),
    onSuccess: (res) => {
      toast.success("Pull request created!");
      if (res.data?.prUrl) {
        window.open(res.data.prUrl, "_blank");
      }
      navigate(-1);
    },
    onError: () => toast.error("Failed to create pull request"),
  });

  const commitToMain = useMutation({
    mutationFn: () =>
      api.post(`/sessions/${sessionId}/commit-to-main`),
    onSuccess: () => {
      toast.success("Changes committed to main branch");
      navigate(-1);
    },
    onError: () => toast.error("Failed to commit to main"),
  });

  const discard = useMutation({
    mutationFn: () =>
      api.post(`/sessions/${sessionId}/discard`),
    onSuccess: () => {
      toast.success("Session discarded");
      navigate(-1);
    },
    onError: () => toast.error("Failed to discard session"),
  });

  const isSessionActive = status === "RUNNING" || status === "STARTING";
  const isSessionEnded =
    status === "COMPLETED" || status === "ERRORED" || status === "TIMED_OUT";
  const anyActionLoading =
    createPr.isPending || commitToMain.isPending || discard.isPending;

  return (
    <div className="flex h-screen flex-col lg:flex-row bg-gray-50">
      {/* ── Left panel: Chat ─────────────────────────────────────────── */}
      <div className="flex flex-col w-full lg:w-1/2 border-r border-gray-200 bg-white">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
          <button
            onClick={() => navigate(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-gray-900 truncate">
              {project?.name ?? "Loading..."}
            </h1>
            {session?.branchName && (
              <p className="text-xs text-gray-400 truncate">
                {session.branchName}
              </p>
            )}
          </div>
          {status && <StatusBadge status={status} />}
          <div className="text-sm font-medium text-gray-500 tabular-nums">
            ${totalCostUsd.toFixed(2)}
          </div>
        </div>

        {/* Messages */}
        <div
          ref={messagesContainerRef}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-0.5 scroll-smooth bg-gray-50"
        >
          {messages.length === 0 && !agentStatus && (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-gray-400">
                No messages yet. Start the conversation.
              </p>
            </div>
          )}
          {messages.map((msg) => (
            <ChatBubble key={msg.id} message={msg} />
          ))}
          {agentStatus && <TypingIndicator status={agentStatus} />}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-gray-200 bg-white p-3">
          {isSessionActive && (
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={
                  agentStatus
                    ? "Waiting for agent..."
                    : "Type a message... (Enter to send, Shift+Enter for newline)"
                }
                disabled={!!agentStatus}
                rows={1}
                className={cn(
                  "flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm",
                  "placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  "transition-colors"
                )}
                autoFocus
              />
              {agentStatus ? (
                <button
                  onClick={() => {}}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors"
                  title="Stop agent"
                >
                  <StopCircle className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors",
                    input.trim()
                      ? "bg-gray-900 text-white hover:bg-gray-800"
                      : "bg-gray-100 text-gray-400 cursor-not-allowed"
                  )}
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {/* Action bar after session ends */}
          {isSessionEnded && !session?.outcome && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => createPr.mutate()}
                disabled={anyActionLoading}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  "bg-gray-900 text-white hover:bg-gray-800",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {createPr.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <GitPullRequest className="h-4 w-4" />
                )}
                Create PR
              </button>
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      "Are you sure you want to commit directly to main?"
                    )
                  ) {
                    commitToMain.mutate();
                  }
                }}
                disabled={anyActionLoading}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium transition-colors",
                  "bg-white text-gray-700 hover:bg-gray-50",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {commitToMain.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <GitMerge className="h-4 w-4" />
                )}
                Commit to Main
              </button>
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      "Are you sure you want to discard all changes?"
                    )
                  ) {
                    discard.mutate();
                  }
                }}
                disabled={anyActionLoading}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium transition-colors",
                  "bg-white text-red-600 hover:bg-red-50",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {discard.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Discard
              </button>
            </div>
          )}

          {/* Outcome display if already resolved */}
          {session?.outcome && (
            <div className="text-sm text-gray-500 text-center py-2">
              {session.outcome === "PR_CREATED" && (
                <span className="inline-flex items-center gap-1.5">
                  <GitPullRequest className="h-4 w-4 text-blue-500" />
                  Pull request created
                  {session.prUrl && (
                    <>
                      {" "}
                      &mdash;{" "}
                      <a
                        href={session.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        View PR
                      </a>
                    </>
                  )}
                </span>
              )}
              {session.outcome === "COMMITTED_TO_MAIN" && (
                <span className="inline-flex items-center gap-1.5">
                  <GitMerge className="h-4 w-4 text-green-500" />
                  Committed to main
                </span>
              )}
              {session.outcome === "DISCARDED" && (
                <span className="inline-flex items-center gap-1.5">
                  <Trash2 className="h-4 w-4 text-gray-400" />
                  Session discarded
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Right panel: Preview ─────────────────────────────────────── */}
      <div className="flex flex-col w-full lg:w-1/2 bg-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Preview</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setVncKey((k) => k + 1)}
              disabled={!previewUrl}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Refresh preview"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Browser preview via VNC */}
        <div className="flex-1 relative">
          {previewUrl ? (
            <VncPreview key={vncKey} wsUrl={previewUrl} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-gray-300 mb-3" />
                <p className="text-sm text-gray-400">
                  {status === "STARTING"
                    ? "Starting sandbox..."
                    : "Connecting to browser..."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
