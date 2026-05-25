# Code Review 报告 #2

> **审查人**：DeepSeek-V4-Pro（代理技术总监审查）
> **审查日期**：2026-05-25
> **项目**：project-workshop — 多 Agent 协作开发系统
> **审查范围**：全量代码（第二轮）
> **审查轮次**：第 2 轮

---

## 一、R1 遗留问题修复核查

| R1 编号 | 问题 | 状态 |
|---------|------|------|
| C1 | opencode.json 中 GLM baseURL 不一致 | ✅ 已修复 — 三模型均改为 `${...}` 引用 |
| C2 | 状态机 REVIEW_PASSED 死循环 | ⚠️ 部分修复 — 见下方 NC1 |
| C3 | 阶段 3~6 未实现 | ✅ 已实现 runPhase3~6 |
| C4 | ERROR 转换不携带错误信息 | ✅ 已修复 — 全部 7 个 ERROR 转换均带 assign |
| C5 | fetch 无超时控制 | ✅ 已修复 — AbortController + 120s 超时 |
| W1 | paths 配置无法生效 | ⚠️ 未修复，但无实际影响 |
| W2 | phaseNames 数组重复定义 | ✅ 已修复 — 提取为模块级 PHASE_NAMES |
| W3 | `as never` 强制类型转换 | ❌ 未修复 — server.ts:296 仍存在 |
| W4 | MessageRouter 无法取消订阅 | ✅ 已修复 — 新增 `off()` 方法 |
| W5 | WebSocket 无心跳 | ✅ 已修复 — 30s ping 心跳 |
| W6 | conversationHistory 跨项目污染 | ✅ 已修复 — clearAllHistory() |
| W7 | currentTaskIndex 从不更新 | ⚠️ 新增 NEXT_TASK，但触发时机有误 |
| I1 | 缺少 CORS | ✅ 已修复 |
| I2 | requirement 无校验 | ✅ 已修复 — 类型+长度校验 |
| I3 | .env 在目录中 | ⚠️ 未修复（Info，不阻塞） |
| I4 | opencode.json 硬编码 baseURL | ✅ 已修复 |

**R1 遗留未修复：W3（as never）**

---

## 二、🔴 第二轮 Critical 问题

### C2-1. 状态机与 server 代码完全脱节 — REVIEWING 状态是死代码

**文件**：`src/orchestrator/server.ts` + `src/orchestrator/pipeline.ts`

**问题根因**：状态机定义了完整的 `CODING → REVIEWING → CODING → DELIVERING` 链路，但 server 代码从未发送 `TASK_DONE` 事件，导致状态机**永远停留在 CODING 状态**。REVIEWING 状态及其所有转换（REVIEW_PASSED / REVIEW_NEEDS_FIX）都是完全不会触发的死代码。

**实际执行流**（以 server.ts 为准）：

```
runPhase4_Code:
  coder 写完代码 → 设置 task.status = "REVIEW_1"
  → runPhase5_Review (状态机仍在 CODING)
    → 内部 for 循环 1~3 轮
    → REVIEW_NEEDS_FIX 发送，但状态机在 CODING，该事件未定义在 CODING → 被静默忽略 ❌
    → review 结束，break
  → 回到 runPhase4_Code
  → actor.send("NEXT_TASK")   ← 状态机在 CODING，该事件在 CODING 定义 ✅ 但仅 increment index
  → actor.send("ALL_TASKS_DONE") ← 状态机在 CODING，正常 → DELIVERING ✅
```

**后果**：
1. 状态机的 `reviewRound` 永远不会更新（REVIEW_NEEDS_FIX 被忽略）
2. `currentTaskIndex` 仅在 ALL_TASKS_DONE 触发时通过 NEXT_TASK 更新
3. `REVIEW_PASSED` 事件从未在任何代码中发送——该转换是完全的死代码
4. 状态机订阅者（前端）收到的 `phase_change` 永远是 CODING，无法感知 Review 阶段

**修复建议**：

方案 A（推荐）— 让状态机驱动流程：
在 `runPhase4_Code` 中，每完成一个任务的编码后发送 `TASK_DONE`，在 `runPhase5_Review` 中根据 review 结果发送 `REVIEW_PASSED`（通过时）或 `REVIEW_NEEDS_FIX`（需修复时），由状态机守卫决定是否进入下一任务或交付。

