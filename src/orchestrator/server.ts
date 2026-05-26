import "dotenv/config";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { MessageRouter } from "./router.js";
import { projectMachine, type ProjectEvent } from "./pipeline.js";
import { createActor } from "xstate";
import { AgentPool } from "../agents/agent-pool.js";
import type { Project, AgentState, AgentRole, MessageType, DevTask } from "./types.js";
import { formatAgentContext } from "./types.js";
import { render } from "./prompt-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, "../web/index.html");

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});
app.get("/", (_req, res) => { res.set("Cache-Control", "no-store").type("html").send(readFileSync(HTML_PATH, "utf-8")); });
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const router = new MessageRouter();
const agentPool = new AgentPool();
const clients = new Set<WebSocket>();

interface ActiveProject {
  project: Project;
  actor: ReturnType<typeof createActor>;
  agentStates: Map<AgentRole, AgentState>;
}

let activeProject: ActiveProject | null = null;

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
  if (activeProject) {
    ws.send(JSON.stringify({
      type: "init",
      project: activeProject.project,
      agents: Array.from(activeProject.agentStates.values()),
    }));
  }
});

const heartbeat = setInterval(() => {
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
  }
}, 30_000);
wss.on("close", () => clearInterval(heartbeat));

function broadcast(data: object) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function updateAgentStatus(role: AgentRole, status: AgentState["status"], animation: AgentState["animation"], currentTask?: string) {
  if (!activeProject) return;
  const state = activeProject.agentStates.get(role)!;
  state.status = status;
  state.animation = animation;
  state.currentTask = currentTask;
  broadcast({ type: "agent_status", role, status, animation, currentTask });
}

for (const type of ["discuss", "task_assign", "review", "fix_confirm", "clarify", "report"] as MessageType[]) {
  router.on(type, (msg) => broadcast({ type: "agent_message", formatted: formatAgentContext(msg), message: msg }));
}

function initAgentStates(): Map<AgentRole, AgentState> {
  const map = new Map<AgentRole, AgentState>();
  map.set("tech-lead", { role: "tech-lead", status: "idle", position: { x: 2, y: 2 }, animation: "standing" });
  map.set("product-manager", { role: "product-manager", status: "idle", position: { x: 8, y: 2 }, animation: "standing" });
  map.set("coder", { role: "coder", status: "idle", position: { x: 5, y: 8 }, animation: "standing" });
  return map;
}

async function runPhase2_Discuss(project: Project) {
  const maxRounds = 3;
  for (let round = 1; round <= maxRounds; round++) {
    broadcast({ type: "phase_progress", phase: "DISCUSSING", round, totalRounds: maxRounds });
    updateAgentStatus("product-manager", "working", "talking");
    updateAgentStatus("tech-lead", "working", "talking");

    const dPrompt = round === 1
      ? render("phase2-d-first.md", { requirement: project.userRequirement })
      : render("phase2-d-revise.md", { round: String(round) });

    const dReply = await agentPool.send("product-manager", "tech-lead", 2, round, "discuss", dPrompt);
    const dMsg = router.createMessage("product-manager", "tech-lead", 2, round, "discuss", dPrompt, dReply);
    project.messages.push(dMsg);
    router.route(dMsg);

    const gPrompt = render("phase2-g-review.md", { prd: dReply });

    const gReply = await agentPool.send("tech-lead", "product-manager", 2, round, "discuss", gPrompt);
    const gMsg = router.createMessage("tech-lead", "product-manager", 2, round, "discuss", gPrompt, gReply);
    project.messages.push(gMsg);
    router.route(gMsg);

    updateAgentStatus("product-manager", "idle", "standing");
    updateAgentStatus("tech-lead", "idle", "standing");
  }
  broadcast({ type: "phase_done", phase: "DISCUSSING" });
}

