import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { toast } from "sonner";
import type { Project } from "@vendi/shared";
import {
  ArrowLeft,
  Send,
  Loader2,
  Bot,
  CheckCircle2,
} from "lucide-react";

interface SetupMsg {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  createdAt: string;
}

interface SetupState {
  active: boolean;
  messages: SetupMsg[];
  status: string;
  isProcessing: boolean;
}

export function ProjectSetup() {
  const { orgId, projectId } = useParams<{ orgId: string; projectId: string }>();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const setupTriggeredRef = useRef(false);

  const [messages, setMessages] = useState<SetupMsg[]>([]);
  const [input, setInput] = useState("");
  const [agentStatus, setAgentStatus] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);

  // Fetch project details
  const { data: project } = useQuery({
    queryKey: ["orgs", orgId, "projects", projectId],
    queryFn: async () => {
      const { data } = await api.get<Project>(`/orgs/${orgId}/projects/${projectId}`);
      return data;
    },
    enabled: !!orgId && !!projectId,
    refetchInterval: setupComplete ? 5000 : false,
  });

  // Start setup on mount (once)
  useEffect(() => {
    if (!orgId || !projectId || setupTriggeredRef.current) return;
    setupTriggeredRef.current = true;

    api.post(`/orgs/${orgId}/projects/${projectId}/setup/start`).catch((err) => {
      toast.error("Failed to start setup: " + (err.response?.data?.error || err.message));
    });
  }, [orgId, projectId]);

  // Poll for state every second
  useEffect(() => {
    if (!orgId || !projectId || setupComplete) return;

    const interval = setInterval(async () => {
      try {
        const { data } = await api.get<SetupState>(
          `/orgs/${orgId}/projects/${projectId}/setup/state`
        );

        if (data.messages.length > 0) {
          setMessages(data.messages);
        }
        setAgentStatus(data.status || "");
        setIsProcessing(data.isProcessing);

        // Check for completion
        const hasComplete = data.messages.some(
          (m) => m.role === "SYSTEM" && m.content.includes("configured successfully")
        );
        if (hasComplete) {
          setSetupComplete(true);
        }
      } catch {
        // ignore polling errors
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [orgId, projectId, setupComplete]);

  // Auto-scroll only when message count changes
  const prevCountRef = useRef(0);
  useEffect(() => {
    if (messages.length > prevCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevCountRef.current = messages.length;
  }, [messages.length]);

  // Handle input
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isProcessing || setupComplete) return;

    api.post(`/orgs/${orgId}/projects/${projectId}/setup/message`, { content: trimmed })
      .catch((err) => toast.error("Failed to send message"));

    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, isProcessing, setupComplete, orgId, projectId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const templateStatus = project?.templateStatus;

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 bg-white rounded-t-xl">
        <button
          onClick={() => navigate(`/orgs/${orgId}`)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-gray-900">
            Setting up {project?.name ?? "project"}
          </h1>
          <p className="text-xs text-gray-400">{project?.githubRepoFullName}</p>
        </div>
        <Bot className="h-5 w-5 text-gray-400" />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-gray-300 mb-3" />
              <p className="text-sm text-gray-500 font-medium">
                {agentStatus || "Starting setup..."}
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => {
          if (msg.role === "SYSTEM") {
            return (
              <div key={msg.id} className="flex justify-center my-3">
                <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-4 py-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {msg.content}
                </div>
              </div>
            );
          }

          const isUser = msg.role === "USER";
          return (
            <div key={msg.id} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                isUser
                  ? "bg-gray-900 text-white rounded-br-md"
                  : "bg-white border border-gray-200 text-gray-800 rounded-bl-md shadow-sm"
              )}>
                <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              </div>
            </div>
          );
        })}

        {isProcessing && messages.length > 0 && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
                  <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
                  <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
                </div>
                <span className="text-xs text-gray-400 ml-1">{agentStatus || "Thinking..."}</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Template build status */}
      {setupComplete && templateStatus && (
        <div className={cn(
          "px-4 py-2 text-sm border-t",
          templateStatus === "BUILDING" && "bg-yellow-50 text-yellow-800 border-yellow-200",
          templateStatus === "READY" && "bg-green-50 text-green-800 border-green-200",
          templateStatus === "FAILED" && "bg-red-50 text-red-800 border-red-200"
        )}>
          {templateStatus === "BUILDING" && (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Building template... This may take a few minutes.
            </span>
          )}
          {templateStatus === "READY" && (
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Template ready! You can now start sessions.
              <button
                onClick={() => navigate(`/orgs/${orgId}`)}
                className="ml-auto rounded-lg bg-green-700 px-3 py-1 text-xs font-medium text-white hover:bg-green-800"
              >
                Go to Dashboard
              </button>
            </span>
          )}
          {templateStatus === "FAILED" && (
            <span>Template build failed. Check the build log.</span>
          )}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-200 bg-white p-3 rounded-b-xl">
        {!setupComplete ? (
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={isProcessing ? "Waiting for response..." : "Type your response... (Enter to send)"}
              disabled={isProcessing || messages.length === 0}
              rows={1}
              className={cn(
                "flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm",
                "placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300",
                "disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              )}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isProcessing || setupComplete}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors",
                input.trim() && !isProcessing
                  ? "bg-gray-900 text-white hover:bg-gray-800"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              )}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-1">
            Setup complete. Configuration has been saved.
          </p>
        )}
      </div>
    </div>
  );
}
