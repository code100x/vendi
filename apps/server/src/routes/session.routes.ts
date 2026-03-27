import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { startSessionSchema } from "@vendi/shared";
import {
  startSession,
  sendMessage,
  createSessionPR,
  commitToMain,
  discardSession,
} from "../services/session.service";
import { syncAgentProgress } from "../services/agent.service";

const router = Router();

// Helper: verify user is a member of the org that owns a session's project.
// Returns the session (with project included) or null if not found / no access.
async function getSessionWithAccess(
  sessionId: string,
  userId: string,
  res: Response
) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      project: {
        include: { org: true },
      },
    },
  });

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return null;
  }

  const membership = await prisma.orgMember.findUnique({
    where: {
      userId_orgId: { userId, orgId: session.project.orgId },
    },
  });

  if (!membership) {
    res.status(403).json({ error: "Not a member of this organization" });
    return null;
  }

  return { session, membership };
}

// POST / — Start a new session
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = res.locals.user.id as string;

    const parsed = startSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const { projectId } = parsed.data;

    // Verify user exists and has GitHub linked
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { githubId: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.githubId) {
      return res
        .status(400)
        .json({ error: "GitHub account not linked. Please connect your GitHub account before starting a session." });
    }

    // Verify the project exists and user is a member of the owning org
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, orgId: true, templateStatus: true },
    });

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const membership = await prisma.orgMember.findUnique({
      where: {
        userId_orgId: { userId, orgId: project.orgId },
      },
    });

    if (!membership) {
      return res
        .status(403)
        .json({ error: "Not a member of this organization" });
    }

    // Verify project is configured
    if (project.templateStatus !== "READY") {
      return res
        .status(400)
        .json({ error: `Project is not configured yet. Please complete setup first.` });
    }

    // Start the session via service
    const session = await startSession(projectId, userId);

    return res.status(201).json({
      id: session.id,
      status: session.status,
      previewUrl: session.previewUrl,
      sandboxId: session.sandboxId,
      branchName: session.branchName,
      projectId: session.projectId,
      startedAt: session.startedAt,
    });
  } catch (error) {
    console.error("Error starting session:", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to start session" });
  }
});

// GET /by-user — List current user's sessions across all orgs
router.get("/by-user", async (req: Request, res: Response) => {
  try {
    const userId = res.locals.user.id as string;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    const [sessions, total] = await Promise.all([
      prisma.session.findMany({
        where: { userId },
        include: {
          project: {
            select: {
              id: true,
              name: true,
              githubRepoFullName: true,
              org: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                },
              },
            },
          },
        },
        orderBy: { startedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.session.count({ where: { userId } }),
    ]);

    return res.json({
      sessions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error listing user sessions:", error);
    return res.status(500).json({ error: "Failed to list sessions" });
  }
});

// GET /by-org/:orgId — List all sessions for an org
router.get("/by-org/:orgId", async (req: Request, res: Response) => {
  try {
    const userId = res.locals.user.id as string;
    const orgId = req.params.orgId as string;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    // Verify user is a member of the org
    const membership = await prisma.orgMember.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });

    if (!membership) {
      return res
        .status(403)
        .json({ error: "Not a member of this organization" });
    }

    const [sessions, total] = await Promise.all([
      prisma.session.findMany({
        where: {
          project: { orgId },
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
          project: {
            select: {
              id: true,
              name: true,
              githubRepoFullName: true,
            },
          },
        },
        orderBy: { startedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.session.count({
        where: { project: { orgId } },
      }),
    ]);

    return res.json({
      sessions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error listing org sessions:", error);
    return res.status(500).json({ error: "Failed to list sessions" });
  }
});

// GET /:sessionId — Get session details
router.get("/:sessionId", async (req: Request, res: Response) => {
  try {
    const userId = res.locals.user.id as string;
    const sessionId = req.params.sessionId as string;

    const result = await getSessionWithAccess(sessionId, userId, res);
    if (!result) return;

    return res.json(result.session);
  } catch (error) {
    console.error("Error fetching session:", error);
    return res.status(500).json({ error: "Failed to fetch session" });
  }
});

// POST /:sessionId/chat — Send a chat message
router.post("/:sessionId/chat", async (req: Request, res: Response) => {
  try {
    const userId = res.locals.user.id as string;
    const sessionId = req.params.sessionId as string;
    const { content } = req.body;

    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "Message content required" });
    }

    const result = await getSessionWithAccess(sessionId, userId, res);
    if (!result) return;

    // Fire and forget — agent runs async, results polled via GET /messages
    console.log(`[Chat] Sending message to session ${sessionId}`);
    sendMessage(sessionId, content).then(() => {
      console.log(`[Chat] Agent turn completed for session ${sessionId}`);
    }).catch((e) => {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[Chat] Agent turn failed for session ${sessionId}:`, errMsg);
      prisma.chatMessage.create({
        data: { sessionId, role: "SYSTEM", content: `Error: ${errMsg.substring(0, 200)}. Please try again.` },
      }).catch(() => {});
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("Error sending chat message:", error);
    return res.status(500).json({ error: "Failed to send message" });
  }
});

// GET /:sessionId/messages — Get chat messages for a session
router.get("/:sessionId/messages", async (req: Request, res: Response) => {
  try {
    const userId = res.locals.user.id as string;
    const sessionId = req.params.sessionId as string;

    const result = await getSessionWithAccess(sessionId, userId, res);
    if (!result) return;

    // Lazy sync: if agent is running, read log from sandbox and update DB
    await syncAgentProgress(sessionId).catch((err) => {
      console.error(`[Messages] Sync error for ${sessionId}:`, err);
    });

    const messages = await prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    });

    return res.json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    return res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// POST /:sessionId/create-pr — Create PR from session
router.post("/:sessionId/create-pr", async (req: Request, res: Response) => {
  try {
    const userId = res.locals.user.id as string;
    const sessionId = req.params.sessionId as string;

    const result = await getSessionWithAccess(sessionId, userId, res);
    if (!result) return;

    const { prUrl } = await createSessionPR(sessionId, userId);

    return res.json({ prUrl });
  } catch (error) {
    console.error("Error creating PR:", error);
    return res.status(500).json({ error: "Failed to create pull request" });
  }
});

// POST /:sessionId/commit-to-main — Commit to main
router.post("/:sessionId/commit-to-main", async (req: Request, res: Response) => {
  try {
    const userId = res.locals.user.id as string;
    const sessionId = req.params.sessionId as string;

    const result = await getSessionWithAccess(sessionId, userId, res);
    if (!result) return;

    // Verify user is ADMIN of the project's org
    if (result.membership.role !== "ADMIN") {
      return res
        .status(403)
        .json({ error: "Admin access required to commit directly to main" });
    }

    const { prUrl, commitSha } = await commitToMain(sessionId, userId);

    return res.json({ prUrl, commitSha });
  } catch (error) {
    console.error("Error committing to main:", error);
    return res.status(500).json({ error: "Failed to commit to main" });
  }
});

// POST /:sessionId/discard — Discard session
router.post("/:sessionId/discard", async (req: Request, res: Response) => {
  try {
    const userId = res.locals.user.id as string;
    const sessionId = req.params.sessionId as string;

    const result = await getSessionWithAccess(sessionId, userId, res);
    if (!result) return;

    await discardSession(sessionId, userId);

    return res.json({ success: true });
  } catch (error) {
    console.error("Error discarding session:", error);
    return res.status(500).json({ error: "Failed to discard session" });
  }
});

export default router;
