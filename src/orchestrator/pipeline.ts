import { createMachine, assign } from "xstate";
import type { ProjectPhase } from "./types.js";

export const PHASE_NAMES = ["", "需求接收", "需求讨论", "任务分发", "编码实现", "Code Review", "交付"];

export interface ProjectContext {
  phase: ProjectPhase;
  discussionRound: number;
  currentTaskIndex: number;
  totalTasks: number;
  error: string | null;
}

export type ProjectEvent =
  | { type: "START" }
  | { type: "RECEIVED" }
  | { type: "CONTINUE_DISCUSSION" }
  | { type: "DISCUSSION_DONE" }
  | { type: "PLAN_DONE"; totalTasks: number }
  | { type: "TASK_DONE" }
  | { type: "ALL_TASKS_DONE" }
  | { type: "DELIVERED" }
  | { type: "ERROR"; message: string }
  | { type: "RETRY" };

export const projectMachine = createMachine({
  id: "project",
  initial: "IDLE",
  context: {
    phase: "IDLE" as ProjectPhase,
    discussionRound: 0,
    currentTaskIndex: 0,
    totalTasks: 0,
    error: null as string | null,
  },
  states: {
    IDLE: {
      on: {
        START: { target: "RECEIVING", actions: assign({ phase: "RECEIVING" }) },
      },
    },
    RECEIVING: {
      on: {
        RECEIVED: { target: "DISCUSSING", actions: assign({ phase: "DISCUSSING", discussionRound: 1 }) },
        ERROR: { target: "ERROR", actions: assign({ error: ({ event }) => (event as any).message ?? "unknown" }) },
      },
    },
    DISCUSSING: {
      on: {
        CONTINUE_DISCUSSION: {
          actions: assign({ discussionRound: ({ context }) => context.discussionRound + 1 }),
        },
        DISCUSSION_DONE: { target: "PLANNING", actions: assign({ phase: "PLANNING" }) },
        ERROR: { target: "ERROR", actions: assign({ error: ({ event }) => (event as any).message ?? "unknown" }) },
      },
    },
    PLANNING: {
      on: {
        PLAN_DONE: {
          target: "CODING",
          actions: assign({ phase: "CODING", currentTaskIndex: 0, totalTasks: ({ event }) => (event as any).totalTasks ?? 0 }),
        },
        ERROR: { target: "ERROR", actions: assign({ error: ({ event }) => (event as any).message ?? "unknown" }) },
      },
    },
    CODING: {
      on: {
        TASK_DONE: {
          actions: assign({ currentTaskIndex: ({ context }) => context.currentTaskIndex + 1 }),
        },
        ALL_TASKS_DONE: { target: "DELIVERING", actions: assign({ phase: "DELIVERING" }) },
        ERROR: { target: "ERROR", actions: assign({ error: ({ event }) => (event as any).message ?? "unknown" }) },
      },
    },
    DELIVERING: {
      on: {
        DELIVERED: { target: "DONE", actions: assign({ phase: "DONE" }) },
        ERROR: { target: "ERROR", actions: assign({ error: ({ event }) => (event as any).message ?? "unknown" }) },
      },
    },
    DONE: {
      type: "final",
    },
    ERROR: {
      on: {
        RETRY: { target: "IDLE", actions: assign({ error: null }) },
      },
    },
  },
});
