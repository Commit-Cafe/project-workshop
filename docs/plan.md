# 项目工作仓库 — 开发阶段计划书

> 版本：v1.4 | 日期：2026-05-25 | 阶段1-5 ✅ 全部完成

---

## 项目概述

构建一个**自动化软件工厂**：用户输入需求，系统自动完成需求分析→架构设计→编码→Code Review→交付。三个 AI Agent 协同驱动，前端以像素风办公室可视化展示工作过程。

---

## 技术选型

| 层级 | 技术 | 用途 |
|---|---|---|
| Agent 运行 | 三模型直接 API（GLM-5.1 / DS V4 Pro / MM M2.7） | Agent 调用 |
| 后端编排 | Node.js + TypeScript + Express | 流程引擎、消息路由 |
| 实时通信 | ws (WebSocket) | 向前端推送 Agent 状态 |
| 状态管理 | XState | 项目级/任务级状态机 |
| 前端 UI | React 19 + Vite | 组件框架 |
| 前端渲染 | HTML5 Canvas 2D | 像素风办公室场景 |
| 数据存储 | SQLite + 文件系统 | 消息日志、项目文件 |

---

## 开发阶段计划

### 阶段 1：项目基础搭建
**目标**：初始化项目、安装依赖、配置 OpenCode 三 Agent

**任务清单**：
- [x] 创建项目目录结构
- [x] 创建 `.env`（三模型 API Key）
- [x] 创建 `.gitignore`
- [x] 创建 `package.json` + `tsconfig.json`
- [x] 创建 `opencode.json`（三 Agent 配置）
- [x] `npm install` 安装依赖
- [x] 验证 OpenCode Server 可启动
- [x] 验证三模型 API 连通性

**产出物**：可运行的项目骨架

---

### 阶段 2：后端编排器核心
**目标**：实现 Pipeline 引擎，控制三 Agent 的消息路由和状态流转

**任务清单**：
- [x] 实现 `src/orchestrator/server.ts` — HTTP + WebSocket 服务
- [x] 实现 `src/orchestrator/pipeline.ts` — 6 阶段状态机（XState）
- [x] 实现 `src/orchestrator/router.ts` — Agent 间消息路由
- [x] 实现 `src/agents/agent-pool.ts` — OpenCode SDK 封装，管理三个 Agent Session
- [x] 实现 `src/orchestrator/types.ts` — 类型定义（消息、任务、状态）
- [x] 实现 WebSocket 事件推送（向前端广播状态变化）

**产出物**：可通过 API 触发完整 Pipeline 的后端服务

**核心流程**：
```
用户需求 → POST /api/task
  → Pipeline 启动
  → Phase 1: 需求接收 (D 读取)
  → Phase 2: 需求讨论 (D↔G, ≥3轮)
  → Phase 3: 任务分发 (D拆解 + G标注)
  → Phase 4: 编码实现 (M逐任务开发)
  → Phase 5: Code Review (G→M, ×3轮)
  → Phase 6: 交付 (G输出交付报告)
```

**状态机设计**：
```
项目级: IDLE → RECEIVING → DISCUSSING → PLANNING → CODING → DELIVERING → DONE
任务级: TODO → IN_PROGRESS → REVIEW_1 → FIXING_1 → ... → DONE
```

---

### 阶段 3：Agent Prompt 工程
**目标**：编写三个角色的 System Prompt 和阶段 Prompt 模板

**任务清单**：
- [x] 编写 G（技术总监）的 System Prompt + 各阶段 Prompt
- [x] 编写 D（产品经理）的 System Prompt + 各阶段 Prompt
- [x] 编写 M（程序员）的 System Prompt + 各阶段 Prompt
- [x] 编写讨论纪要模板
- [x] 编写 PRD 模板
- [x] 编写技术方案模板
- [x] 编写 Code Review 报告模板
- [x] 编写交付报告模板
- [x] 端到端测试：输入需求 → 完成讨论 → 输出 PRD + 架构文档

**产出物**：Prompt 模板库 + 模板文件

---

### 阶段 4：前端可视化 — 像素办公室
**目标**：实现像素风办公室场景，实时展示 Agent 工作状态

