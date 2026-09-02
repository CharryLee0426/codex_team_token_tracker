# Codex Token Tracker

*English version: [README.md](./README.md)*

面向团队的 OpenAI **Codex** 订阅 token 用量追踪系统：一个菜单栏 / 托盘应用，读取开发者电脑上所有通过 Codex OAuth 登录的智能体的本地会话记录（Codex CLI/Desktop、pi，以及尽力支持的 OpenCode、Cline/Roo/Kilo、Hermes）；加上一个 Next.js 仪表盘，实时展示团队与个人用量。

| 读者 | 阅读 |
|---|---|
| 团队成员（安装工具、使用仪表盘） | **[用户指南](docs/USER_GUIDE.zh-CN.md)** · [User Guide](docs/USER_GUIDE.md) |
| 管理员（部署仪表盘、Convex、Clerk，发布 npm） | **[管理员部署指南](docs/ADMIN_DEPLOY.zh-CN.md)** · [Admin Deployment Guide](docs/ADMIN_DEPLOY.md) |
| 开发者 | 本文件、`packages/*/README.md`、`apps/dashboard/README.md` |

生产环境：仪表盘 **https://codex.chenli.dev** · npm 包 **`codex-token-tracker`**

```
┌──────────────────────────────┐        ┌──────────────────────┐        ┌───────────────────────────┐
│  codex-token-tracker (npm)   │ upload │  Convex (realtime)   │ live   │  Dashboard (Next.js)      │
│  macOS / Windows tray app    │ ─────▶ │  hourly UTC buckets  │ ─────▶ │  Team + Personal views    │
│  or headless agent (WSL2)    │        │  sessions, devices   │        │  Clerk login (Google/GH)  │
│  reads Codex / pi / … logs   │ ◀───── │  device auth flow    │ ◀───── │  Organizations = teams    │
└──────────────────────────────┘ remote └──────────────────────┘ approve└───────────────────────────┘
```

## 功能特性

- **指标** — 输入 / 缓存 / 输出 / 推理 token、请求数、缓存命中率、模型分布、API 等价费用（按公开 API 标价计算）、当前会话的每秒 token 数。
- **实时用量限额** — 直接从账户获取 Codex 的每周 / 5 小时窗口（与 Codex 应用使用同一接口），另含按模型的限额、套餐与额度；离线时回退到日志中的数值。
- **视图** — 每日贡献热力图、小时 × 星期活跃度、周一至周日对比、模型分布、成员排行榜、实时“正在编码”、最近会话、设备列表。
- **来源** — 所有消耗 Codex 订阅的智能体都会被打上标签（`codex`、`pi`、`opencode`、`cline`、`roo`、`kilo`、`hermes`、自定义目录）；这些智能体内部使用 API Key 的 provider 默认不计入。
- **团队** — 基于 Clerk 组织（团队）；成员关系通过 JWT 与 Webhook 同步；每人可绑定任意数量的设备 —— 但每台机器只算一个设备，无论登录多少次（托盘应用 + 无界面 agent、重新登录）。
- **无界面登录** — `codex-tracker login` 会打印批准链接和二维码，WSL2、服务器或 SSH 会话可以用手机或任意其他电脑完成批准。
- **时间与语言** — 数据库以 UTC 存储，所有视图按查看者的本机本地时间显示；英文 / 简体中文自动检测并持久化；浅色 / 深色 / 跟随系统主题（任务控制风格 UI，落地页与仪表盘背后有粒子场景）。
- **隐私** — 离开本机的只有计数、模型/智能体名称、项目文件夹名和路径哈希。

## 仓库结构

