import { Router } from "express";
import { nanoid } from "nanoid";
import { prisma } from "../lib/prisma";
import { requireOrg } from "../middleware/requireOrg";
import { INVITE_EXPIRY_MS } from "../config/constants";
import { createOrgSchema, createInviteSchema } from "@vendi/shared";

const router = Router();

// POST /orgs — create a new organization
router.post("/", async (req, res, next) => {
  try {
    const parsed = createOrgSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const userId = res.locals.user.id as string;
    const { name, slug } = parsed.data;

    // Check slug uniqueness
    const existing = await prisma.organization.findUnique({ where: { slug } });
    if (existing) {
      return res.status(409).json({ error: "An organization with this slug already exists" });
    }

    const org = await prisma.organization.create({
      data: {
        name,
        slug,
        members: {
          create: {
            userId,
            role: "ADMIN",
          },
        },
      },
      include: {
        members: true,
      },
    });

    return res.status(201).json(org);
  } catch (err) {
    next(err);
  }
});

// GET /orgs — list all organizations for the current user
router.get("/", async (_req, res, next) => {
  try {
    const userId = res.locals.user.id as string;

    const memberships = await prisma.orgMember.findMany({
      where: { userId },
      include: {
        org: true,
      },
    });

    const orgs = memberships.map((m: (typeof memberships)[number]) => ({
      ...m.org,
      role: m.role,
    }));

    return res.json(orgs);
  } catch (err) {
    next(err);
  }
});

// GET /orgs/:orgId — get a single organization by ID
router.get("/:orgId", requireOrg(), async (req, res, next) => {
  try {
    const orgId = req.params.orgId as string;

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        _count: {
          select: { members: true },
        },
      },
    });

    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    return res.json(org);
  } catch (err) {
    next(err);
  }
});

// PUT /orgs/:orgId — update organization details
router.put("/:orgId", requireOrg("ADMIN"), async (req, res, next) => {
  try {
    const orgId = req.params.orgId as string;
    const { name, slug } = req.body;

    const data: Record<string, string> = {};
    if (name !== undefined) data.name = name;
    if (slug !== undefined) {
      // Validate slug format
      if (typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({ error: "Invalid slug format" });
      }
      // Check slug uniqueness (excluding current org)
      const existing = await prisma.organization.findUnique({ where: { slug } });
      if (existing && existing.id !== orgId) {
        return res.status(409).json({ error: "An organization with this slug already exists" });
      }
      data.slug = slug;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const org = await prisma.organization.update({
      where: { id: orgId },
      data,
    });

    return res.json(org);
  } catch (err) {
    next(err);
  }
});

// DELETE /orgs/:orgId — delete an organization
router.delete("/:orgId", requireOrg("ADMIN"), async (req, res, next) => {
  try {
    const orgId = req.params.orgId as string;

    await prisma.organization.delete({
      where: { id: orgId },
    });

    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /orgs/:orgId/members — list members of an organization
router.get("/:orgId/members", requireOrg(), async (req, res, next) => {
  try {
    const orgId = req.params.orgId as string;

    const members = await prisma.orgMember.findMany({
      where: { orgId },
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
    });

    return res.json(members);
  } catch (err) {
    next(err);
  }
});

// PUT /orgs/:orgId/members/:memberId/role — change a member's role
router.put("/:orgId/members/:memberId/role", requireOrg("ADMIN"), async (req, res, next) => {
  try {
    const orgId = req.params.orgId as string;
    const memberId = req.params.memberId as string;
    const { role } = req.body;

    if (!role || !["ADMIN", "MEMBER"].includes(role)) {
      return res.status(400).json({ error: "Invalid role. Must be ADMIN or MEMBER" });
    }

    const userId = res.locals.user.id as string;

    // Find the target member
    const member = await prisma.orgMember.findUnique({
      where: { id: memberId },
    });

    if (!member || member.orgId !== orgId) {
      return res.status(404).json({ error: "Member not found in this organization" });
    }

    // Cannot change own role
    if (member.userId === userId) {
      return res.status(400).json({ error: "Cannot change your own role" });
    }

    const updated = await prisma.orgMember.update({
      where: { id: memberId },
      data: { role },
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
    });

    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /orgs/:orgId/members/:memberId — remove a member from the organization
router.delete("/:orgId/members/:memberId", requireOrg("ADMIN"), async (req, res, next) => {
  try {
    const orgId = req.params.orgId as string;
    const memberId = req.params.memberId as string;
    const userId = res.locals.user.id as string;

    const member = await prisma.orgMember.findUnique({
      where: { id: memberId },
    });

    if (!member || member.orgId !== orgId) {
      return res.status(404).json({ error: "Member not found in this organization" });
    }

    // Cannot remove self
    if (member.userId === userId) {
      return res.status(400).json({ error: "Cannot remove yourself from the organization" });
    }

    await prisma.orgMember.delete({
      where: { id: memberId },
    });

    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /orgs/:orgId/invites — create an invite
router.post("/:orgId/invites", requireOrg("ADMIN"), async (req, res, next) => {
  try {
    const orgId = req.params.orgId as string;

    const parsed = createInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const { email, role } = parsed.data;
    const token = nanoid();
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS);

    const invite = await prisma.orgInvite.create({
      data: {
        orgId,
        email: email ?? null,
        role: role ?? "MEMBER",
        token,
        expiresAt,
      },
    });

    return res.status(201).json(invite);
  } catch (err) {
    next(err);
  }
});

// GET /orgs/:orgId/invites — list pending invites
router.get("/:orgId/invites", requireOrg("ADMIN"), async (req, res, next) => {
  try {
    const orgId = req.params.orgId as string;

    const invites = await prisma.orgInvite.findMany({
      where: {
        orgId,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    return res.json(invites);
  } catch (err) {
    next(err);
  }
});

// DELETE /orgs/:orgId/invites/:inviteId — revoke an invite
router.delete("/:orgId/invites/:inviteId", requireOrg("ADMIN"), async (req, res, next) => {
  try {
    const orgId = req.params.orgId as string;
    const inviteId = req.params.inviteId as string;

    const invite = await prisma.orgInvite.findUnique({
      where: { id: inviteId },
    });

    if (!invite || invite.orgId !== orgId) {
      return res.status(404).json({ error: "Invite not found" });
    }

    await prisma.orgInvite.delete({
      where: { id: inviteId },
    });

    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /invites/:token/accept — accept an invite using its token
router.post("/invites/:token/accept", async (req, res, next) => {
  try {
    const userId = res.locals.user.id as string;
    const token = req.params.token as string;

    const invite = await prisma.orgInvite.findUnique({
      where: { token },
      include: { org: true },
    });

    if (!invite) {
      return res.status(404).json({ error: "Invite not found" });
    }

    if (invite.acceptedAt) {
      return res.status(400).json({ error: "Invite has already been accepted" });
    }

    if (invite.expiresAt < new Date()) {
      return res.status(400).json({ error: "Invite has expired" });
    }

    // Check if user is already a member
    const existingMembership = await prisma.orgMember.findUnique({
      where: { userId_orgId: { userId, orgId: invite.orgId } },
    });

    if (existingMembership) {
      return res.status(409).json({ error: "You are already a member of this organization" });
    }

    // Add user as member and mark invite accepted in a transaction
    const [, membership] = await prisma.$transaction([
      prisma.orgInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
      prisma.orgMember.create({
        data: {
          userId,
          orgId: invite.orgId,
          role: invite.role,
        },
        include: {
          org: true,
        },
      }),
    ]);

    return res.json(membership.org);
  } catch (err) {
    next(err);
  }
});

export default router;
