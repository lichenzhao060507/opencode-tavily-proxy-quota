/**
 * Tavily quota client for the sidebar plugin.
 *
 * Pure formatting/derivation helpers are split from the single network call so
 * they can be unit tested without touching the network, real credentials, or
 * the OpenCode runtime. Node builtins only; no OpenCode or OpenTUI imports.
 *
 * The `apiKey` plugin option may be a literal key or an `{env:NAME}` /
 * `{file:PATH}` reference. OpenCode expands those references in
 * `opencode.json(c)` but not in `cli.json`, so this module expands them itself.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { messages, type Locale } from "./i18n";

export const USAGE_URL = "https://api.tavily.com/usage";
/**
 * Path the TavilyProxyManager (https://github.com/xuncv/TavilyProxyManager)
 * exposes to report quota summed across every key in its pool. Used when the
 * `proxyUrl` option is set, instead of a single account's `/usage`.
 */
export const PROXY_STATS_PATH = "/api/stats";
/**
 * LOCAL FORK: per-key breakdown.
 *
 * Not part of the upstream TavilyProxyManager contract the plugin targets --
 * `/api/stats` is the documented surface and `/api/keys` is an extra this proxy
 * happens to expose. Every caller must treat it as optional: a 404 (or any
 * failure) degrades to "no pool detail" rather than an error, so the plugin
 * still works against a proxy that only serves `/api/stats`.
 */
export const PROXY_KEYS_PATH = "/api/keys";
/**
 * LOCAL FORK: ask the proxy to re-read every key's usage from Tavily's
 * `/usage` endpoint. The proxy runs this as a background job; the same path
 * reports its status with GET. This is the only way to align the pooled
 * `used_quota` with Tavily's credit accounting, because `/api/stats` otherwise
 * returns whatever the proxy last counted.
 */
export const PROXY_SYNC_PATH = "/api/keys/sync";
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_SYNC_TIMEOUT_MS = 60_000;
const SYNC_POLL_MS = 500;

/**
 * Sidebar content width shared with the built-in quota section, which renders
 * in a 36-column sidebar (`TUI_SIDEBAR_MAX_WIDTH` in opencode-quota).
 */
export const SIDEBAR_WIDTH = 36;
/**
 * Width the quota section reserves for its `100% 剩余` label, so labels line up
 * vertically across sections. `100% 剩余` is 4 + 1 + 4 = 9 terminal cells.
 */
export const PERCENT_COLUMN_WIDTH = 9;
/** Gap between the bar and its label, matching the quota section's separator. */
export const BAR_SEPARATOR = "  ";
/**
 * Bar width that lines the Tavily bar up with the quota section's bars:
 * `36 (sidebar) − 2 (separator) − 9 (percent column) = 25`.
 */
export const DEFAULT_BAR_WIDTH = SIDEBAR_WIDTH - BAR_SEPARATOR.length - PERCENT_COLUMN_WIDTH;

/**
 * Widest label the right-hand column has to hold.
 *
 * Chinese `100% 剩余` is 9 cells (two full-width glyphs); English `16/19 keys`
 * is 10. Everything else stays inside those, so the column is a per-locale
 * constant rather than a single number.
 */
export function percentColumnWidth(locale: Locale = "zh"): number {
  return locale === "en" ? 10 : PERCENT_COLUMN_WIDTH;
}

/** Bar width that leaves exactly one label column, for the given locale. */
export function barWidthFor(locale: Locale = "zh"): number {
  return SIDEBAR_WIDTH - BAR_SEPARATOR.length - percentColumnWidth(locale);
}

/** Shape of `GET https://api.tavily.com/usage` (all fields optional). */
export interface TavilyUsagePayload {
  key?: {
    usage?: number | null;
    limit?: number | null;
  } | null;
  account?: {
    current_plan?: string | null;
    plan_usage?: number | null;
    plan_limit?: number | null;
    paygo_usage?: number | null;
    paygo_limit?: number | null;
  } | null;
}

/** Shape of `GET <proxyUrl>/api/stats` from TavilyProxyManager (optional fields). */
export interface TavilyProxyStatsPayload {
  /** Credits included across every pooled key this cycle. */
  total_quota?: number | null;
  /** Credits already consumed across the pool. */
  total_used?: number | null;
  /** Credits still available across the pool. */
  total_remaining?: number | null;
  /** Number of keys in the pool. */
  key_count?: number | null;
  /** Number of keys currently active (not disabled/exhausted). */
  active_key_count?: number | null;
  /** Requests served today (informational). */
  today_requests?: number | null;
}

