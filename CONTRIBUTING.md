# Contributing

Thanks for looking. This is a personal fork, but issues and pull requests are
welcome — small, focused ones are easiest to review.

## What this repository is

A fork of [54cwh/opencode-tavily-proxy-quota](https://github.com/54cwh/opencode-tavily-proxy-quota),
itself a fork of [cardin/opencode-tavily-quota](https://github.com/cardin/opencode-tavily-quota).
It adds pooled-quota support, a Chinese sidebar, per-key detail, and a
credential-precedence fix. If a change applies upstream, consider offering it
there too — it will reach more people.

## Development

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build      # writes dist/, which is gitignored
```

Requirements: Node >= 22 (developed on 24).

`npm test` runs both suites:

- `usage.test.ts` — quota math, key resolution, `{file:...}` expansion, proxy
  mode, `/api/keys` degradation. Pure functions plus a mocked `fetch`; no
  network and no real credentials.
- `index.test.ts` — the server-side RPC entrypoint.

## Layout

```
index.ts         server entrypoint: registers the quota RPC
rpc.ts           shared RPC definition (only quota data crosses it)
tui.tsx          TUI entrypoint: sidebar slot, refresh button, /tavily-quota
usage.ts         key resolution, HTTP, derivation, formatting (no TUI imports)
scripts/build.mjs
dist/            build output, not committed
```

`usage.ts` deliberately imports nothing from OpenCode or OpenTUI so it stays
testable in isolation. Please keep it that way.

## When changing behaviour

- Add or update a test in `usage.test.ts`. The exotic paths (`{file:...}`,
  proxy 401, `/api/keys` 404) are exactly the ones that break silently.
- Update `README.md` if an option, command, or the rendered output changes.
- If you touch credential handling, read `SECURITY.md` first. Two properties must
  hold: the key never leaves the process except as a request header to the
  configured endpoint, and a rejected credential is never presented as success.

## Builds and the local patch

Earlier versions of this fork required running a `patch-usage.mjs` shim after
every build, because the key-precedence fix lived only in `dist/`. That fix is
now in `usage.ts` (see `resolveApiKey`'s `pooled` flag), so a plain
`npm run build` is sufficient. The shim belongs to the maintainer's local
deployment and is **not** part of this repository.

## Commits

Conventional Commits (`fix:`, `feat:`, `docs:`, `chore:`) with a body that says
what changed and why. One logical change per commit.
