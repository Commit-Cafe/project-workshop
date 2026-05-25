# Code Review 报告 #4

> **审查人**：DeepSeek-V4-Pro（代理技术总监审查）
> **审查日期**：2026-05-25
> **项目**：project-workshop — 多 Agent 协作开发系统
> **审查范围**：全量代码（第四轮 — 阶段 3 Prompt 工程 + 阶段 4 前端可视化）
> **审查轮次**：第 4 轮

---

## 一、R3 遗留 + 本轮变化概览

| R3 编号 | 问题 | 本轮状态 |
|---------|------|---------|
| W3-1 | NEXT_TASK 死代码 | ❌ 未修复 |
| W3-2 | PLAN_DONE totalTasks 未提取 | ❌ 未修复 |
| I3-1 | ws.readyState === ws.OPEN | ❌ 未修复 |
| I3-2 | test-api.ts 无超时 | ❌ 未修复 |

本轮新增文件 15 个（12 个 prompt 模板 + `.env.example` + `index.html` + 1 个新的 `agent-pool.ts`），server.ts 新增 `GET /` 路由。

---

## 二、🔴 Critical 问题

### C4-1. `agent-pool.ts` 缺少 `AgentSession` 接口定义 — 编译错误

**文件**：`src/agents/agent-pool.ts:28`

```typescript
export class AgentPool {
  private agents: Map<AgentRole, AgentSession> = new Map();
  //                              ^^^^^^^^^^^^
  // TS2304: Cannot find name 'AgentSession'.
```

在将 `SYSTEM_PROMPTS` 从内联字符串重构为外部文件加载时，原本定义在文件顶部的 `AgentSession` 接口被误删。该类型在 `agents` Map 的泛型参数中使用，但没有任何地方定义或导入。

**影响**：代码无法通过 TypeScript 编译（`tsc` 直接报错），`npm run build` 和 `npm run dev:server` 均无法启动。

**修复**：恢复 `AgentSession` 接口定义：
```typescript
interface AgentSession {
  role: AgentRole;
  model: string;
  sessionId?: string;
}
```

---

### C4-2. Prompt 模板文件全部未被引用 — 12 个死文件

**文件**：`docs/prompts/phase/*.md`（9 个）+ `docs/prompts/system/*.md`（3 个）

server.ts 中的 **所有 6 个 runPhase 函数继续使用内联硬编码的 prompt 字符串**，与 R3 完全一致。新创建的 12 个 prompt 模板文件没有在代码中任何地方被 import、读取或引用。

唯一的例外是 `agent-pool.ts` 中的 `SYSTEM_PROMPTS` 从 `docs/prompts/system/*.md` 读取了 3 个文件——这是正确的。

但 9 个 phase prompt 模板完全未使用。以 phase 模板 `phase4-m-code.md` 为例：
```
请实现以下任务：
## 任务信息
- 标题：{{taskTitle}}
- 描述：{{taskDescription}}
...
```

而 server.ts:150 仍然用内联字符串：
```typescript
const mPrompt = `请实现以下任务：\n标题：${task.title}\n描述：...`;
```

**影响**：
1. 12 个 .md 文件的存在令人困惑——开发者不知道该改模板文件还是改 server.ts
2. 模板中的 `{{variable}}` 格式与 server.ts 中的 `${variable}` 格式不一致
3. 维护负担：修改 prompt 需要同时改两处

**修复建议**（选其一）：
- **方案 A**：在 server.ts 或 agent-pool.ts 中实现模板渲染函数，统一从 .md 文件加载并替换 `{{var}}` 为实际值，替代内联字符串
- **方案 B**：删除 9 个 phase 模板文件，文档用途的提示词放到 `docs/plan.md` 中说明

---

### C4-3. 前端硬编码后端端口 — 非 3800 端口无法工作

**文件**：`src/web/index.html:172`