export interface QuotaSnapshot {
  /** Plan name reported by Tavily, e.g. `Researcher`. */
  planName: string;
  /** Credits consumed this billing cycle. */
  used: number;
  /** Credits included this billing cycle. */
  limit: number;
  /** Credits still available (`limit - used`, never negative). */
  remaining: number;
  /** `remaining / limit` as a percentage in `[0, 100]`. */
  percentRemaining: number;
  /** Milliseconds since epoch when the snapshot was produced. */
  updatedAt: number;
  /**
   * LOCAL FORK: per-key breakdown, only present in `proxyUrl` mode and only
   * when the proxy served `/api/keys`. Absent means "unknown", not "none".
   */
  pool?: PoolInfo;
  /**
   * LOCAL FORK: set when `/api/keys` answered 401/403, i.e. the master key was
   * rejected. The headline quota can still render from `/api/stats` (which may
   * be a cached value), so this is surfaced as a warning line rather than an
   * error: the key problem must not be invisible.
   */
  poolWarning?: string;
}

/** LOCAL FORK: one pooled key as reported by `<proxyUrl>/api/keys`. */
export interface PoolKey {
  /** Stable numeric id assigned by the proxy. Rendered as `#<id>`. */
  id: number;
  /** Human label, e.g. `tavily-8`. May carry a `(exhausted)` suffix. */
  alias: string;
  /** Credits consumed by this key. */
  used: number;
  /** Credits included for this key. */
  quota: number;
  /** Proxy still schedules this key. */
  active: boolean;
  /** Proxy marked this key unusable (bad credentials, etc.). */
  invalid: boolean;
  /** Epoch ms of the last real Tavily call, or null if it has never been used. */
  lastUsedAt: number | null;
}

/** LOCAL FORK: aggregate view over the pooled keys. */
export interface PoolInfo {
  keys: PoolKey[];
  /** Keys in the pool. */
  total: number;
  /** Keys with no credits left. */
  exhausted: number;
  /** Keys still able to serve a request. */
  live: number;
  /**
   * Most recently used key, or null when nothing has been used yet.
   *
   * This is "the key the last real call went through", NOT the proxy's internal
   * rotation cursor -- the proxy exposes no such cursor. Say "last used", never
   * "current".
   */
  lastUsed: PoolKey | null;
}

export type QuotaResult =
  | { ok: true; snapshot: QuotaSnapshot; sync?: SyncOutcome }
  | { ok: false; message: string };

export interface FetchQuotaOptions {
  /** Environment to read `TAVILY_API_KEY` from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Key supplied as a plugin option (e.g. from `cli.json`). */
  apiKey?: string;
  /**
   * Base URL of a running TavilyProxyManager, e.g. `http://127.0.0.1:27890`.
   * When set, quota is read from `<proxyUrl>/api/stats` (summed across the
   * pool) instead of a single key's `/usage`, and `apiKey` is sent as the proxy
   * master key.
   */
  proxyUrl?: string;
  /** File reader for `{file:...}` references in `apiKey`. Injected by tests. */
  readFile?: (path: string) => string;
  /** Home directory for `~/` in `{file:...}`. Injected by tests. */
  home?: string;
  /** Base directory for relative `{file:...}` paths. Injected by tests. */
  cwd?: string;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
  /** Ask the proxy to sync official usage before reading stats. */
  sync?: boolean;
  /** Budget for the whole proxy sync job, in milliseconds. */
  syncTimeoutMs?: number;
  /** Injectable fetch, used by tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable clock, used by tests. Defaults to `Date.now`. */
  now?: number;
  /** Language for user-facing messages. Defaults to Chinese. */
  locale?: Locale;
}

/** Prefer CLI credentials; ask the server only when the CLI has no key. */
export async function fetchQuotaWithFallback(
  options: FetchQuotaOptions & { remote: () => Promise<QuotaResult> },
): Promise<QuotaResult> {
  try {
    const pooled = (options.proxyUrl ?? "").trim() !== "";
    const key = resolveApiKey(options.env, options.apiKey, { ...options, pooled });
    if (key) return fetchQuota({ ...options, apiKey: key, env: {} });
  } catch {
    // Preserve the existing inline error for an unreadable {file:...} option.
    return fetchQuota(options);
  }
  try {
    return await options.remote();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: messages(options.locale ?? "zh").credUnavailable(reason) };
  }
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * `{env:NAME}` and `{file:PATH}` references accepted in the `apiKey` option.
 * This mirrors the references OpenCode expands in `opencode.json(c)`, but the
 * expansion lives here because `cli.json` passes plugin options through
 * verbatim.
 */
