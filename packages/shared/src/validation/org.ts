import { z } from "zod";

export const createOrgSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
});

export const createInviteSchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

export type CreateOrgInput = z.infer<typeof createOrgSchema>;
