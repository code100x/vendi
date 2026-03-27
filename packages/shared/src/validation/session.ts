import { z } from "zod";

export const startSessionSchema = z.object({
  projectId: z.string().cuid(),
});
