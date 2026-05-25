import type { AgentRole, AgentMessage, MessageType } from "./types.js";

type RouteHandler = (message: AgentMessage) => void;

export class MessageRouter {
  private handlers: Map<string, RouteHandler[]> = new Map();

  on(type: MessageType, handler: RouteHandler) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type)!.push(handler);
  }

  off(type: MessageType, handler: RouteHandler) {
    const list = this.handlers.get(type);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  }

  route(message: AgentMessage) {
    const handlers = this.handlers.get(message.type) || [];
    for (const h of handlers) h(message);
  }

  createMessage(
    from: AgentRole,
    to: AgentRole,
    phase: number,
    round: number,
    type: MessageType,
    prompt: string,
    content: string,
    attachments: string[] = []
  ): AgentMessage {
    return {
      from,
      to,
      phase,
      round,
      type,
      prompt,
      content,
      attachments,
      timestamp: new Date().toISOString(),
    };
  }
}
