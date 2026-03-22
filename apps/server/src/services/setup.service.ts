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

interface SetupState {
  sandbox: Sandbox;
  llmMessages: any[];
  chatMessages: ChatMsg[];
  status: string;
  isProcessing: boolean;
}

// In-memory store — keyed by projectId
const activeSetups = new Map<string, SetupState>();

const SETUP_SYSTEM_PROMPT = `You are a project setup assistant for Vendi, a platform that lets non-technical people make code changes via chat.

You are analyzing a project. Your job is to understand it and configure it for running in a sandbox environment.

WHAT YOU NEED TO FIGURE OUT:
1. What services does this project need? (PostgreSQL, Redis, MySQL, etc.)
2. What are the startup commands? (e.g., "npm install", "npm run dev")
3. What environment variables are needed? Ask the developer to paste their .env file.
4. What port does the dev server run on?
5. What file patterns should the AI agent be allowed to modify? (e.g., "src/**")

HOW TO WORK:
1. Start by using the tools to read package.json, .env.example, docker-compose.yml, README.md
2. Based on what you find, tell the developer what you've discovered
3. Ask focused questions — one or two at a time
4. When asking for .env, reassure them it will be stored encrypted
5. Be conversational and friendly

WHEN YOU HAVE ENOUGH INFORMATION, output this config block:

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
- ALWAYS read the codebase first before asking questions
- Parse .env content the developer pastes and include it in envVars
- Keep messages short and clear
- Do NOT output [SETUP_COMPLETE] until you have at least: startup commands, dev server port, and env vars
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
    body: JSON.stringify({ model: MODEL, messages, tools, max_tokens: 1024 }),
  });
  if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
  return res.json();
}

function addChatMsg(state: SetupState, role: ChatMsg["role"], content: string) {
  state.chatMessages.push({
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
  });
}

// ── Run LLM with tool loop ──────────────────────────────────────────────────

async function runAgentLoop(state: SetupState): Promise<string> {
  let iterations = 0;
  while (iterations < 30) {
    iterations++;
    console.log(`[Setup] LLM iteration ${iterations}`);

    const data = await callLLM(state.llmMessages);
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("No LLM response");

    state.llmMessages.push(msg);

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        const { name, arguments: argsStr } = tc.function;
        const statusMap: Record<string, string> = { read_file: "Reading files...", list_files: "Browsing project...", search_code: "Searching code...", run_command: "Running commands..." };
        state.status = statusMap[name] || "Working...";

        let args: Record<string, string>;
        try { args = JSON.parse(argsStr); } catch { args = {}; }
        const result = await executeTool(state.sandbox, name, args);
        state.llmMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }
      continue;
    }

    // Got a text response
    return msg.content || "";
  }

  // Exhausted iterations — force a summary
  console.log("[Setup] Exhausted iterations, forcing summary");
  state.llmMessages.push({ role: "user", content: "Stop reading files. Summarize what you found and ask your first question." });
  const summary = await callLLM(state.llmMessages);
  const summaryMsg = summary.choices?.[0]?.message;
  if (summaryMsg) {
    state.llmMessages.push(summaryMsg);
    return summaryMsg.content || "";
  }
  return "I've analyzed the project. Could you paste your .env file so I can configure the environment?";
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function startSetupSession(projectId: string, userId: string): Promise<string> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });

  // If already active, return existing
  if (activeSetups.has(projectId)) return projectId;

  const githubAccount = await prisma.oAuthAccount.findFirst({ where: { userId, provider: "github" } });
  if (!githubAccount) throw new Error("GitHub account not linked");
  const [ghEnc, ghIv] = githubAccount.accessToken.split("|");
  const githubToken = decrypt(ghEnc, ghIv);

  const state: SetupState = {
    sandbox: null as any,
    llmMessages: [{ role: "system", content: SETUP_SYSTEM_PROMPT }],
    chatMessages: [],
    status: "Creating sandbox...",
    isProcessing: true,
  };

  activeSetups.set(projectId, state);

  // Run async — frontend polls for updates
  (async () => {
    try {
      state.status = "Creating sandbox...";
      const sandbox = await Sandbox.create({ timeoutMs: 600_000 });
      state.sandbox = sandbox;

      state.status = "Cloning repository...";
      await sandbox.commands.run(
    "sudo mkdir -p /workspace && sudo chmod 777 /workspace && git config --global --add safe.directory /workspace",
    { requestTimeoutMs: 5_000 }
  );

      const cloneResult = await sandbox.commands.run(
        `git clone https://x-access-token:${githubToken}@github.com/${project.githubRepoFullName}.git /workspace`,
        { requestTimeoutMs: 120_000 }
      );
      if (cloneResult.exitCode !== 0) throw new Error(`Clone failed: ${cloneResult.stderr || cloneResult.stdout}`);

      addChatMsg(state, "SYSTEM", `Repository cloned: ${project.githubRepoFullName}`);
      state.status = "Analyzing project...";

      // Initial analysis
      state.llmMessages.push({
        role: "user",
        content: "Analyze this project. Read package.json, .env.example or .env.sample, docker-compose.yml, README.md, and key config files. Then tell me what you found and ask your first question.",
      });

      const response = await runAgentLoop(state);
      addChatMsg(state, "ASSISTANT", response);
      await handlePossibleCompletion(projectId, state, response);

      state.status = "";
      state.isProcessing = false;
    } catch (e) {
      console.error("[Setup] Failed:", e);
      addChatMsg(state, "SYSTEM", "Error: " + (e instanceof Error ? e.message : String(e)));
      state.status = "";
      state.isProcessing = false;
    }
  })();

  return projectId;
}

