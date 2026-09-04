# Codex Token Tracker — 用户指南

*English version: [USER_GUIDE.md](./USER_GUIDE.md)*

本指南面向团队成员。你不需要部署任何东西：管理员已经在 **https://codex.chenli.dev** 运行了仪表盘；你只需登录，并在每台使用 Codex 的电脑上安装一个小巧的菜单栏工具。

## 1. 你将获得什么

- **仪表盘**（https://codex.chenli.dev）—— 你的个人用量与团队用量：token、缓存命中率、API 等价费用、每日热力图、活跃时段、星期对比、模型分布、谁正在编码。
- **菜单栏 / 托盘应用**（npm 上的 `codex-token-tracker`）—— 常驻 macOS 菜单栏或 Windows 托盘，显示今日用量、当前会话的每秒 token 数、你的**实时**每周 / 5 小时 Codex 限额，并每分钟把用量上传到团队仪表盘。

所有内容都按**本机本地时间**显示，并支持**英文或中文**（跟随系统语言；可切换并记住选择）。

## 2. 登录仪表盘

1. 打开 https://codex.chenli.dev，点击 **Sign in** → **Google** 或 **GitHub**。
2. 管理员会把你加入团队（即一个 Clerk *组织*），有两种方式：
   - **邀请链接**，形如 `https://codex.chenli.dev/j/7K2QF9XM4TVB` —— 打开链接，用任意账号登录，然后点击 **加入该组织**。链接对任何拿到它的人都有效，直到过期（最长 7 天）或名额用完。
   - **邮件邀请** —— 通过邮件或仪表盘顶部的组织切换器接受邀请。

   在正式加入组织之前，你仍然只能看到自己的 **Personal（个人）** 视图。

请在每台设备上始终使用同一个登录方式（或同一个邮箱），这样所有用量才会归到同一个账号。

## 3. 安装并启动菜单栏工具

要求：**Node.js 20 或更高版本**（`node -v`；可从 https://nodejs.org 或使用 `nvm` 安装）。`npx` 随 Node 一起提供，除此之外无需安装任何东西——追踪器在运行时自动获取。

### 在一台电脑上的第一次

```bash
npx codex-token-tracker login
```

1. 终端会打印一个类似 `RHF7-DWW8` 的代码和链接 `https://codex.chenli.dev/cli-auth?code=…`，并在浏览器中打开它（第一次运行还会下载该包，只需几秒）。
2. 在浏览器中，用你登录仪表盘的**同一个** Google/GitHub 账号登录，然后点击 **授权（Approve）**。
3. 终端显示 *Connected as <你的名字>. Uploads are enabled.* 此时这台电脑拥有了自己的设备 token——可在 **Dashboard → Devices** 中查看或撤销。

那台机器打不开浏览器（WSL2、服务器、SSH）？终端还会打印同一链接的**二维码**：用手机相机扫一扫，在手机上登录并授权即可——或者在任何其他电脑上打开该链接。加上 `--qr` 可以在桌面上也显示二维码，`--no-qr` 则隐藏。

### 登录之后——每天

```bash
npx codex-token-tracker
```

这会启动菜单栏 / 托盘应用（在桌面环境中，第一次启动还会下载 Electron 运行时，约 100 MB，仅一次）。让它一直运行：它读取本机的 Codex 会话，在托盘显示今日用量，并每分钟上传到仪表盘。然后：

- 右键点击托盘图标 → **开机自启动（Launch at login）**，以后就再也不用敲这条命令了。
- 打开 https://codex.chenli.dev → **Personal（个人）**。历史会话会在第一次运行时上传；新的用量一分钟内就会出现。
- `npx codex-token-tracker status` 会在终端打印今日用量、实时限额和已登录的账号——不需要托盘。

`npx` 每次启动都会获取最新发布的版本，因此不需要手动更新。想要永久安装？`npm install -g codex-token-tracker` 会提供更短的 **`codex-tracker`** 命令（及其别名 `codex-token-tracker`），并可用 `codex-tracker update` 升级。本指南中的每条命令两种形式都可用——如果你没有全局安装，下文的 `codex-tracker <命令>` 即指 `npx codex-token-tracker <命令>`。

