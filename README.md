# opencode-tavily-proxy-quota

[![CI](https://github.com/lichenzhao060507/opencode-tavily-proxy-quota/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/lichenzhao060507/opencode-tavily-proxy-quota/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](./package.json)

An OpenCode 2 TUI plugin that shows the remaining Tavily API credits in the
session sidebar.

## Lineage

This is a fork of a fork:

| Repository | What it added |
|---|---|
| [cardin/opencode-tavily-quota](https://github.com/cardin/opencode-tavily-quota) | original: one key's `/usage` in the sidebar |
| [54cwh/opencode-tavily-proxy-quota](https://github.com/54cwh/opencode-tavily-proxy-quota) | pooled quota from a [TavilyProxyManager](https://github.com/xuncv/TavilyProxyManager) (`/api/stats`) |
| this fork | per-key breakdown (`/api/keys`), on-demand sync, clickable **Refresh** + **Details** buttons, Chinese/English UI, credential-handling fixes |

Without `proxyUrl` it behaves exactly like the original: one account's credits
from `api.tavily.com/usage`.

The same sidebar as text (the bar widths match OpenCode's built-in quota
section, so the two line up):

```
Tavily
 刷新额度   详情   距重置 5天12小时
████████░░░░░░░░░░░░░░░░░   32% 剩余
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░   16/19 个
6143/19000 · 最后 #19 · 3 个耗尽
```

The first bar is monthly credits left; the second counts keys in the proxy pool
that can still serve a request. Both are 25 cells plus a right-aligned label
column, so they line up with OpenCode's built-in quota section.

The English build (`"locale": "en"`) trades a cell of bar width for its wider
labels and stays on 36 columns:

```text
Tavily
 Refresh  Details  reset 5d 12h
████████░░░░░░░░░░░░░░░░    32% left
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░  16/19 keys
6143/19000 · last #19 · 3 spent
```


## Install

This fork ships from GitHub, not npm — the npm package
`@cardinal4/opencode-tavily-quota` is the upstream version without proxy
support:

```sh
opencode plugin add github:lichenzhao060507/opencode-tavily-proxy-quota
```

Or declare it in `cli.json` to pass options (see
[Configuration](#configuration)). The install runs the package's `prepare`
build, so the first install compiles `dist/` from source. If a local copy exists
under `~/.config/opencode/plugins/opencode-tavily-proxy-quota/`, remove it after
installing the package so the plugin is not loaded twice.

The sidebar follows the built-in quota styling — the heading uses the default
text color and the body (bar included) uses the muted/subdued text color. A
countdown between the heading and the bar shows how long until the monthly
credits reset. It polls every 10 minutes and can be refreshed on demand with the
command below.

## Requirements

- OpenCode 2 (`opencode --version` reports `2.x`).
- A Tavily API key, supplied by:
  - `TAVILY_API_KEY` in the CLI environment,
  - the `apiKey` plugin option configured in `cli.json`, or
  - OpenCode's active Tavily connection (use `opencode auth login tavily` or
    `/connect` to connect Tavily).

The CLI environment takes precedence over `apiKey`; OpenCode's active
connection is used when neither supplies a key. The server resolves its saved
credential and fetches `/usage` itself. Only quota data returns to the TUI;
the saved key is never sent over plugin RPC or displayed. With a remote server,
install this plugin there too to use its active connection.

The `apiKey` option also accepts `{file:...}` and `{env:...}` references, which
the plugin expands itself because `cli.json` does not (unlike `opencode.jsonc`).

## Layout

```
index.ts         # server entrypoint: integration credential + quota RPC
rpc.ts           # shared RPC definition
tui.tsx          # TUI entrypoint: sidebar slot + command
usage.ts         # key resolution, /usage fetch, formatting
usage.test.ts    # unit tests for usage.ts
scripts/build.mjs
dist/            # built entrypoints shipped to npm
```

`npm run build` compiles the TypeScript/JSX sources into `dist/`, which is what
`package.json` exports and what npm publishes. Published plugins ship built
`dist/*.js`: OpenCode transpiles `.tsx` entrypoints as it loads them, and the
Solid JSX runtime (`@opentui/solid`) is only provided at runtime, not from the
installed plugin.

OpenCode installs package plugins under `~/.cache/opencode/npm/`. The server
entrypoint (`dist/index.js`) registers the quota RPC; the `tui` entrypoint
(`dist/tui.js`) renders the sidebar in the CLI.

## Configuration

If you already connected Tavily in OpenCode, no key option is needed. To pass
the API key as a plugin option instead, register the plugin in `cli.json`:

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

The CLI-only `cli.json` entry also keeps the plugin active when the TUI is
connected to a remote server. The same entry accepts a `refreshMs` option to
override the default poll interval — 10 minutes in direct mode (Tavily's
`/usage` allows 10 requests per 10 minutes), 60 seconds in proxy mode (it only
reads the local cache).

### Language

The sidebar ships in Chinese and English:

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

`locale` is `"auto"` (default), `"zh"` or `"en"`. `"auto"` reads `LC_ALL` /
`LC_MESSAGES` / `LANG`, then the OS locale, and falls back to Chinese. Set it
explicitly if your terminal locale does not match what you want.

```text
Tavily
 Refresh  Details  reset 5d 12h
████████░░░░░░░░░░░░░░░░    32% left
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░  16/19 keys
6143/19000 · last #19 · 3 spent
```

### Buttons

- **Refresh** re-reads the proxy cache, then syncs every key from Tavily in the
  background (10–20 s on a large pool) and reports what happened.
- **Details** opens the per-key breakdown as a toast. It reads current state and
  never syncs, so it is instant. Same view as `/tavily-quota`.

### Keeping the key out of the file

`cli.json` is not processed like `opencode.jsonc`: OpenCode does not expand
`{file:...}` or `{env:...}` in plugin options, so the plugin does it. Use either
reference as `apiKey` to avoid pasting the raw key into `cli.json`:

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

`{env:NAME}` reads an environment variable (empty when unset). `{file:PATH}`
reads a file's trimmed contents, with `~/` expanding to the home directory and
relative paths resolving against the CLI's working directory. `TAVILY_API_KEY`
still wins over `apiKey` when both are set. A missing or unreadable file is
reported in the sidebar instead of being used as the key.

## Tavily proxy pool

[TavilyProxyManager](https://github.com/xuncv/TavilyProxyManager) is a
self-hosted reverse proxy that fronts a pool of Tavily API keys and picks a key
per request. Its `GET /api/stats` endpoint reports credits summed across the
whole pool. Set `proxyUrl` to read that endpoint instead of a single key's
`/usage`, and set `apiKey` to the proxy's **master key** (the credential clients
use to talk to the proxy, not a `tvly-` key):

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

The sidebar then shows `limit = total_quota`, `remaining = total_remaining`, and
the heading reports the key count (`Tavily Pool (6 keys)`). A trailing slash on
`proxyUrl` is fine. `apiKey` still accepts `{env:...}`/`{file:...}` references,
so the master key can stay out of `cli.json`. The proxy must be reachable from
wherever the TUI runs.

Notes:

- The reset countdown still uses the calendar-month approximation. Pooled keys
  can belong to different accounts with different reset dates, so treat it as a
  rough indicator only.
- `total_quota` is the sum of each key's monthly allowance, which is what the
  sidebar bar is relative to; it is not a real single-account plan.
- `TAVILY_API_KEY` in the environment still wins over `apiKey`, so don't set it
  to a raw Tavily key when using a proxy.
- With `proxyUrl` set the plugin never calls `api.tavily.com` directly.

### Refresh behaviour

Proxy mode reads the local `<proxyUrl>/api/stats` cache, so the sidebar polls
every **60 seconds** and a refresh paints in well under a second. Direct mode
reads `api.tavily.com/usage`, which is limited to 10 requests per 10 minutes, so
it polls every **10 minutes**.

Pressing refresh (button, `/tavily-quota`, or the palette command) adds a
*sync*: the proxy re-reads every key's `/usage` on Tavily, one key at a time.
With a ~20-key pool that is ~19 upstream requests and takes 10–20 seconds, so
the cached numbers are painted first and the sync result is reported afterwards.

If the sync fails, the sidebar says so rather than showing a success:

```
⚠ 同步失败 19/19，数字为缓存
```

The proxy marks the job `completed` even when every key returned `429`, so the
plugin checks `succeeded`/`failed` rather than trusting the job status. Several
refreshes in quick succession can trip Tavily's rate limit; after that, syncs
fail until the window resets. The proxy's own auto-sync is the primary source of
freshness — treat the button as a manual override.

## Commands

- `/tavily-quota` — slash command that re-fetches and reports the current quota,
  the reset countdown, and what the sync actually did.
- "Refresh Tavily quota" — the same action from the command palette (`Ctrl+P`).

## Data source

`GET https://api.tavily.com/usage` with `Authorization: Bearer <key>`. The
plugin prefers the account plan (`account.plan_limit` / `account.plan_usage`,
e.g. `Researcher` with 1000 monthly credits) and falls back to the per-key limit
when the plan limit is absent. A `null` per-key limit (unlimited key) is
therefore handled.

The response has no reset timestamp, so the sidebar countdown is derived from
the calendar: Tavily resets credits on the first day of each month (not the
billing date), and the plugin assumes `00:00 UTC` for that reset. If Tavily
later exposes an explicit reset time, prefer it over this derivation.

## Development

`usage.ts` is deliberately free of OpenCode and OpenTUI imports so it can be
tested anywhere. The tests cover quota math, local-key precedence and fallback,
the connected-key RPC, and HTTP error handling using a mock `fetch`.

Run the tests and type check from the repository root:

```sh
npm install
npm test
npm run typecheck
```

## Notes

- The server handles OpenCode-connected credentials and their quota requests;
  the CLI handles local keys and renders TUI slots.

## Security

The Tavily key is never logged, never rendered, and never sent over the plugin
RPC boundary — only quota numbers cross it. `{file:...}` references are treated
as credentials and rejected if they are multi-line or longer than 512
characters. See [SECURITY.md](./SECURITY.md) for scope and private reporting.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Changes are listed in
[CHANGELOG.md](./CHANGELOG.md).

## License

MIT — see [LICENSE](./LICENSE). Original work by
[cardin](https://github.com/cardin/opencode-tavily-quota) and
[54cwh](https://github.com/54cwh/opencode-tavily-proxy-quota); this fork keeps
the same licence and copyright notices.
