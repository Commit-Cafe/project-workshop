import "dotenv/config";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { AgentRole } from "../orchestrator/types.js";
import { AGENT_META, buildPromptEnvelope, type MessageType } from "../orchestrator/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "../../docs/prompts");

function loadPrompt(filename: string): string {
  try {
    const content = readFileSync(join(PROMPTS_DIR, filename), "utf-8").trim();
    if (!content) throw new Error("empty file");
    return content;
  } catch (err) {
    console.error(`[AgentPool] Failed to load prompt: ${filename}`, err);
    throw new Error(`Cannot start: missing system prompt "${filename}"`);
  }
}

interface AgentSession {
  role: AgentRole;
  model: string;
  sessionId?: string;
}

const SYSTEM_PROMPTS: Record<AgentRole, string> = {
  "tech-lead": loadPrompt("system/tech-lead.md"),
  "product-manager": loadPrompt("system/product-manager.md"),
  "coder": loadPrompt("system/coder.md"),
};

const API_TIMEOUT_MS = 120_000;

export class AgentPool {
  private agents: Map<AgentRole, AgentSession> = new Map();
  private conversationHistory: Map<AgentRole, Array<{ role: string; content: string }>> = new Map();

  constructor() {
    for (const [role, meta] of Object.entries(AGENT_META)) {
      this.agents.set(role as AgentRole, { role: role as AgentRole, model: meta.model });
      this.conversationHistory.set(role as AgentRole, []);
    }
  }

  clearAllHistory() {
    for (const role of this.conversationHistory.keys()) {
      this.conversationHistory.set(role, []);
    }
  }

  async send(
    role: AgentRole,
    fromRole: AgentRole,
    phase: number,
    round: number,
    type: MessageType,
    promptText: string,
    attachments: string[] = []
  ): Promise<string> {
    const agent = this.agents.get(role)!;
    const envelope = buildPromptEnvelope(fromRole, role, phase, round, type, promptText, attachments);
    const history = this.conversationHistory.get(role)!;

    history.push({ role: "user", content: envelope });

    const systemPrompt = SYSTEM_PROMPTS[role];
    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...history.slice(-20),
    ];

    const config = this.getAPIConfig(agent.model);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${config.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ model: agent.model, messages, temperature: 0.7 }),
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(`API timeout [${agent.model}]: ${API_TIMEOUT_MS}ms exceeded`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error [${agent.model}]: ${response.status} ${errText}`);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "";

    history.push({ role: "assistant", content: reply });

    return reply;
  }

  private getAPIConfig(model: string): { apiKey: string; baseURL: string } {
    if (model.startsWith("glm")) {
      return { apiKey: process.env.GLM_API_KEY || "", baseURL: process.env.GLM_BASE_URL || "" };
    }
    if (model.startsWith("deepseek")) {
      return { apiKey: process.env.DEEPSEEK_API_KEY || "", baseURL: process.env.DEEPSEEK_BASE_URL || "" };
    }
    if (model.startsWith("minimax")) {
      return { apiKey: process.env.MINIMAX_API_KEY || "", baseURL: process.env.MINIMAX_BASE_URL || "" };
    }
    throw new Error(`Unknown model: ${model}`);
  }
}
