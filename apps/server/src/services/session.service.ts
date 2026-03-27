import { prisma } from "../lib/prisma";
import { startSessionSandbox, stopSandbox, pushChangesFromSandbox } from "./sandbox.service";
import { createPullRequest, mergePullRequest, deleteBranch } from "./github.service";
import { startAgentTurn } from "./agent.service";

export async function startSession(projectId: string, userId: string) {
  // Check project is ready
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
  });

  if (project.templateStatus !== "READY") {
    throw new Error("Project is not configured yet");
  }

  // Check for active sessions (conflict detection)
  const activeSessions = await prisma.session.findMany({
    where: {
      projectId,
      status: { in: ["STARTING", "RUNNING"] },
    },
    include: { user: { select: { id: true, name: true } } },
  });

  // Create session record
  const session = await prisma.session.create({
    data: {
      projectId,
      userId,
      branchName: "", // Will be set by sandbox service
      status: "STARTING",
    },
  });

  try {
    // Start the sandbox (async, updates session record)
    const result = await startSessionSandbox(session.id, projectId, userId);

    // Notify about conflicts via a system message
    if (activeSessions.length > 0) {
      const names = activeSessions.map((s) => s.user.name || "Someone").join(", ");
      await prisma.chatMessage.create({
        data: { sessionId: session.id, role: "SYSTEM", content: `Warning: ${names} also has an active session on this project.` },
      });
    }

    const sessionResult = {
      ...session,
      sandboxId: result.sandboxId,
      previewUrl: result.previewUrl,
      status: "RUNNING" as const,
    };

    // Save a system message so the user sees progress via polling
    await prisma.chatMessage.create({
      data: { sessionId: sessionResult.id, role: "SYSTEM", content: "Setting up your project..." },
    });

    // Build explicit startup instructions from the project config
    const startupSteps = project.startupCommands.length > 0
      ? project.startupCommands.map((cmd, i) => `${i + 1}. Run: ${cmd}`).join("\n")
      : "1. Read package.json and figure out how to install deps and start the server";

    const setupPrompt = `The project has been cloned to /workspace and .env has been written at /workspace/.env.

IMPORTANT: The .env file might need to be in a subdirectory (e.g. /workspace/backend/.env). Check where the project loads env vars from and copy it there if needed.

${project.requiredServices.length > 0 ? `Services available: ${project.requiredServices.join(", ")} (already running).\n` : ""}
Run these steps to start the project:
${startupSteps}

The dev server should be on port ${project.devServerPort || 3000}.

As you work, output SHORT status updates like:
- "Installing dependencies..."
- "Running database setup..."
- "Starting servers..."
- "Everything is running!"

If anything fails, fix it yourself. Keep messages short and non-technical.`;

    // Fire and forget — don't block session creation
    sendMessage(sessionResult.id, setupPrompt, { hidden: true }).catch((e) => {
      console.error("[Session] Auto-setup failed:", e);
    });

    return sessionResult;
  } catch (error) {
    await prisma.session.update({
      where: { id: session.id },
      data: { status: "ERRORED", endedAt: new Date() },
    });
    throw error;
  }
}

export async function sendMessage(sessionId: string, content: string, options?: { hidden?: boolean }) {
  // Save user message to DB IMMEDIATELY so it appears in the UI right away
  if (!options?.hidden) {
    await prisma.chatMessage.create({
      data: { sessionId, role: "USER", content },
    });
  }

  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: { project: true },
  });

  if (session.status !== "RUNNING" || !session.sandboxId) {
    throw new Error("Session is not active");
  }

  // Don't start a new turn if one is already running
  if (session.agentRunId) {
    throw new Error("Agent is still processing");
  }

  const systemPrompt = buildSystemPrompt(session.project);

  // Non-blocking: starts agent in sandbox and returns immediately
  await startAgentTurn({
    sessionId,
    sandboxId: session.sandboxId,
    userMessage: content,
    systemPrompt,
  });
}