export interface ExpandOptions {
  /** Environment used by `{env:NAME}`. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Reads a file as UTF-8. Defaults to `readFileSync`. Injected by tests. */
  readFile?: (path: string) => string;
  /** Home directory for `~/`. Defaults to `os.homedir()`. */
  home?: string;
  /** Base directory for relative paths. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Language for error messages. Defaults to Chinese. */
  locale?: Locale;
}

const OPTION_REFERENCE = /\{(env|file):([^}]+)\}/g;

/**
 * Longest credential accepted from a `{file:...}` reference. API tokens are
 * short; anything longer is almost certainly not a key and is refused rather
 * than shipped as a Bearer token.
 */
const MAX_CREDENTIAL_LENGTH = 512;

/**
 * Expand every `{env:NAME}` and `{file:PATH}` reference in a plugin option.
 *
 * `{env:NAME}` reads an environment variable (empty string when unset).
 * `{file:PATH}` reads a file's trimmed contents; `~/` expands to the home
 * directory and relative paths resolve against `cwd`. Unreadable files throw
 * with the offending reference and resolved path.
 */
export function expandOptionValue(value: string, options: ExpandOptions = {}): string {
  const env = options.env ?? process.env;
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  const home = options.home ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  const m = messages(options.locale ?? "zh");

  return value.replace(OPTION_REFERENCE, (match, kind: string, body: string) => {
    if (kind === "env") return env[body] ?? "";

    const raw = body.trim();
    const path =
      raw === "~"
        ? home
        : raw.startsWith("~/")
          ? join(home, raw.slice(2))
          : isAbsolute(raw)
            ? raw
            : resolve(cwd, raw);
    let contents: string;
    try {
      contents = readFile(path).trim();
    } catch (cause) {
      throw new Error(m.fileReadFailed(match, path), { cause });
    }
    // A credential is a single short token. Refusing anything else stops a
    // `{file:...}` option from being pointed at an arbitrary multi-line secret
    // (an SSH private key, a .env, a cookie DB dump) and having its contents
    // sent out as a `Authorization: Bearer <contents>` header.
    if (contents.length > MAX_CREDENTIAL_LENGTH) {
      throw new Error(m.fileTooLong(match, path, contents.length, MAX_CREDENTIAL_LENGTH));
    }
    if (/\s/.test(contents)) {
      throw new Error(m.fileMultiline(match, path));
    }
    return contents;
  });
}

/**
 * Resolve the Tavily API key: `TAVILY_API_KEY` first, then the `apiKey` plugin
 * option configured in `cli.json`. Reference values such as
 * `{file:~/.secrets/tavily-api-key}` are expanded here (see
 * `expandOptionValue`), since `cli.json` does not expand them itself. Never
 * logs or returns the key beyond the caller.
 */
export function resolveApiKey(
  env: Record<string, string | undefined> = process.env,
  apiKey?: string,
  options: Omit<ExpandOptions, "env"> & { pooled?: boolean } = {},
): string {
  // When `pooled` is set the caller explicitly wants pooled quota, so `apiKey`
  // holds the proxy MASTER key. `TAVILY_API_KEY` is a raw `tvly-` key and must
  // not preempt it: sending one to `<proxyUrl>/api/stats` yields a 401.
  //
  // The flag is passed in explicitly instead of being re-derived from
  // `options.proxyUrl` here. That keeps this function's contract at
  // `(env, apiKey, options)` and stops the precedence fix from silently
  // regressing if a caller ever stops threading `proxyUrl` down to it.
  const fromEnv = options.pooled ? "" : (env.TAVILY_API_KEY ?? "").trim();
  if (fromEnv) return fromEnv;
  const raw = (apiKey ?? "").trim();
  if (!raw) return "";
  return expandOptionValue(raw, { ...options, env }).trim();
}

/**
 * Derive the headline credit quota from a `/usage` payload.
 *
 * Prefers the account plan (`plan_limit`/`plan_usage`) because a per-key limit
 * is often `null` while the account still has a monthly allowance. Falls back
 * to the key limit when no positive plan limit is reported.
 */
