# Codex Token Tracker

*English version: [README.md](./README.md)*

面向团队的 OpenAI **Codex** 订阅 token 用量追踪系统：一个菜单栏 / 托盘应用，读取已审计且支持当前格式的 Codex OAuth 智能体本地用量记录（Codex CLI/Desktop、pi、oh-my-pi、Cline、Kilo Code、Hermes Agent、OpenClaw、DeepSeek Harness），同时保留尽力兼容的读取器；再由 Next.js 仪表盘实时展示团队与个人用量。

| 读者 | 阅读 |
|---|---|
| 团队成员（安装工具、使用仪表盘） | **[用户指南](docs/USER_GUIDE.zh-CN.md)** · [User Guide](docs/USER_GUIDE.md) |
| 管理员（部署仪表盘、Convex、Clerk，发布 npm） | **[管理员部署指南](docs/ADMIN_DEPLOY.zh-CN.md)** · [Admin Deployment Guide](docs/ADMIN_DEPLOY.md) |
| 开发者 | 本文件、`packages/*/README.md`、`apps/dashboard/README.md` |

生产环境：仪表盘 **https://codex.chenli.dev** · npm 包 **`codex-token-tracker`**

团队成员只需要两条命令（Node.js 20+；无需安装——`npx` 每次启动都会获取最新版本）：

```bash
npx codex-token-tracker login   # 每台电脑的第一次：在自动打开的浏览器中登录并授权该设备
npx codex-token-tracker         # 之后每天：启动菜单栏应用并让它一直运行（右键 → 开机自启动）
```

然后打开仪表盘：**Personal（个人）** 会在一分钟内出现数据。第一次登录会有一个简短的新手引导；可在 **设置** 中随时重看。

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
- **来源** — 当前已审计的集成会标记为 `codex`、`pi`、`omp`（oh-my-pi）、`cline`、`kilo`、`hermes`、`openclaw`、`dsh`（DeepSeek Harness）；原有 OpenCode / Roo 读取器与自定义目录仍可使用。多 provider 智能体中使用 API Key 的调用永远不会进入展示、定价或上传汇总。
- **团队** — 基于 Clerk 组织（团队）；成员关系通过 JWT 与 Webhook 同步；每人可绑定任意数量的设备 —— 但每台机器只算一个设备，无论登录多少次（托盘应用 + 无界面 agent、重新登录）。
- **无界面登录** — `npx codex-token-tracker login` 会打印批准链接和二维码，WSL2、服务器或 SSH 会话可以用手机或任意其他电脑完成批准。
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

1. 通过 Codex OAuth 登录的智能体会在本地保留用量记录。追踪器的来源注册表（`packages/menubar/src/core/sources`）负责发现并解析当前 Codex rollout、pi / oh-my-pi JSONL、Cline 消息信封、Kilo 与 Hermes SQLite 存储、OpenClaw 数据库，以及 DeepSeek Harness JSONL / Zstandard 日志；旧版 OpenCode、Roo、Cline 系列与 JSON/JSONL 布局继续作为兼容读取器。OpenClaw 托管的 Codex rollout 可供本地诊断发现，但缺少可持久验证的 OAuth 归因时不会计数。
2. 用量按 **UTC 小时 × 模型 × 智能体** 分桶、计价后 upsert 到 Convex（幂等 —— 重复扫描不会重复计数）。会话仅保存摘要（只含项目文件夹名 + 路径哈希）。
3. 每 15 秒发送一次心跳，携带实时快照（当前会话、每秒 token 数），供仪表盘展示“正在编码”。
4. 仪表盘订阅 Convex 查询，并把 UTC 分桶转换为查看者的本机本地时间，用于所有按日 / 小时 / 星期的视图。
5. 团队即 Clerk 组织（团队）；团队视图汇总所有成员的全部设备。

## 智能体兼容性

我们审计了 OpenRouter 排名中这些智能体的当前公开版本与仓库，判断标准是是否存在真实、面向用户的
Codex / ChatGPT OAuth 登录路径，以及是否有可持续读取的本地用量数据。

