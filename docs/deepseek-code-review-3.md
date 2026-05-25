# Code Review 报告 #3（终审）

> **审查人**：DeepSeek-V4-Pro（代理技术总监审查）
> **审查日期**：2026-05-25
> **项目**：project-workshop — 多 Agent 协作开发系统
> **审查范围**：全量代码（第三轮）
> **审查轮次**：第 3 轮（终审）

---

## 一、R2 遗留问题修复核查

| R2 编号 | 问题 | 状态 |
|---------|------|------|
| C2-1 | 状态机与 server 脱节，REVIEWING 死代码 | ✅ 已修复 — 采用方案 B，移除 REVIEWING 状态，Review 逻辑内置在 runPhase5_Review |
| C2-2 | Phase 3 未传任务清单给技术总监 | ✅ 已修复 — server.ts:124 gPrompt 包含 `${dReply}` |
| C2-3 | opencode.json Schema 变更 | ✅ 已变更为 provider/agent 双段式，model 带前缀 `glm/glm-5.1` |
| W2-1 | Review 取代码方式不可靠 | ✅ 已修复 — 使用 `task.currentCode` 字段追踪 |
| W2-2 | parseTasksFromReply 空 catch | ✅ 已修复 — catch 块输出 console.error |
| W2-3 | `as never` 绕过类型检查（R1 遗留） | ✅ 已修复 — 定义 `ProjectEvent` 类型包含 `{ type: "ERROR"; message: string }` |
| W2-4 | PHASE_NAMES 文件间重复 | ✅ 已修复 — types.ts 从 pipeline.ts import 后 re-export |
| W2-5 | 第 3 轮强制 DONE 无日志 | ✅ 已修复 — server.ts:186 console.warn |
| W2-6 | 编码后未发 TASK_DONE | ✅ 已修复 — server.ts:154 `actor.send({ type: "TASK_DONE" })` |

**R2 全部 9 个问题均已修复。** 无遗留。

---

## 二、架构变更说明

本轮最大的架构变化：**移除了 REVIEWING 状态**，将 Code Review 逻辑完全内置在 `runPhase5_Review()` 中。

```
R1/R2 架构：CODING → REVIEWING ⇄ CODING → DELIVERING → DONE
R3 架构：   CODING（内部含 Review 循环）→ DELIVERING → DONE
```

这是一个合理的设计选择——Review 是编码阶段的子流程，内置处理避免了状态机与业务代码的同步问题（这正是 C2-1 的根因）。状态机现在只追踪大阶段流转，粒度适当。

---

## 三、第二轮新增改进点（未在 R2 中要求，本轮自行发现）

以下为 GLM 在修复过程中主动做的额外优化，值得肯定：

| 改进 | 说明 |
|------|------|
| `ProjectEvent` 类型定义 | pipeline.ts:14-25 定义了完整的 TS 联合类型，所有事件入参都有编译期检查 |
| `DevTask.currentCode` 字段 | types.ts:57 新增字段，解决代码追踪问题 |
| `gracefulShutdown()` | server.ts:347-359 优雅关闭 + SIGINT/SIGTERM 处理 |
| `task.status = "IN_PROGRESS"` | server.ts:141 编码前设置任务状态 |
| fixPrompt 附带完整代码 | server.ts:177 fix prompt 包含 `${task.currentCode}`，coder 有完整上下文 |

---

## 四、审查结果

### 🔴 Critical：0 个

无。

### 🟡 Warning：2 个

#### W3-1. NEXT_TASK 事件是死代码

**文件**：`src/orchestrator/pipeline.ts:72-74`

```typescript
NEXT_TASK: {
  actions: assign({ currentTaskIndex: (ctx) => ctx.currentTaskIndex + 1 }),
},
```

`NEXT_TASK` 事件在 CODING 状态下定义，与 `TASK_DONE` 做完全相同的事（`currentTaskIndex++`），但 server.ts 中**从未发送 NEXT_TASK 事件**。这是上一版残留的冗余代码。

**建议**：删除 NEXT_TASK 事件定义，`currentTaskIndex` 的递增由 `TASK_DONE` 单独负责。

---

#### W3-2. PLAN_DONE 事件携带 totalTasks 但状态机未接收

**文件**：`src/orchestrator/pipeline.ts:60-63`

```typescript
PLAN_DONE: {
  target: "CODING",
  actions: assign({ phase: "CODING", currentTaskIndex: 0 }),
},
```

server.ts:297 发送了 `{ type: "PLAN_DONE", totalTasks: project.tasks.length }`，事件类型定义中也包含 `totalTasks: number`。但状态机的 actions 中没有提取 `totalTasks`：

```typescript
// 应该是：
actions: assign({ phase: "CODING", currentTaskIndex: 0, totalTasks: (_, e) => e.totalTasks }),
```

当前 `context.totalTasks` 永远是初始值 `0`。虽然 server.ts 使用 `project.tasks.length` 做循环控制，不依赖 context 中的值，但状态机订阅者（前端）接收到的 `context.totalTasks` 始终为 0。

**建议**：补上 `totalTasks` 的 assign，或在不需要时从 context 和事件类型中移除 `totalTasks` 字段。

---

### 🔵 Info：2 个

#### I3-1. `ws.readyState === ws.OPEN` 应使用静态属性

**文件**：`src/orchestrator/server.ts:50,58`

```typescript
if (ws.readyState === ws.OPEN) ws.send(...)
```

`OPEN` 是 WebSocket 的静态常量（`WebSocket.OPEN === 1`）。通过实例访问 `ws.OPEN` 虽然返回值相同，但不符合规范用法。TypeScript 类型定义中 `ws.OPEN` 可能未声明。

**建议**：改为 `WebSocket.OPEN`。

---

#### I3-2. `test-api.ts` 无超时控制

**文件**：`src/test-api.ts:21-33`

```typescript
const res = await fetch(`${baseURL}/chat/completions`, { ... });
```

agent-pool.ts 已加上 AbortController 超时，但 test-api.ts 仍未加。连通性测试时若某个 API 挂死，CLI 工具会永远卡住。

**建议**：加 30 秒超时，与 agent-pool.ts 保持一致。

---

## 五、审查决定

**✅ PASSED — 允许合入。**

本轮无 Critical 问题。2 个 Warning 和 2 个 Info 不阻塞合入，建议在后续迭代中处理。

从 R1 到 R3 的修复轨迹：

| 轮次 | Critical | Warning | Info | 结果 |
|------|----------|---------|------|------|
| R1 | 5 | 7 | 4 | REJECTED |
| R2 | 3 | 6 | 3 | REJECTED |
| R3 | **0** | **2** | **2** | **✅ PASSED** |

---

## 六、整体代码质量评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 类型安全 | ⭐⭐⭐⭐ | ProjectEvent 联合类型、严格模式、无 `as never` 绕过 |
| 错误处理 | ⭐⭐⭐⭐ | 全链路 try/catch、超时控制、graceful shutdown |
| 状态管理 | ⭐⭐⭐⭐ | XState 追踪大阶段，小流程内置，粒度合理 |
| 可维护性 | ⭐⭐⭐⭐ | 6 个 runPhase 函数职责清晰、常量单一来源 |
| 通信协议 | ⭐⭐⭐⭐ | WebSocket 心跳、CORS、消息格式化统一 |

**总结**：项目骨架完整、架构清晰、类型系统健壮。6 个阶段全部实现并可串联执行。建议合入后进入阶段 4（前端可视化）开发。
