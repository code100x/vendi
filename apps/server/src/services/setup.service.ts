import { Sandbox } from "e2b";
import { prisma } from "../lib/prisma";
import { decrypt, encrypt } from "../lib/crypto";
import { env } from "../config/env";
import { buildProjectTemplate } from "./template.service";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "anthropic/claude-sonnet-4";

interface ChatMsg {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  createdAt: string;
}

interface ToolCallEntry {
  id: string;
  name: string;
  args: Record<string, string>;
  result: string;
  timestamp: string;
}

// In-memory: only sandbox references (can't be serialized)
const activeSandboxes = new Map<string, Sandbox>();
const sandboxTimeouts = new Map<string, NodeJS.Timeout>();

const SANDBOX_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

function scheduleSandboxCleanup(projectId: string) {
  const existing = sandboxTimeouts.get(projectId);
  if (existing) clearTimeout(existing);
  const timeout = setTimeout(() => {
    console.log(`[Setup] Sandbox idle timeout for project ${projectId}`);
    cleanupSandbox(projectId);
  }, SANDBOX_TIMEOUT_MS);
  sandboxTimeouts.set(projectId, timeout);
}

const SETUP_SYSTEM_PROMPT = `You are a project setup assistant for Vendi. Your job is to analyze a project's codebase and automatically configure it for running in a sandbox environment.

YOUR GOAL:
Automatically detect the project configuration by reading files. Then ask the developer ONLY for their environment variable values (the .env file contents). Do NOT ask about code changes, architecture decisions, or how the project should be modified.

WHAT TO AUTO-DETECT (do NOT ask the user about these — figure them out yourself):
1. Required services (PostgreSQL, Redis, MySQL, etc.) — detect from docker-compose.yml, package.json dependencies, prisma/schema.prisma, etc.
2. Startup commands — detect from package.json scripts (look for "dev" script), Makefile, README instructions
3. Dev server port — detect from vite.config.ts, next.config.js, .env.example, or package.json scripts
4. Allowed file patterns — infer from project structure (e.g. src/**, app/**, pages/**)
5. Context instructions — write a brief description of the project based on what you find

WHAT TO ASK THE USER:
- Their .env file contents (environment variables). Reassure them values will be stored encrypted.
- That's it. Do NOT ask about anything else.

HOW TO WORK:
1. Use your tools to read: package.json, .env.example or .env.sample, docker-compose.yml, README.md, prisma/schema.prisma, vite.config.ts or next.config.js, turbo.json or pnpm-workspace.yaml — read as many as exist
2. Auto-detect ALL configuration from what you find
3. Present a SHORT summary of what you detected (services, startup commands, port)
4. Ask the user to paste their .env file (or the values for the variables you found in .env.example)
5. Once you have the .env values, IMMEDIATELY output the [SETUP_COMPLETE] block

OUTPUT FORMAT — when you have everything:

[SETUP_COMPLETE]
{
  "requiredServices": ["postgres"],
  "startupCommands": ["npm install", "npm run dev"],
  "envVars": {"DATABASE_URL": "postgresql://...", "PORT": "3000"},
  "devServerPort": 3000,
  "allowedFilePatterns": ["src/**", "public/**"],
  "contextInstructions": "Brief description of the project..."
}
[/SETUP_COMPLETE]

RULES:
- ALWAYS read the codebase FIRST before saying anything to the user
- Do NOT ask the user about services, ports, startup commands, or file patterns — detect them yourself
- Do NOT ask about or suggest code changes — this is setup, not development
- Parse the .env content the developer pastes and include ALL variables in envVars
- Keep messages short — one message to summarize findings, one to ask for .env values
- Do NOT output [SETUP_COMPLETE] until you have the env vars from the user
- Keep the [SETUP_COMPLETE] JSON compact — no extra whitespace or commentary inside the block
- Do NOT echo back or summarize all the env vars before the [SETUP_COMPLETE] block — go straight to the JSON output
`;

