# Codex Token Tracker — 管理员部署指南

*English version: [ADMIN_DEPLOY.md](./ADMIN_DEPLOY.md)*

生产环境拓扑：

```
GitHub (main) ──push──▶ Vercel  ──builds──▶ Next.js dashboard  https://codex.chenli.dev
                          │  `convex deploy --cmd 'next build'`
                          └──deploys──▶ Convex production deployment (realtime DB + functions)
Clerk production instance (Google/GitHub login, Organizations, JWT template "convex", webhook → Convex)
npm: codex-token-tracker (menu bar app; default dashboard = https://codex.chenli.dev)
```

请按顺序完成各节；每一节都需要用到上一节得到的值。

## 0. 前置条件

- 账号：GitHub（仓库 `CharryLee0426/codex_team_token_tracker`）、Vercel、Convex、Clerk、npm；对 `chenli.dev` 的 DNS 管理权限（Cloudflare）。
- 本地环境：Node ≥ 20、pnpm 11（`corepack enable`）、Clerk CLI（`npm i -g clerk`）、Convex CLI（`npx convex`）。
- 仓库已包含全部内容：Convex 函数位于 `packages/backend/convex`，仪表盘位于 `apps/dashboard`（`vercel.json` 已设置构建命令），菜单栏应用位于 `packages/menubar`。

## 1. Convex —— 生产部署

当前状态：项目 **codex-token-tracker**，开发部署 `majestic-lynx-360`，生产部署 **`grandiose-seal-712`** → API `https://grandiose-seal-712.convex.cloud`，HTTP/Webhook 主机 `https://grandiose-seal-712.convex.site`（`/health` 返回 `{"ok":true}`）。

1. **部署密钥**（供 Vercel 使用；已创建，名称 `vercel-production`，轮换时重新生成）：
   ```bash
   cd apps/dashboard
   npx convex deployment token create vercel-production --deployment prod   # 输出 prod:… → 填入 Vercel 的 CONVEX_DEPLOY_KEY
   ```
   （或 Convex 控制台 → Settings → Deploy keys → *Generate production deploy key*）。
2. **生产部署的环境变量**（`CLERK_JWT_ISSUER_DOMAIN` 已设置；Webhook 密钥可选，见 3.6）：
   ```bash
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://clerk.codex.chenli.dev --prod
   npx convex env set CLERK_WEBHOOK_SECRET whsec_xxx --prod
   npx convex env list --prod --names-only
   ```
3. **手动部署**（Vercel 每次构建都会自动执行，仅在紧急情况下需要）：`CONVEX_DEPLOY_KEY=prod:… npx convex deploy --yes`。

## 2. Vercel —— 仪表盘

当前状态：团队 *CharryLee's projects* 下的项目 **`codex-token-tracker`**，已关联 GitHub 仓库 `CharryLee0426/codex_team_token_tracker`（生产分支 `main`），Root Directory 为 `apps/dashboard`，已开启 *Include source files outside of the Root Directory*，Node 24，域名 `codex.chenli.dev` 已绑定。

1. 如需重建：**Add New Project → Import** 该仓库，Root Directory 填 `apps/dashboard`，保持 *Include source files outside of the Root Directory* 开启（pnpm workspace）。Framework 为 Next.js；构建命令来自 `apps/dashboard/vercel.json` → `pnpm build:vercel`（`scripts/build-vercel.mjs`：设置了 `CONVEX_DEPLOY_KEY` 时执行 `convex deploy --cmd 'next build'`，否则只执行 `next build`）。
2. **环境变量**（均已设置）：

   | 名称 | Production | Preview / Development |
   |---|---|---|
   | `CONVEX_DEPLOY_KEY` | 生产部署密钥（第 1 节） | —（预览环境不会碰生产） |
   | `NEXT_PUBLIC_CONVEX_URL` | *不设置* —— 由 `convex deploy` 注入 | `https://majestic-lynx-360.convex.cloud`（开发部署） |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | `pk_live_…` / `sk_live_…` | `pk_test_…` / `sk_test_…`（开发实例） |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `…_SIGN_UP_URL` | `/sign-in` / `/sign-up` | 相同 |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` / `…_SIGN_UP_…` | `/dashboard` | 相同 |
   | `NEXT_PUBLIC_APP_URL` | `https://codex.chenli.dev` | — |
   | `NEXT_PUBLIC_TEAM_PLAN_START` | 可选 —— 团队 Codex 套餐的开始时间，供 **自团队套餐开始** 范围使用（带时区偏移的 ISO 8601；默认 `2026-08-25T00:00:00-07:00`） | 相同 |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` —— 让 Vercel 遵循 `packageManager: pnpm@11` | 相同 |
   | `ELECTRON_SKIP_BINARY_DOWNLOAD` | `1` —— 安装时跳过 Electron 下载 | 相同 |

   CLI 等价命令：`vercel env add NAME production --value '…'`（Clerk 密钥可用 `clerk env pull --instance prod --file <tmp>` 取得）。
3. **域名**：`codex.chenli.dev` 已绑定到项目。在 Cloudflare（`chenli.dev` 的 DNS）添加 **`CNAME codex → f5cb3d497ca8d963.vercel-dns-017.com`**（Vercel 为该域名推荐的目标；`cname.vercel-dns.com` 同样可用），**Proxy status = DNS only**（灰色云朵）。记录生效后 Vercel 会自动签发证书。
4. **部署**：每次推送到 `main` 都会自动构建并部署；在执行过 `vercel login` 的机器上，于仓库根目录运行 `vercel --prod` 效果相同。
5. 验证：`https://codex.chenli.dev/api/config` 返回 `{ "convexUrl": "https://grandiose-seal-712.convex.cloud", "dashboardUrl": "https://codex.chenli.dev", … }`。