export function deriveSnapshot(
  payload: TavilyUsagePayload,
  now: number = Date.now(),
  locale: Locale = "zh",
): QuotaResult {
  const account = payload.account ?? {};
  const key = payload.key ?? {};

  const planLimit = finite(account.plan_limit);
  const planUsage = finite(account.plan_usage);
  const keyLimit = finite(key.limit);
  const keyUsage = finite(key.usage);

  const usePlan = planLimit !== null && planLimit > 0;
  const limit = usePlan ? planLimit : keyLimit;
  const used = usePlan ? planUsage ?? 0 : keyUsage ?? 0;

  if (limit === null || limit <= 0) {
    return { ok: false, message: messages(locale).noLimitForKey };
  }

  const remaining = Math.max(0, limit - used);
  const planName =
    typeof account.current_plan === "string" && account.current_plan.trim()
      ? account.current_plan.trim()
      : "Tavily";

  return {
    ok: true,
    snapshot: {
      planName,
      used,
      limit,
      remaining,
      percentRemaining: (remaining / limit) * 100,
      updatedAt: now,
    },
  };
}

/**
 * Build the `<proxyUrl>/api/stats` URL, tolerating trailing slashes so both
 * `http://host:27890` and `http://host:27890/` work.
 */
export function proxyStatsUrl(proxyUrl: string): string {
  return `${proxyUrl.trim().replace(/\/+$/, "")}${PROXY_STATS_PATH}`;
}

/**
 * Derive the pooled quota from a TavilyProxyManager `/api/stats` payload.
 *
 * `total_quota` is the sum of every key's allowance, so the sidebar shows the
 * whole pool rather than whichever single key the proxy happened to pick.
 * Falls back to `total_quota - total_used` when `total_remaining` is absent.
 */
export function deriveProxySnapshot(
  payload: TavilyProxyStatsPayload,
  now: number = Date.now(),
  locale: Locale = "zh",
): QuotaResult {
  const m = messages(locale);
  const limit = finite(payload.total_quota);
  const used = finite(payload.total_used);
  const remainingRaw = finite(payload.total_remaining);

  if (limit === null || limit <= 0) {
    return { ok: false, message: m.proxyNoPoolQuota };
  }

  const remaining = Math.max(0, remainingRaw ?? limit - (used ?? 0));
  const consumed = Math.max(0, used ?? limit - remaining);
  const keyCount = finite(payload.key_count);
  const planName =
    keyCount !== null && keyCount > 0 ? m.poolNameWithCount(keyCount) : m.poolName;

  return {
    ok: true,
    snapshot: {
      planName,
      used: consumed,
      limit,
      remaining,
      percentRemaining: (remaining / limit) * 100,
      updatedAt: now,
    },
  };
}

/**
 * LOCAL FORK: build the `<proxyUrl>/api/keys` URL, tolerating trailing slashes
 * exactly like `proxyStatsUrl`.
 */
export function proxyKeysUrl(proxyUrl: string): string {
  return `${proxyUrl.trim().replace(/\/+$/, "")}${PROXY_KEYS_PATH}`;
}

/** LOCAL FORK: build the `<proxyUrl>/api/keys/sync` URL. */
export function proxySyncUrl(proxyUrl: string): string {
  return `${proxyUrl.trim().replace(/\/+$/, "")}${PROXY_SYNC_PATH}`;
}

/** Shape of the proxy's sync job status (every field optional). */
export interface ProxySyncStatus {
  id?: string;
  status?: string;
  total?: number;
  completed?: number;
  succeeded?: number;
  failed?: number;
  error?: string;
  items?: { id?: number; alias?: string; status?: string; error?: string }[] | null;
}

/**
 * LOCAL FORK: what one sync attempt actually achieved.
 *
 * The proxy reports `status: "completed"` even when every key failed (a 429
 * from Tavily, for instance), so the job status alone is not success.
 * `succeeded`/`failed` have to be read too — a caller that only checks
 * `completed` presents a failed sync as a good one, and the sidebar then shows
 * frozen numbers with no hint that they are stale.
 */
export interface SyncOutcome {
  kind: "completed" | "partial" | "failed" | "timeout" | "unavailable";
  /** Keys the proxy tried to refresh. */
  total: number;
  succeeded: number;
  failed: number;
  elapsedMs: number;
  /** First distinct per-key upstream error, collapsed to one line. */
  error?: string;
}

/** Collapse the per-key errors to the first one, short enough for a toast. */
function firstSyncError(items: ProxySyncStatus["items"]): string | undefined {
  if (!Array.isArray(items)) return undefined;
  for (const item of items) {
    const raw = typeof item?.error === "string" ? item.error.trim() : "";
    if (!raw) continue;
    const oneLine = raw.replace(/\s+/g, " ");
    return oneLine.length > 120 ? `${oneLine.slice(0, 117)}...` : oneLine;
  }
  return undefined;
}