const tools = [
  { type: "function" as const, function: { name: "read_file", description: "Read a file from the project", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function" as const, function: { name: "list_files", description: "List files in a directory", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function" as const, function: { name: "search_code", description: "Search for a pattern in project files", parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } } },
  { type: "function" as const, function: { name: "run_command", description: "Run a shell command", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
];

async function executeTool(sandbox: Sandbox, name: string, args: Record<string, string>): Promise<string> {
  try {
    switch (name) {
      case "read_file":
        return String(await sandbox.files.read(args.path));
      case "list_files": {
        const r = await sandbox.commands.run(`find ${args.path} -maxdepth 2 -type f 2>/dev/null | head -40`, { requestTimeoutMs: 10_000 });
        return r.stdout || "No files found";
      }
      case "search_code": {
        const r = await sandbox.commands.run(
          `cd /workspace && grep -rn "${args.pattern.replace(/"/g, '\\"')}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" --include="*.env*" --include="*.yml" --include="*.yaml" --include="*.md" --include="*.prisma" 2>/dev/null | head -30`,
          { requestTimeoutMs: 10_000 }
        );
        return r.stdout || "No matches";
      }
      case "run_command": {
        const r = await sandbox.commands.run(`cd /workspace && ${args.command}`, { requestTimeoutMs: 30_000 });
        return (r.stdout + (r.stderr ? "\n" + r.stderr : "")).slice(0, 3000) || `Exit: ${r.exitCode}`;
      }
      default:
        return "Unknown tool";
    }
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function callLLM(messages: any[]): Promise<any> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "X-Title": "Vendi",
    },
    body: JSON.stringify({ model: MODEL, messages, tools, max_tokens: 4096 }),
  });
  if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── DB persistence helpers ──────────────────────────────────────────────────

async function persistState(
  projectId: string,
  updates: {
    messages?: ChatMsg[];
    toolCalls?: ToolCallEntry[];
    llmHistory?: any[];
    status?: string;
    isProcessing?: boolean;
  }
) {
  const data: any = {};
  if (updates.messages !== undefined) data.setupMessages = updates.messages;
  if (updates.toolCalls !== undefined) data.setupToolCalls = updates.toolCalls;
  if (updates.llmHistory !== undefined) data.setupLlmHistory = updates.llmHistory;
  if (updates.status !== undefined) data.setupStatus = updates.status;
  if (updates.isProcessing !== undefined) data.setupIsProcessing = updates.isProcessing;
  await prisma.project.update({ where: { id: projectId }, data });
}

async function loadState(projectId: string) {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      setupMessages: true,
      setupToolCalls: true,
      setupLlmHistory: true,
      setupStatus: true,
      setupIsProcessing: true,
    },
  });
  if (!p) return null;
  return {
    messages: (p.setupMessages ?? []) as unknown as ChatMsg[],
    toolCalls: (p.setupToolCalls ?? []) as unknown as ToolCallEntry[],
    llmHistory: (p.setupLlmHistory ?? []) as unknown as any[],
    status: p.setupStatus ?? "",
    isProcessing: p.setupIsProcessing,
  };
}

// ── Run LLM with tool loop ──────────────────────────────────────────────────

interface LoopContext {
  projectId: string;
  sandbox: Sandbox;
  llmMessages: any[];
  chatMessages: ChatMsg[];
  toolCalls: ToolCallEntry[];
}