方案 B — 简化为状态机只跟踪大阶段：
移除 REVIEWING 状态，将 Review 逻辑完全放在 `runPhase5_Review` 内部处理。CODING 状态覆盖编码+Review，完成后直接跳到 DELIVERING。

---

### C2-2. `runPhase3_Plan` 未将任务清单传给技术总监

**文件**：`src/orchestrator/server.ts:118-125`

```typescript
const dPrompt = `根据已讨论确认的需求，将需求拆解为开发任务清单...`;
const dReply = await agentPool.send("product-manager", "tech-lead", 3, 0, "task_assign", dPrompt);
// dReply 包含产品经理输出的任务清单 JSON

// ❌ 技术总监收到的 prompt 没有包含 dReply！
const gPrompt = `产品经理输出了开发任务清单，请为每个任务标注技术要点和验收技术标准，确认任务依赖顺序。如有调整请说明。`;
const gReply = await agentPool.send("tech-lead", "product-manager", 3, 0, "task_assign", gPrompt);
```

产品经理输出的任务清单（`dReply`）被存入产品经理的 conversationHistory，但**技术总监的 API 调用完全没有收到任务清单内容**。技术总监被要求"标注技术要点"，却看不到任务列表本身。

**后果**：技术总监会凭空编造技术要点，或要求重新提供任务清单，导致 Phase 3 产出不可用。

**修复建议**：
```typescript
const gPrompt = `产品经理输出了以下开发任务清单，请为每个任务标注技术要点和验收技术标准，确认任务依赖顺序。如有调整请说明。\n\n任务清单：\n${dReply}`;
```

---

### C2-3. `opencode.json` Schema 结构变更可能破坏兼容性

**文件**：`opencode.json`

| 字段 | R1 版本 | R2 版本 |
|------|---------|---------|
| 顶层 key | `"agents"` (数组) | `"agent"` (单数对象) |
| 子字段 | `name`, `model`, `system_prompt` | `description`, `mode`, `model`, `prompt` |
| system prompt 字段名 | `system_prompt` | `prompt` |

结构从数组变为对象，字段名从 `system_prompt` 变为 `prompt`，新增 `mode` 字段。如果 OpenCode 的 Schema 校验严格，三个 Agent 会因字段名不匹配而无法加载。

**修复建议**：确认 OpenCode 文档中的实际 Schema 格式。如果 `$schema: "https://opencode.ai/config.json"` 定义的是数组格式，则需要回退；如果确实支持对象格式，需验证 `prompt` 字段是否等价于 `system_prompt`。

---

## 三、🟡 第二轮 Warning 问题

### W2-1. `runPhase5_Review` 向技术总监传递代码的方式不可靠

**文件**：`src/orchestrator/server.ts:166`

```typescript
const gPrompt = `请对以下代码进行第${round}轮Code Review。...
代码：\n${project.messages[project.messages.length - 1]?.content || ""}`;
```

**问题**：
1. 永远取 `messages` 的最后一条作为"代码"。第 2、3 轮时最后一条消息是 coder 的 fix 回复，恰好符合预期——但耦合于消息写入顺序。
2. 如果未来在 review 和 fix 之间插入其他消息类型（如 clarify），会拿到完全无关的内容。
3. `|| ""` 退化为空字符串时，技术总监会 Review 空白代码。

**修复建议**：在 `DevTask` 上增加 `currentCode: string` 字段，每次 coder 输出后更新该字段，Review 时从 `task.currentCode` 取。

---

### W2-2. `parseTasksFromReply` 空 catch 吞掉所有解析错误

**文件**：`src/orchestrator/server.ts:207-236`

```typescript
try {
  const jsonMatch = reply.match(/\[[\s\S]*\]/);
  // ...
} catch {}  // ← 静默丢弃所有错误
```

当 AI 返回了几乎正确的 JSON（如多了一个尾部逗号、用了单引号），解析失败后静默降级为单个默认任务。开发者无法发现解析问题，会以为 AI 只输出了一个任务。

**修复建议**：
```typescript
} catch (err: any) {
  console.warn(`[parseTasksFromReply] JSON parse failed: ${err.message}`);
  console.warn(`Raw reply (first 500 chars): ${reply.slice(0, 500)}`);
}
```