function classifySync(status: ProxySyncStatus, elapsedMs: number): SyncOutcome {
  const total = finite(status.total) ?? 0;
  const succeeded = finite(status.succeeded) ?? 0;
  const failed = finite(status.failed) ?? Math.max(0, total - succeeded);
  const base = { total, succeeded, failed, elapsedMs, error: firstSyncError(status.items) };
  if (status.status !== "completed") return { kind: "timeout", ...base };
  if (total > 0 && failed >= total) return { kind: "failed", ...base };
  if (failed > 0) return { kind: "partial", ...base };
  return { kind: "completed", ...base };
}

/**
 * LOCAL FORK: ask the proxy to re-read every key's usage from Tavily's
 * `/usage`, then wait for the shared background job to finish.
 *
 * Never throws. The outcome distinguishes "the job finished" from "the keys
 * were refreshed", which is what a caller actually needs.
 *
 * This takes ~10–20 s for a pool of ~20 keys because the proxy refreshes them
 * one at a time, so callers should not block the first paint on it.
 */
export async function syncProxyUsage(
  proxyUrl: string,
  key: string,
  options: FetchQuotaOptions = {},
): Promise<SyncOutcome> {
  const startedAt = Date.now();
  const m = messages(options.locale ?? "zh");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS;
  const deadline = startedAt + timeoutMs;
  const url = proxySyncUrl(proxyUrl);
  const elapsed = () => Date.now() - startedAt;
  const unavailable = (error: string): SyncOutcome => ({
    kind: "unavailable",
    total: 0,
    succeeded: 0,
    failed: 0,
    elapsedMs: elapsed(),
    error,
  });

  const readStatus = async (response: Response): Promise<ProxySyncStatus | null> => {
    if (!response.ok) return null;
    try {
      return (await response.json()) as ProxySyncStatus;
    } catch {
      return null;
    }
  };

  let status: ProxySyncStatus | null = null;
  try {
    status = await readStatus(
      await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(Math.min(15_000, timeoutMs)),
      }),
    );
  } catch {
    return unavailable(m.syncNotDelivered);
  }
  if (!status) return unavailable(m.syncNotDelivered);

  while (status.status === "running") {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return classifySync(status, elapsed());
    await new Promise((resolve) => setTimeout(resolve, Math.min(SYNC_POLL_MS, remaining)));
    const budget = deadline - Date.now();
    if (budget <= 0) return classifySync(status, elapsed());
    try {
      status = await readStatus(
        await fetchImpl(url, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(budget),
        }),
      );
    } catch {
      return unavailable(m.syncNotDelivered);
    }
    if (!status) return unavailable(m.syncNotDelivered);
  }
  return classifySync(status, elapsed());
}

/** LOCAL FORK: one entry of `<proxyUrl>/api/keys` (every field optional). */
export interface TavilyProxyKeysPayload {
  items?:
    | (Partial<PoolKey> & {
        total_quota?: number | null;
        used_quota?: number | null;
        /** SQLite 0/1 or JSON boolean. */
        is_active?: boolean | number | null;
        is_invalid?: boolean | number | null;
        last_used_at?: string | null;
      })[]
    | null;
}

/** Proxies report booleans as `true`/`false` or as SQLite's `1`/`0`. */
function truthyFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return false;
}

