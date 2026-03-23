import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { encrypt } from "../lib/crypto";
import { requireOrg } from "../middleware/requireOrg";
import { createProjectSchema, updateProjectConfigSchema } from "@vendi/shared";
import { buildProjectTemplate } from "../services/template.service";
import { startSetupSession, sendSetupMessage, isSetupActive, getSetupState, resetSetup } from "../services/setup.service";

const router = Router({ mergeParams: true });

// Helper to extract orgId from merged params (comes from parent route /orgs/:orgId)
function getOrgId(req: Request): string {
  return (req.params as Record<string, string>).orgId;
}

function getProjectId(req: Request): string {
  return (req.params as Record<string, string>).projectId;
}

// POST /orgs/:orgId/projects — create a new project within an organization
router.post("/", requireOrg("ADMIN"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);

    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const { name, githubRepoFullName, githubRepoUrl, defaultBranch } =
      parsed.data;

    // Check if a project with this repo already exists in the org
    const existing = await prisma.project.findUnique({
      where: { orgId_githubRepoFullName: { orgId, githubRepoFullName } },
    });

    if (existing) {
      return res.status(409).json({
        error:
          "A project with this repository already exists in the organization",
      });
    }

    // Handle optional envVars from body
    let envVarsEncrypted: string | null = null;
    let envVarsIv: string | null = null;

    if (req.body.envVars && typeof req.body.envVars === "object") {
      const { encrypted, iv } = encrypt(JSON.stringify(req.body.envVars));
      envVarsEncrypted = encrypted;
      envVarsIv = iv;
    }

    const project = await prisma.project.create({
      data: {
        orgId,
        name,
        githubRepoFullName,
        githubRepoUrl,
        defaultBranch,
        envVars: envVarsEncrypted,
        envVarsIv,
      },
    });

    return res.status(201).json(project);
  } catch (error) {
    console.error("Error creating project:", error);
    return res.status(500).json({ error: "Failed to create project" });
  }
});

// GET /orgs/:orgId/projects — list all projects in an organization
router.get("/", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);

    const projects = await prisma.project.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    });

    return res.json(projects);
  } catch (error) {
    console.error("Error listing projects:", error);
    return res.status(500).json({ error: "Failed to list projects" });
  }
});

// GET /orgs/:orgId/projects/:projectId — get a single project by ID
router.get("/:projectId", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const projectId = getProjectId(req);

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project || project.orgId !== orgId) {
      return res.status(404).json({ error: "Project not found" });
    }

    return res.json(project);
  } catch (error) {
    console.error("Error fetching project:", error);
    return res.status(500).json({ error: "Failed to fetch project" });
  }
});

// PUT /orgs/:orgId/projects/:projectId — update project settings
router.put("/:projectId", requireOrg("ADMIN"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const projectId = getProjectId(req);

    // Verify project belongs to org
    const existing = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!existing || existing.orgId !== orgId) {
      return res.status(404).json({ error: "Project not found" });
    }

    const parsed = updateProjectConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const updateData: Record<string, any> = { ...parsed.data };

    // Handle optional envVars from body (not part of the zod schema)
    if (req.body.envVars !== undefined) {
      if (
        req.body.envVars === null ||
        (typeof req.body.envVars === "object" &&
          Object.keys(req.body.envVars).length === 0)
      ) {
        updateData.envVars = null;
        updateData.envVarsIv = null;
      } else if (typeof req.body.envVars === "object") {
        const { encrypted, iv } = encrypt(JSON.stringify(req.body.envVars));
        updateData.envVars = encrypted;
        updateData.envVarsIv = iv;
      }
    }

    const project = await prisma.project.update({
      where: { id: projectId },
      data: updateData,
    });

    return res.json(project);
  } catch (error) {
    console.error("Error updating project:", error);
    return res.status(500).json({ error: "Failed to update project" });
  }
});

// POST /orgs/:orgId/projects/:projectId/build-template — trigger e2b template build
router.post(
  "/:projectId/build-template",
  requireOrg("ADMIN"),
  async (req: Request, res: Response) => {
    try {
      const orgId = getOrgId(req);
      const projectId = getProjectId(req);

      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project || project.orgId !== orgId) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Set status to BUILDING immediately and respond
      await prisma.project.update({
        where: { id: projectId },
        data: { templateStatus: "BUILDING", templateBuildLog: null },
      });

      // Kick off the build asynchronously (don't await — it takes minutes)
      buildProjectTemplate(projectId).catch((err) => {
        console.error("Template build failed:", err);
      });

      const updated = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
      });

      return res.json(updated);
    } catch (error) {
      console.error("Error triggering template build:", error);
      return res
        .status(500)
        .json({ error: "Failed to trigger template build" });
    }
  }
);

