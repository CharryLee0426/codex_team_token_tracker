# Codex Token Tracker — 用户指南

*English version: [USER_GUIDE.md](./USER_GUIDE.md)*

本指南面向团队成员。你不需要部署任何东西：管理员已经在 **https://codex.chenli.dev** 运行了仪表盘；你只需登录，并在每台使用 Codex 的电脑上安装一个小巧的菜单栏工具。

## 1. 你将获得什么

- **仪表盘**（https://codex.chenli.dev）—— 你的个人用量与团队用量：token、缓存命中率、API 等价费用、每日热力图、活跃时段、星期对比、模型分布、谁正在编码。
- **菜单栏 / 托盘应用**（npm 上的 `codex-token-tracker`）—— 常驻 macOS 菜单栏或 Windows 托盘，显示今日用量、当前会话的每秒 token 数、你的**实时**每周 / 5 小时 Codex 限额，并每分钟把用量上传到团队仪表盘。

所有内容都按**本机本地时间**显示，并支持**英文或中文**（跟随系统语言；可切换并记住选择）。

## 2. 登录仪表盘

1. 打开 https://codex.chenli.dev，点击 **Sign in** → **Google** 或 **GitHub**。
2. 管理员会邀请你加入团队（即一个 Clerk *组织*）。通过邮件或仪表盘顶部的组织切换器接受邀请。在此之前，你仍然可以看到自己的 **Personal（个人）** 视图。

请在每台设备上始终使用同一个登录方式（或同一个邮箱），这样所有用量才会归到同一个账号。

## 3. 安装菜单栏工具

要求：**Node.js 20 或更高版本**（`node -v`）。可从 https://nodejs.org 或使用 `nvm` 安装 Node。

```bash
npm install -g codex-token-tracker
codex-tracker login        # opens the dashboard; sign in and click "Approve"
codex-tracker              # starts the menu bar app
```

`codex-tracker login` 会打印一个类似 `RHF7-DWW8` 的代码，并打开 `https://codex.chenli.dev/cli-auth?code=…`。在浏览器中点击批准后，终端会显示 *Connected as <你的名字>*。此时这台设备拥有了自己的 token（可在 **Dashboard → Devices** 中撤销）。

小提示
- 右键点击托盘图标 → **Launch at login**（开机自启），让它随电脑一起启动。
- 托盘标题显示今日 token 数（例如 `12.4k`）；`codex-tracker config set trayTitle cost` 改为显示美元，`none` 则隐藏。
- 之后可通过 `npm install -g codex-token-tracker@latest` 升级。

### Windows

原生支持（系统托盘）。如果你在 **WSL2** 中使用 Codex，Windows 托盘应用也会自动发现 WSL 中的会话日志（`\\wsl$\<distro>\home\<you>\.codex`）—— 每台机器只运行**一个**追踪器，不要两个都跑。

### WSL2 / Linux 服务器（无托盘）

```bash
npm install -g codex-token-tracker
codex-tracker login                 # prints the URL — open it in any browser
codex-tracker agent                 # headless: tracks + uploads, prints a status line
codex-tracker status                # today's usage, live limits, sources
```

让代理持续运行（tmux、`nohup` 或 `systemd --user` 服务）。

## 4. 菜单栏显示的内容

| 区块 | 含义 |
|---|---|
| **Today（今日）** | token、API 等价费用、缓存命中率、请求数 —— 本地日期，仅本机 |
| **Sources（来源）** | 哪些工具消耗了你的 Codex 订阅（Codex、pi 等） |
| **Live（实时）** | 当前会话的项目、模型、每秒 token 数、上下文窗口占用 |
| **Rate limits（用量限额）** | 来自你 Codex 账户的**实时**每周 / 5 小时限额（与 Codex 应用数值一致）、额外的按模型限额、套餐、“…后重置”。琥珀色的 *From logs*（来自日志）表示实时查询失败（离线 / Codex 登录已过期），当前显示的是日志中最后记录的数值 |
| **Heatmap（热力图）** | 最近 16 周，包含本机和你的其他设备 |
| **Models（模型）** | 每个模型的 token、占比与费用；*est.* = 模型比定价表更新，价格为估算 |

“API 等价费用”是指同样的 token 在公开的 OpenAI API 按标价计费时的花费 —— 用来比较用量，并不是账单。

## 5. 仪表盘导览

- **Personal（个人）** —— 只有你自己（所有设备）。**Team（团队）** —— 组织中的所有人，外加成员排行榜。
- **时间范围按钮**（Today · 7d · 30d · 90d · 1y）对每个卡片都生效。
- **Members（成员）** —— 成员名单、最近活跃、谁在线。**Devices（设备）** —— 你已连接的电脑；**Revoke** 可断开某一台。
- 顶部栏：组织切换器、语言（EN / 中文）、主题（浅色 / 深色 / 跟随系统）。

## 6. 会追踪哪些智能体

所有消耗你的 Codex 订阅并在本地保留会话记录的工具：

| 智能体 | 说明 |
|---|---|
| Codex CLI / Codex Desktop | 精确数值，来自 `~/.codex/sessions` |
| pi | `~/.pi/agent/sessions`；只统计 `openai-codex` 调用 —— 使用 API Key 的 provider 会被忽略，除非执行 `codex-tracker config set trackAllProviders true` |
| OpenCode、Cline / Roo Code / Kilo Code、Hermes | 尽力支持的读取器；如果你的用量没有显示，请运行 `codex-tracker paths` 并告知管理员 |
| 其他工具 | `codex-tracker config set extraSessionDirs '[{"path":"/path/to/logs","agent":"mytool","format":"generic"}]'` |

## 7. 命令参考

```
codex-tracker                 menu bar app (falls back to agent mode without a display)
codex-tracker agent [--once]  headless tracker/uploader
codex-tracker login|logout    connect / disconnect this device
codex-tracker status          today's usage, live limits, sources, account
codex-tracker paths           detected session folders per agent
codex-tracker lang en|zh|auto display language
codex-tracker config get      all settings (uploadIntervalSec, trayTitle, sources.*, …)
codex-tracker config set <key> <value>
```

设置保存在 `~/.codex-tracker/config.json`；`~/.codex-tracker/pricing.json` 可覆盖模型价格。

## 8. 隐私

离开你电脑的只有这些内容：token 计数、模型名称、智能体名称（codex / pi / …）、项目的**文件夹名**及其路径的 SHA-256、时间戳。提示词、代码、文件内容以及你的 Codex 登录 token 永远不会上传。实时用量限额由你自己的电脑使用本地 Codex 登录直接向 chatgpt.com 获取。

## 9. 常见问题

- **仪表盘没有任何数据** —— 托盘应用 / 代理是否在运行并已登录（`codex-tracker status` → *Signed in as …*）？数据会在一分钟内出现。
- **提示 “Electron is not installed”** —— 运行 `npm rebuild electron`（或改用 `codex-tracker agent`）。在 Linux/WSL 上托盘需要图形界面；代理模式不需要。
- **数值与 Codex 应用中的限额不一致** —— 用量限额卡片与 Codex 应用的差异应在一分钟以内；如果显示 *From logs*，说明你的 Codex 登录已过期：打开一次 Codex 即可刷新。
- **我有两台电脑** —— 两台都连接即可；仪表盘会把你所有设备的用量相加。不要运行两个读取*同一份*日志的追踪器（例如同一台 PC 上同时跑 Windows 托盘 + WSL 代理）。
- **日期 / 小时不对** —— 所有内容都按你本机的本地时间显示；数据库存储的是 UTC。
- **笔记本丢了** —— Dashboard → Devices → Revoke。
