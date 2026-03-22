import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import type { OrgRole } from "@vendi/shared";

export function requireOrg(minimumRole?: OrgRole) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals.user?.id;
    const orgId = (req.params as Record<string, string>).orgId;

    if (!userId || !orgId) {
      return res.status(400).json({ error: "Missing user or org ID" });
    }

    const membership = await prisma.orgMember.findUnique({
      where: { userId_orgId: { userId, orgId: orgId as string } },
    });

    if (!membership) {
      return res.status(403).json({ error: "Not a member of this organization" });
    }

    if (minimumRole === "ADMIN" && membership.role !== "ADMIN") {
      return res.status(403).json({ error: "Admin access required" });
    }

    res.locals.membership = membership;
    next();
  };
}