async function runAgentLoop(ctx: LoopContext): Promise<string> {
  let iterations = 0;
  while (iterations < 30) {
    iterations++;
    console.log(`[Setup] LLM iteration ${iterations}`);

    const data = await callLLM(ctx.llmMessages);
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("No LLM response");

    ctx.llmMessages.push(msg);

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        const { name, arguments: argsStr } = tc.function;
        const statusMap: Record<string, string> = { read_file: "Reading files...", list_files: "Browsing project...", search_code: "Searching code...", run_command: "Running commands..." };

        await persistState(ctx.projectId, { status: statusMap[name] || "Working..." });

        let args: Record<string, string>;
        try { args = JSON.parse(argsStr); } catch { args = {}; }
        const result = await executeTool(ctx.sandbox, name, args);
        ctx.toolCalls.push({
          id: crypto.randomUUID(),
          name,
          args,
          result: result.slice(0, 2000),
          timestamp: new Date().toISOString(),
        });
        ctx.llmMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }

      // Persist after each LLM iteration (batch tool calls)
      await persistState(ctx.projectId, {
        toolCalls: ctx.toolCalls,
        llmHistory: ctx.llmMessages,
      });
      continue;
    }

    // Got a text response — check if it was truncated mid-[SETUP_COMPLETE]
    const text = msg.content || "";
    if (text.includes("[SETUP_COMPLETE]") && !text.includes("[/SETUP_COMPLETE]")) {
      console.log("[Setup] Detected truncated SETUP_COMPLETE block, asking LLM to continue");
      ctx.llmMessages.push({
        role: "user",
        content: "Your response was cut off. Please output the complete [SETUP_COMPLETE]...[/SETUP_COMPLETE] block again with all environment variables included. Output ONLY the JSON block, nothing else.",
      });
      continue;
    }
    return text;
  }

  // Exhausted iterations — force a summary
  console.log("[Setup] Exhausted iterations, forcing summary");
  ctx.llmMessages.push({ role: "user", content: "Stop reading files. Summarize what you found and ask your first question." });
  const summary = await callLLM(ctx.llmMessages);
  const summaryMsg = summary.choices?.[0]?.message;
  if (summaryMsg) {
    ctx.llmMessages.push(summaryMsg);
    return summaryMsg.content || "";
  }
  return "I've analyzed the project. Could you paste your .env file so I can configure the environment?";
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function startSetupSession(projectId: string, userId: string): Promise<string> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });

  // If sandbox already active on this pod, skip
  if (activeSandboxes.has(projectId)) return projectId;

  // If another pod is processing, skip
  const existing = await loadState(projectId);
  if (existing && existing.isProcessing) return projectId;

  const githubAccount = await prisma.oAuthAccount.findFirst({ where: { userId, provider: "github" } });
  if (!githubAccount) throw new Error("GitHub account not linked");
  const [ghEnc, ghIv] = githubAccount.accessToken.split("|");
  const githubToken = decrypt(ghEnc, ghIv);

  // Initialize DB state
  const initialMessages = existing?.messages ?? [];
  const initialToolCalls = existing?.toolCalls ?? [];
  const initialLlmHistory = existing?.llmHistory.length
    ? existing.llmHistory
    : [{ role: "system", content: SETUP_SYSTEM_PROMPT }];

  await persistState(projectId, {
    messages: initialMessages,
    toolCalls: initialToolCalls,
    llmHistory: initialLlmHistory,
    status: "Creating sandbox...",
    isProcessing: true,
  });

  // Run async — frontend polls for updates
  (async () => {
    try {
      await persistState(projectId, { status: "Creating sandbox..." });
      const sandbox = await Sandbox.create({ timeoutMs: 30 * 60_000 });
      activeSandboxes.set(projectId, sandbox);
      scheduleSandboxCleanup(projectId);

      await persistState(projectId, { status: "Cloning repository..." });
      await sandbox.commands.run(
        "sudo mkdir -p /workspace && sudo chmod 777 /workspace && git config --global --add safe.directory /workspace",
        { requestTimeoutMs: 5_000 }
      );

      const cloneResult = await sandbox.commands.run(
        `git clone https://x-access-token:${githubToken}@github.com/${project.githubRepoFullName}.git /workspace`,
        { requestTimeoutMs: 120_000 }
      );
      if (cloneResult.exitCode !== 0) throw new Error(`Clone failed: ${cloneResult.stderr || cloneResult.stdout}`);

      const chatMessages: ChatMsg[] = [...initialMessages];
      const toolCalls: ToolCallEntry[] = [];
      const llmMessages = [...initialLlmHistory];

      chatMessages.push({
        id: crypto.randomUUID(),
        role: "SYSTEM",
        content: `Repository cloned: ${project.githubRepoFullName}`,
        createdAt: new Date().toISOString(),
      });
      await persistState(projectId, { messages: chatMessages, status: "Analyzing project..." });

      // Initial analysis
      llmMessages.push({
        role: "user",
        content: "Analyze this project. Read package.json, .env.example or .env.sample, docker-compose.yml, README.md, and key config files. Then tell me what you found and ask your first question.",
      });

      const ctx: LoopContext = { projectId, sandbox, llmMessages, chatMessages, toolCalls };
      const response = await runAgentLoop(ctx);

      ctx.chatMessages.push({
        id: crypto.randomUUID(),
        role: "ASSISTANT",
        content: response,
        createdAt: new Date().toISOString(),
      });

      await handlePossibleCompletion(projectId, ctx.chatMessages, response);

      await persistState(projectId, {
        messages: ctx.chatMessages,
        toolCalls: ctx.toolCalls,
        llmHistory: ctx.llmMessages,
        status: "",
        isProcessing: false,
      });
    } catch (e) {
      console.error("[Setup] Failed:", e);
      const state = await loadState(projectId);
      const msgs = state?.messages ?? [];
      msgs.push({
        id: crypto.randomUUID(),
        role: "SYSTEM",
        content: "Error: " + (e instanceof Error ? e.message : String(e)),
        createdAt: new Date().toISOString(),
      });
      await persistState(projectId, {
        messages: msgs,
        status: "",
        isProcessing: false,
      });
    }
  })();

  return projectId;
}