```javascript
const res = await fetch(`http://${location.hostname}:3800/api/task`, {
```

端口 `3800` 硬编码。但 `PORT` 从 `.env` 读取，默认值是 `process.env.PORT || 3800`。如果用户设置 `PORT=8080`，前端请求仍然打到 3800，功能完全不可用。

同样的，WebSocket 连接（line 53）使用的是 `location.hostname:3800`，也存在相同问题。

**修复建议**：
```javascript
const API_PORT = location.port || 3800;
const WS_URL = `ws://${location.hostname}:${API_PORT}/ws`;
const API_URL = `http://${location.hostname}:${API_PORT}/api/task`;
```

---

### C4-4. `loadPrompt` 返回空字符串时无告警 — Agent 在无 system prompt 下运行

**文件**：`src/agents/agent-pool.ts:11-17`

```typescript
function loadPrompt(filename: string): string {
  try {
    return readFileSync(join(PROMPTS_DIR, filename), "utf-8").trim();
  } catch {
    return "";  // 静默返回空字符串
  }
}
```

如果 `docs/prompts/system/tech-lead.md` 文件在运行时因路径错误（如打包、部署到不同目录）而读取失败，`SYSTEM_PROMPTS["tech-lead"]` 会是 `""`。Agent 将在**无 system prompt 的情况下**运行，行为完全不受控——可能输出英文、做业务代码、做需求决策等，打破角色约束。

**修复建议**：
```typescript
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
```

---

## 三、🟡 Warning 问题

### W4-1. R3 遗留未修复 ×4

| R3 编号 | 问题 | 文件:行号 |
|---------|------|-----------|
| W3-1 | `NEXT_TASK` 事件是死代码（与 TASK_DONE 完全重复） | pipeline.ts:72-74 |
| W3-2 | `PLAN_DONE` 事件携带 `totalTasks` 但状态机未 assign | pipeline.ts:60-63 |
| I3-1 | `ws.readyState === ws.OPEN` 应改为 `WebSocket.OPEN` | server.ts:57,65 |
| I3-2 | `test-api.ts` 的 fetch 无超时控制 | test-api.ts:21 |

没有新问题，但这 4 个 R3 遗留问题跨越 2 轮仍未修复。

---

### W4-2. `package.json` 缺少 `vite` 依赖

**文件**：`package.json`

```json
"dev:web": "vite src/web --port 5173"
```

`devDependencies` 中没有 `vite`。执行 `npm run dev:web` 或 `npm run dev` 时，如果 `vite` 未全局安装，会直接报 `'vite' is not recognized`。

**修复**：添加 `vite` 到 `devDependencies`。

---

### W4-3. `tsconfig.json` 移除了 `baseUrl` 和 `paths` — 当前无影响，但属于隐性变更

**文件**：`tsconfig.json`

R3 版有 `"baseUrl": "."` + `"paths": { "@/*": ["src/*"] }`，R4 版移除了。当前代码中没有任何 `@/` import，所以不影响编译。但 `plan.md` 和目录结构文档中多次提到 `@/` 别名，形成文档与配置不一致。

---

## 四、🔵 Info 建议

### I4-1. 前端仅展示 1 个程序员但画了 3 个工位

**文件**：`src/web/index.html:212-218`

```javascript
for (let i = 0; i < 3; i++) { ... ctx.fillText(`工位 ${i+1}`, ...) }
```

办公室渲染 3 个工位，但系统实际上只有 1 个 `coder` Agent。工位 2 和工位 3 永远无人就坐，像空置办公室。`plan.md` 的"阶段 6"计划了多程序员支持，但在当前阶段容易让用户困惑"为什么另外两个人不干活"。

**建议**：当前只渲染 1 个工位，或标注"工位 2（待扩展）"。

---

### I4-2. 前端 Canvas 无 resize 处理

**文件**：`src/web/index.html:183-185`

```javascript
const W = canvas.width, H = canvas.height;
```

Canvas 固定 800×600。缩小浏览器窗口时内容被裁剪，放大时出现空白边距。

---

### I4-3. `routing.ts` 中 `router.ts` 未随 `MessageRouter` 添加 `off` 被使用

**文件**：`src/orchestrator/router.ts:13-18`

`off()` 方法在 R2 中添加，但 server.ts 中从未调用（只 `on` 不 `off`）。当前单项目场景不影响，但如果未来支持多个 WebSocket 客户端各自订阅，就需要注意。

---

### I4-4. `.env.example` 中 `WS_PORT=3801` 未在代码中使用

**文件**：`.env.example:18`

```ini
WS_PORT=3801
```

server.ts 中 WebSocket 挂载在 HTTP server 的同端口（3800），未独立监听 3801。`.env.example` 中的配置项不对应任何实际代码。

**建议**：移除 `WS_PORT` 行，或在 server.ts 中实现独立端口的 WebSocket 服务器。

---

### I4-5. Phase prompt 模板中的 `{{variable}}` 格式与代码中的 `${variable}` 不一致

模板使用 Mustache-style `{{var}}`，代码使用 JS template literal `${var}`。如果后续实现模板渲染，需要统一格式。

---

## 五、审查决定

**🔴 REJECTED — 必须修复后重新提交。**

### 阻塞项（C4-1 ~ C4-4）

| 编号 | 问题 | 严重度 |
|------|------|--------|
| C4-1 | `agent-pool.ts` 缺少 `AgentSession` 接口 → 编译失败 | 🔴 |
| C4-2 | 12 个 prompt 模板文件未被引用 → 死代码/困惑源 | 🔴 |
| C4-3 | 前端硬编码 `:3800` 端口 → 非默认端口不可用 | 🔴 |
| C4-4 | `loadPrompt` 静默失败 → Agent 在无 prompt 下运行 | 🔴 |

### 四轮 Review 趋势

| 轮次 | Critical | Warning | Info | 结果 |
|------|----------|---------|------|------|
| R1 | 5 | 7 | 4 | REJECTED |
| R2 | 3 | 6 | 3 | REJECTED |
| R3 | 0 | 2 | 2 | **PASSED** |
| R4 | **4** | **4** | **5** | **REJECTED** |

R3 → R4 质量回退。主要原因：重构 `agent-pool.ts`（外部文件加载 system prompt）时误删了 `AgentSession` 接口；创建了大量 prompt 模板文件但未接入代码；新增前端存在环境耦合。

**重点**：C4-1 是 100% 的编译阻断问题——当前代码无法启动，需要最优先修复。
