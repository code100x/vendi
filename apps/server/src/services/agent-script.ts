/**
 * Returns the source code for the agent script that runs INSIDE the e2b sandbox.
 * This script is written to /workspace/.vendi/agent.mjs before each agent turn.
 */
export function getAgentScript(): string {
  return `#!/usr/bin/env node
import fs from "node:fs";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const CONFIG_PATH = "/workspace/.vendi/agent-config.json";
const LOG_PATH = "/workspace/.vendi/agent-log.jsonl";
const MAX_COMMAND_TIMEOUT_MS = 60_000;

// ── Load config ──────────────────────────────────────────────────────────────

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const { llmBaseUrl, llmApiKey, llmModel, systemPrompt, messages, maxIterations } = config;

// Clear log file for this run
fs.writeFileSync(LOG_PATH, "");

// ── Helpers ──────────────────────────────────────────────────────────────────

function appendLog(entry) {
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\\n");
}

function sanitizeArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = k === "content" && typeof v === "string" && v.length > 200 ? v.slice(0, 200) + "..." : v;
  }
  return out;
}

// ── Tool definitions ─────────────────────────────────────────────────────────

const tools = [
  { type: "function", function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "write_file", description: "Write or create a file", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function", function: { name: "list_files", description: "List files in a directory (3 levels, max 80)", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "search_code", description: "Search for a regex pattern in source files", parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } } },
  { type: "function", function: { name: "run_command", description: "Run a shell command in /workspace (60s timeout)", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
];

// ── Tool execution ───────────────────────────────────────────────────────────

function executeTool(name, args) {
  try {
    switch (name) {
      case "read_file":
        return fs.readFileSync(args.path, "utf8");
      case "write_file": {
        const dir = args.path.substring(0, args.path.lastIndexOf("/"));
        if (dir) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(args.path, args.content);
        return "File written successfully.";
      }
      case "list_files": {
        const out = execSync(\`find \${args.path} -maxdepth 3 -type f 2>/dev/null | head -80\`, { encoding: "utf8", timeout: 10_000 });
        return out || "No files found";
      }
      case "search_code": {
        const escaped = args.pattern.replace(/"/g, '\\\\"');
        try {
          const out = execSync(
            \`cd /workspace && grep -rn "\${escaped}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.json" --include="*.css" --include="*.html" --include="*.env*" --include="*.yml" --include="*.yaml" --include="*.md" --include="*.prisma" 2>/dev/null | head -50\`,
            { encoding: "utf8", timeout: 10_000 }
          );
          return out || "No matches";
        } catch (e) {
          return e.stdout || "No matches";
        }
      }
      case "run_command": {
        try {
          const out = execSync(\`cd /workspace && \${args.command}\`, {
            encoding: "utf8",
            timeout: MAX_COMMAND_TIMEOUT_MS,
            maxBuffer: 1024 * 1024,
          });
          return (out || "").slice(0, 4000) || "Command completed.";
        } catch (e) {
          const stdout = e.stdout || "";
          const stderr = e.stderr || "";
          return (stdout + "\\n" + stderr).trim().slice(0, 4000) || \`Exit code: \${e.status}\`;
        }
      }
      default:
        return "Unknown tool";
    }
  } catch (e) {
    return \`Error: \${e.message || String(e)}\`;
  }
}

// ── LLM call ─────────────────────────────────────────────────────────────────

async function callLLM(msgs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(llmBaseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: \`Bearer \${llmApiKey}\`,
        "X-Title": "Vendi",
      },
      body: JSON.stringify({ model: llmModel, messages: msgs, tools, max_tokens: 4096 }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(\`LLM error \${res.status}: \${await res.text()}\`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ── Main loop ────────────────────────────────────────────────────────────────

async function main() {
  const llmMessages = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  let iterations = 0;
  let finalText = "";

  while (iterations < (maxIterations || 50)) {
    iterations++;

    const data = await callLLM(llmMessages);
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("No LLM response");

    llmMessages.push(msg);

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        const { name, arguments: argsStr } = tc.function;
        let args;
        try { args = JSON.parse(argsStr); } catch { args = {}; }

        const result = executeTool(name, args);

        appendLog({
          type: "tool_call",
          id: randomUUID(),
          name,
          args: sanitizeArgs(args),
          result: (typeof result === "string" ? result : String(result)).slice(0, 2000),
          timestamp: new Date().toISOString(),
        });

        llmMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }
      continue;
    }

    finalText = msg.content || "";
    break;
  }

  if (!finalText && iterations >= (maxIterations || 50)) {
    llmMessages.push({
      role: "user",
      content: "You've used many tool calls. Please summarize what you've done and the current state.",
    });
    const summary = await callLLM(llmMessages);
    finalText = summary.choices?.[0]?.message?.content || "Done.";
  }

  // Get changed files
  let filesChanged = [];
  try {
    const out = execSync("cd /workspace && git status --porcelain", { encoding: "utf8", timeout: 10_000 });
    filesChanged = out.split("\\n").map(l => l.trim()).filter(Boolean).map(l => l.slice(3).trim()).filter(Boolean).slice(0, 50);
  } catch {}

  // Write done marker
  appendLog({
    type: "done",
    content: finalText || "Done.",
    filesChanged,
  });
}

main().catch((err) => {
  appendLog({
    type: "error",
    content: \`Agent error: \${err.message || String(err)}\`,
  });
  process.exit(1);
});
`;
}