function timestampOf(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * LOCAL FORK: derive the per-key pool view from a `/api/keys` payload.
 *
 * Returns `undefined` for anything that is not a usable key list, so callers can
 * treat "no breakdown" as a normal outcome rather than an error.
 */
export function derivePoolInfo(payload: TavilyProxyKeysPayload): PoolInfo | undefined {
  const items = payload?.items;
  if (!Array.isArray(items) || items.length === 0) return undefined;

  const keys: PoolKey[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const quota = finite(raw.total_quota ?? raw.quota);
    const used = finite(raw.used_quota ?? raw.used);
    if (quota === null && used === null) continue;
    keys.push({
      id: finite(raw.id) ?? -1,
      alias: typeof raw.alias === "string" && raw.alias.trim() ? raw.alias.trim() : `key ${raw.id}`,
      used: used ?? 0,
      quota: quota ?? 0,
      active: truthyFlag(raw.is_active ?? raw.active),
      invalid: truthyFlag(raw.is_invalid ?? raw.invalid),
      lastUsedAt: timestampOf(raw.last_used_at ?? raw.lastUsedAt),
    });
  }
  if (keys.length === 0) return undefined;

  // Oldest first so the sidebar reads key 1 -> key 9 top to bottom.
  keys.sort((a, b) => a.id - b.id);

  const exhausted = keys.filter((key) => key.quota > 0 && key.used >= key.quota).length;
  const live = keys.filter((key) => !key.invalid && key.quota > 0 && key.used < key.quota).length;

  // "Last used" is the newest `last_used_at`. Keys never used sort last.
  let lastUsed: PoolKey | null = null;
  for (const key of keys) {
    if (key.lastUsedAt === null) continue;
    if (lastUsed === null || lastUsed.lastUsedAt === null || key.lastUsedAt > lastUsed.lastUsedAt) {
      lastUsed = key;
    }
  }

  return { keys, total: keys.length, exhausted, live, lastUsed };
}

/** Format a remaining percentage for the sidebar. */
export function formatPercent(percentRemaining: number): string {
  const clamped = Math.max(0, Math.min(100, percentRemaining));
  return `${clamped.toFixed(clamped >= 10 ? 0 : 1)}%`;
}

/**
 * Terminal cells occupied by `text`. CJK characters and full-width punctuation
 * take two cells; `String#length` would undercount them and break the sidebar's
 * right-aligned label column.
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    width +=
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
        ? 2
        : 1;
  }
  return width;
}

function padStartDisplay(text: string, width: number): string {
  const diff = width - displayWidth(text);
  return diff > 0 ? " ".repeat(diff) + text : text;
}

/** Render a fixed-width progress bar for a remaining percentage. */
export function progressBar(percentRemaining: number, width = DEFAULT_BAR_WIDTH): string {
  const clamped = Math.max(0, Math.min(100, percentRemaining));
  const safeWidth = Math.max(1, Math.floor(width));
  const filled = Math.round((clamped / 100) * safeWidth);
  return "█".repeat(filled) + "░".repeat(Math.max(0, safeWidth - filled));
}

/**
 * Compose the single sidebar line: the bar plus a `84% left` label.
 *
 * The bar matches the built-in quota section's bars and the label sits in the
 * same right-aligned percent column, so the two sections line up. The exact
 * credit count is still available from `formatRemaining` (used by the toast).
 */
export function formatQuotaLine(
  snapshot: QuotaSnapshot,
  width?: number,
  locale: Locale = "zh",
): string {
  const m = messages(locale);
  const label = m.quotaLeft(formatPercent(snapshot.percentRemaining));
  const w = width ?? barWidthFor(locale);
  return `${progressBar(snapshot.percentRemaining, w)}${BAR_SEPARATOR}${padStartDisplay(label, percentColumnWidth(locale))}`;
}

/** Format the headline line, e.g. `剩余 839 额度` / `839 credits left`. */
export function formatRemaining(snapshot: QuotaSnapshot, locale: Locale = "zh"): string {
  return messages(locale).creditsLeft(snapshot.remaining);
}

/* ------------------------------------------------------------------ *
 * LOCAL FORK: pool rendering.
 *
 * The sidebar is 36 columns. `DEFAULT_BAR_WIDTH` (25) plus the 2-space
 * separator plus the 9-char percent column already fills it exactly, so the
 * pool bar reuses both widths to stay flush with the quota bar above it.
 * ------------------------------------------------------------------ */

/** Fill char for the per-key bar, so it never reads as the credit bar. */
const POOL_FILL = "▓";

/** `#8` from a key id. */
function keyTag(key: PoolKey): string {
  return `#${key.id}`;
}

/**
 * LOCAL FORK: the per-key bar line, e.g.
 * `[███████▓▓▓░░░░░░░░░░░░░░░]  8/9 个`.
 *
 * One cell is roughly one key; filled cells are keys that can still serve a
 * request. Returns an empty string when there is no pool detail, so callers can
 * filter it out.
 */
export function formatPoolLine(
  pool: PoolInfo | undefined,
  width?: number,
  locale: Locale = "zh",
): string {
  if (!pool || pool.total === 0) return "";
  const safeWidth = Math.max(1, Math.floor(width ?? barWidthFor(locale)));
  const filled = Math.round((pool.live / pool.total) * safeWidth);
  const bar = POOL_FILL.repeat(filled) + "░".repeat(Math.max(0, safeWidth - filled));
  const label = messages(locale).keysFraction(pool.live, pool.total);
  return `${bar}${BAR_SEPARATOR}${padStartDisplay(label, percentColumnWidth(locale))}`;
}

/**
 * LOCAL FORK: the line under the pool bar, e.g.
 * `6648/9000 · last #8 · 1 spent`.
 *
 * Leads with absolute credits because the percentage alone cannot tell you how
 * much a month is actually worth. Kept at 29 columns so there is headroom for
 * the totals to grow (a 10th key widens `6648/9000` to `6648/10000`) before it
 * would clip the 36-column sidebar.
 *
 * Wording is deliberate: the proxy exposes no rotation cursor, so this reports
 * the last key a real call went through, not a "current" one. The reset
 * countdown is deliberately omitted -- `formatResetLine` already sits above the
 * quota bar and repeating it here would just burn sidebar width.
 */
export function formatPoolTailLine(snapshot: QuotaSnapshot, locale: Locale = "zh"): string {
  const m = messages(locale);
  const pool = snapshot.pool;
  if (!pool || pool.total === 0) return "";
  const parts: string[] = [`${snapshot.remaining}/${snapshot.limit}`];
  if (pool.lastUsed) parts.push(m.lastUsed(keyTag(pool.lastUsed)));
  else parts.push(m.unused);
  if (pool.exhausted > 0) parts.push(m.exhaustedCount(pool.exhausted));
  return parts.join(" · ");
}

/** LOCAL FORK: one per-key row for the `/tavily-quota` detail view. */
export function formatPoolKeyLine(key: PoolKey, width = 10, locale: Locale = "zh"): string {
  const m = messages(locale);
  const safeWidth = Math.max(1, Math.floor(width));
  const percent = key.quota > 0 ? (key.used / key.quota) * 100 : 0;
  const filled = Math.round((percent / 100) * safeWidth);
  const bar = POOL_FILL.repeat(Math.min(safeWidth, filled)) + "░".repeat(Math.max(0, safeWidth - filled));
  const amounts = `${key.used}/${key.quota}`;
  const spent = key.quota > 0 && key.used >= key.quota;
  const tags = [spent ? m.spentTag : key.invalid ? m.invalidTag : null].filter(Boolean).join(" ");
  const tail = `${amounts}${tags ? `  ${tags}` : ""}`;
  return `${keyTag(key).padStart(3)} ${bar}  ${tail}`;
}

/**
 * LOCAL FORK: the multi-line breakdown shown by `/tavily-quota`.
 *
 * Falls back to the single-line summary when the proxy did not serve
 * `/api/keys`, so the command still works against a stats-only proxy.
 */
export function formatPoolDetailLines(
  snapshot: QuotaSnapshot,
  now: number = Date.now(),
  locale: Locale = "zh",
): string[] {
  const m = messages(locale);
  const head = m.detailHead(
    snapshot.remaining,
    snapshot.limit,
    formatPercent(snapshot.percentRemaining),
    formatResetCountdown(nextMonthlyResetAt(now), now, locale),
  );
  const pool = snapshot.pool;
  if (!pool || pool.total === 0) return [head];

  const rows = pool.keys.map((key) => {
    const line = formatPoolKeyLine(key, 10, locale);
    return pool.lastUsed?.id === key.id ? `${line}  ${m.recentlyUsed}` : line;
  });
  return [head, m.detailPoolSummary(pool.live, pool.total, pool.exhausted), "─".repeat(28), ...rows];
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * When the credit quota next resets, as epoch milliseconds.
 *
 * Tavily resets credits on the first day of each month (calendar-based, not the
 * billing date) and `/usage` does not report when. Derive it as `00:00 UTC` on
 * the 1st of the following month. Tavily does not document a reset timezone;
 * UTC is assumed (see the README).
 */
export function nextMonthlyResetAt(now: number = Date.now()): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0);
}

