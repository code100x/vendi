import type { WebSocket, RawData } from "ws";
import { lucia } from "../lib/auth";
import { COOKIE_NAME } from "../config/constants";
import { joinRoom, leaveRoom, leaveAllRooms } from "./rooms";
import { sendMessage } from "../services/session.service";
import { sendSetupMessage } from "../services/setup.service";
import type { WsClientMessage } from "@vendi/shared";
import type { IncomingMessage } from "http";

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [key, ...rest] = c.trim().split("=");
      return [key, rest.join("=")];
    })
  );
}

export async function handleWsConnection(ws: WebSocket, req: IncomingMessage) {
  // Authenticate via session cookie
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[COOKIE_NAME];

  if (!sessionId) {
    ws.close(4001, "Unauthorized");
    return;
  }

  const { session, user } = await lucia.validateSession(sessionId);
  if (!session || !user) {
    ws.close(4001, "Unauthorized");
    return;
  }

  ws.on("message", async (data: RawData) => {
    try {
      const msg: WsClientMessage = JSON.parse(data.toString());

      switch (msg.type) {
        case "join_session":
          joinRoom(msg.sessionId, ws);
          break;

        case "leave_session":
          leaveRoom(msg.sessionId, ws);
          break;

        case "chat_message":
          // Run agent turn asynchronously
          sendMessage(msg.sessionId, msg.content).catch((error) => {
            const errorMsg = JSON.stringify({
              type: "error",
              sessionId: msg.sessionId,
              message: error instanceof Error ? error.message : "Agent error",
            });
            ws.send(errorMsg);
          });
          break;

        case "setup_message":
          sendSetupMessage(msg.projectId, msg.content).catch((error) => {
            const errorMsg = JSON.stringify({
              type: "error",
              sessionId: msg.projectId,
              message: error instanceof Error ? error.message : "Setup error",
            });
            ws.send(errorMsg);
          });
          break;

        case "stop_session":
          // Handled via REST endpoints (create-pr, commit-to-main, discard)
          break;
      }
    } catch (error) {
      console.error("WebSocket message error:", error);
    }
  });

  ws.on("close", () => {
    leaveAllRooms(ws);
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    leaveAllRooms(ws);
  });
}
