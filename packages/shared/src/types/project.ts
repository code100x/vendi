export type TemplateStatus = "PENDING" | "BUILDING" | "READY" | "FAILED";

export interface Project {
  id: string;
  orgId: string;
  name: string;
  githubRepoFullName: string;
  githubRepoUrl: string;
  defaultBranch: string;
  contextInstructions: string | null;
  startupCommands: string[];
  migrationCommands: string[];
  requiredServices: string[];
  allowedFilePatterns: string[];
  devServerPort: number;
  e2bTemplateId: string | null;
  templateStatus: TemplateStatus;
  maxSessionDurationMin: number;
  maxBudgetUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubRepo {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  language: string | null;
  url: string;
}