| 智能体 | 状态 | 追踪内容 / 决策 |
|---|---|---|
| Codex CLI / Codex Desktop | 支持 | 原生 rollout 用量，包括当前 `token_usage_record` 与旧版累计计数 |
| pi | 支持 | 归属于 `openai-codex` OAuth provider 的 assistant 用量 |
| oh-my-pi（`omp`） | 支持 | 与 pi 兼容的消息，以及当前 `model_usage` 记录 |
| Cline | 支持 | 当前 v1 消息信封与旧版任务存储；默认只统计 provider 精确为 `openai-codex` 的用量 |
| Kilo Code | 支持 | 当前 SQLite 消息存储与旧版 VS Code 任务存储 |
| Hermes Agent | 支持 | 当前 `session_model_usage` SQLite 汇总与旧版 JSON / JSONL 会话 |
| OpenClaw | 支持 | 当前逐智能体 SQLite 记录，以及可归因的旧版 JSON / JSONL；OpenClaw 将托管 Codex 的 OAuth token 仅保存在内存中、不会写入托管 `CODEX_HOME`，因此这类 rollout 仅用于诊断 |
| DeepSeek Harness（`dsh`） | 支持 | 当前本地路由元数据确认使用 OAuth 时，从 `$DSH_HOME/sessions` 或 `~/.dsh/sessions` 读取直接归属于 `openai-codex` 的用量，包括拼接多帧的 `session.jsonl.zstd` 日志；自定义会话根目录可选择 `format: "dsh"` |
| OpenCode | 保留的尽力兼容 | 原有消息存储读取器仍默认启用；本次审计未将其验证为当前格式集成 |
| Roo Code | 保留的尽力兼容 | 原有旧版 Cline 格式任务读取器仍默认启用 |
| Claude Code | 已审计，未启用 | Claude Code 没有公开的 Codex / ChatGPT OAuth provider；其官方登录面向 Anthropic 服务 |
| Zazen（Freebuff 分支） | 由 `codex` 覆盖 | Freebuff Desktop 可通过已有 provider 账号运行本机安装的 Codex；这些原生 rollout 会标记为 `codex`。Freebuff 没有暴露可供单独来源使用的持久 OAuth 归因 |

运行时与归因限制：

- 当前 Kilo、Hermes 与 OpenClaw 的 SQLite 存储依赖 `node:sqlite`，可用于 Node 22.5 起的版本与当前 Electron 运行时。在更旧的 Node 运行时中，追踪器会使用各智能体中可归因的旧版 JSON/JSONL 或 VS Code 任务回退；若历史只存在于 SQLite，则无法读取。
- 原生 Codex rollout 只有在当前 `$CODEX_HOME/auth.json` 能证明 ChatGPT 登录时才会计数（显式 `auth_mode: "chatgpt"`，或结构有效的旧版 token bundle）。若 Codex 只把凭据存进系统钥匙串，或通过临时方式注入认证，rollout 本身又不记录认证方式，追踪器会安全地不计数。出于同一原因，在 ChatGPT 与 API Key 认证之间切换当前 Codex 登录后，下次扫描会重新分类历史 rollout。凭据值绝不会被保留、写入日志或上传。
- Kilo 只使用当前认证记录中的 `type` 判别字段；凭据值不会被保留、记录到日志或上传。由于消息行不保存每次请求所用的认证方式，在 OAuth 与 API Key 之间切换 OpenAI 认证后，后续同步可能改变历史记录的分类。
- DeepSeek Harness 会解析本机的凭据与设置 YAML，但只使用 `openai-codex` 记录类型以及是否配置了 API Key 覆盖；凭据值不会被保留、记录到日志或上传。它的日志同样不保存每次请求所用的认证方式，因此历史记录的分类取决于当前路由配置。自定义 `dsh` 格式根目录也遵循这一规则：归因仍使用 `$DSH_HOME` 或 `~/.dsh` 下的当前 sidecar。
- Hermes 保存的是不按小时拆分的会话/模型汇总。追踪器把每条汇总归入其 `last_seen` 所在小时，因此总量得以保留，但小时分布是近似值。
- OpenClaw 当前的逐智能体 transcript 数据库会保存精确的 Codex OAuth 路由标记，因此它是受支持的数据源。其托管 Codex harness 会在内存中注入 `chatgptAuthTokens`，且有意不写入托管 `CODEX_HOME/auth.json`；这类 rollout 只有开启 `trackAllProviders` 时可供本地诊断，永远不会进入 OAuth 汇总。
- 压缩的 Codex/OpenClaw `.jsonl.zst` rollout 与 DeepSeek Harness `.jsonl.zstd` 会话会优先使用原生 Zstandard，不可用时改用随包提供的解码器，因此压缩历史可在所有受支持运行时中读取。未压缩的 `.jsonl` 仍受支持。

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
| `pnpm dev:tour` | 仪表盘开发服务器，且每次打开仪表盘都强制显示新手引导 |
| `pnpm test` | 单元测试（shared 的解析器/定价/聚合，menubar 的来源模块） |
| `pnpm -r typecheck` | 所有 workspace 的类型检查 |
| `pnpm build` | 先构建各 package，再构建仪表盘 |
| `pnpm release:menubar` | 发布 `codex-token-tracker` —— 由 `prepack` 生成生产版构建（见管理员指南） |

定价表位于 `packages/shared/src/pricing.ts`，与 <https://developers.openai.com/api/docs/pricing> 保持一致（含 272K 长上下文档位）；未知模型会回退到同系列价格并标记为 *estimated*（估算）。仅统计具有精确 Codex OAuth 归因的 OpenAI 模型 —— API Key 与非 OpenAI 用量都会被忽略，因为本工具统计的是 Codex 订阅消耗。依赖版本固定在稳定的主版本线（Next 15、Clerk 6、Convex 1.x、TypeScript 5.9、Electron 38、recharts 2）；pnpm ≥ 10 需要 `pnpm-workspace.yaml` 中的 `allowBuilds` 列表。

许可证：MIT。
