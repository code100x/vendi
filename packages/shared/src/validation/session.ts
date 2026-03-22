import { z } from "zod";

export const startSessionSchema = z.object({
  projectId: z.string().cuid(),
});

export const chatMessageSchema = z.object({
  content: z.string().min(1).max(10000),
});

export type StartSessionInput = z.infer<typeof startSessionSchema>;
export type ChatMessageInput = z.infer<typeof chatMessageSchema>;
