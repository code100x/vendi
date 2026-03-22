import { WebSocketServer } from "ws";
import type { Server as HttpServer } from "http";
import { handleWsConnection } from "../ws/handler";

export function setupWebSocket(httpServer: HttpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    handleWsConnection(ws, req);
  });

  return wss;
}
