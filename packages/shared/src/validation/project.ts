import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  githubRepoFullName: z.string().regex(/^[^/]+\/[^/]+$/),
  githubRepoUrl: z.string().url(),
  defaultBranch: z.string().default("main"),
});

export const updateProjectConfigSchema = z.object({
  contextInstructions: z.string().max(50000).nullable().optional(),
  startupCommands: z.array(z.string().max(500)).max(20).optional(),
  requiredServices: z.array(z.enum(["postgres", "redis", "mysql"])).optional(),
  allowedFilePatterns: z.array(z.string().max(200)).max(50).optional(),
  devServerPort: z.number().min(1).max(65535).optional(),
  maxSessionDurationMin: z.number().min(5).max(480).optional(),
  maxBudgetUsd: z.number().min(0.1).max(100).optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectConfigInput = z.infer<typeof updateProjectConfigSchema>;