## 3. Clerk —— 生产实例

开发密钥（`pk_test_`）不能用于生产。生产实例已通过 Clerk CLI 创建（`cd apps/dashboard && clerk deploy`），它会把开发实例的设置（Organizations、JWT 模板 `convex`）克隆到域名 **`codex.chenli.dev`** 上的新实例：

| 用途 | 主机 |
|---|---|
| Frontend API / **JWT issuer** | `https://clerk.codex.chenli.dev` |
| 账户门户 | `https://accounts.codex.chenli.dev` |
| 邮件 | `clkmail.codex.chenli.dev` + DKIM |

1. **DNS**（Cloudflare，zone `chenli.dev`，全部 **DNS only** —— 开启代理的记录无法通过验证）：

   | 类型 | 名称 | 目标 |
   |---|---|---|
   | CNAME | `clerk.codex` | `frontend-api.clerk.services` |
   | CNAME | `accounts.codex` | `accounts.clerk.services` |
   | CNAME | `clkmail.codex` | `mail.waptkkq0u2cr.clerk.services` |
   | CNAME | `clk._domainkey.codex` | `dkim1.waptkkq0u2cr.clerk.services` |
   | CNAME | `clk2._domainkey.codex` | `dkim2.waptkkq0u2cr.clerk.services` |

   `clerk deploy` 可以把这些记录导出为 BIND zone 文件（Cloudflare → DNS → *Import and Export*）。用 `clerk deploy status --wait` 或 Clerk 控制台 → Domains 查看状态。
2. **社交登录 —— 生产环境必须使用你自己的 OAuth 应用**（共享的开发凭据会被拒绝）。创建好两个应用后，再次运行 `clerk deploy`，按提示粘贴 client id/secret（或在 Clerk 控制台 → *User & Authentication → Social connections → 对应提供商 → Use custom credentials* 填写）：
   - **GitHub**：github.com → *Settings → Developer settings → OAuth Apps → New OAuth App*。Homepage 填 `https://codex.chenli.dev`，Authorization callback URL 填 **`https://clerk.codex.chenli.dev/v1/oauth_callback`**。生成 client secret。
   - **Google**：Google Cloud Console → *APIs & Services → OAuth consent screen*（External，填写应用名称/支持邮箱；发布后任何 Google 账号都能登录）→ *Credentials → Create credentials → OAuth client ID → Web application*。Authorized JavaScript origins 填 `https://codex.chenli.dev`；Authorized redirect URI 填 **`https://clerk.codex.chenli.dev/v1/oauth_callback`**。
3. **组织（团队）**：已启用（从开发实例克隆）。Clerk 免费套餐每个组织最多 5 名成员 —— 团队更大时需在 Clerk → *Organizations → Settings* 中提高上限（付费套餐）。可选：开启 *verified domains*，让 `@yourcompany` 邮箱自动加入。

   **邀请链接。** Clerk 自带的邀请绑定单个邮箱，因此仪表盘在其之上做了可复用的链接：*Members → 邀请链接*（仅管理员）可生成 `https://codex.chenli.dev/j/<code>`，有效期可选 1/3/5/7 天，并可限制名额。邀请台账存放在 Convex（`orgInvites` 表）；兑换时由 Next.js 服务端用 `CLERK_SECRET_KEY` 调用 Clerk Backend API，所以该密钥必须配置在 Vercel 上，`/api/join` 才能工作。在面板中撤销链接会立即失效。链接使用复制时所在的域名 —— 开发环境是 `localhost:3000`，生产环境是 `codex.chenli.dev`。
