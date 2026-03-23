import { Sandbox } from "e2b";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { getAgentScript } from "./agent-script";
import { broadcastToRoom } from "../ws/rooms";
import type { ToolCallEntry } from "@vendi/shared";

const VENDI_DIR = "/workspace/.vendi";
const CONFIG_PATH = `${VENDI_DIR}/agent-config.json`;
const SCRIPT_PATH = `${VENDI_DIR}/agent.mjs`;
const LOG_PATH = `${VENDI_DIR}/agent-log.jsonl`;

const AGENT_STALE_MS = 60 * 60 * 1000; // 1 hour safety valve

interface StartAgentConfig {
  sessionId: string;
  sandboxId: string;
  userMessage: string;
  systemPrompt: string;
}

// ── Start agent turn (non-blocking) ──────────────────────────────────────────

/** Load previous chat messages and convert to LLM format */
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
  }
  return history;
}

function getLLMConfig() {
  if (env.LLM_PROVIDER === "vercel") {
    if (!env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY not set");
    return {
      llmBaseUrl: "https://ai-gateway.vercel.sh/v1/chat/completions",
      llmApiKey: env.AI_GATEWAY_API_KEY,
      llmModel: "openai/gpt-4.1",
    };
  }
  if (env.LLM_PROVIDER === "openai") {
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
    return {
      llmBaseUrl: "https://api.openai.com/v1/chat/completions",
      llmApiKey: env.OPENAI_API_KEY,
      llmModel: "gpt-4.1",
    };
  }
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");
  return {
    llmBaseUrl: "https://openrouter.ai/api/v1/chat/completions",
    llmApiKey: env.OPENROUTER_API_KEY,
    llmModel: "anthropic/claude-sonnet-4",
  };
}

export async function startAgentTurn(config: StartAgentConfig): Promise<void> {
  const { sessionId, sandboxId, userMessage, systemPrompt } = config;

  const llmConfig = getLLMConfig();
  const sandbox = await Sandbox.connect(sandboxId);

  // Ensure state directory exists
  await sandbox.commands.run(`mkdir -p ${VENDI_DIR}`, { requestTimeoutMs: 5_000 });

  // Build conversation history from DB
  const history = await buildConversationHistory(sessionId);
  history.push({ role: "user", content: userMessage });

  // Write config for the agent script
  const agentConfig = {
    ...llmConfig,
    systemPrompt,
    messages: history,
    maxIterations: 25,
  };
  await sandbox.files.write(CONFIG_PATH, JSON.stringify(agentConfig));

  // Write the agent script
  await sandbox.files.write(SCRIPT_PATH, getAgentScript());

  // Create working message visible to frontend
  const workingMsg = await prisma.chatMessage.create({
    data: {
      sessionId,
      role: "SYSTEM",
      content: "Working on it...",
    },
  });

  // Track the agent run in DB (for cross-pod sync + safety valve)
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      agentRunId: `run-${Date.now()}`,
      agentWorkingMsgId: workingMsg.id,
      agentRunStartedAt: new Date(),
    },
  });

  // Start agent as background process in sandbox
  await sandbox.commands.run(`node ${SCRIPT_PATH} > /dev/null 2>&1 &`, {
    background: true,
    requestTimeoutMs: 5_000,
  });
}

// ── Sync agent progress (called by GET /messages + sweep) ────────────────────

interface LogEntry {
  type: "tool_call" | "done" | "error";
  id?: string;
  name?: string;
  args?: Record<string, string>;
  result?: string;
  timestamp?: string;
  content?: string;
  filesChanged?: string[];
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  iterations?: number;
}

function parseLogFile(content: string): LogEntry[] {
  if (!content) return [];
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean) as LogEntry[];
}