---

### W2-3. `as never` 绕过类型检查未修复（R1-W3 遗留）

**文件**：`src/orchestrator/server.ts:296`

```typescript
actor.send({ type: "ERROR", message: err.message } as never);
```

第 1 轮标记的 Warning，本轮仍未修复。XState v5 的 `send` 接受事件对象，`message` 不在类型定义中。应该使用 XState 的 payload 机制，而非绕过类型系统。

---

### W2-4. `PHASE_NAMES` 在两个文件中重复定义

**文件**：`src/orchestrator/types.ts:88` 和 `src/orchestrator/pipeline.ts:4`

```typescript
// types.ts:88
export const PHASE_NAMES = ["", "需求接收", "需求讨论", "任务分发", "编码实现", "Code Review", "交付"];

// pipeline.ts:4
export const PHASE_NAMES = ["", "需求接收", "需求讨论", "任务分发", "编码实现", "Code Review", "交付"];
```

两份完全相同的常量。R1 修了函数内重复，但引入了文件间重复。`types.ts` 是类型定义文件，建议 `PHASE_NAMES` 只定义在 `pipeline.ts`，types.ts 中 import。

---

### W2-5. `runPhase5_Review` 第 3 轮仍有 Critical 时强制标记 DONE

**文件**：`src/orchestrator/server.ts:184-188`

```typescript
if (round >= maxReviewRounds || (!hasCritical && !hasWarning)) {
  task.status = "DONE";
  break;
}
```

当 `round === 3` 且仍有 Critical 问题时，代码直接标记 DONE 并跳出。这符合"3 轮封顶"的设计意图，但应该至少记录一条告警日志，告知用户该任务有未修复的 Critical 问题。

---

### W2-6. `runPhase4_Code` 未在编码完成后发送 TASK_DONE

**文件**：`src/orchestrator/server.ts:148-149`

```typescript
task.status = "REVIEW_1";   // 直接改了 task.status
updateAgentStatus("coder", "idle", "standing");
// 缺少: actor.send({ type: "TASK_DONE" });
```

编码完成后直接进入 review，但状态机未收到 `TASK_DONE` 事件。结合 C2-1，这导致状态机永远无法进入 REVIEWING 状态。

---

## 四、🔵 Info 建议

### I2-1. Heartbeat 间隔中 `ws.readyState` 检查不完整

**文件**：`src/orchestrator/server.ts:48-53`

```typescript
const heartbeat = setInterval(() => {
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "ping" }));
  }
}, 30_000);
wss.on("close", () => clearInterval(heartbeat));
```

`ws.OPEN` 是常量 `1`，应使用 `WebSocket.OPEN` 而非实例属性 `ws.OPEN`。虽然值相同（都是 1），但语义上不准确。实测不会出错，属于代码风格问题。

### I2-2. runPhase* 函数缺少 JSDoc 注释

5 个 runPhase 函数承担了核心流程，但无任何注释说明入参、返回值、副作用。

### I2-3. 无优雅关闭（graceful shutdown）

`server.listen()` 后没有 `process.on("SIGTERM", ...)` 处理。Ctrl+C 杀进程时 WebSocket 连接不会得到 close 通知。

---

## 五、审查决定

**🔴 REJECTED — 需要修复后重新提交。**

### 必须修复（阻塞合入）

| 编号 | 问题 | 文件:行号 |
|------|------|-----------|
| C2-1 | 状态机与 server 脱节，REVIEWING 状态是死代码 | pipeline.ts + server.ts |
| C2-2 | Phase 3 未将任务清单传给技术总监 | server.ts:124 |
| C2-3 | opencode.json Schema 变更待验证 | opencode.json |

### 建议修复（第 3 轮前完成）

| 编号 | 问题 |
|------|------|
| W2-1 | Review 取代码方式不可靠 |
| W2-2 | parseTasksFromReply 空 catch |
| W2-3 | `as never` 绕过类型检查（R1 遗留） |
| W2-4 | PHASE_NAMES 文件间重复 |
| W2-5 | 第 3 轮强制 DONE 无日志告警 |
| W2-6 | 编码完成后未发送 TASK_DONE |