4. **API keys**：`pk_live_…` / `sk_live_…` 已写入 Vercel 的 Production 环境（`clerk env pull --instance prod --file <tmp>` 可再次取得）。更换后需重新部署。
5. **JWT 模板** `convex` 已存在于生产实例（克隆而来）；claims 需与 `docs/clerk-jwt-template.json` 一致。检查：`clerk api /jwt_templates --instance prod`。issuer `https://clerk.codex.chenli.dev` 已设置到 Convex 生产环境（第 1.2 节）。
6. **Webhook**（可选 —— 即使成员从未打开仪表盘也能同步团队名单）：Clerk 控制台 → *Webhooks → Add endpoint* → `https://grandiose-seal-712.convex.site/clerk-webhook`，事件选择 `user.*`、`organization.*`、`organizationMembership.*` → 复制签名密钥 → `npx convex env set CLERK_WEBHOOK_SECRET whsec_… --prod`。Webhook 用于保持名单新鲜，并不是唯一授权关卡；团队读取同时要求镜像 membership 与 Clerk 签名的当前 `org_id` 匹配，因此即使删除 webhook 延迟或遗漏，成员移除后的访问也只会持续到 JWT 到期。
7. **收尾**：DNS 生效且 OAuth 应用填好后，`clerk deploy status` 会显示 `complete: true`；Clerk 控制台中 `clerk.codex.chenli.dev` 的 SSL 证书显示已签发。此时 `https://codex.chenli.dev/sign-in` 即可登录。

## 4. 部署后检查清单

1. 打开 https://codex.chenli.dev → 使用 Google/GitHub 登录 → **Create organization**（这就是团队）→ 邀请成员（成员也可以通过组织切换器自助加入）。
2. 在你的电脑上：`npx codex-token-tracker login` → 批准 → `npx codex-token-tracker agent --once` → 数据先出现在 **Personal**，再出现在 **Team**。第一次登录还会运行仪表盘的新手引导（可跳过，也可在 **设置** 中重看）。
3. Convex 控制台 → Production → Data：`users`、`orgs`、`memberships`、`devices`、`hourlyUsage`、`sessions` 开始有数据。Logs 中会显示所有 `ConvexError`。
4. Clerk → Webhooks → 检查投递记录是否返回 200。

## 5. 将菜单栏工具发布到 npm

包名为 `codex-token-tracker`。**已发布**构建内置的仪表盘地址是 `https://codex.chenli.dev`（用户可通过 `--dashboard` 自行更改）；**本地**构建则指向 `http://localhost:3000` —— 详见下方的*构建通道*。

```bash
npm login                                  # once, on the publishing machine (npm account with 2FA recommended)
pnpm --filter codex-token-tracker version patch   # or minor / major
pnpm release:menubar                       # = pnpm --filter codex-token-tracker publish --access public
git push origin main --tags
```

`pnpm release:menubar` 会先执行 `prepublishOnly`（类型检查），再执行 `prepack` —— 后者用 `--release` 重新构建 `dist/`。正是这个标记让发布出去的产物指向生产环境，因此**绝不要发布手工构建的 `dist/`**，始终让生命周期脚本来做。发布结束后 `postpack` 会把 `dist/` 还原为开发版构建，你的工作副本仍然指向 localhost。

### 构建通道

`packages/menubar/scripts/build.mjs` 在打包时写入 `__APP_CHANNEL__`：带 `--release` 即为 `prod`，其他情况一律为 `dev`。该通道决定了：

| | 开发版构建（`pnpm build`、`pnpm dev`） | 发布版构建（`prepack` → npm） |
| --- | --- | --- |
| 默认仪表盘 | `http://localhost:3000` | `https://codex.chenli.dev` |
| Convex 部署 | 开发部署，经由本地仪表盘的 `/api/config` 获取 | 生产部署 |
| 配置 / 设备令牌 / 上传状态 | `~/.codex-tracker-dev` | `~/.codex-tracker` |
| 自动更新 | 关闭；`update` 会拒绝执行 | 开启 |
| 应用名、LaunchAgent | `Codex Tracker (dev)`、`…menubar.dev` | `Codex Tracker`、`…menubar` |

因此开发者在本地测试时，数据会用开发环境的设备令牌上传到开发部署，并且该构建可以与已安装的生产版本**同时运行**。弹窗中会用橙色 **DEV** 标记标识开发版构建。

使用 `npx codex-token-tracker`（文档推荐的方式）运行的用户会在下次启动时自动获得新版本；全局安装的用户通过 `codex-tracker update` 或 `npm i -g codex-token-tracker@latest` 升级。Electron 在第一次启动时下载，而不是在安装时，因此即使其二进制下载被拦截，无界面 / WSL 环境下的安装也能成功。

## 6. 运维

