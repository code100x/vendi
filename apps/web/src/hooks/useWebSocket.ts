import { useEffect, useRef, useCallback } from "react";
import { useSessionStore } from "../stores/sessionStore";
import type { WsClientMessage, WsServerMessage } from "@vendi/shared";
import { toast } from "sonner";

export function useWebSocket(sessionId: string | undefined) {
  const wsRef = useRef<WebSocket | null>(null);
  const { addMessage, setStatus, setPreviewUrl, setAgentStatus, setCost } =
    useSessionStore();

  useEffect(() => {
    if (!sessionId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "join_session",
          sessionId,
        } satisfies WsClientMessage)
      );
    };

    ws.onmessage = (event) => {
      const msg: WsServerMessage = JSON.parse(event.data);

      switch (msg.type) {
        case "session_status":
          setStatus(msg.status);
          if (msg.previewUrl) setPreviewUrl(msg.previewUrl);
          break;
        case "chat_message":
          addMessage(msg.message);
          break;
        case "agent_status":
          setAgentStatus(msg.status || null);
          break;
        case "agent_streaming":
          setAgentStatus(msg.delta ? "Typing..." : null);
          break;
        case "preview_updated":
          // Browser in sandbox auto-refreshes, no action needed
          break;
        case "cost_update":
          setCost(msg.totalCostUsd);
          break;
        case "error":
          toast.error(msg.message);
          break;
        case "conflict_warning":
          toast.warning(
            `Other users are active on this project: ${msg.otherSessions.map((s) => s.userName).join(", ")}`
          );
          break;
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "leave_session",
            sessionId,
          } satisfies WsClientMessage)
        );
      }
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId, addMessage, setStatus, setPreviewUrl, setAgentStatus, setCost]);

  const sendMessage = useCallback(
    (content: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && sessionId) {
        wsRef.current.send(
          JSON.stringify({
            type: "chat_message",
            sessionId,
            content,
          } satisfies WsClientMessage)
        );
      }
    },
    [sessionId]
  );

  const stopSession = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && sessionId) {
      wsRef.current.send(
        JSON.stringify({
          type: "stop_session",
          sessionId,
        } satisfies WsClientMessage)
      );
    }
  }, [sessionId]);

  return { sendMessage, stopSession };
}
