import { createHash, randomUUID } from "node:crypto";
import { Sandbox } from "e2b";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import type { ToolCallEntry } from "@vendi/shared";

interface AgentRunConfig {
  sessionId: string;
  sandboxId: string;
  userMessage: string;
  systemPrompt: string;
  maxBudgetUsd: number;
}

const CODEX_STATE_DIR = "/workspace/.vendi";
const READY_MARKER = `${CODEX_STATE_DIR}/codex-ready`;
const MODEL_FILE = `${CODEX_STATE_DIR}/model.txt`;
const CODEX_HOME_DIR = `${CODEX_STATE_DIR}/home`;
const CODEX_AUTH_FILE = `${CODEX_HOME_DIR}/.codex/auth.json`;
const OPENAI_KEY_FINGERPRINT_FILE = `${CODEX_STATE_DIR}/openai-key.sha256`;
const PREFERRED_MODEL = "gpt-5.4";
const FALLBACK_MODELS = ["gpt-5.3-codex"];
const REASONING_EFFORT = "high";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function ensureStateDir(sandbox: Sandbox): Promise<void> {
  await sandbox.commands.run(`mkdir -p ${CODEX_STATE_DIR} ${CODEX_HOME_DIR}`, {
    requestTimeoutMs: 10_000,
  });
}

function getOpenAIKeyFingerprint(): string {
  return createHash("sha256").update(env.OPENAI_API_KEY || "").digest("hex");
}

async function ensureCodexAuth(sandbox: Sandbox): Promise<void> {
  const existingFingerprint = (await readIfExists(sandbox, OPENAI_KEY_FINGERPRINT_FILE)).trim();
  const currentFingerprint = getOpenAIKeyFingerprint();

  if (existingFingerprint === currentFingerprint) {
    try {
      const result = await sandbox.commands.run(`test -f ${CODEX_AUTH_FILE}`, {
        requestTimeoutMs: 5_000,
      });
      if (result.exitCode === 0) return;
    } catch (error: any) {
      if (error?.result?.exitCode !== 1) throw error;
    }
  }

  const loginCommand =
    `cd /workspace && mkdir -p ${shellEscape(CODEX_HOME_DIR)} && ` +
    `OPENAI_API_KEY=${shellEscape(env.OPENAI_API_KEY || "")} ` +
    `HOME=${shellEscape(CODEX_HOME_DIR)} ` +
    `bash -lc ${shellEscape('printf %s "$OPENAI_API_KEY" | codex login --with-api-key')}`;

  const result = await sandbox.commands.run(loginCommand, {
    requestTimeoutMs: 120_000,
  });

  if (result.exitCode !== 0) {
    const failure = [result.stderr, result.stdout].find(Boolean)?.trim() || "Codex login failed.";
    throw new Error(failure.slice(0, 1000));
  }

  await sandbox.files.write(OPENAI_KEY_FINGERPRINT_FILE, currentFingerprint);
}

async function hasExistingSession(sandbox: Sandbox): Promise<boolean> {
  try {
    const result = await sandbox.commands.run(`test -f ${READY_MARKER}`, {
      requestTimeoutMs: 5_000,
    });
    return result.exitCode === 0;
  } catch (error: any) {
    if (error?.result?.exitCode === 1) return false;
    throw error;
  }
}

async function readIfExists(sandbox: Sandbox, path: string): Promise<string> {
  try {
    return String(await sandbox.files.read(path));
  } catch {
    return "";
  }
}

async function getSessionModels(sandbox: Sandbox): Promise<string[]> {
  const savedModel = (await readIfExists(sandbox, MODEL_FILE)).trim();
  if (savedModel) return [savedModel];
  return [PREFERRED_MODEL, ...FALLBACK_MODELS];
}

async function listChangedFiles(sandbox: Sandbox): Promise<string[]> {
  const result = await sandbox.commands.run(
    "cd /workspace && git status --porcelain",
    { requestTimeoutMs: 10_000 }
  );

  if (!result.stdout) return [];

  return result.stdout
    .split("\n")
    .map((line: string) => line.trim())
    .filter(Boolean)
    .map((line: string) => line.slice(3).trim())
    .filter(Boolean)
    .slice(0, 50);
}