- **更新仪表盘 / 后端**：推送到 `main` → Vercel 构建 → 同一次构建中 `convex deploy` 会把函数和 schema 推送到生产环境。Schema 变更会针对现有数据做校验；新增字段请保持可选（如 `agent` 字段的做法）。
- **先部署仪表盘 / 后端，再发布依赖它的追踪器。** 追踪器会从 `/api/config` 读取 `wireVersion`，只向声明支持新字段的后端发送这些字段（0.3.0 从 wire version 2 起发送 `machineId`）。会话身份也由服务端保证：在发布扩展了智能体来源的客户端前，必须先部署 `(device, agent, sessionId)` upsert 逻辑，否则重用同一会话 ID 的两个智能体在后端升级前可能互相覆盖。
- **预览部署（Preview）**（任何非 `main` 分支 / PR）：`CONVEX_DEPLOY_KEY` 只在 Production 环境设置，因此预览构建只执行 `next build`，并使用 **开发** Convex 部署和 **开发** Clerk 实例（Preview 环境变量）—— 这是一个不会触碰生产数据的安全预发布环境。
- **旧版已启用 `trackAllProviders` 时的一次性清理：** 旧客户端可能已上传 API Key 形式的 OpenAI 记录。新客户端不会再上传它们，但 v2 upsert 协议无法判断本地消失的记录是否应被删除。请先备份部署，再从 Convex 控制台删除该设备的 `hourlyUsage` 与 `sessions` 记录（删除整台设备的这两类记录最稳妥），然后在该设备上运行 `codex-tracker sync`。撤销设备不会删除其用量。
- **定价表**：`packages/shared/src/pricing.ts`（每 100 万 token 的美元价格），与 <https://developers.openai.com/api/docs/pricing> 保持一致，并包含输入超过 272K token 时的长上下文档位。未知模型会回退到同系列价格并标记为 *est.*；用户可在本地 `~/.codex-tracker/pricing.json` 中覆盖。仅统计具有精确 Codex OAuth 归因的 OpenAI 模型 —— API Key 与非 OpenAI 用量都会在设备端丢弃。
- **撤销设备**：用户在 Dashboard → Devices 中操作；管理员可以在 Convex 控制台中为 `devices` 表对应行设置 `revokedAt`。
- **移除成员**：从 Clerk 组织中移除该成员；Webhook 会删除成员关系，团队视图不再包含此人（其数据行仍然关联到该用户）。
- **备份 / 导出**：Convex 控制台 → Settings → Export，或执行 `npx convex export --prod`。
- **轮换密钥**：重新生成 Convex 部署密钥或 Clerk 密钥并更新 Vercel → 重新部署；更换 Webhook 密钥后需要同步更新 Convex 环境变量。
- **本地开发**仍然使用开发部署：`cd apps/dashboard && npx convex dev` + `pnpm dev`，然后执行 `pnpm --filter codex-token-tracker build` 与 `node packages/menubar/bin/codex-tracker.js login` —— 本地构建已经默认指向 `http://localhost:3000` 并使用独立的 `~/.codex-tracker-dev`，无需 `--dashboard` 参数，也不会影响生产数据。

## 7. 故障排查

| 现象 | 原因 / 解决方法 |
|---|---|
| Vercel 构建报 `Unknown option allowBuilds` 或 lockfile 错误 | 使用了 pnpm < 10；设置 `ENABLE_EXPERIMENTAL_COREPACK=1` |
| 构建卡在下载 Electron | 设置 `ELECTRON_SKIP_BINARY_DOWNLOAD=1` |
| 仪表盘出现关于 `org_id` claim 的横幅提示 | JWT 模板未命名为 `convex`，或缺少组织相关 claims（第 3.5 节） |
| Convex 日志中出现 `Unauthenticated` | 生产环境的 `CLERK_JWT_ISSUER_DOMAIN` 错误 / 缺失，或是在最近一次部署之后才设置 —— 重新部署一次 |
| 登录反复跳转 / Cookie 问题 / `clerk.codex.chenli.dev` 无法访问 | Clerk DNS 记录缺失、开启了代理（橙色云朵）或尚未验证；或在生产域名上使用了开发密钥 |
| 生产环境 Google/GitHub 登录按钮报错 | 尚未填入 OAuth 应用凭据 —— 完成 `clerk deploy`（第 3.2 节） |
| Webhook 返回 400 | `CLERK_WEBHOOK_SECRET` 错误；返回 500 → 环境变量缺失 |
| Team 视图缺少成员 | 该成员尚未打开过仪表盘，且未配置 Webhook |
| `/api/config` 中 `convexUrl: null` | 构建没有经过 `convex deploy`（检查构建命令 / 部署密钥） |