export async function syncAgentProgress(sessionId: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      agentRunId: true,
      agentWorkingMsgId: true,
      agentRunStartedAt: true,
      sandboxId: true,
    },
  });

  if (!session?.agentRunId || !session.sandboxId) return;

  // Safety valve: if agent has been running > 1 hour, clean up
  if (session.agentRunStartedAt) {
    const age = Date.now() - session.agentRunStartedAt.getTime();
    if (age > AGENT_STALE_MS) {
      console.log(`[Agent] Stale agent run for session ${sessionId}, cleaning up`);
      if (session.agentWorkingMsgId) {
        await prisma.chatMessage.delete({ where: { id: session.agentWorkingMsgId } }).catch(() => {});
      }
      await prisma.chatMessage.create({
        data: {
          sessionId,
          role: "SYSTEM",
          content: "Agent timed out after 1 hour. You can send a new message to try again.",
        },
      });
      await prisma.session.update({
        where: { id: sessionId },
        data: { agentRunId: null, agentWorkingMsgId: null, agentRunStartedAt: null },
      });
      return;
    }
  }

  // Read log file from sandbox
  let logContent = "";
  try {
    const sandbox = await Sandbox.connect(session.sandboxId);
    logContent = String(await sandbox.files.read(LOG_PATH));
  } catch {
    // Sandbox might not be reachable — skip this cycle
    return;
  }

  const entries = parseLogFile(logContent);
  if (entries.length === 0) return;

  // Check for done/error entry
  const doneEntry = entries.find((e) => e.type === "done");
  const errorEntry = entries.find((e) => e.type === "error");

  // Extract tool calls for display
  const toolCalls: ToolCallEntry[] = entries
    .filter((e) => e.type === "tool_call")
    .map((e) => ({
      id: e.id || "",
      name: e.name || "",
      args: e.args || {},
      result: e.result || "",
      timestamp: e.timestamp || "",
    }));

  if (doneEntry || errorEntry) {
    // Agent finished — finalize
    const finalContent = doneEntry?.content || errorEntry?.content || "Done.";
    const filesChanged = doneEntry?.filesChanged || [];

    // Delete working message
    if (session.agentWorkingMsgId) {
      await prisma.chatMessage.delete({ where: { id: session.agentWorkingMsgId } }).catch(() => {});
    }

    // Create final assistant message
    const hasMetadata = filesChanged.length > 0 || toolCalls.length > 0;
    const metadata = hasMetadata
      ? {
          ...(filesChanged.length > 0 ? { filesChanged } : {}),
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        }
      : undefined;

    await prisma.chatMessage.create({
      data: {
        sessionId,
        role: errorEntry ? "SYSTEM" : "ASSISTANT",
        content: finalContent,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
      },
    });

    // Update session cost tracking from agent-reported usage
    const turnTokensIn = doneEntry?.tokensIn || 0;
    const turnTokensOut = doneEntry?.tokensOut || 0;
    const turnCostUsd = doneEntry?.costUsd || 0;

    if (turnTokensIn > 0 || turnTokensOut > 0) {
      console.log(
        `[Agent] Session ${sessionId} turn cost: $${turnCostUsd.toFixed(4)} (${turnTokensIn} in / ${turnTokensOut} out, ${doneEntry?.iterations || "?"} iterations)`
      );
    }

    const updatedSession = await prisma.session.update({
      where: { id: sessionId },
      data: {
        agentRunId: null,
        agentWorkingMsgId: null,
        agentRunStartedAt: null,
        totalTokensIn: { increment: turnTokensIn },
        totalTokensOut: { increment: turnTokensOut },
        totalCostUsd: { increment: turnCostUsd },
      },
    });

    // Broadcast cost update to connected clients
    if (turnCostUsd > 0) {
      broadcastToRoom(sessionId, {
        type: "cost_update",
        sessionId,
        totalCostUsd: updatedSession.totalCostUsd,
        totalTokensIn: updatedSession.totalTokensIn,
        totalTokensOut: updatedSession.totalTokensOut,
      });
    }
  } else if (session.agentWorkingMsgId && toolCalls.length > 0) {
    // Agent still running — update working message with live tool calls
    const latestTool = toolCalls[toolCalls.length - 1];
    const statusMap: Record<string, string> = {
      read_file: "Reading files...",
      write_file: "Writing files...",
      list_files: "Browsing project...",
      search_code: "Searching code...",
      run_command: "Running commands...",
    };

    await prisma.chatMessage.update({
      where: { id: session.agentWorkingMsgId },
      data: {
        content: statusMap[latestTool?.name || ""] || "Working on it...",
        metadata: JSON.parse(JSON.stringify({ toolCalls })),
      },
    });
  }
}

// ── Background sweep ─────────────────────────────────────────────────────────

export async function sweepActiveAgentRuns(): Promise<void> {
  try {
    const sessions = await prisma.session.findMany({
      where: {
        agentRunId: { not: null },
        status: "RUNNING",
      },
      select: { id: true },
    });

    for (const session of sessions) {
      try {
        await syncAgentProgress(session.id);
      } catch (err) {
        console.error(`[Agent] Sweep error for session ${session.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[Agent] Sweep job error:", err);
  }
}
