import { createServer } from "http";
import { app } from "./app";
import { env } from "./config/env";
import { setupWebSocket } from "./lib/ws";
import { prisma } from "./lib/prisma";
import { Sandbox } from "e2b";

const server = createServer(app);

// Set up WebSocket server on the same HTTP server
setupWebSocket(server);

server.listen(env.PORT, () => {
  console.log(`Server running on port ${env.PORT}`);
});

// Cleanup orphaned sandboxes every 5 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

async function cleanupOrphanedSandboxes() {
  try {
    const stale = await prisma.session.findMany({
      where: {
        sandboxId: { not: null },
        status: { in: ["RUNNING", "STARTING"] },
        startedAt: {
          lt: new Date(Date.now() - 60 * 60 * 1000), // older than 1 hour
        },
      },
    });

    for (const session of stale) {
      try {
        if (session.sandboxId) {
          const sandbox = await Sandbox.connect(session.sandboxId);
          await sandbox.kill();
        }
        await prisma.session.update({
          where: { id: session.id },
          data: {
            status: "TIMED_OUT",
            endedAt: new Date(),
            sandboxId: null,
          },
        });
        console.log(`Cleaned up orphaned sandbox for session ${session.id}`);
      } catch (err) {
        console.error(`Failed to cleanup session ${session.id}:`, err);
      }
    }
  } catch (err) {
    console.error("Cleanup job error:", err);
  }
}

setInterval(cleanupOrphanedSandboxes, CLEANUP_INTERVAL_MS);