| 路径 | 内容 | 发布目标 |
|---|---|---|
| `apps/dashboard` | Next.js 15 仪表盘（Clerk、Convex、next-intl、next-themes、Tailwind v4、recharts） | Vercel |
| `packages/menubar` | `codex-token-tracker` —— Electron 托盘应用 + 无界面代理模式 + CLI（每个智能体一个来源模块） | npm |
| `packages/backend` | Convex schema 与函数（从 `apps/dashboard` 部署） | Convex |
| `packages/shared` | 解析器（Codex、pi、通用）、定价、聚合、时间与配色工具、`wham/usage` 解析器 —— 含单元测试 | – |
| `docs/` | 用户指南与管理员部署指南（EN / 中文）、Clerk JWT 模板 | – |

技术栈：Node ≥ 20、TypeScript、pnpm workspaces、Next.js、Clerk、Convex、Electron。

## 工作原理

1. 每个通过 Codex OAuth 登录的智能体都会在本地保留带有逐请求用量的会话记录。追踪器的来源注册表（`packages/menubar/src/core/sources`）负责发现并解析它们：Codex rollout（`~/.codex/sessions`，把累计的 `token_count` 计数转换为逐请求增量）、pi（`~/.pi/agent/sessions`）、OpenCode 存储、Cline 系列任务目录、Hermes 会话、自定义目录。
2. 用量按 **UTC 小时 × 模型 × 智能体** 分桶、计价后 upsert 到 Convex（幂等 —— 重复扫描不会重复计数）。会话仅保存摘要（只含项目文件夹名 + 路径哈希）。
3. 每 15 秒发送一次心跳，携带实时快照（当前会话、每秒 token 数），供仪表盘展示“正在编码”。
4. 仪表盘订阅 Convex 查询，并把 UTC 分桶转换为查看者的本机本地时间，用于所有按日 / 小时 / 星期的视图。
5. 团队即 Clerk 组织（团队）；团队视图汇总所有成员的全部设备。

## 开发

```bash
pnpm install
cd apps/dashboard && npx convex dev            # dev deployment; writes .env.local (keep running)
# Clerk dev keys → apps/dashboard/.env.local (see .env.example); `clerk init` can do it
pnpm dev                                        # http://localhost:3000

pnpm --filter codex-token-tracker build          # 本地构建即*开发版*构建
node packages/menubar/bin/codex-tracker.js login   # 默认指向 localhost:3000，无需附加参数
node packages/menubar/bin/codex-tracker.js      # tray app, or `agent` / `status`
```

本地执行 `pnpm build` 得到的是面向**开发环境**的构建：仪表盘为 `http://localhost:3000`（因而对应开发用
Convex 部署），状态保存在 `~/.codex-tracker-dev`，不进行自动更新，弹窗中带橙色 **DEV** 标记。只有
`--release`（`npm pack` / `npm publish` 时由 `prepack` 执行）才会生成连接生产环境的构建。两者可以同时运行，
详见 [`packages/menubar/README.md`](packages/menubar/README.md#dev-builds-vs-published-builds)。

| 命令 | 作用 |
|---|---|
| `pnpm test` | 单元测试（shared 的解析器/定价/聚合，menubar 的来源模块） |
| `pnpm -r typecheck` | 所有 workspace 的类型检查 |
| `pnpm build` | 先构建各 package，再构建仪表盘 |
| `pnpm release:menubar` | 发布 `codex-token-tracker` —— 由 `prepack` 生成生产版构建（见管理员指南） |

定价表位于 `packages/shared/src/pricing.ts`，与 <https://developers.openai.com/api/docs/pricing> 保持一致（含 272K 长上下文档位）；未知模型会回退到同系列价格并标记为 *estimated*（估算）。仅统计 OpenAI 模型 —— 其他 agent 在 Anthropic/Google/本地模型上的用量会被忽略，因为本工具统计的是 Codex 消耗。依赖版本固定在稳定的主版本线（Next 15、Clerk 6、Convex 1.x、TypeScript 5.9、Electron 38、recharts 2）；pnpm ≥ 10 需要 `pnpm-workspace.yaml` 中的 `allowBuilds` 列表。

许可证：MIT。
