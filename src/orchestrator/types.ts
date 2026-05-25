import { PHASE_NAMES } from "./pipeline.js";

export type AgentRole = "tech-lead" | "product-manager" | "coder";

export const AGENT_META: Record<AgentRole, { name: string; title: string; model: string }> = {
  "tech-lead": { name: "GLM-5.1", title: "技术总监", model: "glm-5.1" },
  "product-manager": { name: "DeepSeek-V4-Pro", title: "产品经理", model: "deepseek-v4-pro" },
  "coder": { name: "MiniMax-M2.7", title: "程序员", model: "minimax-m2.7-highspeed" },
};

export type ProjectPhase =
  | "IDLE"
  | "RECEIVING"
  | "DISCUSSING"
  | "PLANNING"
  | "CODING"
  | "DELIVERING"
  | "DONE"
  | "ERROR";

export type TaskStatus =
  | "TODO"
  | "IN_PROGRESS"
  | "REVIEW_1"
  | "FIXING_1"
  | "REVIEW_2"
  | "FIXING_2"
  | "REVIEW_3"
  | "FIXING_3"
  | "DONE"
  | "REJECTED";

export type AgentStatus = "working" | "idle" | "resting" | "error";

export type MessageType = "discuss" | "task_assign" | "review" | "fix_confirm" | "clarify" | "report";

export interface AgentMessage {
  from: AgentRole;
  to: AgentRole;
  phase: number;
  round: number;
  type: MessageType;
  prompt: string;
  content: string;
  attachments: string[];
  timestamp: string;
}

export interface DevTask {
  id: string;
  title: string;
  description: string;
  techNotes: string;
  acceptanceCriteria: string[];
  priority: number;
  status: TaskStatus;
  currentCode: string;
  reviewComments: ReviewComment[];
}

export interface ReviewComment {
  severity: "critical" | "warning" | "info";
  file: string;
  line?: number;
  message: string;
  fixed: boolean;
}

export interface Project {
  id: string;
  userRequirement: string;
  phase: ProjectPhase;
  tasks: DevTask[];
  messages: AgentMessage[];
  prd?: string;
  architecture?: string;
  discussionLog?: string;
  deliveryReport?: string;
  createdAt: string;
}

export interface AgentState {
  role: AgentRole;
  status: AgentStatus;
  currentTask?: string;
  position: { x: number; y: number };
  animation: "standing" | "walking" | "talking" | "sitting" | "slacking";
}

export { PHASE_NAMES };

export function formatAgentContext(msg: AgentMessage): string {
  const sender = AGENT_META[msg.from];
  const receiver = AGENT_META[msg.to];
  const lines = [
    `【${sender.title}-${sender.name}】→【${receiver.title}-${receiver.name}】`,
    `时间：${msg.timestamp}`,
    `类型：${msg.type}`,
    `阶段：Phase ${msg.phase} - ${PHASE_NAMES[msg.phase] || "未知"}${msg.round ? ` 第${msg.round}轮` : ""}`,
  ];
  if (msg.attachments.length > 0) {
    lines.push(`附件：${msg.attachments.join(", ")}`);
  }
  lines.push("─".repeat(40));
  lines.push(msg.prompt);
  lines.push("─".repeat(40));
  lines.push(msg.content);
  return lines.join("\n");
}

export function buildPromptEnvelope(
  from: AgentRole,
  to: AgentRole,
  phase: number,
  round: number,
  type: MessageType,
  promptText: string,
  attachments: string[] = []
): string {
  const sender = AGENT_META[from];
  const receiver = AGENT_META[to];
  const lines = [
    `你是【${receiver.title}】，收到来自【${sender.title}-${sender.name}】的消息。`,
    `时间：${new Date().toISOString()}`,
    `类型：${type}`,
    `阶段：Phase ${phase} - ${PHASE_NAMES[phase] || "未知"}${round ? ` 第${round}轮` : ""}`,
  ];
  if (attachments.length > 0) {
    lines.push(`参考文档：${attachments.join(", ")}`);
    lines.push("（以上文档已放置在 workspace 目录中，你可以直接读取）");
  }
  lines.push("─".repeat(40));
  lines.push(promptText);
  lines.push("─".repeat(40));
  return lines.join("\n");
}
