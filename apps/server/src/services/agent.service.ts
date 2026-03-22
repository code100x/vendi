import { Sandbox } from "e2b";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "anthropic/claude-sonnet-4";

interface AgentRunConfig {
  sessionId: string;
  sandboxId: string;
  userMessage: string;
  systemPrompt: string;
  maxBudgetUsd: number;
}

const tools = [
  { type: "function" as const, function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function" as const, function: { name: "write_file", description: "Write/create a file", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function" as const, function: { name: "edit_file", description: "Replace a string in a file", parameters: { type: "object", properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } }, required: ["path", "old_string", "new_string"] } } },
  { type: "function" as const, function: { name: "run_command", description: "Run a shell command in /workspace", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
  { type: "function" as const, function: { name: "list_files", description: "List files in a directory", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function" as const, function: { name: "search_code", description: "Search for a pattern in files", parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } } },
];

async function executeTool(sandbox: Sandbox, name: string, args: Record<string, string>): Promise<string> {
  try {
    switch (name) {
      case "read_file":
        return String(await sandbox.files.read(args.path));
      case "write_file":
        await sandbox.files.write(args.path, args.content);
        return `File written: ${args.path}`;
      case "edit_file": {
        const content = String(await sandbox.files.read(args.path));
        if (!content.includes(args.old_string)) return `Error: string not found in ${args.path}`;
        await sandbox.files.write(args.path, content.replace(args.old_string, args.new_string));
        return `File edited: ${args.path}`;
      }
      case "run_command": {
        const r = await sandbox.commands.run(`cd /workspace && ${args.command}`, { requestTimeoutMs: 120_000 });
        return ((r.stdout || "") + (r.stderr ? "\nSTDERR: " + r.stderr : "")).slice(0, 5000) || `Exit: ${r.exitCode}`;
      }
      case "list_files": {
        const r = await sandbox.commands.run(`find ${args.path} -maxdepth 2 -type f 2>/dev/null | head -50`, { requestTimeoutMs: 10_000 });
        return r.stdout || "No files found";
      }
      case "search_code": {
        const r = await sandbox.commands.run(
          `cd /workspace && grep -rn "${args.pattern.replace(/"/g, '\\"')}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" --include="*.env*" --include="*.yml" --include="*.md" --include="*.prisma" 2>/dev/null | head -30`,
          { requestTimeoutMs: 10_000 }
        );
        return r.stdout || "No matches";
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

// Per-session conversation history
const sessionHistories = new Map<string, any[]>();

export async function runAgentTurn(config: AgentRunConfig): Promise<void> {
  const { sessionId, sandboxId, userMessage, systemPrompt } = config;

  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");

  const sandbox = await Sandbox.connect(sandboxId);

  let messages = sessionHistories.get(sessionId);
  if (!messages) {
    messages = [{ role: "system", content: systemPrompt }];
    sessionHistories.set(sessionId, messages);
  }

  messages.push({ role: "user", content: userMessage });

  const filesChanged: string[] = [];
  let iterations = 0;

  while (iterations < 30) {
    iterations++;

    const data = await callLLM(messages);
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("No LLM response");

    messages.push(msg);

    // Save intermediate text immediately so user sees progress
    if (msg.content && msg.tool_calls) {
      await prisma.chatMessage.create({
        data: { sessionId, role: "ASSISTANT", content: msg.content },
      });
    }

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        const { name, arguments: argsStr } = tc.function;
        let args: Record<string, string>;
        try { args = JSON.parse(argsStr); } catch { args = {}; }

        // Show progress for commands
        if (name === "run_command" && args.command) {
          const shortCmd = args.command.length > 80 ? args.command.substring(0, 80) + "..." : args.command;
          await prisma.chatMessage.create({
            data: { sessionId, role: "SYSTEM", content: `Running: ${shortCmd}` },
          });
        }

        const result = await executeTool(sandbox, name, args);

        if ((name === "write_file" || name === "edit_file") && args.path) {
          filesChanged.push(args.path.replace("/workspace/", ""));
        }

        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }
      continue;
    }

    // Got final text response — save it
    break;
  }

  // If exhausted iterations, force a summary
  if (iterations >= 30) {
    messages.push({ role: "user", content: "Summarize what you did and the current state." });
    const summary = await callLLM(messages);
    const summaryMsg = summary.choices?.[0]?.message;
    if (summaryMsg) messages.push(summaryMsg);
  }

  // Save final response
  const lastAssistant = messages.filter((m: any) => m.role === "assistant" && m.content).pop();
  const responseText = lastAssistant?.content || "";

  if (responseText) {
    // Check if we already saved this as an intermediate message
    const existing = await prisma.chatMessage.findFirst({
      where: { sessionId, role: "ASSISTANT", content: responseText },
    });
    if (!existing) {
      await prisma.chatMessage.create({
        data: {
          sessionId,
          role: "ASSISTANT",
          content: responseText,
          metadata: filesChanged.length > 0 ? { filesChanged } : undefined,
        },
      });
    }
  }
}