async function runPhase3_Plan(project: Project): Promise<DevTask[]> {
  broadcast({ type: "phase_progress", phase: "PLANNING" });
  updateAgentStatus("product-manager", "working", "talking");

  const dPrompt = render("phase3-d-split.md", {});
  const dReply = await agentPool.send("product-manager", "tech-lead", 3, 0, "task_assign", dPrompt);
  router.route(router.createMessage("product-manager", "tech-lead", 3, 0, "task_assign", dPrompt, dReply));
  updateAgentStatus("product-manager", "idle", "standing");

  updateAgentStatus("tech-lead", "working", "talking");
  const gPrompt = render("phase3-g-annotate.md", { taskList: dReply });
  const gReply = await agentPool.send("tech-lead", "product-manager", 3, 0, "task_assign", gPrompt);
  router.route(router.createMessage("tech-lead", "product-manager", 3, 0, "task_assign", gPrompt, gReply));
  updateAgentStatus("tech-lead", "idle", "standing");

  const tasks = parseTasksFromReply(gReply);
  project.tasks = tasks;
  broadcast({ type: "phase_done", phase: "PLANNING", taskCount: tasks.length });
  return tasks;
}

async function runPhase4_Code(project: Project, actor: ReturnType<typeof createActor>) {
  const tasks = project.tasks;
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    broadcast({ type: "phase_progress", phase: "CODING", taskIndex: i, totalTasks: tasks.length, task: task.title });
    updateAgentStatus("coder", "working", "sitting", task.title);
    task.status = "IN_PROGRESS";

    const mPrompt = render("phase4-m-code.md", {
      taskTitle: task.title,
      taskDescription: task.description,
      techNotes: task.techNotes,
      acceptanceCriteria: task.acceptanceCriteria.join("; "),
    });
    const mReply = await agentPool.send("coder", "tech-lead", 4, i + 1, "task_assign", mPrompt);
    const mMsg = router.createMessage("coder", "tech-lead", 4, i + 1, "task_assign", mPrompt, mReply);
    project.messages.push(mMsg);
    router.route(mMsg);

    task.currentCode = mReply;
    updateAgentStatus("coder", "idle", "standing");

    await runPhase5_Review(project, task, i);

    actor.send({ type: "TASK_DONE" });
  }
  actor.send({ type: "ALL_TASKS_DONE" });
}

async function runPhase5_Review(project: Project, task: DevTask, taskIndex: number) {
  const maxReviewRounds = 3;
  for (let round = 1; round <= maxReviewRounds; round++) {
    broadcast({ type: "phase_progress", phase: "REVIEWING", taskIndex, round, totalRounds: maxReviewRounds });
    updateAgentStatus("tech-lead", "working", "talking", `Review: ${task.title}`);

    const gPrompt = render("phase5-g-review.md", { round: String(round), code: task.currentCode });
    const gReply = await agentPool.send("tech-lead", "coder", 5, round, "review", gPrompt);
    const gMsg = router.createMessage("tech-lead", "coder", 5, round, "review", gPrompt, gReply);
    project.messages.push(gMsg);
    router.route(gMsg);
    updateAgentStatus("tech-lead", "idle", "standing");

    const hasCritical = gReply.includes("🔴") || /critical/i.test(gReply);
    const hasWarning = gReply.includes("🟡") || /warning/i.test(gReply);

    if (hasCritical || hasWarning) {
      updateAgentStatus("coder", "working", "sitting", `Fix: ${task.title}`);
      const fixPrompt = render("phase5-m-fix.md", { round: String(round), reviewFeedback: gReply, currentCode: task.currentCode });
      const fixReply = await agentPool.send("coder", "tech-lead", 5, round, "fix_confirm", fixPrompt);
      router.route(router.createMessage("coder", "tech-lead", 5, round, "fix_confirm", fixPrompt, fixReply));
      task.currentCode = fixReply;
      updateAgentStatus("coder", "idle", "standing");
    }

    if (round >= maxReviewRounds) {
      if (hasCritical || hasWarning) {
        console.warn(`[WARN] 任务"${task.title}"经过${maxReviewRounds}轮Review后仍有问题，强制标记DONE`);
      }
      task.status = "DONE";
      broadcast({ type: "task_review_done", taskIndex, round });
      break;
    }

    if (!hasCritical && !hasWarning) {
      task.status = "DONE";
      broadcast({ type: "task_review_done", taskIndex, round });
      break;
    }
  }
}

async function runPhase6_Deliver(project: Project) {
  broadcast({ type: "phase_progress", phase: "DELIVERING" });
  updateAgentStatus("tech-lead", "working", "talking");

  const gPrompt = render("phase6-g-deliver.md", {});
  const gReply = await agentPool.send("tech-lead", "product-manager", 6, 0, "report", gPrompt);
  router.route(router.createMessage("tech-lead", "product-manager", 6, 0, "report", gPrompt, gReply));
  project.deliveryReport = gReply;
  updateAgentStatus("tech-lead", "idle", "standing");

  broadcast({ type: "phase_done", phase: "DELIVERING" });
}

