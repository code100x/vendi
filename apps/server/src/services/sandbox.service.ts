import { Sandbox } from "e2b";
import { prisma } from "../lib/prisma";
import { decrypt } from "../lib/crypto";
import { env } from "../config/env";

interface StartSandboxResult {
  sandboxId: string;
  previewUrl: string;
}

export async function startSessionSandbox(
  sessionId: string,
  projectId: string,
  userId: string
): Promise<StartSandboxResult> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { org: true },
  });

  if (project.templateStatus !== "READY") {
    throw new Error("Project is not configured yet");
  }

  // Get user's GitHub token for repo cloning
  const githubAccount = await prisma.oAuthAccount.findFirst({
    where: { userId, provider: "github" },
  });
  if (!githubAccount) {
    throw new Error("GitHub account not linked");
  }

  // Decrypt GitHub token — stored as "encrypted|iv" format
  const [ghEncrypted, ghIv] = githubAccount.accessToken.split("|");
  const githubToken = decrypt(ghEncrypted, ghIv);

  // Create empty sandbox (no per-project template)
  const sandbox = await Sandbox.create({
    timeoutMs: project.maxSessionDurationMin * 60 * 1000,
    cpuCount: 8,
    memoryMB: 16384,
    envs: {
      GITHUB_TOKEN: githubToken,
      ...(env.OPENAI_API_KEY ? { OPENAI_API_KEY: env.OPENAI_API_KEY } : {}),
      ...(env.OPENROUTER_API_KEY ? { OPENROUTER_API_KEY: env.OPENROUTER_API_KEY } : {}),
    },
  } as any);

  const branchName = `vendi/session-${sessionId}`;

  try {
    // Ensure /workspace exists with proper permissions
    await sandbox.commands.run(
      "sudo mkdir -p /workspace && sudo chmod 777 /workspace && git config --global --add safe.directory /workspace",
      { requestTimeoutMs: 5_000 }
    );

    // Install required system packages
    const servicePkgs: string[] = [];
    for (const svc of project.requiredServices) {
      if (svc === "postgres") servicePkgs.push("postgresql", "postgresql-client");
      else if (svc === "redis") servicePkgs.push("redis-server");
      else if (svc === "mysql") servicePkgs.push("mysql-server");
    }
    const allPkgs = ["git", "curl", "xvfb", "x11vnc", "python3-pip", "chromium", ...servicePkgs].join(" ");
    await sandbox.commands.run(
      `sudo apt-get update && sudo apt-get install -y ${allPkgs} && pip3 install websockify --break-system-packages && sudo apt-get clean`,
      { requestTimeoutMs: 180_000 }
    );

    // Install global npm tools
    await sandbox.commands.run("npm install -g bun @openai/codex", { requestTimeoutMs: 60_000 });

    // Clone the repo
    await sandbox.commands.run(
      `GIT_TOKEN="${githubToken}" git clone https://x-access-token:${githubToken}@github.com/${project.githubRepoFullName}.git /workspace 2>&1`,
      { requestTimeoutMs: 120_000 }
    ).catch((e: any) => {
      throw new Error(`Git clone failed: ${e.result?.stdout || e.message}`);
    });

    // Create and checkout session branch
    await sandbox.commands.run(
      `cd /workspace && git checkout -b ${branchName}`,
      { requestTimeoutMs: 10_000 }
    );

    // Write .env file if project has env vars
    if (project.envVars && project.envVarsIv) {
      const envJson = decrypt(project.envVars, project.envVarsIv);
      const envObj = JSON.parse(envJson) as Record<string, string>;
      const envContent = Object.entries(envObj)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
      await sandbox.files.write("/workspace/.env", envContent);
    }

    // Start required services
    for (const service of project.requiredServices) {
      try {
        if (service === "postgres") {
          await sandbox.commands.run("sudo service postgresql start 2>/dev/null || true", {
            requestTimeoutMs: 30_000,
          });
        } else if (service === "redis") {
          await sandbox.commands.run("redis-server --daemonize yes 2>/dev/null || true", {
            requestTimeoutMs: 10_000,
          });
        }
      } catch {
        // Best-effort service start
      }
    }

    // Run migration commands
    for (const cmd of project.migrationCommands) {
      try {
        await sandbox.commands.run(`cd /workspace && ${cmd}`, { requestTimeoutMs: 60_000 });
      } catch {
        // Migration may fail if deps aren't installed yet — agent will handle it
      }
    }

    // NOTE: We do NOT run startup commands here.
    // The agent will handle installing deps and starting the dev server
    // as its first task when the user sends the first message (or automatically).

    // Start browser streaming: Xvfb + Chromium + x11vnc + websockify
    const devPort = project.devServerPort || 3000;

    // Start virtual display
    await sandbox.commands.run("Xvfb :99 -screen 0 1280x720x24 &", {
      background: true,
      requestTimeoutMs: 5_000,
    });

    // Wait for Xvfb to be ready
    await sandbox.commands.run("sleep 1", { requestTimeoutMs: 5_000 });

    // Start Chromium browser pointing to the dev server
    await sandbox.commands.run(
      `DISPLAY=:99 chromium --no-sandbox --disable-gpu --disable-dev-shm-usage --window-size=1280,720 --start-maximized http://localhost:${devPort} &`,
      { background: true, requestTimeoutMs: 10_000 }
    );

    // Start x11vnc (VNC server) on display :99, port 5900
    await sandbox.commands.run(
      "x11vnc -display :99 -nopw -listen 0.0.0.0 -forever -shared -rfbport 5900 &",
      { background: true, requestTimeoutMs: 5_000 }
    );

    // Start websockify to bridge WebSocket (6080) to VNC (5900)
    await sandbox.commands.run(
      "websockify 6080 localhost:5900 &",
      { background: true, requestTimeoutMs: 5_000 }
    );

    // Wait for everything to start
    await sandbox.commands.run("sleep 2", { requestTimeoutMs: 5_000 });

    // Get noVNC WebSocket URL for browser streaming
    const previewUrl = `wss://${sandbox.getHost(6080)}`;

    // Update session record
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        sandboxId: sandbox.sandboxId,
        previewUrl,
        branchName,
        status: "RUNNING",
      },
    });

    return { sandboxId: sandbox.sandboxId, previewUrl };
  } catch (error) {
    // Clean up sandbox on failure
    await sandbox.kill().catch(() => {});
    throw error;
  }
}

export async function stopSandbox(sandboxId: string): Promise<void> {
  try {
    const sandbox = await Sandbox.connect(sandboxId);
    await sandbox.kill();
  } catch {
    // Sandbox may already be dead
  }
}

export async function pushChangesFromSandbox(
  sandboxId: string,
  branchName: string,
  commitMessage: string
): Promise<void> {
  const sandbox = await Sandbox.connect(sandboxId);

  const escapedMessage = commitMessage.replace(/"/g, '\\"');
  await sandbox.commands.run(
    `cd /workspace && git add -A && git commit -m "${escapedMessage}" --allow-empty && git push origin ${branchName}`,
    { requestTimeoutMs: 60_000 }
  );
}