function buildSystemPrompt(project: {
  allowedFilePatterns: string[];
  contextInstructions: string | null;
  startupCommands: string[];
  migrationCommands: string[];
  requiredServices: string[];
  devServerPort: number;
}): string {
  const parts = [
    "You are a skilled software engineer with full access to a Linux development environment.",
    "You are exceptionally good at understanding codebases, writing clean functional code, and iterating until things work.",
    "The project is cloned at /workspace. Environment variables are in /workspace/.env.",
    "",
    "ENVIRONMENT:",
    `- Dev server port: ${project.devServerPort}`,
    `- Required services: ${project.requiredServices.length > 0 ? project.requiredServices.join(", ") : "none"}`,
    `- Startup commands: ${project.startupCommands.length > 0 ? project.startupCommands.join(" && ") : "check package.json"}`,
    `- Migration commands: ${project.migrationCommands.length > 0 ? project.migrationCommands.join(" && ") : "none"}`,
    "- You have FULL SYSTEM ACCESS including sudo. Use it freely to:",
    "  - Start/stop/restart services (PostgreSQL, Redis, MySQL, etc.)",
    "  - Install system packages with apt-get",
    "  - Modify system configuration files",
    "  - Manage processes, ports, and networking",
    "  - Do anything else a developer would do on their own machine",
    "- Tools available: bun, node, npm, git, curl, python3, and any packages you install",
    "",
    "APPROACH TO WORK:",
    "- Gather information before acting. Read relevant files and understand the codebase before making changes.",
    "- When making changes to files, first understand the file's code conventions. Mimic code style, use existing libraries and utilities, and follow existing patterns.",
    "- Never assume a library is available — check package.json (or equivalent) first.",
    "- When editing code, look at surrounding context and imports to understand framework and library choices.",
    "- When struggling with failing tests, consider that the root cause is in your code, not the tests. Never modify tests unless explicitly asked to.",
    "- When encountering difficulties, take time to gather information before concluding a root cause.",
    "- If something breaks, diagnose and fix it yourself before reporting back.",
    "- IMPORTANT: Batch multiple tool calls in a single response whenever possible. Read multiple files at once, run independent commands together. This saves time and cost.",
    "",
    "RULES:",
    "- Only modify files matching these patterns: " +
      (project.allowedFilePatterns.length > 0
        ? project.allowedFilePatterns.join(", ")
        : "any file"),
    "- Explain what you changed in simple, non-technical terms.",
    "- Do NOT show code diffs or terminal output to the user.",
    "- Do NOT commit or push changes. Vendi handles that after the session.",
    "- Keep the dev server running after making changes.",
    "- For long-running dev servers, use a detached start: `nohup ... >/tmp/<name>.log 2>&1 < /dev/null &`",
    "- Verify the expected local ports with curl before claiming the project is running.",
    "- The .env file may need to be copied to subdirectories (e.g. backend/) — check where the project expects it.",
    "- When creating or fixing env files, inspect the codebase for the actual env names it reads.",
    "- Infer obvious frontend aliases without asking. Example: if the frontend reads `import.meta.env.VITE_GITHUB_CLIENT_ID` and `.env` only has `GITHUB_CLIENT_ID`, add the `VITE_` version with the same value.",
    "- Treat server secrets and frontend public keys as different values unless obviously the same identifier with a framework prefix change.",
    "- If a frontend env value is truly distinct and cannot be derived safely, state exactly which name is still missing.",
    "- Never add comments to code unless asked or the code is truly complex.",
    "- Never expose or log secrets and keys.",
    "",
    "COMMUNICATION:",
    "- Keep messages short and non-technical.",
    "- When you encounter an environment issue you cannot fix, clearly report it.",
    "- Share what you did and the result, not the process.",
  ];

  if (project.contextInstructions) {
    parts.push("", "PROJECT CONTEXT:", project.contextInstructions);
  }

  return parts.join("\n");
}

export async function createSessionPR(sessionId: string, userId: string) {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: { project: true, user: true },
  });

  if (!session.sandboxId) throw new Error("No active sandbox");

  await prisma.session.update({
    where: { id: sessionId },
    data: { status: "STOPPING" },
  });

  try {
    // Push changes from sandbox
    await pushChangesFromSandbox(
      session.sandboxId,
      session.branchName,
      `Changes from Vendi session by ${session.user.name || session.user.email}`
    );

    // Create PR
    const prUrl = await createPullRequest(
      userId,
      session.project.githubRepoFullName,
      session.branchName,
      session.project.defaultBranch,
      `Vendi: Changes from session ${session.id.slice(0, 8)}`,
      `Changes made via Vendi by ${session.user.name || session.user.email}.\n\nSession ID: ${session.id}`
    );

    // Stop sandbox
    await stopSandbox(session.sandboxId);

    // Update session
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        status: "COMPLETED",
        outcome: "PR_CREATED",
        prUrl,
        endedAt: new Date(),
        sandboxId: null,
      },
    });

    return { prUrl };
  } catch (error) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { status: "ERRORED", endedAt: new Date() },
    });
    throw error;
  }
}

export async function commitToMain(sessionId: string, userId: string) {
  // Same as createSessionPR but also merges
  const result = await createSessionPR(sessionId, userId);

  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: { project: true },
  });

  // Extract PR number from URL
  const prNumber = parseInt(result.prUrl.split("/").pop()!, 10);

  // Merge the PR
  const sha = await mergePullRequest(
    userId,
    session.project.githubRepoFullName,
    prNumber
  );

  // Clean up branch
  await deleteBranch(userId, session.project.githubRepoFullName, session.branchName);

  await prisma.session.update({
    where: { id: sessionId },
    data: { outcome: "COMMITTED_TO_MAIN", commitSha: sha },
  });

  return { prUrl: result.prUrl, commitSha: sha };
}

export async function discardSession(sessionId: string, userId: string) {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: { project: true },
  });

  if (session.sandboxId) {
    await stopSandbox(session.sandboxId);
  }

  // Delete the remote branch
  await deleteBranch(userId, session.project.githubRepoFullName, session.branchName).catch(
    () => {}
  );

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      status: "COMPLETED",
      outcome: "DISCARDED",
      endedAt: new Date(),
      sandboxId: null,
    },
  });
}
