# Changelog

All notable changes to this fork. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow the
upstream package version until this fork diverges meaningfully.

## [Unreleased]

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
