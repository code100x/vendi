import { Template } from "e2b";
import { prisma } from "../lib/prisma";

export async function buildProjectTemplate(projectId: string): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
  });

  let buildLog = "";
  const log = (msg: string) => {
    buildLog += msg + "\n";
    prisma.project
      .update({ where: { id: projectId }, data: { templateBuildLog: buildLog } })
      .catch(() => {});
  };

  try {
    await prisma.project.update({
      where: { id: projectId },
      data: { templateStatus: "BUILDING", templateBuildLog: "" },
    });

    log("Building template...");

    // Build service install commands
    const servicePkgs: string[] = [];
    for (const svc of project.requiredServices) {
      if (svc === "postgres") servicePkgs.push("postgresql", "postgresql-client");
      else if (svc === "redis") servicePkgs.push("redis-server");
      else if (svc === "mysql") servicePkgs.push("mysql-server");
    }

    const allPkgs = ["git", "curl", "xvfb", "x11vnc", "python3-pip", "chromium", ...servicePkgs].join(" ");

    const dockerfile = `FROM node:22-bookworm

RUN apt-get update && apt-get install -y ${allPkgs} \\
    && pip3 install websockify --break-system-packages \\
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN npm install -g bun @openai/codex

RUN mkdir -p /workspace && chmod 777 /workspace \\
    && git config --global --add safe.directory /workspace
`;

    log("Building image from Dockerfile...");

    const templateAlias = `vendi-${projectId}`;

    const template = Template().fromDockerfile(dockerfile);

    await Template.build(template, {
      alias: templateAlias,
      cpuCount: 8,
      memoryMB: 8192,
      onBuildLogs: (logEntry) => {
        if (logEntry && typeof logEntry === "object" && "message" in logEntry) {
          const msg = (logEntry as any).message;
          if (msg) buildLog += msg + "\n";
        }
      },
    });

    log("Template built successfully!");

    await prisma.project.update({
      where: { id: projectId },
      data: {
        e2bTemplateId: templateAlias,
        templateStatus: "READY",
        templateBuildLog: buildLog,
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Template build failed:", errorMsg);
    await prisma.project.update({
      where: { id: projectId },
      data: {
        templateStatus: "FAILED",
        templateBuildLog: buildLog + "\n\nERROR: " + errorMsg,
      },
    });
    throw error;
  }
}