/**
 * Parse Codex --json stdout to extract structured tool call events.
 * Codex outputs newline-delimited JSON; we look for function_call / function_call_output pairs.
 */
function parseCodexToolCalls(stdout: string): ToolCallEntry[] {
  if (!stdout) return [];

  const toolCalls: ToolCallEntry[] = [];
  const pending = new Map<string, { name: string; args: Record<string, string> }>();

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line);
      // Handle both direct events and events wrapped in an "item" envelope
      const event = raw.item || raw;

      if (event.type === "function_call") {
        const callId = event.call_id || event.id || randomUUID();
        let args: Record<string, string> = {};
        try {
          const parsed = JSON.parse(event.arguments || "{}");
          for (const [k, v] of Object.entries(parsed)) {
            args[k] = Array.isArray(v) ? v.join(" ") : String(v);
          }
        } catch {
          args = { raw: event.arguments || "" };
        }
        pending.set(callId, { name: event.name || "unknown", args });
      } else if (event.type === "function_call_output") {
        const callId = event.call_id || event.id;
        const entry = pending.get(callId);
        if (entry) {
          toolCalls.push({
            id: callId,
            name: entry.name,
            args: entry.args,
            result: String(event.output || "").slice(0, 3000),
            timestamp: new Date().toISOString(),
          });
          pending.delete(callId);
        }
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  // Flush remaining calls that had no output
  for (const [callId, entry] of pending) {
    toolCalls.push({
      id: callId,
      name: entry.name,
      args: entry.args,
      result: "",
      timestamp: new Date().toISOString(),
    });
  }

  return toolCalls;
}

function buildPrompt(systemPrompt: string, userMessage: string, maxBudgetUsd: number): string {
  return [
    systemPrompt,
    "",
    "OPERATION RULES:",
    `- Keep working until the request is complete or you need a concrete answer from the user.`,
    `- Budget target: $${maxBudgetUsd.toFixed(2)}.`,
    "- Keep user-facing updates brief and non-technical.",
    "- If you need clarification, ask one focused question at the end.",
    "- For long-running dev servers, launch them in a detached way so they survive after this Codex turn exits.",
    "- Prefer `nohup ... >/tmp/<name>.log 2>&1 < /dev/null &` or `setsid ... >/tmp/<name>.log 2>&1 < /dev/null &` for dev servers.",
    "- Do not leave the task blocked on an attached foreground server process.",
    "- After starting a dev server, verify it with curl on the expected port before reporting success.",
    "- If the task involves creating or fixing env files, inspect the codebase for the exact env names it reads before replying.",
    "- Infer obvious aliases instead of asking the user again. Example: add `VITE_GITHUB_CLIENT_ID` from `GITHUB_CLIENT_ID` when the frontend reads the `VITE_` name.",
    "- Only ask for an env value when it is truly distinct and cannot be derived safely from what already exists.",
    "",
    "USER REQUEST:",
    userMessage,
  ].join("\n");
}

