# Changelog

All notable changes to this fork. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow the
upstream package version until this fork diverges meaningfully.

## [Unreleased]

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
