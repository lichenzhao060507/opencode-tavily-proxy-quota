**中文** | [English](README.en.md)

# opencode-tavily-proxy-quota

[![CI](https://github.com/lichenzhao060507/opencode-tavily-proxy-quota/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/lichenzhao060507/opencode-tavily-proxy-quota/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](./package.json)

一个 OpenCode 2 的 TUI 插件：在会话侧边栏显示 Tavily API 的剩余额度。

## 血缘

这是 fork 的 fork：

| 仓库 | 它增加了什么 |
|---|---|
| [cardin/opencode-tavily-quota](https://github.com/cardin/opencode-tavily-quota) | 原始版本：侧边栏显示单把 key 的 `/usage` |
| [54cwh/opencode-tavily-proxy-quota](https://github.com/54cwh/opencode-tavily-proxy-quota) | 从 [TavilyProxyManager](https://github.com/xuncv/TavilyProxyManager) 的 `/api/stats` 读取池化额度 |
| 本 fork | 逐 key 明细（`/api/keys`）、按需同步、可点击的 **刷新** 与 **详情**、中英双语界面、凭证处理修正 |

不配 `proxyUrl` 时，行为与原始版本一致：只读 `api.tavily.com/usage` 里单个账号的额度。

同一条侧边栏以文本表示（条形宽度对齐 OpenCode 内置的额度区块，两处能对齐）：

```
Tavily
 刷新额度   详情   距重置 5天12小时
████████░░░░░░░░░░░░░░░░░   32% 剩余
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░   16/19 个
可用6143/19000 · 最后 #19 · 3 个耗尽
```

第一条是本月剩余额度，第二条统计代理池里仍能服务请求的 key 数。两条都是 25 格加一个右对齐标签列，因此与 OpenCode 内置额度区块对齐。

英文界面（`"locale": "en"`）为较宽的标签让出一格，总宽仍保持 36 列：

```text
Tavily
 Refresh  Details  reset 5d 12h
████████░░░░░░░░░░░░░░░░    32% left
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░  16/19 keys
6143/19000 left · last #19 · 3 spent
```

## 安装

需要 OpenCode 2 和一个 Tavily API key。**反向代理是可选的** —— 不配 `proxyUrl` 时插件读取单个账号的 `api.tavily.com/usage`，这也是多数人需要的形态。

三种安装方式，挑一种。

### 1. 本地克隆（无需构建）

`dist/` 已随仓库提交，不必编译。但宿主不会注入运行时依赖，仍需安装：

```sh
git clone https://github.com/lichenzhao060507/opencode-tavily-proxy-quota.git
cd opencode-tavily-proxy-quota
npm install --omit=dev --ignore-scripts   # 约 1 分钟，仅运行时依赖
```

然后在 `cli.json` 里指向该目录（见 [配置](#配置)）：

```json title="cli.json"
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-tavily-proxy-quota",
      "options": { "apiKey": "tvly-..." }
    }
  ]
}
```

已验证：`--omit=dev` 且不构建时，两个根入口都能正常 import（`index.ts` → `PLUGIN_ID`、`default`；`tui.ts` → `TavilyQuotaTuiPlugin`、`buildLines` 等）。完全跳过 `npm install` **不行** —— 插件需要从自己的 `node_modules` 解析 `@opencode/plugin` 与 `@opentui/solid`。

想避开 babel 构建的人，走这条路。

### 2. 从 GitHub 按包安装

```sh
opencode plugin add github:lichenzhao060507/opencode-tavily-proxy-quota
```

安装会执行包里的 `prepare` 构建，所以这一条会从源码生成 `dist/`，也需要开发依赖。装完再往 `cli.json` 加 `options` 传 key。

部分 OpenCode 2 版本会在自带的 npm 里失败（`NpmInstallFailedError`），此时退回方式 1。

### 3. 从 npm 安装

发布之后：

```sh
opencode plugin add opencode-tavily-proxy-quota
```

同样需要在 `cli.json` 里加 `options`。

> 如果 `~/.config/opencode/plugins/opencode-tavily-proxy-quota/` 下已有副本，按包安装后要删掉，否则插件会被加载两次。

侧边栏沿用内置额度区块的样式：标题用默认文字色，正文（含条形）用次级文字色。标题与条形之间显示到本月额度重置的倒计时。默认每 10 分钟轮询一次，也可以用下面的命令手动刷新。

## 环境要求

- OpenCode 2（`opencode --version` 显示 `2.x`）。
- 一个 Tavily API key，来源三选一：
  - CLI 环境变量 `TAVILY_API_KEY`；
  - `cli.json` 里的 `apiKey` 插件选项；
  - OpenCode 里已连接的 Tavily（`opencode auth login tavily` 或 `/connect`）。

CLI 环境变量优先级高于 `apiKey`；两者都没有时用 OpenCode 的已连接凭证。服务端自己解析保存的凭证并请求 `/usage`，只有额度数据回到 TUI，已保存的 key 不会经插件 RPC 传递，也不会显示。若 TUI 连接的是远程服务端，需在服务端也安装本插件才能用它的已连接凭证。

`apiKey` 还接受 `{file:...}` 与 `{env:...}` 引用，由插件自行展开，因为 `cli.json` 不像 `opencode.jsonc` 那样做展开。

## 布局

```
index.ts         # 服务端入口：集成凭证 + 额度 RPC
rpc.ts           # 共享 RPC 定义
tui.tsx          # TUI 入口：侧边栏槽位 + 命令
usage.ts         # key 解析、/usage 请求、格式化
usage.test.ts    # usage.ts 的单元测试
scripts/build.mjs
dist/            # 发布到 npm 的已构建入口
```

`npm run build` 把 TypeScript/JSX 源码编译进 `dist/`，`package.json` 的 `exports` 与 npm 发布都指向它。发布版带已构建的 `dist/*.js`：OpenCode 在加载时转译 `.tsx` 入口，而 Solid 的 JSX 运行时（`@opentui/solid`）只在运行时提供，不从已安装的插件里取。

OpenCode 把包插件装在 `~/.cache/opencode/npm/` 下。服务端入口（`dist/index.js`）注册额度 RPC，`tui` 入口（`dist/tui.js`）在 CLI 里渲染侧边栏。

## 配置

如果你已经在 OpenCode 里连过 Tavily，不需要任何 key 选项。要用插件选项传 key，在 `cli.json` 里登记：

```json title="cli.json"
{
  "plugins": [
    {
      "package": "github:lichenzhao060507/opencode-tavily-proxy-quota",
      "options": {
        "apiKey": "tvly-..."
      }
    }
  ]
}
```

`cli.json` 只在 CLI 侧生效，因此当 TUI 连接远程服务端时，这条登记仍能让插件保持启用。同一处还接受 `refreshMs`，用来覆盖默认轮询间隔 —— 直连模式 10 分钟（Tavily 的 `/usage` 限每 10 分钟 10 次请求），代理模式 60 秒（只读本地缓存）。

### 语言

侧边栏提供中文与英文：

```json title="cli.json"
{
  "plugins": [
    {
      "package": "github:lichenzhao060507/opencode-tavily-proxy-quota",
      "options": {
        "apiKey": "<proxy master key>",
        "locale": "en"
      }
    }
  ]
}
```

`locale` 取 `"auto"`（默认）、`"zh"` 或 `"en"`。`"auto"` 依次读 `LC_ALL` / `LC_MESSAGES` / `LANG`，再读操作系统区域设置，最后回落到中文。终端区域设置与期望不符时，显式指定即可。

```text
Tavily
 Refresh  Details  reset 5d 12h
████████░░░░░░░░░░░░░░░░    32% left
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░  16/19 keys
6143/19000 left · last #19 · 3 spent
```

### 按钮

- **刷新** 先读代理缓存，再在后台从 Tavily 同步每一把 key（大池子需 10–20 秒），最后报告结果。
- **详情** 以 toast 打开逐 key 明细。它只读当前状态、从不触发同步，因此是即时的。与 `/tavily-quota` 是同一视图。

### 让 key 不落在文件里

`cli.json` 不经过 `opencode.jsonc` 那套处理：OpenCode 不会展开插件选项里的 `{file:...}` 或 `{env:...}`，所以由插件来做。两种引用都可以用作 `apiKey`，避免把明文 key 粘进 `cli.json`：

```json title="cli.json"
{
  "plugins": [
    {
      "package": "github:lichenzhao060507/opencode-tavily-proxy-quota",
      "options": {
        "apiKey": "{file:~/.secrets/tavily-api-key}"
      }
    }
  ]
}
```

`{env:NAME}` 读环境变量（未设置时为空）。`{file:PATH}` 读文件并去掉首尾空白，`~/` 展开为家目录，相对路径按 CLI 的工作目录解析。两者同时存在时，`TAVILY_API_KEY` 仍优先于 `apiKey`。文件缺失或不可读会在侧边栏报错，而不是当作 key 使用。

## Tavily 代理池

[TavilyProxyManager](https://github.com/xuncv/TavilyProxyManager) 是自建的反向代理，前面是一池 Tavily key，每个请求挑一把。它的 `GET /api/stats` 汇报整池汇总的额度。设置 `proxyUrl` 即可读这个端点而不再读单 key 的 `/usage`，同时把 `apiKey` 设为代理的 **master key**（客户端访问代理用的凭证，不是 `tvly-` 开头的 key）：

```json title="cli.json"
{
  "plugins": [
    {
      "package": "github:lichenzhao060507/opencode-tavily-proxy-quota",
      "options": {
        "apiKey": "<proxy master key>",
        "proxyUrl": "http://127.0.0.1:27890"
      }
    }
  ]
}
```

侧边栏随即显示 `limit = total_quota`、`remaining = total_remaining`，标题带上 key 数（`Tavily Pool (6 keys)`）。`proxyUrl` 末尾多一个斜杠也没问题。`apiKey` 同样接受 `{env:...}`/`{file:...}`，master key 不必写进 `cli.json`。代理必须能从 TUI 所在位置访问到。

说明：

- 重置倒计时仍用按自然月近似。池里的 key 可能属于不同账号、重置日不同，所以只能当粗略提示。
- `total_quota` 是各 key 月度额度的加总，是侧边栏条形的基准，不对应任何真实套餐。
- 环境变量里的 `TAVILY_API_KEY` 仍优先于 `apiKey`，用代理时不要把它设成裸 Tavily key。
- 配了 `proxyUrl` 后，插件不再直接请求 `api.tavily.com`。

### 刷新行为

代理模式读本地 `<proxyUrl>/api/stats` 缓存，因此侧边栏每 **60 秒** 轮询一次，手动刷新在一秒内出图。直连模式读 `api.tavily.com/usage`，受每 10 分钟 10 次限制，因此每 **10 分钟** 轮询一次。

按下刷新（按钮、`/tavily-quota` 或命令面板）会额外触发一次 *同步*：代理逐把重新向 Tavily 请求 `/usage`。20 把左右的池子约 19 次上游请求，耗时 10–20 秒，所以先画出缓存数字，事后再报告同步结果。

同步失败时如实提示，不装作成功：

```
⚠ 同步失败 19/19，数字为缓存
```

代理即使每把 key 都返回 `429`，也会把任务标为 `completed`，因此插件检查 `succeeded`/`failed`，而不信任任务状态。短时间内连续刷新可能触发 Tavily 的限流，之后同步会一直失败到窗口重置。保持新鲜度主要靠代理自身的自动同步 —— 把按钮当作手动兜底。

## 命令

- `/tavily-quota` —— 斜杠命令，重新取额度并报告当前值、重置倒计时，以及同步实际做了什么。
- `Refresh Tavily quota` —— 命令面板（`Ctrl+P`）里的同一动作。

## 数据来源

`GET https://api.tavily.com/usage`，带 `Authorization: Bearer <key>`。插件优先用账号套餐（`account.plan_limit` / `account.plan_usage`，例如 `Researcher` 每月 1000 credits），套餐上限缺失时回落到单 key 上限，因此单 key 上限为 `null`（无限额 key）也能处理。

响应里没有重置时间戳，所以倒计时按日历推算：Tavily 在每月 1 日（不是账单日）重置额度，插件按 `00:00 UTC` 计算。若将来 Tavily 提供明确的重置时间，应优先使用它。

## 开发

`usage.ts` 刻意不 import OpenCode 与 OpenTUI 的任何东西，因此随处可测。测试覆盖额度计算、本地 key 的优先级与回落、已连接 key 的 RPC，以及用 mock `fetch` 的 HTTP 错误处理。

在仓库根目录跑测试与类型检查：

```sh
npm install
npm test
npm run typecheck
```

## 说明

- 服务端负责 OpenCode 已连接的凭证及其额度请求；CLI 负责本地 key 与 TUI 槽位渲染。

## 安全

Tavily key 从不记入日志、从不渲染、也从不跨越插件 RPC 边界 —— 只有额度数字过去。`{file:...}` 引用按凭证对待，多行或超过 512 字符会被拒绝。范围说明与私密报告方式见 [SECURITY.md](./SECURITY.md)。

## 贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。改动记录在 [CHANGELOG.md](./CHANGELOG.md)。

## 许可

MIT —— 见 [LICENSE](./LICENSE)。原始工作来自
[cardin](https://github.com/cardin/opencode-tavily-quota) 与
[54cwh](https://github.com/54cwh/opencode-tavily-proxy-quota)；本 fork 沿用同一许可与版权声明。