同一台电脑登录多次（菜单栏应用 *和* 无界面 agent，或重新登录）没有问题：仪表盘会识别出这是同一台机器，只保留一个设备，用量不会重复统计。

> **Electron 运行时在第一次启动时下载，而不是在安装时**（约 100 MB，仅一次，存放于 `~/.codex-tracker/electron/`）。如果有防火墙，请设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 或 `HTTPS_PROXY` 后重新启动；无界面的 `agent` 和 `status` 命令完全不需要 Electron。

小提示
- 托盘标题显示今日 token 数（例如 `12.4k`）；`codex-tracker config set trayTitle cost` 改为显示美元，`none` 则隐藏。
- 仅限全局安装：通过 `codex-tracker update` 升级（也可以用 `npm install -g codex-token-tracker@latest`）。有新版本时，托盘菜单和弹窗顶部会出现 **更新** 按钮；如果是用 `npx` 启动的，它只会提示你退出并重新运行 `npx codex-token-tracker`。

### Windows

原生支持（系统托盘）：在 PowerShell 中运行同样的两条命令即可。如果你在 **WSL2** 中使用 Codex，Windows 托盘应用也会自动发现 WSL 中的会话日志（`\\wsl$\<distro>\home\<you>\.codex`），所以一个追踪器就够了；再跑一个 WSL agent 也无妨——两者会识别为同一台 PC，只统计一次。

### WSL2 / Linux 服务器（无托盘）

```bash
npx codex-token-tracker login    # 打印链接和二维码——用手机或任意浏览器授权
npx codex-token-tracker agent    # 无界面：统计 + 上传，打印一行状态
npx codex-token-tracker status   # 今日用量、实时限额、来源
```

让代理持续运行（tmux、`nohup` 或 `systemd --user` 服务）。

## 4. 菜单栏显示的内容

| 区块 | 含义 |
|---|---|
| **Today（今日）** | token、API 等价费用、缓存命中率、请求数 —— 本地日期，仅本机 |
| **Sources（来源）** | 哪些工具消耗了你的 Codex 订阅（Codex、pi、oh-my-pi 等） |
| **Live（实时）** | 当前会话的项目、模型、每秒 token 数、上下文窗口占用 |
| **Rate limits（用量限额）** | 来自你 Codex 账户的**实时**每周 / 5 小时限额（与 Codex 应用数值一致）、额外的按模型限额、套餐、“…后重置”。琥珀色的 *From logs*（来自日志）表示实时查询失败（离线 / Codex 登录已过期），当前显示的是日志中最后记录的数值 |
| **Heatmap（热力图）** | 最近 16 周，包含本机和你的其他设备 |
| **Models（模型）** | 每个模型的 token、占比与费用；*est.* = 模型比定价表更新，价格为估算 |

“API 等价费用”是指同样的 token 在公开的 OpenAI API 按标价计费时的花费 —— 用来比较用量，并不是账单。

## 5. 仪表盘导览

- **Personal（个人）** —— 只有你自己（所有设备）。**Team（团队）** —— 组织中的所有人，外加成员排行榜。
- **时间范围按钮**（Today · 7d · 30d · 90d · 1y）、**自团队套餐开始**（2026-08-25 00:00 PDT 起的全部用量）与 **自定义**（任意起止日期，最长一年）对每个卡片都生效。**活跃时段**始终至少覆盖最近 7 天，因此选择 1 天时也能看到完整一周的规律。
- **Members（成员）** —— 成员名单、最近活跃、谁在线。**Devices（设备）** —— 你已连接的电脑；**Revoke** 可断开某一台。
- 顶部栏：组织切换器、语言（EN / 中文）、主题（浅色 / 深色 / 跟随系统）。

## 6. 会追踪哪些智能体

所有消耗你的 Codex 订阅并在本地保留会话记录的工具：

