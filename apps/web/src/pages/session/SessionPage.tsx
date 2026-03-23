import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { useSessionStore } from "../../stores/sessionStore";
import { VncPreview } from "../../components/preview/VncPreview";
import type { Session, ChatMessage, Project, ToolCallEntry } from "@vendi/shared";
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
  CheckCircle2,
  ArrowLeftCircle,
  ChevronDown,
  Terminal,
  FileText,
  FolderOpen,
  Search,
  Wrench,
} from "lucide-react";

// ── Tool call metadata ────────────────────────────────────────────────────────

const TOOL_META: Record<string, { icon: typeof Terminal; label: string; argKey: string }> = {
  shell:        { icon: Terminal, label: "Run",    argKey: "command" },
  bash:         { icon: Terminal, label: "Run",    argKey: "command" },
  run_command:  { icon: Terminal, label: "Run",    argKey: "command" },
  read_file:    { icon: FileText, label: "Read",   argKey: "path" },
  file_read:    { icon: FileText, label: "Read",   argKey: "path" },
  write_file:   { icon: FileText, label: "Write",  argKey: "path" },
  file_write:   { icon: FileText, label: "Write",  argKey: "path" },
  list_files:   { icon: FolderOpen, label: "List", argKey: "path" },
  list_dir:     { icon: FolderOpen, label: "List", argKey: "path" },
  search_code:  { icon: Search, label: "Search",   argKey: "pattern" },
  search:       { icon: Search, label: "Search",   argKey: "query" },
};

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

// ── Tool call detail row ──────────────────────────────────────────────────────

function ToolCallRow({ tc, isExpanded, onToggle }: {
  tc: ToolCallEntry;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const meta = TOOL_META[tc.name] || { icon: Wrench, label: tc.name, argKey: "" };
  const Icon = meta.icon;
  const argValue = meta.argKey && tc.args[meta.argKey]
    ? tc.args[meta.argKey]
    : Object.values(tc.args).join(" ") || tc.name;

  return (
    <div className="border-b border-gray-50 last:border-0">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 px-3 py-1.5 w-full text-left hover:bg-gray-50 transition-colors"
      >
        <Icon className="h-3.5 w-3.5 text-gray-400 shrink-0" />
        <span className="text-xs text-gray-600 truncate flex-1 font-mono">
          {argValue}
        </span>
        {tc.result && (
          <ChevronDown
            className={cn(
              "h-3 w-3 text-gray-300 shrink-0 transition-transform",
              isExpanded && "rotate-180"
            )}
          />
        )}
      </button>
      {isExpanded && tc.result && (
        <pre className="px-3 py-2 bg-gray-50 text-[11px] text-gray-500 overflow-x-auto max-h-40 font-mono whitespace-pre-wrap break-all">
          {tc.result}
        </pre>
      )}
    </div>
  );
}

// ── Chat message ────────────────────────────────────────────────────────────

function ChatBubble({ message }: { message: ChatMessage }) {
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);

  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const filesChanged = message.metadata?.filesChanged;
  const toolCalls = message.metadata?.toolCalls;

  if (message.role === "SYSTEM") {
    const isWorking = message.content.includes("working on it") || message.content.includes("Setting up your project");
    const systemToolCalls = toolCalls;
    const hasToolCalls = systemToolCalls && systemToolCalls.length > 0;

    // "Working" messages always get the enhanced UI with bouncing dots
    if (isWorking) {
      return (
        <div className="flex justify-start my-3">
          <div className="max-w-[80%] bg-white border border-gray-200 rounded-2xl rounded-bl-md shadow-sm overflow-hidden">
            <button
              onClick={() => hasToolCalls && setToolsExpanded((v) => !v)}
              className={cn(
                "flex items-center gap-2 px-4 py-3 w-full transition-colors",
                hasToolCalls && "hover:bg-gray-50 cursor-pointer"
              )}
            >
              <div className="flex gap-1">
                <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
                <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
                <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
              </div>
              <span className="text-xs text-gray-400 ml-1">
                {message.content.includes("Setting up") ? "Setting up project..." : "Codex is working..."}
              </span>
              {hasToolCalls && (
                <>
                  <span className="text-xs text-gray-300 ml-auto tabular-nums">
                    {systemToolCalls.length} {systemToolCalls.length === 1 ? "call" : "calls"}
                  </span>
                  <ChevronDown className={cn("h-3 w-3 text-gray-300 transition-transform", toolsExpanded && "rotate-180")} />
                </>
              )}
            </button>
            {toolsExpanded && hasToolCalls && (
              <div className="border-t border-gray-100 max-h-64 overflow-y-auto">
                {systemToolCalls.map((tc) => (
                  <ToolCallRow
                    key={tc.id}
                    tc={tc}
                    isExpanded={expandedToolId === tc.id}
                    onToggle={() => setExpandedToolId(expandedToolId === tc.id ? null : tc.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

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
          "max-w-[80%] rounded-2xl text-sm leading-relaxed overflow-hidden",
          isUser
            ? "bg-gray-900 text-white rounded-br-md"
            : "bg-white border border-gray-200 text-gray-800 rounded-bl-md shadow-sm"
        )}
      >
        <div className="px-4 py-2.5">
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

        {/* Expandable tool calls for assistant messages */}
        {!isUser && toolCalls && toolCalls.length > 0 && (
          <div className="border-t border-gray-100">
            <button
              onClick={() => setToolsExpanded((v) => !v)}
              className="flex items-center gap-2 px-4 py-2 w-full hover:bg-gray-50 transition-colors"
            >
              <Wrench className="h-3 w-3 text-gray-400" />
              <span className="text-xs text-gray-400">
                {toolCalls.length} tool {toolCalls.length === 1 ? "call" : "calls"}
              </span>
              <ChevronDown
                className={cn(
                  "h-3 w-3 text-gray-300 ml-auto transition-transform",
                  toolsExpanded && "rotate-180"
                )}
              />
            </button>

            {toolsExpanded && (
              <div className="border-t border-gray-100 max-h-64 overflow-y-auto">
                {toolCalls.map((tc) => (
                  <ToolCallRow
                    key={tc.id}
                    tc={tc}
                    isExpanded={expandedToolId === tc.id}
                    onToggle={() =>
                      setExpandedToolId(expandedToolId === tc.id ? null : tc.id)
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
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
  const [showActions, setShowActions] = useState(false);

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

        {/* Input / Actions */}
        <div className="border-t border-gray-200 bg-white p-3">
          {/* Chat input — visible when session active and not in "done" mode */}
          {isSessionActive && !showActions && (
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
                <>
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
                  <button
                    onClick={() => setShowActions(true)}
                    className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-green-600 text-white px-4 hover:bg-green-700 transition-colors text-sm font-medium"
                    title="Finish editing and choose what to do with changes"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Done
                  </button>
                </>
              )}
            </div>
          )}

          {/* Action buttons — visible after clicking "Done" or when session ended naturally */}
          {((isSessionActive && showActions) || isSessionEnded) && !session?.outcome && (
            <div className="space-y-3">
              <div className="text-sm font-medium text-gray-700 text-center">
                What would you like to do with your changes?
              </div>
              <div className="flex items-center justify-center gap-2 flex-wrap">
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
              {/* Back to chat — only if session is still running */}
              {isSessionActive && (
                <div className="flex justify-center">
                  <button
                    onClick={() => setShowActions(false)}
                    disabled={anyActionLoading}
                    className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                  >
                    <ArrowLeftCircle className="h-3.5 w-3.5" />
                    Back to chat
                  </button>
                </div>
              )}
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
