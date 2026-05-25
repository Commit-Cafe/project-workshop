# Code Review 报告 #1

> **审查人**：DeepSeek-V4-Pro（代理技术总监审查）
> **审查日期**：2026-05-25
> **项目**：project-workshop — 多 Agent 协作开发系统
> **审查范围**：全量代码（src/、opencode.json、package.json、tsconfig.json、.env、docs/plan.md）
> **审查轮次**：第 1 轮

---

## 一、审查概要

| 严重级别 | 数量 |
|---------|------|
| 🔴 Critical | 5 |
| 🟡 Warning | 7 |
| 🔵 Info | 4 |

**总体评估**：项目骨架搭建完整，类型系统设计合理，但状态机逻辑存在关键 bug，后端仅实现了 Phase 2 讨论阶段，其余 4 个阶段（规划 / 编码 / Review / 交付）全部缺失。**不建议合入**，需修复 Critical 问题后重新提交。

---

## 二、🔴 Critical 问题

### C1. `opencode.json` 中 GLM baseURL 与 `.env` 不一致

**文件**：`opencode.json:9` → `.env:3`

| 来源 | 值 |
|-----|---|
| `opencode.json` | `https://open.bigmodel.cn/api/paas/v4` |
| `.env` (`GLM_BASE_URL`) | `https://open.bigmodel.cn/api/coding/paas/v4` |

中间少了一级 `/coding` 路径。如果 OpenCode 使用 json 中的硬编码 URL，请求会打到错误的端点。反之，`agent-pool.ts` 使用的是 `.env` 中的值，两者脱钩。

**修复建议**：`opencode.json` 中的 `baseURL` 应改为引用环境变量 `${GLM_BASE_URL}`，与其他两个模型保持一致。

---

### C2. 状态机 `REVIEW_PASSED` 守卫逻辑错误——review 通过后永远无法完成项目

**文件**：`src/orchestrator/pipeline.ts:54-57`

```typescript
REVIEW_PASSED: [
  { guard: ({ context }) => context.reviewRound >= 3, target: "CODING" },
  { target: "CODING", actions: assign({ reviewRound: (ctx) => ctx.reviewRound + 1 }) },
],
```

**问题**：
1. 当 `reviewRound >= 3` 时，Review 已跑满 3 轮，应该结束当前任务进入下一个任务或交付。但当前逻辑是 **回到 CODING**。
2. 回到 CODING 后，必须再触发 `TASK_DONE` 才能重新进入 REVIEWING，形成 `CODING → REVIEWING → CODING` 死循环。
3. 没有任何转换能到达 `DELIVERING` 或 `DONE`（除非从 CODING 直接触发 `ALL_TASKS_DONE`，但该事件从未在 server.ts 中发送）。

**修复建议**：
```typescript
REVIEW_PASSED: [
  {
    guard: ({ context }) => context.reviewRound >= 3,
    target: "CODING",
    actions: assign({ currentTaskIndex: (ctx) => ctx.currentTaskIndex + 1 }),
  },
  { target: "CODING", actions: assign({ reviewRound: (ctx) => ctx.reviewRound + 1 }) },
],
```
同时在 CODING 状态增加守卫：当 `currentTaskIndex >= tasks.length` 时，`ALL_TASKS_DONE` → `DELIVERING`。

**注意**：这里需要附加上下文中的 tasks 数组才能判断。当前 machine context 没有 tasks 字段——这是架构层面的缺失。

---

### C3. 阶段 3~6 完全未实现——Pipeline 只能跑完讨论阶段

**文件**：`src/orchestrator/server.ts`

当前 `POST /api/task` 的实现：
- ✅ 阶段 1 RECEIVING：正常流转
- ✅ 阶段 2 DISCUSSING：`runPhase2_Discuss()` 已实现
- ❌ 阶段 3 PLANNING：无对应函数，`DISCUSSION_DONE` 事件发送后无人消费
- ❌ 阶段 4 CODING：无实现
- ❌ 阶段 5 REVIEWING：无实现
- ❌ 阶段 6 DELIVERING：无实现

`DISCUSSION_DONE` 转换到 PLANNING 后，没有任何代码驱动后续的状态流转。

**修复建议**：依次实现 `runPhase3_Plan()`、`runPhase4_Code()`、`runPhase5_Review()`、`runPhase6_Deliver()`，并在 `runPhase2_Discuss` 之后串联调用。

---

### C4. ERROR 状态转换不携带错误信息

**文件**：`src/orchestrator/pipeline.ts:32,38,45,58,64`

除 `RECEIVING` 外，所有状态的 ERROR 转换均不设置错误信息：

```typescript
// RECEIVING — 正确 ✅
ERROR: { target: "ERROR", actions: assign({ error: (_, e) => e.message }) },

// DISCUSSING / PLANNING / CODING / REVIEWING / DELIVERING — 有缺陷 ❌
ERROR: { target: "ERROR" },
```

出错后 `context.error` 保持为 `null`，前端和日志无法获知错误原因。

**修复建议**：统一所有 ERROR 转换为 `assign({ error: (_, e) => e.message })`。

---

### C5. `agent-pool.ts` 的 `send()` 无超时控制

