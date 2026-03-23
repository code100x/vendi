import { randomUUID } from "node:crypto";
import { Sandbox } from "e2b";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import type { ToolCallEntry } from "@vendi/shared";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "anthropic/claude-sonnet-4";
const MAX_ITERATIONS = 50;

interface AgentRunConfig {
  sessionId: string;
  sandboxId: string;
  userMessage: string;
  systemPrompt: string;
  maxBudgetUsd: number;
}

// ── Tool definitions (OpenAI function-calling format) ─────────────────────────

const tools = [
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read a file from the project",
      parameters: { type: "object", properties: { path: { type: "string", description: "Absolute path to the file" } }, required: ["path"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Write or create a file in the project",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the file" },
          content: { type: "string", description: "Full file content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_files",
      description: "List files in a directory (up to 3 levels deep, max 80 entries)",
      parameters: { type: "object", properties: { path: { type: "string", description: "Directory path" } }, required: ["path"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_code",
      description: "Search for a regex pattern across project source files",
      parameters: { type: "object", properties: { pattern: { type: "string", description: "Grep-compatible regex pattern" } }, required: ["pattern"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_command",
      description: "Run a shell command in /workspace (60s timeout)",
      parameters: { type: "object", properties: { command: { type: "string", description: "Shell command to execute" } }, required: ["command"] },
    },
  },
];

// ── Tool execution ────────────────────────────────────────────────────────────

async function executeTool(sandbox: Sandbox, name: string, args: Record<string, string>): Promise<string> {
  try {
    switch (name) {
      case "read_file":
        return String(await sandbox.files.read(args.path));
      case "write_file":
        await sandbox.files.write(args.path, args.content);
        return "File written successfully.";
      case "list_files": {
        const r = await sandbox.commands.run(
          `find ${args.path} -maxdepth 3 -type f 2>/dev/null | head -80`,
          { requestTimeoutMs: 10_000 },
        );
        return r.stdout || "No files found";
      }
      case "search_code": {
        const escaped = args.pattern.replace(/"/g, '\\"');
        const r = await sandbox.commands.run(
          `cd /workspace && grep -rn "${escaped}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.json" --include="*.css" --include="*.html" --include="*.env*" --include="*.yml" --include="*.yaml" --include="*.md" --include="*.prisma" 2>/dev/null | head -50`,
          { requestTimeoutMs: 10_000 },
        );
        return r.stdout || "No matches";
      }
      case "run_command": {
        const r = await sandbox.commands.run(`cd /workspace && ${args.command}`, {
          requestTimeoutMs: 60_000,
        });
        const out = (r.stdout + (r.stderr ? "\n" + r.stderr : "")).trim();
        return (out || `Exit code: ${r.exitCode}`).slice(0, 4000);
      }
      default:
        return "Unknown tool";
    }
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ── LLM call ──────────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function listChangedFiles(sandbox: Sandbox): Promise<string[]> {
  const result = await sandbox.commands.run("cd /workspace && git status --porcelain", {
    requestTimeoutMs: 10_000,
  });
  if (!result.stdout) return [];
  return result.stdout
    .split("\n")
    .map((line: string) => line.trim())
    .filter(Boolean)
    .map((line: string) => line.slice(3).trim())
    .filter(Boolean)
    .slice(0, 50);
}

/** Load previous chat messages and convert to LLM message format */
async function buildConversationHistory(sessionId: string): Promise<any[]> {
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });

  const history: any[] = [];
  for (const msg of messages) {
    if (msg.role === "USER") {
      history.push({ role: "user", content: msg.content });
    } else if (msg.role === "ASSISTANT") {
      history.push({ role: "assistant", content: msg.content });
    }
    // Skip SYSTEM messages (UI-only status messages)
  }
  return history;
}

// ── Main agent loop ───────────────────────────────────────────────────────────

export async function runAgentTurn(config: AgentRunConfig): Promise<void> {
  const { sessionId, sandboxId, userMessage, systemPrompt } = config;

  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");

  const sandbox = await Sandbox.connect(sandboxId);

  // Build LLM conversation: system prompt + history + current message
  const conversationHistory = await buildConversationHistory(sessionId);
  const llmMessages: any[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory,
    { role: "user", content: userMessage },
  ];

  // Create "working" placeholder visible to frontend
  const workingMsg = await prisma.chatMessage.create({
    data: {
      sessionId,
      role: "SYSTEM",
      content: "Working on it...",
    },
  });

  const allToolCalls: ToolCallEntry[] = [];

  try {
    let iterations = 0;
    let finalText = "";

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      console.log(`[Agent] Session ${sessionId} — iteration ${iterations}`);

      const data = await callLLM(llmMessages);
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error("No LLM response");

      llmMessages.push(msg);

      // ── Tool calls ──────────────────────────────────────────────────
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          const { name, arguments: argsStr } = tc.function;

          // Update status text
          const statusMap: Record<string, string> = {
            read_file: "Reading files...",
            write_file: "Writing files...",
            list_files: "Browsing project...",
            search_code: "Searching code...",
            run_command: "Running commands...",
          };

          let args: Record<string, string>;
          try { args = JSON.parse(argsStr); } catch { args = {}; }

          const result = await executeTool(sandbox, name, args);

          allToolCalls.push({
            id: randomUUID(),
            name,
            args: sanitizeArgs(args),
            result: result.slice(0, 2000),
            timestamp: new Date().toISOString(),
          });

          llmMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
        }

        // Update working message with live tool calls + status
        const latestTool = msg.tool_calls[msg.tool_calls.length - 1];
        const latestName = latestTool?.function?.name || "";
        const statusMap: Record<string, string> = {
          read_file: "Reading files...",
          write_file: "Writing files...",
          list_files: "Browsing project...",
          search_code: "Searching code...",
          run_command: "Running commands...",
        };
        await prisma.chatMessage.update({
          where: { id: workingMsg.id },
          data: {
            content: statusMap[latestName] || "Working on it...",
            metadata: JSON.parse(JSON.stringify({ toolCalls: allToolCalls })),
          },
        });

        continue;
      }

      // ── Text response — done ────────────────────────────────────────
      finalText = msg.content || "";
      break;
    }

    if (!finalText && iterations >= MAX_ITERATIONS) {
      // Force a summary
      llmMessages.push({
        role: "user",
        content: "You've used many tool calls. Please summarize what you've done and what the current state is.",
      });
      const summary = await callLLM(llmMessages);
      const summaryMsg = summary.choices?.[0]?.message;
      finalText = summaryMsg?.content || "Done.";
    }

    // Remove working placeholder
    await prisma.chatMessage.delete({ where: { id: workingMsg.id } }).catch(() => {});

    // Build final assistant message
    const changedFiles = await listChangedFiles(sandbox);
    const hasMetadata = changedFiles.length > 0 || allToolCalls.length > 0;
    const metadata = hasMetadata
      ? {
          ...(changedFiles.length > 0 ? { filesChanged: changedFiles } : {}),
          ...(allToolCalls.length > 0 ? { toolCalls: allToolCalls } : {}),
        }
      : undefined;

    await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "ASSISTANT",
        content: finalText || "Done.",
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
      },
    });
  } catch (error) {
    // Clean up working message on error
    await prisma.chatMessage.delete({ where: { id: workingMsg.id } }).catch(() => {});
    throw error;
  }
}

/** Strip large values (like file content) from args for display */
function sanitizeArgs(args: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === "content" && v.length > 200) {
      sanitized[k] = v.slice(0, 200) + "...";
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}
