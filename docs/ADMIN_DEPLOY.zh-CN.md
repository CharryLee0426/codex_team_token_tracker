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

- 账号：GitHub（仓库 `CharryLee0426/codex_team_token_tracker`）、Vercel、Convex、Clerk、npm；对 `chenli.dev` 的 DNS 管理权限。
- 本地环境：Node ≥ 20、pnpm 11（`corepack enable`）、Clerk CLI（`npm i -g clerk`）、Convex CLI（`npx convex`）。
- 仓库已包含全部内容：Convex 函数位于 `packages/backend/convex`，仪表盘位于 `apps/dashboard`（`vercel.json` 已设置构建命令），菜单栏应用位于 `packages/menubar`。

## 1. Convex —— 生产部署

1. https://dashboard.convex.dev → 你的项目（开发部署 `majestic-lynx-360` 已存在）→ **Settings → Deploy keys → Generate production deploy key**。复制它：这就是 Vercel 中要用的 `CONVEX_DEPLOY_KEY`。生产部署会在第一次部署时自动创建。
2. 第一次 Vercel 构建完成后，记录生产环境的 URL（Convex 控制台 → Production）：`https://<prod-name>.convex.cloud`（API）和 `https://<prod-name>.convex.site`（Webhook 主机）。
3. 生产环境变量在 Clerk 生产实例就绪后于 **第 3.6 节** 设置：
   ```bash
   cd apps/dashboard
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://clerk.chenli.dev --prod
   npx convex env set CLERK_WEBHOOK_SECRET whsec_xxx --prod
   ```
   （或在 Convex 控制台 → Production → Settings → Environment Variables 中设置）。

## 2. Vercel —— 仪表盘

1. **Add New Project → Import** `CharryLee0426/codex_team_token_tracker`。
2. **Root Directory**：`apps/dashboard`（保持 *Include source files outside of the Root Directory* 开启 —— 这是一个 pnpm workspace）。Framework：Next.js。构建命令从 `apps/dashboard/vercel.json` 读取（`pnpm build:vercel` = `convex deploy --cmd 'next build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`）。
3. **环境变量**（Production）：

   | 名称 | 值 |
   |---|---|
   | `CONVEX_DEPLOY_KEY` | 第 1 步得到的生产部署密钥 |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_…`（第 3.5 节） |
   | `CLERK_SECRET_KEY` | `sk_live_…`（第 3.5 节） |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
   | `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/dashboard` |
   | `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/dashboard` |
   | `NEXT_PUBLIC_APP_URL` | `https://codex.chenli.dev` |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` —— 让 Vercel 遵循 `packageManager: pnpm@11`（lockfile 依赖 pnpm ≥ 10 的设置） |
   | `ELECTRON_SKIP_BINARY_DOWNLOAD` | `1` —— 安装时跳过 menubar workspace 约 100 MB 的 Electron 下载 |

   `NEXT_PUBLIC_CONVEX_URL` **不需要**手动设置 —— `convex deploy` 会在构建时自动注入。
4. **Domains** → 添加 `codex.chenli.dev`。在你的 DNS 中添加 `CNAME codex → cname.vercel-dns.com`（Vercel 会显示准确的记录）。等待证书签发。
5. 部署（第一次构建可以在 Clerk 生产实例就绪之前进行；完成第 3 节并重新部署后，登录功能即可正常使用）。
6. 验证：`https://codex.chenli.dev/api/config` 返回 `{ "convexUrl": "https://<prod>.convex.cloud", "dashboardUrl": "https://codex.chenli.dev", … }`。

## 3. Clerk —— 生产实例

开发密钥（`pk_test_`）不能用于生产环境；Clerk 要求在你自己的域名上创建生产实例。

1. **创建生产实例**：Clerk 控制台 → 顶部的实例切换器 → **Create production instance** → *Clone development settings*。Home URL：`https://codex.chenli.dev`。
2. **DNS**：Clerk 会列出需要在 `chenli.dev` 上添加的记录 —— 通常是 `CNAME clerk → frontend-api.clerk.services`、`CNAME accounts → accounts.clerk.services`，以及用于邮件的 `clkmail`、`clk._domainkey`、`clk2._domainkey`。添加后点击 **Verify**。Frontend API 将变为 `https://clerk.chenli.dev` —— 这也是下文使用的 **JWT issuer**。
3. **社交登录（生产环境需要你自己的 OAuth 应用）**：
   - Google：Google Cloud Console → *APIs & Services → Credentials → OAuth client (Web)*；授权重定向 URI 填 Clerk 显示的地址（`https://clerk.chenli.dev/v1/oauth_callback`）。把 client id/secret 粘贴到 Clerk → *User & Authentication → Social connections → Google → Use custom credentials*。
   - GitHub：GitHub → *Settings → Developer settings → OAuth Apps → New*；callback URL 填同一个 Clerk 回调地址。粘贴到 Clerk → GitHub → custom credentials。