export async function sendSetupMessage(projectId: string, content: string): Promise<void> {
  const state = await loadState(projectId);
  if (!state) throw new Error("No setup session found");
  if (state.isProcessing) throw new Error("Agent is still processing");

  const sandbox = activeSandboxes.get(projectId);
  if (!sandbox) throw new Error("No active sandbox. Please refresh to restart setup.");
  scheduleSandboxCleanup(projectId);

  const chatMessages = state.messages;
  const toolCalls: ToolCallEntry[] = [];
  const llmMessages = state.llmHistory;

  chatMessages.push({
    id: crypto.randomUUID(),
    role: "USER",
    content,
    createdAt: new Date().toISOString(),
  });
  llmMessages.push({ role: "user", content });

  await persistState(projectId, {
    messages: chatMessages,
    toolCalls,
    status: "Thinking...",
    isProcessing: true,
  });

  try {
    const ctx: LoopContext = { projectId, sandbox, llmMessages, chatMessages, toolCalls };
    const response = await runAgentLoop(ctx);

    ctx.chatMessages.push({
      id: crypto.randomUUID(),
      role: "ASSISTANT",
      content: response,
      createdAt: new Date().toISOString(),
    });

    await handlePossibleCompletion(projectId, ctx.chatMessages, response);

    await persistState(projectId, {
      messages: ctx.chatMessages,
      toolCalls: ctx.toolCalls,
      llmHistory: ctx.llmMessages,
      status: "",
      isProcessing: false,
    });
  } catch (e) {
    console.error("[Setup] Message error:", e);
    chatMessages.push({
      id: crypto.randomUUID(),
      role: "SYSTEM",
      content: "Error: " + (e instanceof Error ? e.message : String(e)),
      createdAt: new Date().toISOString(),
    });
    await persistState(projectId, {
      messages: chatMessages,
      status: "",
      isProcessing: false,
    });
  }
}

// Check if the response contains [SETUP_COMPLETE]
async function handlePossibleCompletion(projectId: string, chatMessages: ChatMsg[], response: string) {
  const match = response.match(/\[SETUP_COMPLETE\]\s*([\s\S]*?)\s*\[\/SETUP_COMPLETE\]/);
  if (!match) return;

  try {
    const config = JSON.parse(match[1]);
    await applySetupConfig(projectId, config);
    chatMessages.push({
      id: crypto.randomUUID(),
      role: "SYSTEM",
      content: "Project configured successfully! Building template...",
      createdAt: new Date().toISOString(),
    });
    await cleanupSandbox(projectId);
  } catch (err) {
    console.error("Failed to parse setup config:", err);
    const message = err instanceof Error ? err.message : String(err);
    chatMessages.push({
      id: crypto.randomUUID(),
      role: "SYSTEM",
      content: `Couldn't save the setup config. The [SETUP_COMPLETE] block must be valid JSON. ${message.slice(0, 160)}`,
      createdAt: new Date().toISOString(),
    });
  }
}

// Poll endpoint — reads from DB so it works across pods
export async function getSetupState(projectId: string): Promise<{
  messages: ChatMsg[];
  toolCalls: ToolCallEntry[];
  status: string;
  isProcessing: boolean;
} | null> {
  const state = await loadState(projectId);
  if (!state || (!state.messages.length && !state.isProcessing)) return null;
  return {
    messages: state.messages,
    toolCalls: state.toolCalls,
    status: state.status,
    isProcessing: state.isProcessing,
  };
}

export async function isSetupActive(projectId: string): Promise<boolean> {
  const state = await loadState(projectId);
  return !!state?.isProcessing;
}

async function applySetupConfig(projectId: string, config: any) {
  const data: any = {};
  if (config.requiredServices) data.requiredServices = config.requiredServices;
  if (config.startupCommands) data.startupCommands = config.startupCommands;
  if (config.devServerPort) data.devServerPort = config.devServerPort;
  if (config.allowedFilePatterns) data.allowedFilePatterns = config.allowedFilePatterns;
  if (config.contextInstructions) data.contextInstructions = config.contextInstructions;
  if (config.maxSessionDurationMin) data.maxSessionDurationMin = config.maxSessionDurationMin;
  if (config.maxBudgetUsd) data.maxBudgetUsd = config.maxBudgetUsd;
  if (config.envVars && Object.keys(config.envVars).length > 0) {
    const { encrypted, iv } = encrypt(JSON.stringify(config.envVars));
    data.envVars = encrypted;
    data.envVarsIv = iv;
  }
  await prisma.project.update({ where: { id: projectId }, data });
  buildProjectTemplate(projectId).catch(console.error);
}

async function cleanupSandbox(projectId: string) {
  const timeout = sandboxTimeouts.get(projectId);
  if (timeout) {
    clearTimeout(timeout);
    sandboxTimeouts.delete(projectId);
  }
  const sandbox = activeSandboxes.get(projectId);
  if (sandbox) {
    await sandbox.kill().catch(() => {});
    activeSandboxes.delete(projectId);
  }
}