**任务清单**：
- [x] Canvas 2D 引擎搭建（渲染循环、帧率控制）
- [x] 办公室场景渲染（G 小房间、D 小房间、走廊、M 工位区）
- [x] 像素人物 Sprite 绘制（方格人 + 手脚 + 行走动画）
- [x] 人物移动系统（从 A 点到 B 点的行走动画）
- [x] BFS 寻路算法（绕过障碍物）— 简化为 lerp 平滑移动
- [x] 工位状态显示（🟢工作中 / 🟡摸鱼中 / 🔵休息中 / 🔴报错中）
- [x] 对话气泡系统（头顶显示讨论内容摘要）
- [x] 动画触发规则（阶段切换 → 角色移动动画）
- [x] WebSocket 客户端（接收后端状态推送，驱动动画）
- [x] 用户需求输入界面

**产出物**：可视化前端页面

**动画触发规则**：
| 阶段 | 动画 |
|---|---|
| Phase 2 讨论 | G 和 D 从各自房间走出，走廊碰面，面对面交谈，头顶气泡 |
| Phase 3 分发 | G 走到 M 工位旁，递出文件动画 |
| Phase 4 编码 | M 坐下敲键盘，手部微动 |
| Phase 5 Review | G 到 M 工位查看屏幕，指问题 |

---

### 阶段 5：联调与端到端测试
**目标**：前后端联调，跑通完整流程

**任务清单**：
- [x] 前后端 WebSocket 联调
- [x] 端到端测试：输入简单需求（如"做一个 TODO 应用"）
- [x] 验证 Phase 1-6 全流程状态流转
- [x] 验证前端动画与后端状态同步
- [x] 错误处理（API 超时、Agent 报错、网络断连）
- [x] 日志系统完善

**产出物**：可演示的完整系统

---

### 阶段 6：优化与扩展
**目标**：打磨体验、增加功能

**任务清单**：
- [ ] 支持多个 M（多个程序员工位，并行开发）
- [ ] 历史项目列表和回看
- [ ] 生成代码的下载/预览功能
- [ ] 响应式布局（移动端适配）
- [ ] 像素美术资源优化（更多动作帧）
- [ ] 音效（打字声、讨论声、报错声）

**产出物**：生产就绪的系统

---

## 项目目录结构

```
project-workshop/
├── .env                          # 三模型 API Key（不提交 Git）
├── .gitignore
├── package.json
├── tsconfig.json
├── opencode.json                 # OpenCode 三 Agent 配置
├── docs/
│   ├── plan.md                   # 本文件 — 阶段计划书
│   └── prompts/                  # Prompt 模板库
│       ├── system/               # 三个角色的 System Prompt
│       └── phase/                # 各阶段的 Prompt 模板
├── src/
│   ├── orchestrator/             # 后端编排器
│   │   ├── server.ts             # Express + WebSocket 服务
│   │   ├── pipeline.ts           # 6阶段状态机 (XState)
│   │   ├── router.ts             # Agent 消息路由
│   │   └── types.ts              # 类型定义
│   ├── agents/                   # Agent 封装
│   │   └── agent-pool.ts         # OpenCode SDK 封装
│   └── web/                      # 前端
│       ├── index.html
│       ├── App.tsx               # React 入口
│       ├── components/           # UI 组件
│       │   ├── Office.tsx        # 办公室场景主组件
│       │   ├── AgentSprite.tsx   # 像素人物组件
│       │   └── StatusPanel.tsx   # 状态面板
│       ├── engine/               # Canvas 渲染引擎
│       │   ├── renderer.ts       # 主渲染器
│       │   ├── sprites.ts        # Sprite 管理
│       │   ├── pathfinding.ts    # BFS 寻路
│       │   └── animations.ts     # 动画系统
│       └── sprites/              # 像素美术资源
└── workspace/                    # Agent 生成代码的输出目录
```

---

## 里程碑时间线

| 里程碑 | 包含阶段 | 交付物 |
|---|---|---|
| M1：基础跑通 | 阶段 1 + 2 + 3 | 后端可运行，三 Agent 可对话 |
| M2：可视化上线 | 阶段 4 | 前端办公室场景可展示 |
| M3：端到端可用 | 阶段 5 | 输入需求→输出代码，全程可视化 |
| M4：体验打磨 | 阶段 6 | 生产级可用系统 |
