import type { Request, Response, NextFunction } from "express";
import { lucia } from "../lib/auth";
import { COOKIE_NAME } from "../config/constants";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sessionId = req.cookies?.[COOKIE_NAME];
  if (!sessionId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { session, user } = await lucia.validateSession(sessionId);
  if (!session) {
    res.clearCookie(COOKIE_NAME);
    return res.status(401).json({ error: "Session expired" });
  }

  // Refresh session if needed
  if (session.fresh) {
    const cookie = lucia.createSessionCookie(session.id);
    res.cookie(cookie.name, cookie.value, cookie.attributes);
  }

  res.locals.user = user;
  res.locals.session = session;
  next();
}
