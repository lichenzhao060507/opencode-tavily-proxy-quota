# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Use GitHub's private reporting instead:
[Security → Report a vulnerability](https://github.com/lichenzhao060507/opencode-tavily-proxy-quota/security/advisories/new).

If that is unavailable, open an issue that says only that you have a security
report and how to reach you — no details, no proof of concept.

Expect an initial reply within about a week. This is a personal fork maintained
on a best-effort basis, not a funded project; there is no bug bounty.

## Scope

This plugin runs inside your OpenCode process and handles a credential. The
parts that matter:

- **Credential handling.** The Tavily key (or the TavilyProxyManager master key)
  is read from `TAVILY_API_KEY`, the `apiKey` plugin option, or OpenCode's saved
  Tavily integration. It is never logged, never rendered in the sidebar, and
  never sent over the plugin RPC boundary — only quota numbers cross it.
- **`{file:...}` references.** A file reference is treated as a credential: its
  contents are rejected if they contain whitespace/newlines or exceed 512
  characters, so the option cannot be pointed at a multi-line secret.
- **Proxy mode.** With `proxyUrl` set the plugin talks only to that proxy and
  never to `api.tavily.com`.
- **`/api/keys`.** When the proxy rejects the credential (401/403) the sidebar
  says so instead of showing stale numbers.

Out of scope: the TavilyProxyManager itself, OpenCode's own credential storage,
and anything that requires an attacker to already control your configuration
file or your machine.

## Hardening notes

The 2026-10-26 audit that produced the current behaviour is recorded in
[CHANGELOG.md](CHANGELOG.md) under `1.1.1`. In short: an explicit `pooled` flag
for key precedence, a credential-shape guard on `{file:...}`, and a visible
warning when `/api/keys` authentication fails.