export async function sendSetupMessage(setupId: string, content: string): Promise<void> {
  const state = activeSetups.get(setupId);
  if (!state) throw new Error("No active setup session");
  if (state.isProcessing) throw new Error("Agent is still processing");

  addChatMsg(state, "USER", content);
  state.isProcessing = true;
  state.status = "Thinking...";

  try {
    state.llmMessages.push({ role: "user", content });
    const response = await runAgentLoop(state);
    addChatMsg(state, "ASSISTANT", response);
    await handlePossibleCompletion(setupId, state, response);
  } catch (e) {
    console.error("[Setup] Message error:", e);
    addChatMsg(state, "SYSTEM", "Error: " + (e instanceof Error ? e.message : String(e)));
  }

  state.status = "";
  state.isProcessing = false;
}

// Check if the response contains [SETUP_COMPLETE]
async function handlePossibleCompletion(projectId: string, state: SetupState, response: string) {
  const match = response.match(/\[SETUP_COMPLETE\]\s*([\s\S]*?)\s*\[\/SETUP_COMPLETE\]/);
  if (!match) return;

  try {
    const config = JSON.parse(match[1]);
    await applySetupConfig(projectId, config);
    addChatMsg(state, "SYSTEM", "Project configured successfully! Building template...");
    await cleanupSetup(projectId);
  } catch (err) {
    console.error("Failed to parse setup config:", err);
    const message = err instanceof Error ? err.message : String(err);
    addChatMsg(
      state,
      "SYSTEM",
      `Couldn't save the setup config. The [SETUP_COMPLETE] block must be valid JSON. ${message.slice(0, 160)}`
    );
  }
}

// Poll endpoint returns current state
export function getSetupState(projectId: string): { messages: ChatMsg[]; status: string; isProcessing: boolean } | null {
  const state = activeSetups.get(projectId);
  if (!state) return null;
  return { messages: state.chatMessages, status: state.status, isProcessing: state.isProcessing };
}

export function isSetupActive(projectId: string): boolean {
  return activeSetups.has(projectId);
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

async function cleanupSetup(setupId: string) {
  const state = activeSetups.get(setupId);
  if (state?.sandbox) await state.sandbox.kill().catch(() => {});
  // Don't delete — keep messages available for polling
}