async function diagnoseOpenAIFailure(): Promise<string | null> {
  if (!env.OPENAI_API_KEY) return "OPENAI_API_KEY is not set on the server.";

  const headers = {
    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    const modelsRes = await fetch(OPENAI_MODELS_URL, {
      method: "GET",
      headers,
    });

    if (!modelsRes.ok) {
      const body = await modelsRes.text();
      return `OpenAI auth check failed (${modelsRes.status}). ${body.slice(0, 300)}`;
    }

    const responsesRes = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        input: "Reply with exactly OK.",
      }),
    });

    if (responsesRes.ok) return null;

    const body = await responsesRes.text();
    if (responsesRes.status === 429 && body.includes("insufficient_quota")) {
      return "The OpenAI API key is valid, but the project has no usable Responses quota right now.";
    }

    return `OpenAI Responses check failed (${responsesRes.status}). ${body.slice(0, 300)}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function runCodexCommand(
  sandbox: Sandbox,
  model: string,
  promptPath: string,
  outputPath: string,
  logPath: string,
  resume: boolean
): Promise<CommandResult & { logPath: string }> {

  const baseArgs = [
    "codex",
    "exec",
    ...(resume ? ["resume", "--last"] : []),
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "--model",
    model,
    "-c",
    `model_reasoning_effort="${REASONING_EFFORT}"`,
    "-c",
    'experimental_realtime_ws_mode="disabled"',
    ...(resume ? [] : ["-C", "/workspace"]),
    "--skip-git-repo-check",
    "--output-last-message",
    outputPath,
    "-",
  ];

  // Pipe stdout to a log file so we can poll it for live progress
  const command =
    `cd /workspace && ` +
    `OPENAI_API_KEY=${shellEscape(env.OPENAI_API_KEY || "")} ` +
    `HOME=${shellEscape(CODEX_HOME_DIR)} ` +
    `${baseArgs.map(shellEscape).join(" ")} < ${shellEscape(promptPath)} | tee ${shellEscape(logPath)}`;
  try {
    const result = await sandbox.commands.run(command, {
      requestTimeoutMs: 20 * 60 * 1000,
      timeoutMs: 0,
    });
    return { ...result, logPath };
  } catch (error: any) {
    if (error?.result) return { ...error.result as CommandResult, logPath };
    throw error;
  }
}

export async function runAgentTurn(config: AgentRunConfig): Promise<void> {
  const { sessionId, sandboxId, userMessage, systemPrompt, maxBudgetUsd } = config;

  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");

  const sandbox = await Sandbox.connect(sandboxId);
  await ensureStateDir(sandbox);
  await ensureCodexAuth(sandbox);

  const runId = randomUUID();
  const promptPath = `${CODEX_STATE_DIR}/prompt-${runId}.txt`;
  const outputPath = `${CODEX_STATE_DIR}/last-message-${runId}.txt`;

  const prompt = buildPrompt(systemPrompt, userMessage, maxBudgetUsd);
  await sandbox.files.write(promptPath, prompt);

  const workingMsg = await prisma.chatMessage.create({
    data: {
      sessionId,
      role: "SYSTEM",
      content: "Codex is working on it...",
    },
  });

  // Track run in DB so other pods can detect/recover it
  await prisma.session.update({
    where: { id: sessionId },
    data: { agentRunId: runId, agentWorkingMsgId: workingMsg.id, agentRunStartedAt: new Date() },
  });

  let result: (CommandResult & { logPath: string }) | null = null;
  const resume = await hasExistingSession(sandbox);
  const models = await getSessionModels(sandbox);
  let chosenModel = models[0];

  for (let index = 0; index < models.length; index++) {
    const model = models[index]!;
    const shouldResume = index === 0 ? resume : false;

    // Start polling for live tool calls while Codex runs
    const logPath = `${CODEX_STATE_DIR}/codex-log-${runId}.jsonl`;
    let lastLogSize = 0;
    const pollInterval = setInterval(async () => {
      try {
        const logContent = await readIfExists(sandbox, logPath);
        if (logContent.length <= lastLogSize) return;
        lastLogSize = logContent.length;
        const liveCalls = parseCodexToolCalls(logContent);
        if (liveCalls.length > 0) {
          await prisma.chatMessage.update({
            where: { id: workingMsg.id },
            data: {
              metadata: { toolCalls: liveCalls },
            },
          });
        }
      } catch {
        // Ignore polling errors
      }
    }, 2000);

    const attempt = await runCodexCommand(sandbox, model, promptPath, outputPath, logPath, shouldResume);
    clearInterval(pollInterval);

    if (attempt.exitCode === 0) {
      result = attempt;
      chosenModel = model;
      break;
    }

    const failureText = [attempt.stderr, attempt.stdout].find(Boolean)?.trim() || "";
    const canFallback =
      index < models.length - 1 &&
      !resume &&
      failureText.includes("responses_websocket");

    if (!canFallback) {
      result = attempt;
      chosenModel = model;
      break;
    }

    await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "SYSTEM",
        content: `Codex hit a model transport issue on ${model}. Retrying with ${models[index + 1]}.`,
      },
    });
  }

  if (!result) throw new Error("Codex did not return a result.");

  // Remove the "working" placeholder and clear run tracking
  await prisma.chatMessage.delete({ where: { id: workingMsg.id } }).catch(() => {});
  await prisma.session.update({
    where: { id: sessionId },
    data: { agentRunId: null, agentWorkingMsgId: null, agentRunStartedAt: null },
  });

  const finalMessage = (await readIfExists(sandbox, outputPath)).trim();
  const changedFiles = await listChangedFiles(sandbox);
  // Read from log file for final parsing (tee pipes stdout to file)
  const logContent = await readIfExists(sandbox, result.logPath);
  const toolCalls = parseCodexToolCalls(logContent || result?.stdout || "");

  if (result.exitCode === 0) {
    await sandbox.files.write(MODEL_FILE, chosenModel);
    await sandbox.commands.run(`touch ${READY_MARKER}`, { requestTimeoutMs: 5_000 });

    const hasMetadata = changedFiles.length > 0 || toolCalls.length > 0;
    const metadata = hasMetadata
      ? JSON.parse(JSON.stringify({
          ...(changedFiles.length > 0 ? { filesChanged: changedFiles } : {}),
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        }))
      : undefined;

    await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "ASSISTANT",
        content: finalMessage || "Done.",
        rawContent: result.stdout || null,
        metadata,
      },
    });
    return;
  }

  const failureDetails = [result.stderr, result.stdout].find(Boolean)?.trim() || "Codex exited without a response.";

  if (failureDetails.includes("responses_websocket")) {
    const diagnosis = await diagnoseOpenAIFailure();
    if (diagnosis) {
      throw new Error(`${diagnosis} Original Codex error: ${failureDetails}`.slice(0, 1000));
    }
  }

  throw new Error(failureDetails.slice(0, 1000));
}

/**
 * Try to recover a Codex run started by a crashed pod.
 * Checks if the output file exists (meaning Codex finished).
 * Returns true if recovered, false if still running.
 */
export async function recoverAgentRun(
  sessionId: string,
  sandboxId: string,
  runId: string,
  workingMsgId: string | null
): Promise<boolean> {
  const sandbox = await Sandbox.connect(sandboxId);
  const outputPath = `${CODEX_STATE_DIR}/last-message-${runId}.txt`;
  const logPath = `${CODEX_STATE_DIR}/codex-log-${runId}.jsonl`;

  // Check if Codex finished by looking for the output file
  const finalMessage = (await readIfExists(sandbox, outputPath)).trim();
  if (!finalMessage) return false; // Still running

  console.log(`[Agent] Recovering finished run ${runId} for session ${sessionId}`);

  // Codex finished — save the result
  const changedFiles = await listChangedFiles(sandbox);
  const logContent = await readIfExists(sandbox, logPath);
  const toolCalls = parseCodexToolCalls(logContent);

  const hasMetadata = changedFiles.length > 0 || toolCalls.length > 0;
  const metadata = hasMetadata
    ? JSON.parse(JSON.stringify({
        ...(changedFiles.length > 0 ? { filesChanged: changedFiles } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      }))
    : undefined;

  // Delete the stale "working" message
  if (workingMsgId) {
    await prisma.chatMessage.delete({ where: { id: workingMsgId } }).catch(() => {});
  }

  await prisma.chatMessage.create({
    data: {
      sessionId,
      role: "ASSISTANT",
      content: finalMessage,
      rawContent: logContent || null,
      metadata,
    },
  });

  // Mark ready for next turn
  await sandbox.files.write(MODEL_FILE, PREFERRED_MODEL);
  await sandbox.commands.run(`touch ${READY_MARKER}`, { requestTimeoutMs: 5_000 });

  return true;
}