function parseTasksFromReply(reply: string): DevTask[] {
  try {
    const jsonMatch = reply.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.map((t: any, i: number) => ({
          id: `task-${i + 1}`,
          title: t.title || t.name || `任务${i + 1}`,
          description: t.description || "",
          techNotes: t.techNotes || t.tech_notes || "",
          acceptanceCriteria: t.acceptanceCriteria || t.acceptance_criteria || [],
          priority: t.priority || i + 1,
          status: "TODO" as const,
          currentCode: "",
          reviewComments: [],
        }));
      }
    }
  } catch (err) {
    console.error("[parseTasks] Failed to parse task JSON:", err);
  }
  return [{
    id: "task-1",
    title: "实现完整项目",
    description: reply,
    techNotes: "",
    acceptanceCriteria: ["代码可运行"],
    priority: 1,
    status: "TODO",
    currentCode: "",
    reviewComments: [],
  }];
}

app.post("/api/task", async (req, res) => {
  const { requirement } = req.body;
  if (!requirement || typeof requirement !== "string") {
    res.status(400).json({ error: "requirement is required and must be a string" });
    return;
  }
  if (requirement.length < 5) {
    res.status(400).json({ error: "requirement too short (min 5 chars)" });
    return;
  }
  if (requirement.length > 10000) {
    res.status(400).json({ error: "requirement too long (max 10000 chars)" });
    return;
  }

  agentPool.clearAllHistory();

  const project: Project = {
    id: `proj-${Date.now()}`,
    userRequirement: requirement,
    phase: "IDLE",
    tasks: [],
    messages: [],
    createdAt: new Date().toISOString(),
  };

  const actor = createActor(projectMachine);
  actor.start();
  activeProject = { project, actor, agentStates: initAgentStates() };

  actor.subscribe((state) => {
    if (state.value && typeof state.value === "string") {
      project.phase = state.value as Project["phase"];
      broadcast({ type: "phase_change", phase: state.value, context: state.context });
    }
  });

  actor.send({ type: "START" });
  broadcast({ type: "project_started", project });
  res.json({ projectId: project.id, status: "started" });

  actor.send({ type: "RECEIVED" });

  try {
    await runPhase2_Discuss(project);
    actor.send({ type: "DISCUSSION_DONE" });

    await runPhase3_Plan(project);
    actor.send({ type: "PLAN_DONE", totalTasks: project.tasks.length });

    await runPhase4_Code(project, actor);

    await runPhase6_Deliver(project);
    actor.send({ type: "DELIVERED" });

    broadcast({ type: "project_done", project });
  } catch (err: any) {
    broadcast({ type: "error", message: err.message });
    actor.send({ type: "ERROR", message: err.message });
  }
});

app.get("/api/project", (_req, res) => {
  if (!activeProject) { res.json({ status: "no active project" }); return; }
  res.json(activeProject.project);
});

app.get("/api/agents", (_req, res) => {
  if (!activeProject) { res.json([]); return; }
  res.json(Array.from(activeProject.agentStates.values()));
});

app.post("/api/test/:role", async (req, res) => {
  const role = req.params.role as AgentRole;
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  try {
    updateAgentStatus(role, "working", "talking");
    const reply = await agentPool.send(role, "product-manager" as AgentRole, 0, 0, "discuss" as MessageType, prompt);
    updateAgentStatus(role, "idle", "standing");
    res.json({ role, reply });
  } catch (err: any) {
    updateAgentStatus(role, "error", "standing");
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3800;
server.listen(PORT, () => {
  console.log(`[Project Workshop] Server running on http://localhost:${PORT}`);
  console.log(`[Project Workshop] WebSocket on ws://localhost:${PORT}/ws`);
  console.log(`[Project Workshop] API: POST /api/task, GET /api/project, POST /api/test/:role`);
});

function gracefulShutdown() {
  console.log("\n[Project Workshop] Shutting down gracefully...");
  for (const ws of clients) ws.close();
  wss.close();
  server.close(() => {
    console.log("[Project Workshop] Server closed.");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
