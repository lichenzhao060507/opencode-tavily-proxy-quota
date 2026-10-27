# Changelog

All notable changes to this fork. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow the
upstream package version until this fork diverges meaningfully.

## [Unreleased]

### Added

- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1) and a pull request template,
  filling the gaps in GitHub's community profile.
- `publish.yml` now checks for the `NPM_TOKEN` secret before publishing and, when
  it is absent, skips with an actionable job summary instead of failing with a
  bare `ENEEDAUTH`.
- Dependabot version updates for npm are disabled (`open-pull-requests-limit: 0`).
  `@opentui/solid` pins `solid-js` exactly, so automated bumps of one without the
  other always fail; two of the three PRs this repo received were that. Security
  updates stay enabled. Workflow actions still get monthly bumps.

## [1.3.2] — 2026-10-27

Distribution only — no behaviour change.

### Added

- `tui.ts` at the repo root. OpenCode loads a directory plugin from entry files
  at the plugin root and does not read `package.json` exports in that mode, so
  without this file a path install reported `features: { server: true }` only
  and the sidebar never rendered.
- `publish.yml`, a manual npm publish workflow (needs an `NPM_TOKEN` secret).

### Changed

- `dist/` is committed instead of ignored, so a clone needs no babel build —
  only `npm install --omit=dev --ignore-scripts` for the runtime packages the
  host does not inject. A bare clone without `node_modules` does not load:
  `@opencode/plugin` and `@opentui/solid` must resolve from the plugin directory.
  CI rebuilds and fails if the committed output drifts from the source.
- README install section documents all three routes: local clone (no build),
  GitHub package (builds on install), npm.

## [1.3.1] — 2026-10-26

### Changed

- The sidebar's bottom line now labels its leading figure: `可用6085/19000 ·
  最后 #19 · 3 个耗尽` instead of a bare `6085/19000`. English uses
  `6085/19000 left` to match the `32% left` bar above and stay within 36
  columns. The label consumes the 3-column headroom that line had; a test now
  asserts it against the sidebar width exactly, in both locales.

## [1.3.0] — 2026-10-26

### Added

- **Details button** in the sidebar, between Refresh and the reset countdown.
  It opens the per-key breakdown as a toast — the same view as
  `/tavily-quota` — without triggering a Tavily sync, so it is instant.
- **English UI** alongside Chinese. Pick with the new `locale` option
  (`auto` / `zh` / `en`); `auto` reads `LC_ALL`/`LANG` then the OS locale and
  falls back to Chinese. Label widths are derived per locale, so both builds
  stay on the 36-column sidebar.

### Changed

- `/tavily-quota` and the palette command now show the detail view instead of
  forcing a sync. Refresh is the button that syncs.
- `usage.ts` formatters take an optional `locale`; the default stays Chinese, so
  existing behaviour is unchanged.
- `scripts/build.mjs` also emits `dist/i18n.js`.

## [1.2.0] — 2026-10-26

Refreshing was slow and quietly wrong. Both are fixed.

### Fixed

- **Manual refresh no longer freezes the sidebar for 10–20 s.** It paints the
  proxy's cached numbers first (measured ~50 ms warm), then runs the Tavily
  sync in the background and repaints when it finishes.
- **A failed sync is no longer reported as success.** The proxy marks the job
  `completed` even when every key came back `429`; the plugin now reads
  `succeeded`/`failed` as well. On failure the sidebar shows
  `⚠ 同步失败 19/19，数字为缓存` and the toast carries the first upstream error.
- **Proxy mode polls every 60 s** instead of every 10 minutes. Direct mode keeps
  the 10-minute interval because `api.tavily.com/usage` allows 10 requests per
  10 minutes; `<proxyUrl>/api/stats` is local, so that limit does not apply.

### Changed

- `syncProxyUsage` returns a `SyncOutcome`
  (`completed` / `partial` / `failed` / `timeout` / `unavailable`) instead of a
  boolean, and no longer treats "job finished" as "keys refreshed".
- `fetchQuota` attaches that outcome as `result.sync` when `sync: true`.

### Notes

A refresh re-reads every key's `/usage` on Tavily, one key at a time — with a
~20-key pool that is ~19 upstream requests per click. Several refreshes in quick
succession trip Tavily's rate limit (`429`), after which syncs fail until the
window resets. The proxy's own auto-sync is the primary source of freshness;
treat the button as a manual override, not a polling mechanism.

## [1.1.1] — 2026-10-26

Security and correctness hardening after a local audit.

### Fixed

- **Key precedence in proxy mode.** `resolveApiKey` now takes an explicit
  `pooled` flag from its caller instead of re-deriving pooled mode from
  `options.proxyUrl`. Previously, if `TAVILY_API_KEY` was set (a raw `tvly-`
  key) it would preempt the proxy master key and the proxy would answer 401.
  The fix no longer depends on `proxyUrl` being threaded through every caller.
- **`{file:...}` could read arbitrary files.** Contents containing whitespace or
  newlines, or longer than 512 characters, are now rejected, so a file
  reference cannot ship a multi-line secret (SSH key, `.env`) as a Bearer token.
- **`/api/keys` 401/403 was invisible.** It now degrades to a visible warning
  (`snapshot.poolWarning`, rendered as `⚠`) instead of silently showing pool
  numbers that may be stale. `404`/timeouts still degrade silently, as before.
- **`syncProxyUsage` timeout.** The remaining budget is recomputed each poll
  instead of using a 1000 ms floor, so the sync deadline is honoured.

### Added

- CI workflow: typecheck, tests, build, and a dist syntax check on Node 24.
- Issue forms (bug report / feature request), Dependabot config.
- `SECURITY.md`, `CONTRIBUTING.md`, `.gitattributes`, this changelog.
- 5 regression tests (57 → 62): pooled precedence, proxy-mode bearer token,
  multi-line and oversized file references, and `/api/keys` 401.

### Changed

- `package.json` repository/bugs/homepage point at this fork.
- The local `patch-usage.mjs` shim (maintainer's deployment, not part of this
  repository) is now a compatibility no-op that recognises the fixed source.

## Fork-specific features (before 1.1.1)

- Pooled quota from `<proxyUrl>/api/stats`, with per-key breakdown from
  `/api/keys` and on-demand sync via `/api/keys/sync`.
- Chinese sidebar and detail view; display-width-aware label alignment.
- Clickable "刷新额度" button in the sidebar.