| 智能体 | 说明 |
|---|---|
| Codex CLI / Codex Desktop | 精确数值，来自 `~/.codex/sessions` |
| pi | `~/.pi/agent/sessions`；只统计 `openai-codex` 调用 —— 使用 API Key 的 provider 会被忽略，除非执行 `codex-tracker config set trackAllProviders true` |
| oh-my-pi（`omp`） | `~/.omp/agent/sessions`（另含 `~/.omp/profiles/<name>/agent/sessions` 与 `$XDG_DATA_HOME/omp/sessions`）；会话格式与统计规则均与 pi 相同，标签为 `omp` |
| OpenCode、Cline / Roo Code / Kilo Code、Hermes | 尽力支持的读取器；如果你的用量没有显示，请运行 `codex-tracker paths` 并告知管理员 |
| 其他工具 | `codex-tracker config set extraSessionDirs '[{"path":"/path/to/logs","agent":"mytool","format":"generic"}]'` |

## 7. 命令参考

每条命令都可以写成 `npx codex-token-tracker <命令>`，全局安装后也可以写成 `codex-tracker <命令>`。

```
codex-tracker                 menu bar app (falls back to agent mode without a display)
codex-tracker agent [--once]  headless tracker/uploader
codex-tracker login|logout    connect / disconnect this device (login: --qr, --no-qr, --no-browser)
codex-tracker status          today's usage, live limits, sources, account
codex-tracker paths           detected session folders per agent
codex-tracker sync            重新扫描所有智能体并重新上传本设备完整历史
codex-tracker lang en|zh|auto display language
codex-tracker config get      all settings (uploadIntervalSec, trayTitle, sources.*, …)
codex-tracker config set <key> <value>
codex-tracker update [--check]  安装最新发布版本
```

设置保存在 `~/.codex-tracker/config.json`；`~/.codex-tracker/pricing.json` 可覆盖模型价格。

## 8. 隐私

离开你电脑的只有这些内容：token 计数、模型名称、智能体名称（codex / pi / …）、项目的**文件夹名**及其路径的 SHA-256、时间戳。提示词、代码、文件内容以及你的 Codex 登录 token 永远不会上传。实时用量限额由你自己的电脑使用本地 Codex 登录直接向 chatgpt.com 获取。

## 9. 常见问题

- **每天该运行哪条命令？** —— `npx codex-token-tracker`（或打开*开机自启动*）。`login` 每台电脑只需一次。
- **仪表盘没有任何数据** —— 托盘应用 / 代理是否在运行并已登录（`npx codex-token-tracker status` → *Signed in as …*）？会话有活动后几秒内数据就会出现（追踪器发现新用量后几秒上传，否则每分钟一次）。
- **仪表盘不再更新** —— 它不需要刷新：页面会自动重新建立实时连接（笔记本从睡眠唤醒后也一样），期间侧栏的连接指示会显示 *Reconnecting…*。如果一直停在这个状态，请检查网络；获取最新数据从不需要手动刷新。
- **Devices 里同一台机器出现了两次** —— 它用 0.3.0 之前的版本登录了两次。在那台机器上更新并重启追踪器；最初几次心跳就会把两条记录合并为一条（显示 *2 次登录* 标记）。
- **这台电脑的数据看起来不对 / 不完整** —— 点击弹窗顶部的 **⟳ 同步** 按钮（或运行 `codex-tracker sync`）。它会从零重新扫描所有智能体，并重新上传本设备的完整历史，用新算出的数值替换仪表盘上该设备的统计。安装了新的编码智能体之后也建议执行一次。
- **提示 “Electron is not installed”** —— 运行 `npm rebuild electron`（或改用 `codex-tracker agent`）。在 Linux/WSL 上托盘需要图形界面；代理模式不需要。
- **数值与 Codex 应用中的限额不一致** —— 用量限额卡片与 Codex 应用的差异应在一分钟以内；如果显示 *From logs*，说明你的 Codex 登录已过期：打开一次 Codex 即可刷新。
- **我有两台电脑** —— 两台都连接即可；仪表盘会把你所有设备的用量相加。*同一台* PC 上的两个追踪器（例如 Windows 托盘 + WSL 代理）会被识别为同一台机器，只统计一次。
- **日期 / 小时不对** —— 所有内容都按你本机的本地时间显示；数据库存储的是 UTC。
- **笔记本丢了** —— Dashboard → Devices → Revoke。