/**
 * Countdown to `resetAt`, e.g. `12d 4h`, `5h 12m`, or `45m`.
 *
 * Days and hours are floored so the value never overstates the time left; a
 * sub-minute remainder rounds up to `1m`, and a past reset reads `0m`.
 */
export function formatResetCountdown(
  resetAt: number,
  now: number = Date.now(),
  locale: Locale = "zh",
): string {
  const m = messages(locale);
  const diff = resetAt - now;
  if (!Number.isFinite(diff) || diff <= 0) return m.countdownNow;
  const days = Math.floor(diff / MS_PER_DAY);
  const hours = Math.floor((diff % MS_PER_DAY) / MS_PER_HOUR);
  const minutes = Math.floor((diff % MS_PER_HOUR) / MS_PER_MINUTE);
  if (days > 0) return m.countdownDays(days, hours);
  if (hours > 0) return m.countdownHours(hours, minutes);
  return m.countdownMinutes(Math.max(1, minutes));
}

/** Sidebar line for the next reset, e.g. `距重置 12天4小时`. */
export function formatResetLine(now: number = Date.now(), locale: Locale = "zh"): string {
  return messages(locale).resetLine(formatResetCountdown(nextMonthlyResetAt(now), now, locale));
}

/**
 * Fetch and derive the current Tavily quota.
 *
 * Never throws: every failure is returned as `{ ok: false, message }` so the
 * sidebar can render it inline.
 */