4. **组织（团队）**：*Organizations → Enable*（或执行 `clerk enable orgs --instance prod`）。可选：调高 *max members*，并开启 *verified domains*，让 `@yourcompany` 邮箱自动加入。
5. **API keys**（生产实例）：把 `pk_live_…` 和 `sk_live_…` 复制到 Vercel（第 2.3 节）并**重新部署**。
6. **JWT 模板**，名称必须为 `convex` —— Clerk 控制台 → *Configure → JWT templates → New → Convex*，然后用 `docs/clerk-jwt-template.json` 中的内容替换 claims；或使用 CLI：
   ```bash
   clerk api /jwt_templates --instance prod -X POST --file docs/clerk-jwt-template.json --yes
   ```
   然后在 Convex 生产环境设置 issuer（第 1.3 节）：`CLERK_JWT_ISSUER_DOMAIN=https://clerk.chenli.dev`（即模板页面上显示的 *Issuer*）。
7. **Webhook**（即使成员从未打开仪表盘，也能保持团队名单同步）：*Webhooks → Add endpoint* → `https://<prod-name>.convex.site/clerk-webhook`，事件选择 `user.*`、`organization.*`、`organizationMembership.*` → 复制签名密钥 → `npx convex env set CLERK_WEBHOOK_SECRET whsec_… --prod`。

## 4. 部署后检查清单

1. 打开 https://codex.chenli.dev → 使用 Google/GitHub 登录 → **Create organization**（这就是团队）→ 邀请成员（成员也可以通过组织切换器自助加入）。
2. 在你的电脑上：`npm i -g codex-token-tracker && codex-tracker login` → 批准 → `codex-tracker agent --once` → 数据先出现在 **Personal**，再出现在 **Team**。
3. Convex 控制台 → Production → Data：`users`、`orgs`、`memberships`、`devices`、`hourlyUsage`、`sessions` 开始有数据。Logs 中会显示所有 `ConvexError`。
4. Clerk → Webhooks → 检查投递记录是否返回 200。

## 5. 将菜单栏工具发布到 npm

包名为 `codex-token-tracker`（内置默认仪表盘地址 `https://codex.chenli.dev`，用户可通过 `--dashboard` 自行更改）。

```bash
npm login                                  # once, on the publishing machine (npm account with 2FA recommended)
pnpm --filter codex-token-tracker version patch   # or minor / major
pnpm release:menubar                       # = pnpm --filter codex-token-tracker publish --access public (runs build + typecheck first)
git push origin main --tags
```

用户通过 `npm i -g codex-token-tracker@latest` 升级。Electron 是*可选*依赖，因此即使其二进制下载被拦截，无界面 / WSL 环境下的安装也能成功。

## 6. 运维

- **更新仪表盘 / 后端**：推送到 `main` → Vercel 构建 → 同一次构建中 `convex deploy` 会把函数和 schema 推送到生产环境。Schema 变更会针对现有数据做校验；新增字段请保持可选（如 `agent` 字段的做法）。
- **预览部署（Preview）**：预览部署同样会对生产环境执行 `convex deploy`。请在 Vercel 上关闭预览部署，或仅为 Production 环境设置 `CONVEX_DEPLOY_KEY`。
- **定价表**：`packages/shared/src/pricing.ts`（每 100 万 token 的美元价格）。未知模型会回退到同系列价格并标记为 *est.*；用户可在本地 `~/.codex-tracker/pricing.json` 中覆盖。
- **撤销设备**：用户在 Dashboard → Devices 中操作；管理员可以在 Convex 控制台中为 `devices` 表对应行设置 `revokedAt`。
- **移除成员**：从 Clerk 组织中移除该成员；Webhook 会删除成员关系，团队视图不再包含此人（其数据行仍然关联到该用户）。
- **备份 / 导出**：Convex 控制台 → Settings → Export，或执行 `npx convex export --prod`。
- **轮换密钥**：重新生成 Convex 部署密钥或 Clerk 密钥并更新 Vercel → 重新部署；更换 Webhook 密钥后需要同步更新 Convex 环境变量。
- **本地开发**仍然使用开发部署：`cd apps/dashboard && npx convex dev` + `pnpm dev`；`codex-tracker login --dashboard http://localhost:3000`。

## 7. 故障排查

| 现象 | 原因 / 解决方法 |
|---|---|
| Vercel 构建报 `Unknown option allowBuilds` 或 lockfile 错误 | 使用了 pnpm < 10；设置 `ENABLE_EXPERIMENTAL_COREPACK=1` |
| 构建卡在下载 Electron | 设置 `ELECTRON_SKIP_BINARY_DOWNLOAD=1` |
| 仪表盘出现关于 `org_id` claim 的横幅提示 | JWT 模板未命名为 `convex`，或缺少组织相关 claims（第 3.6 节） |
| Convex 日志中出现 `Unauthenticated` | 生产环境的 `CLERK_JWT_ISSUER_DOMAIN` 错误 / 缺失，或是在最近一次部署之后才设置 —— 重新部署一次 |
| 登录反复跳转 / Cookie 问题 | Clerk DNS 未验证，或在生产域名上使用了开发密钥 |
| Webhook 返回 400 | `CLERK_WEBHOOK_SECRET` 错误；返回 500 → 环境变量缺失 |
| Team 视图缺少成员 | 该成员尚未打开过仪表盘，且未配置 Webhook |
| `/api/config` 中 `convexUrl: null` | 构建没有经过 `convex deploy`（检查构建命令 / 部署密钥） |