**文件**：`src/agents/agent-pool.ts:68-75`

```typescript
const response = await fetch(`${config.baseURL}/chat/completions`, {
  method: "POST",
  headers: { ... },
  body: JSON.stringify({ ... }),
});
```

`fetch` 没有 `AbortController` 或 `timeout` 参数。如果 API 服务端挂起，这个 Promise 永远不会 resolve，整个 Pipeline 将永久阻塞。

**修复建议**：
```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 120_000); // 2 分钟超时
const response = await fetch(url, { ..., signal: controller.signal });
clearTimeout(timeout);
```

---

## 三、🟡 Warning 问题

### W1. `tsconfig.json` 中 `paths` 配置无法生效

**文件**：`tsconfig.json:11-13`

```json
"paths": { "@/*": ["src/*"] }
```

`paths` 别名需要 `moduleResolution` 为 `"bundler"` 或 `"node"` 才能被 TypeScript 编译器解析，但实际运行时 Node.js 不认识 `@/` 前缀。当前 `moduleResolution` 设为 `"bundler"`，在 Vite 场景下有效，但在 `tsx` 直接运行时会找不到模块。

**当前代码中没有任何 import 使用 `@/`**，所以不影响运行，但配置是 misleading 的。

---

### W2. `phaseNames` 数组重复定义

**文件**：`src/orchestrator/types.ts:91` 和 `types.ts:119`

```typescript
const phaseNames = ["", "需求接收", "需求讨论", "任务分发", "编码实现", "Code Review", "交付"];
```

完全相同的数组在 `formatAgentContext()` 和 `buildPromptEnvelope()` 中各定义了一次。应提取为模块级常量。

---

### W3. `as never` 强制类型转换绕过类型检查

**文件**：`src/orchestrator/server.ts:144`

```typescript
actor.send({ type: "ERROR", message: err.message } as never);
```

XState 的 ERROR 事件预期不携带 payload（根据 pipeline.ts 的定义），但实际传入了一个 `message` 属性。类型系统正确报错后，使用 `as never` 强行绕过。如果未来修改事件定义导致类型不兼容，编译器也无法发现。

---

### W4. `MessageRouter` 无法取消订阅——潜在内存泄漏

**文件**：`src/orchestrator/router.ts:8-11`

```typescript
on(type: MessageType, handler: RouteHandler) {
  if (!this.handlers.has(type)) this.handlers.set(type, []);
  this.handlers.get(type)!.push(handler);
}
```

没有 `off()` 方法。当前 server.ts 只在启动时注册一次，影响不大。但如果将来前端断开连接时需要移除 handler，Map 中的引用会阻止 GC。

---

### W5. WebSocket 广播无心跳/保活机制

**文件**：`src/orchestrator/server.ts:29-38`

WebSocket 连接建立后不做心跳检测。长时间空闲后，中间代理（nginx、负载均衡器等）可能断开连接而不通知双方，导致客户端收不到状态更新。

**修复建议**：每 30 秒发送 `{ type: "ping" }`，客户端回复 `{ type: "pong" }`。

---

### W6. conversationHistory 跨项目污染

**文件**：`src/agents/agent-pool.ts:57`

```typescript
history.push({ role: "user", content: envelope });
```

`AgentPool` 是全局单例，`conversationHistory` 随 API 调用持续增长。当完成一个项目再开启新项目时，Agent 会"记得"上一个项目的上下文（历史中保留了最近 20 条消息），可能导致混乱。

**修复建议**：在 `POST /api/task` 启动新项目时，调用 `agentPool.clearHistory()` 清理所有 Agent 的会话历史。

---

### W7. `currentTaskIndex` 被初始化但从未更新

**文件**：`src/orchestrator/pipeline.ts:11` 和 `server.ts`

`context.currentTaskIndex` 在 PLANNING → CODING 时置 0，但之后没有任何事件递增它。遍历任务列表的逻辑不存在，当前只能处理第 0 个任务。

---

## 四、🔵 Info 建议

### I1. 缺少 CORS 中间件

`server.ts` 没有配置 CORS。如果前端 `dev:web`（Vite，默认 5173 端口）向后端（3800 端口）发请求，浏览器会拦截跨域请求。`dev` 脚本用 concurrently 同时启动，必然跨域。

### I2. `POST /api/task` 的 requirement 参数无长度/内容校验

```typescript
if (!requirement) { res.status(400)... }
```

仅检查了是否为空。建议增加最大长度限制（如 10000 字符）和最小长度（如 5 字符）。

### I3. `.env` 文件存在工作目录中

API Key 虽被 `.gitignore` 排除，但存在于工作目录中。建议添加 `.env.example` 模板文件，在项目文档中提示用户自行填写。

### I4. `opencode.json` 硬编码了 baseURL

Json 中三个模型的 `baseURL` 都是硬编码字符串，而 `.env` 中也有对应的 `*_BASE_URL` 变量。两边数据源不一致，修改时需要同步两处，容易出错。

---

## 五、审查决定

**🔴 REJECTED — 需要修复后重新提交。**

必须修复项（C1~C5）完成后才能进入第 2 轮 Review。Warning 项建议在第 2 轮提交时一并修复。
