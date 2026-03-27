import { useEffect, useRef, useState, useCallback } from "react";

// RFB is the noVNC client class
// @ts-ignore - noVNC doesn't have great types
import RFB from "@novnc/novnc/core/rfb.js";

interface VncPreviewProps {
  wsUrl: string | null;
}

export function VncPreview({ wsUrl }: VncPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<any>(null);
  const [connectionState, setConnectionState] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("disconnected");

  const connect = useCallback(() => {
    if (!wsUrl || !containerRef.current) return;

    // Clean up existing connection
    if (rfbRef.current) {
      rfbRef.current.disconnect();
      rfbRef.current = null;
    }

    // Clear the container
    containerRef.current.innerHTML = "";

    setConnectionState("connecting");

    try {
      const rfb = new RFB(containerRef.current, wsUrl);

      rfb.viewOnly = false; // Allow interaction
      rfb.scaleViewport = true; // Scale to fit container
      rfb.resizeSession = true; // Resize remote display to match
      rfb.clipViewport = false;
      rfb.showDotCursor = true;

      rfb.addEventListener("connect", () => {
        setConnectionState("connected");
      });

      rfb.addEventListener("disconnect", (e: any) => {
        setConnectionState(e.detail?.clean ? "disconnected" : "error");
      });

      rfbRef.current = rfb;
    } catch (err) {
      console.error("VNC connection error:", err);
      setConnectionState("error");
    }
  }, [wsUrl]);

  // Connect when wsUrl changes
  useEffect(() => {
    connect();

    return () => {
      if (rfbRef.current) {
        rfbRef.current.disconnect();
        rfbRef.current = null;
      }
    };
  }, [connect]);

  return (
    <div className="relative h-full w-full">
      {connectionState === "connecting" && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-gray-900 mb-3" />
            <p className="text-sm text-gray-400">Connecting to browser...</p>
          </div>
        </div>
      )}
      {connectionState === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
          <div className="text-center">
            <p className="text-sm text-red-500 mb-2">Connection lost</p>
            <button
              onClick={connect}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Reconnect
            </button>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ touchAction: "none" }}
      />
    </div>
  );
}