export async function fetchQuota(options: FetchQuotaOptions = {}): Promise<QuotaResult> {
  const locale = options.locale ?? "zh";
  const m = messages(locale);
  const proxyUrl = (options.proxyUrl ?? "").trim();
  let key: string;
  try {
    key = resolveApiKey(options.env, options.apiKey, { ...options, pooled: proxyUrl !== "" });
  } catch (error) {
    // A `{file:...}` option can point at a missing or unreadable file; surface
    // that inline instead of rejecting the sidebar render.
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  if (!key) {
    return { ok: false, message: proxyUrl ? m.missingProxyKey : m.missingKey };
  }

  // LOCAL FORK: align the proxy's cached `used_quota` with Tavily's official
  // credit accounting. This is slow (~10–20 s for a ~20-key pool) and can fail
  // per key, so the outcome is returned to the caller instead of being
  // discarded -- the TUI renders the cached numbers first and reports the
  // result afterwards.
  let syncOutcome: SyncOutcome | undefined;
  if (proxyUrl && options.sync) {
    syncOutcome = await syncProxyUsage(proxyUrl, key, options);
  }

  const endpoint = proxyUrl ? proxyStatsUrl(proxyUrl) : USAGE_URL;
  const endpointLabel = proxyUrl ? PROXY_STATS_PATH : "/usage";

  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: m.requestFailed(reason) };
  }

  if (response.status === 401) {
    return {
      ok: false,
      message: proxyUrl ? m.unauthorizedProxy : m.unauthorized,
    };
  }
  if (response.status === 429) {
    return { ok: false, message: m.rateLimited(endpointLabel) };
  }
  if (!response.ok) {
    return { ok: false, message: m.httpError(endpointLabel, response.status) };
  }

  let payload: TavilyUsagePayload | TavilyProxyStatsPayload;
  try {
    payload = (await response.json()) as TavilyUsagePayload | TavilyProxyStatsPayload;
  } catch {
    return { ok: false, message: m.invalidJson(endpointLabel) };
  }

  const derived = proxyUrl
    ? deriveProxySnapshot(payload as TavilyProxyStatsPayload, options.now, locale)
    : deriveSnapshot(payload as TavilyUsagePayload, options.now, locale);

  // LOCAL FORK: enrich proxy mode with the per-key breakdown.
  //
  // `/api/keys` is not part of the upstream proxy contract, so a 404 or a
  // timeout leaves the headline quota intact rather than replacing a working
  // sidebar with an error -- the breakdown is an extra, not a requirement.
  // A 401/403 is different: the master key was rejected, so the numbers above
  // may be stale. That case is reported as a warning instead of being hidden.
  const withSync = (result: QuotaResult): QuotaResult =>
    result.ok && syncOutcome ? { ...result, sync: syncOutcome } : result;

  if (!derived.ok || !proxyUrl) return withSync(derived);

  const pool = await fetchPoolInfo(proxyUrl, key, options);
  if (pool.kind === "ok") {
    return withSync({ ok: true, snapshot: { ...derived.snapshot, pool: pool.pool } });
  }
  if (pool.kind === "denied") {
    return withSync({
      ok: true,
      snapshot: {
        ...derived.snapshot,
        poolWarning: m.poolDenied(pool.status),
      },
    });
  }
  return withSync(derived);
}

type PoolFetch =
  | { kind: "ok"; pool: PoolInfo }
  | { kind: "absent" }
  | { kind: "denied"; status: number };

/**
 * LOCAL FORK: best-effort `<proxyUrl>/api/keys` read. Returns `absent` for
 * every failure that means "no breakdown available" (a proxy that does not
 * implement the endpoint, a timeout, malformed JSON), and `denied` when the
 * proxy explicitly rejected the credential.
 */
async function fetchPoolInfo(
  proxyUrl: string,
  key: string,
  options: FetchQuotaOptions,
): Promise<PoolFetch> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(proxyKeysUrl(proxyUrl), {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) {
      return { kind: "denied", status: response.status };
    }
    if (!response.ok) return { kind: "absent" };
    const pool = derivePoolInfo((await response.json()) as TavilyProxyKeysPayload);
    return pool ? { kind: "ok", pool } : { kind: "absent" };
  } catch {
    return { kind: "absent" };
  }
}
