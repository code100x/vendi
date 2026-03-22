import type { WebSocket } from "ws";

const rooms = new Map<string, Set<WebSocket>>();

export function joinRoom(sessionId: string, ws: WebSocket): void {
  if (!rooms.has(sessionId)) {
    rooms.set(sessionId, new Set());
  }
  rooms.get(sessionId)!.add(ws);
}

export function leaveRoom(sessionId: string, ws: WebSocket): void {
  const room = rooms.get(sessionId);
  if (room) {
    room.delete(ws);
    if (room.size === 0) rooms.delete(sessionId);
  }
}

export function leaveAllRooms(ws: WebSocket): void {
  for (const [sessionId, room] of rooms) {
    room.delete(ws);
    if (room.size === 0) rooms.delete(sessionId);
  }
}

export function broadcastToRoom(sessionId: string, message: object): void {
  const room = rooms.get(sessionId);
  if (!room) return;
  const data = JSON.stringify(message);
  for (const ws of room) {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }
}

export function getRoomSize(sessionId: string): number {
  return rooms.get(sessionId)?.size ?? 0;
}