// GET /orgs/:orgId/projects/:projectId/template-status — check template build status
router.get("/:projectId/template-status", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const projectId = getProjectId(req);

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        orgId: true,
        templateStatus: true,
        templateBuildLog: true,
      },
    });

    if (!project || project.orgId !== orgId) {
      return res.status(404).json({ error: "Project not found" });
    }

    return res.json({
      templateStatus: project.templateStatus,
      templateBuildLog: project.templateBuildLog,
    });
  } catch (error) {
    console.error("Error fetching template status:", error);
    return res
      .status(500)
      .json({ error: "Failed to fetch template status" });
  }
});

// GET /orgs/:orgId/projects/:projectId/active-sessions — list active sessions for conflict detection
router.get("/:projectId/active-sessions", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const projectId = getProjectId(req);

    // Verify project belongs to org
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, orgId: true },
    });

    if (!project || project.orgId !== orgId) {
      return res.status(404).json({ error: "Project not found" });
    }

    const sessions = await prisma.session.findMany({
      where: {
        projectId,
        status: { in: ["STARTING", "RUNNING"] },
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
      },
      orderBy: { startedAt: "desc" },
    });

    return res.json(sessions);
  } catch (error) {
    console.error("Error fetching active sessions:", error);
    return res
      .status(500)
      .json({ error: "Failed to fetch active sessions" });
  }
});

// POST /orgs/:orgId/projects/:projectId/setup/start — start an AI-guided setup session
router.post(
  "/:projectId/setup/start",
  requireOrg("ADMIN"),
  async (req: Request, res: Response) => {
    try {
      const projectId = getProjectId(req);
      const userId = res.locals.user.id;

      if (await isSetupActive(projectId)) {
        return res.json({ setupId: projectId, status: "already_active" });
      }

      // Fire and forget — setup sends progress via WebSocket
      startSetupSession(projectId, userId).catch((err) => {
        console.error("Setup session failed:", err);
      });
      return res.json({ setupId: projectId, status: "started" });
    } catch (error) {
      console.error("Error starting setup:", error);
      return res
        .status(500)
        .json({ error: error instanceof Error ? error.message : "Failed to start setup" });
    }
  }
);

// POST /orgs/:orgId/projects/:projectId/setup/message — send a message in the setup chat
router.post(
  "/:projectId/setup/message",
  requireOrg("ADMIN"),
  async (req: Request, res: Response) => {
    try {
      const projectId = getProjectId(req);
      const userId = res.locals.user.id;
      const { content } = req.body;

      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "Message content required" });
      }

      await sendSetupMessage(projectId, content);
      return res.json({ success: true });
    } catch (error) {
      console.error("Error in setup message:", error);
      return res
        .status(500)
        .json({ error: error instanceof Error ? error.message : "Failed to send message" });
    }
  }
);

// GET /orgs/:orgId/projects/:projectId/setup/state — poll setup state
router.get(
  "/:projectId/setup/state",
  requireOrg(),
  async (req: Request, res: Response) => {
    const projectId = getProjectId(req);
    const state = await getSetupState(projectId);
    if (!state) {
      return res.json({ active: false, messages: [], status: "", isProcessing: false });
    }
    return res.json({ active: true, ...state });
  }
);

// POST /orgs/:orgId/projects/:projectId/setup/reset — restart setup from scratch
router.post(
  "/:projectId/setup/reset",
  requireOrg("ADMIN"),
  async (req: Request, res: Response) => {
    try {
      const projectId = getProjectId(req);
      await resetSetup(projectId);
      return res.json({ ok: true });
    } catch (e) {
      console.error("Reset setup error:", e);
      return res.status(500).json({ error: "Failed to reset setup" });
    }
  }
);

// DELETE /orgs/:orgId/projects/:projectId — delete a project
router.delete("/:projectId", requireOrg("ADMIN"), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const projectId = getProjectId(req);

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project || project.orgId !== orgId) {
      return res.status(404).json({ error: "Project not found" });
    }

    await prisma.project.delete({
      where: { id: projectId },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("Error deleting project:", error);
    return res.status(500).json({ error: "Failed to delete project" });
  }
});

export default router;
