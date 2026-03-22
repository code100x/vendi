import { prisma } from "../lib/prisma";
import { stopSandbox } from "../services/sandbox.service";

const MAX_SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours max

export async function cleanupOrphanedSandboxes(): Promise<void> {
  // Find sessions that should be stopped
  const staleSessions = await prisma.session.findMany({
    where: {
      sandboxId: { not: null },
      status: { in: ["COMPLETED", "ERRORED", "TIMED_OUT"] },
    },
    select: { id: true, sandboxId: true },
  });

  for (const session of staleSessions) {
    if (session.sandboxId) {
      console.log(
        `Cleaning up sandbox ${session.sandboxId} for session ${session.id}`
      );
      await stopSandbox(session.sandboxId);
      await prisma.session.update({
        where: { id: session.id },
        data: { sandboxId: null },
      });
    }
  }

  // Also check for sessions that have been running too long
  const overdueSessions = await prisma.session.findMany({
    where: {
      status: { in: ["STARTING", "RUNNING"] },
      startedAt: {
        lt: new Date(Date.now() - MAX_SESSION_DURATION_MS),
      },
    },
    select: { id: true, sandboxId: true },
  });

  for (const session of overdueSessions) {
    console.log(`Timing out session ${session.id}`);
    if (session.sandboxId) {
      await stopSandbox(session.sandboxId);
    }
    await prisma.session.update({
      where: { id: session.id },
      data: { status: "TIMED_OUT", endedAt: new Date(), sandboxId: null },
    });
  }
}
