/**
 * Unit tests for the Tavily quota client.
 *
 * Run with any TypeScript-aware test runner, e.g. `npx tsx --test usage.test.ts`.
 */

import assert from "node:assert/strict";
import { join, resolve as resolvePath } from "node:path";
import { test } from "node:test";

import {
  derivePoolInfo,
  deriveProxySnapshot,
  deriveSnapshot,
  displayWidth,
  expandOptionValue,
  fetchQuota,
  fetchQuotaWithFallback,
  formatPercent,
  formatPoolDetailLines,
  formatPoolLine,
  formatPoolTailLine,
  formatQuotaLine,
  formatRemaining,
  formatResetCountdown,
  formatResetLine,
  nextMonthlyResetAt,
  progressBar,
  PROXY_KEYS_PATH,
  PROXY_STATS_PATH,
  PROXY_SYNC_PATH,
  proxyKeysUrl,
  proxyStatsUrl,
  proxySyncUrl,
  resolveApiKey,
  SIDEBAR_WIDTH,
  syncProxyUsage,
} from "./usage.ts";

import { resolveLocale } from "./i18n.ts";

/** LOCAL FORK: a three-key pool fixture mirroring the proxy's /api/keys shape. */
const PROXY_KEYS = {
  items: [
    {
      id: 1,
      alias: "tavily-1 (exhausted)",
      total_quota: 1000,
      used_quota: 1000,
      is_active: 0,
      is_invalid: 0,
      last_used_at: "2026-10-08T16:09:01+08:00",
    },
    {
      id: 2,
      alias: "tavily-2",
      total_quota: 1000,
      used_quota: 227,
      is_active: 1,
      is_invalid: 0,
      last_used_at: "2026-10-10T02:37:35+08:00",
    },
    {
      id: 3,
      alias: "tavily-3",
      total_quota: 1000,
      used_quota: 0,
      is_active: 1,
      is_invalid: 0,
      last_used_at: null,
    },
  ],
};

/** LOCAL FORK: a snapshot stub for formatter tests. */
const KEY_PAYLOAD_SNAPSHOT = {
  planName: "Researcher",
  used: 600,
  limit: 1000,
  remaining: 400,
  percentRemaining: 40,
  updatedAt: 0,
};

const KEY_PAYLOAD = {
  key: { usage: 161, limit: null, search_usage: 158 },
  account: {
    current_plan: "Researcher",
    plan_usage: 161,
    plan_limit: 1000,
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("deriveSnapshot prefers the account plan over an unlimited key", () => {
  const result = deriveSnapshot(KEY_PAYLOAD, 1234);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.snapshot.planName, "Researcher");
  assert.equal(result.snapshot.used, 161);
  assert.equal(result.snapshot.limit, 1000);
  assert.equal(result.snapshot.remaining, 839);
  assert.equal(result.snapshot.updatedAt, 1234);
  // `839 / 1000` is not exactly representable in binary floating point.
  assert.ok(Math.abs(result.snapshot.percentRemaining - 83.9) < 1e-9);
});

test("deriveSnapshot falls back to the key limit without a plan limit", () => {
  const result = deriveSnapshot({ key: { usage: 25, limit: 100 } }, 0);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.snapshot.limit, 100);
  assert.equal(result.snapshot.remaining, 75);
  assert.equal(result.snapshot.planName, "Tavily");
});

test("deriveSnapshot clamps remaining at zero when usage exceeds the limit", () => {
  const result = deriveSnapshot({ account: { plan_usage: 120, plan_limit: 100 } }, 0);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.snapshot.remaining, 0);
  assert.equal(result.snapshot.percentRemaining, 0);
});

test("deriveSnapshot reports an error when no positive limit is present", () => {
  assert.equal(deriveSnapshot({ key: { usage: 5, limit: null } }).ok, false);
  assert.equal(deriveSnapshot({ account: { plan_usage: 5, plan_limit: 0 } }).ok, false);
  assert.equal(deriveSnapshot({}).ok, false);
});

test("formatPercent and formatRemaining render sidebar text", () => {
  assert.equal(formatPercent(83.9), "84%");
  assert.equal(formatPercent(4.25), "4.3%");
  assert.equal(
    formatRemaining({
      planName: "Researcher",
      used: 161,
      limit: 1000,
      remaining: 839,
      percentRemaining: 83.9,
      updatedAt: 0,
    }),
    "剩余 839 额度",
  );
});

test("progressBar renders a fixed width and clamps out-of-range input", () => {
  assert.equal(progressBar(100, 10), "██████████");
  assert.equal(progressBar(0, 10), "░░░░░░░░░░");
  assert.equal(progressBar(50, 10), "█████░░░░░");
  assert.equal(progressBar(200, 4), "████");
  assert.equal(progressBar(-50, 4), "░░░░");
});

test("formatQuotaLine matches the quota section's bar width on one line", () => {
  const snapshot = {
    planName: "Researcher",
    used: 161,
    limit: 1000,
    remaining: 839,
    percentRemaining: 83.9,
    updatedAt: 0,
  };

  const line = formatQuotaLine(snapshot);
  // 25-char bar (the quota section's 36-column sidebar leaves 25 after its
  // separator and 9-cell percent column), then a right-aligned `84% 剩余`.
  assert.equal(line, "█████████████████████░░░░   84% 剩余");
  assert.equal(displayWidth(line), SIDEBAR_WIDTH);

  // An explicit width still controls the bar length.
  assert.ok(formatQuotaLine(snapshot, 4).startsWith(progressBar(83.9, 4)));
});

test("formatQuotaLine keeps a full label inside the percent column", () => {
  const line = formatQuotaLine({
    planName: "Tavily",
    used: 0,
    limit: 100,
    remaining: 100,
    percentRemaining: 100,
    updatedAt: 0,
  });
  assert.ok(line.endsWith("100% 剩余"));
  assert.equal(displayWidth(line), SIDEBAR_WIDTH);
});

test("nextMonthlyResetAt is 00:00 UTC on the 1st of the next month", () => {
  const now = Date.UTC(2026, 8, 24, 15, 30); // Sep 24 2026, 15:30 UTC
  assert.equal(nextMonthlyResetAt(now), Date.UTC(2026, 9, 1));
});

test("nextMonthlyResetAt rolls over the year boundary", () => {
  const now = Date.UTC(2026, 11, 31, 23, 59, 59); // Dec 31 2026
  assert.equal(nextMonthlyResetAt(now), Date.UTC(2027, 0, 1));
});

test("formatResetCountdown reports days and hours", () => {
  const now = Date.UTC(2026, 8, 24, 12, 0); // Sep 24 2026, 12:00 UTC
  const resetAt = Date.UTC(2026, 9, 1);
  assert.equal(formatResetCountdown(resetAt, now), "6天12小时");
});

test("formatResetCountdown drops to hours and minutes in the last day", () => {
  const resetAt = Date.UTC(2026, 9, 1);
  assert.equal(formatResetCountdown(resetAt, resetAt - (5 * 3_600_000 + 12 * 60_000)), "5小时12分");
  assert.equal(formatResetCountdown(resetAt, resetAt - 45 * 60_000), "45分");
  // A sub-minute remainder still reads as `1分` rather than `0分`.
  assert.equal(formatResetCountdown(resetAt, resetAt - 30_000), "1分");
});

test("formatResetCountdown floors instead of overstating the time left", () => {
  const resetAt = Date.UTC(2026, 9, 1);
  const now = resetAt - (6 * 86_400_000 + 12 * 3_600_000 + 59 * 60_000 + 59_000);
  assert.equal(formatResetCountdown(resetAt, now), "6天12小时");
});

test("formatResetCountdown reports 0分 at or past the reset", () => {
  const resetAt = Date.UTC(2026, 9, 1);
  assert.equal(formatResetCountdown(resetAt, resetAt), "0分");
  assert.equal(formatResetCountdown(resetAt, resetAt + 1_000), "0分");
});

test("formatResetLine renders the sidebar countdown", () => {
  const now = Date.UTC(2026, 8, 24, 12, 0); // Sep 24 2026, 12:00 UTC
  assert.equal(formatResetLine(now), "距重置 6天12小时");
});

test("resolveApiKey prefers the environment and falls back to the plugin option", () => {
  assert.equal(resolveApiKey({ TAVILY_API_KEY: "  env-key  " }, "option-key"), "env-key");
  assert.equal(resolveApiKey({}, "option-key"), "option-key");
  assert.equal(resolveApiKey({}, "  option-key  "), "option-key");
  assert.equal(resolveApiKey({}, undefined), "");
  assert.equal(resolveApiKey({ TAVILY_API_KEY: "   " }, ""), "");
});

test("expandOptionValue expands env references and treats missing ones as empty", () => {
  assert.equal(expandOptionValue("{env:MY_KEY}", { env: { MY_KEY: "abc" } }), "abc");
  assert.equal(expandOptionValue("{env:MISSING}", { env: {} }), "");
  assert.equal(expandOptionValue("Bearer {env:MY_KEY}", { env: { MY_KEY: "abc" } }), "Bearer abc");
});

test("expandOptionValue reads file references and trims surrounding whitespace", () => {
  const readFile = () => "  secret-from-file \n";
  assert.equal(expandOptionValue("{file:/abs/key}", { readFile }), "secret-from-file");
});

test("expandOptionValue expands ~/ against the home directory", () => {
  const seen: string[] = [];
  const readFile = (path: string) => {
    seen.push(path);
    return "k";
  };
  assert.equal(expandOptionValue("{file:~/.secrets/key}", { readFile, home: "/home/me" }), "k");
  assert.deepEqual(seen, [join("/home/me", ".secrets/key")]);
});

test("expandOptionValue resolves relative file references against cwd", () => {
  const seen: string[] = [];
  const readFile = (path: string) => {
    seen.push(path);
    return "k";
  };
  assert.equal(expandOptionValue("{file:.secrets/key}", { readFile, cwd: "/work" }), "k");
  assert.deepEqual(seen, [resolvePath("/work", ".secrets/key")]);
});

test("expandOptionValue expands multiple references in one value", () => {
  const readFile = (path: string) => (path === "/a" ? "A" : "B");
  assert.equal(
    expandOptionValue("{file:/a}-{env:V}-{file:/b}", { readFile, env: { V: "X" } }),
    "A-X-B",
  );
});

test("expandOptionValue reports an unreadable file reference", () => {
  assert.throws(
    () =>
      expandOptionValue("{file:/nope}", {
        readFile: () => {
          throw new Error("ENOENT");
        },
      }),
    /无法读取文件引用："\{file:\/nope\}"（\/nope）/,
  );
});

test("resolveApiKey expands references in the plugin option", () => {
  const readFile = () => "file-key\n";
  assert.equal(resolveApiKey({}, "{file:/k}", { readFile }), "file-key");
  assert.equal(resolveApiKey({ KEY: "from-env" }, "{env:KEY}"), "from-env");
  // `TAVILY_API_KEY` still wins over an option reference.
  assert.equal(resolveApiKey({ TAVILY_API_KEY: "direct" }, "{file:/k}", { readFile }), "direct");
});

test("resolveApiKey lets the pooled master key win over TAVILY_API_KEY", () => {
  // Regression guard: with `proxyUrl` set, `apiKey` is the proxy master key and
  // `TAVILY_API_KEY` is a raw tvly- key. The raw key must not be sent to the
  // proxy, which answers 401.
  assert.equal(
    resolveApiKey({ TAVILY_API_KEY: "raw-tvly-key" }, "master-key", { pooled: true }),
    "master-key",
  );
  // Direct (non-pooled) use is unchanged.
  assert.equal(
    resolveApiKey({ TAVILY_API_KEY: "raw-tvly-key" }, "master-key", { pooled: false }),
    "raw-tvly-key",
  );
});

test("fetchQuotaWithFallback sends the master key, never TAVILY_API_KEY, in proxy mode", async () => {
  let authorization: string | null = null;
  const result = await fetchQuotaWithFallback({
    env: { TAVILY_API_KEY: "raw-tvly-key" },
    apiKey: "master-key",
    proxyUrl: "http://127.0.0.1:27890",
    remote: async () => ({ ok: false as const, message: "unused" }),
    fetchImpl: (async (input: unknown, init?: RequestInit) => {
      // /api/keys is optional; make it absent so only /api/stats is asserted.
      if (String(input).endsWith(PROXY_KEYS_PATH)) return jsonResponse({}, 404);
      authorization = new Headers(init?.headers).get("authorization");
      return jsonResponse(PROXY_STATS);
    }) as typeof fetch,
  });
  assert.equal(result.ok, true);
  assert.equal(authorization, "Bearer master-key");
});

test("expandOptionValue refuses a multi-line file reference", () => {
  // A `{file:...}` option must not be able to ship an arbitrary secret (an SSH
  // key, a .env) out as a Bearer token.
  const readFile = () => "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END-----\n";
  assert.throws(
    () => expandOptionValue("{file:/nope}", { readFile }),
    /文件引用不是凭据格式/,
  );
});

test("expandOptionValue refuses an oversized file reference", () => {
  const readFile = () => "k".repeat(513);
  assert.throws(
    () => expandOptionValue("{file:/nope}", { readFile }),
    /超过 512 上限/,
  );
});

test("resolveLocale honours an explicit option, then the environment", () => {
  assert.equal(resolveLocale("zh"), "zh");
  assert.equal(resolveLocale("en"), "en");
  assert.equal(resolveLocale("zh-CN"), "zh");
  assert.equal(resolveLocale("en-GB"), "en");
  // A non-empty, non-Chinese environment locale means English.
  assert.equal(resolveLocale("auto", { LANG: "en_US.UTF-8" }), "en");
  assert.equal(resolveLocale(undefined, { LC_ALL: "zh_CN.UTF-8" }), "zh");
});

test("English locale renders the sidebar in English and keeps the 36-column width", () => {
  const snapshot = {
    planName: "Tavily pool (19 keys)",
    used: 12857,
    limit: 19000,
    remaining: 6143,
    percentRemaining: (6143 / 19000) * 100,
    updatedAt: 0,
    pool: derivePoolInfo(PROXY_KEYS),
  };
  const quota = formatQuotaLine(snapshot, undefined, "en");
  const pool = formatPoolLine(snapshot.pool, undefined, "en");
  assert.match(quota, /32% left$/);
  assert.equal(displayWidth(quota), SIDEBAR_WIDTH);
  assert.equal(displayWidth(pool), SIDEBAR_WIDTH);
  assert.match(pool, /\d+\/\d+ keys$/);
  assert.match(formatResetLine(0, "en"), /^reset /);
  assert.match(formatRemaining(snapshot, "en"), /^6143 credits left$/);
});

test("English detail view words the same rows differently", () => {
  const snapshot = {
    planName: "pool",
    used: 12857,
    limit: 19000,
    remaining: 6143,
    percentRemaining: (6143 / 19000) * 100,
    updatedAt: 0,
    pool: derivePoolInfo(PROXY_KEYS),
  };
  const lines = formatPoolDetailLines(snapshot, 0, "en");
  assert.match(lines[0], /6143\/19000 left/);
  assert.match(lines[1], /usable · .* spent/);
  assert.ok(lines.some((line) => line.includes("← last")));
  // Chinese stays the default and is untouched.
  assert.match(formatPoolDetailLines(snapshot, 0)[0], /^剩余 6143\/19000/);
});

test("fetchQuota reports a missing key without calling fetch", async () => {
  let called = false;
  const result = await fetchQuota({
    env: {},
    fetchImpl: (async () => {
      called = true;
      return jsonResponse({});
    }) as typeof fetch,
  });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /未配置 Tavily API Key/);
});

test("fetchQuota sends the plugin-option key as a Bearer token", async () => {
  let authorization: string | null = null;
  const result = await fetchQuota({
    env: {},
    apiKey: "option-key",
    now: 7,
    fetchImpl: (async (_url: unknown, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("authorization");
      return jsonResponse(KEY_PAYLOAD);
    }) as typeof fetch,
  });
  assert.equal(authorization, "Bearer option-key");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.snapshot.remaining, 839);
});

test("fetchQuota maps HTTP failures to messages", async () => {
  const cases: Array<[number, RegExp]> = [
    [401, /拒绝/],
    [429, /限流/],
    [500, /HTTP 500/],
  ];
  for (const [status, pattern] of cases) {
    const result = await fetchQuota({
      env: { TAVILY_API_KEY: "k" },
      fetchImpl: (async () => new Response("nope", { status })) as typeof fetch,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, pattern);
  }
});

test("fetchQuota reports invalid JSON", async () => {
  const result = await fetchQuota({
    env: { TAVILY_API_KEY: "k" },
    fetchImpl: (async () => new Response("not json", { status: 200 })) as typeof fetch,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /不是有效 JSON/);
});

test("fetchQuota derives a snapshot from a successful response", async () => {
  const result = await fetchQuota({
    env: { TAVILY_API_KEY: "k" },
    now: 42,
    fetchImpl: (async () => jsonResponse(KEY_PAYLOAD)) as typeof fetch,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.snapshot.remaining, 839);
  assert.equal(result.snapshot.updatedAt, 42);
});

test("fetchQuota reports network failures gracefully", async () => {
  const result = await fetchQuota({
    env: { TAVILY_API_KEY: "k" },
    fetchImpl: (async () => {
      throw new Error("boom");
    }) as typeof fetch,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /请求失败：boom/);
});

test("fetchQuota sends a key read from a {file:...} option", async () => {
  let authorization: string | null = null;
  const result = await fetchQuota({
    env: {},
    apiKey: "{file:/secrets/tavily}",
    readFile: () => "tvly-from-file\n",
    now: 7,
    fetchImpl: (async (_url: unknown, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("authorization");
      return jsonResponse(KEY_PAYLOAD);
    }) as typeof fetch,
  });
  assert.equal(authorization, "Bearer tvly-from-file");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.snapshot.remaining, 839);
});

test("fetchQuota surfaces a bad file reference without calling fetch", async () => {
  let called = false;
  const result = await fetchQuota({
    env: {},
    apiKey: "{file:/missing}",
    readFile: () => {
      throw new Error("ENOENT");
    },
    fetchImpl: (async () => {
      called = true;
      return jsonResponse({});
    }) as typeof fetch,
  });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /无法读取文件引用："\{file:\/missing\}"/);
});

test("fetchQuotaWithFallback uses OpenCode only when the CLI has no key", async () => {
  let remoteCalls = 0;
  let authorization: string | null = null;
  const remote = async () => {
    remoteCalls++;
    return { ok: false as const, message: "not connected" };
  };
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    authorization = new Headers(init?.headers).get("authorization");
    return jsonResponse(KEY_PAYLOAD);
  }) as typeof fetch;

  const local = await fetchQuotaWithFallback({
    env: { TAVILY_API_KEY: "env-key" }, apiKey: "option-key", remote, fetchImpl,
  });
  assert.equal(local.ok, true);
  assert.equal(authorization, "Bearer env-key");
  assert.equal(remoteCalls, 0);

  const option = await fetchQuotaWithFallback({ env: {}, apiKey: "option-key", remote, fetchImpl });
  assert.equal(option.ok, true);
  assert.equal(authorization, "Bearer option-key");
  assert.equal(remoteCalls, 0);

  const connected = await fetchQuotaWithFallback({ env: {}, remote, fetchImpl });
  assert.deepEqual(connected, { ok: false, message: "not connected" });
  assert.equal(remoteCalls, 1);
});

const PROXY_STATS = {
  total_quota: 6000,
  total_used: 1157,
  total_remaining: 4843,
  key_count: 6,
  active_key_count: 5,
  today_requests: 2,
};

test("proxyStatsUrl targets /api/stats and tolerates a trailing slash", () => {
  assert.equal(proxyStatsUrl("http://127.0.0.1:27890"), `http://127.0.0.1:27890${PROXY_STATS_PATH}`);
  assert.equal(proxyStatsUrl("http://127.0.0.1:27890/"), `http://127.0.0.1:27890${PROXY_STATS_PATH}`);
  assert.equal(proxyStatsUrl("  http://host:1//  "), `http://host:1${PROXY_STATS_PATH}`);
});

test("proxySyncUrl targets /api/keys/sync", () => {
  assert.equal(proxySyncUrl("http://127.0.0.1:27890"), `http://127.0.0.1:27890${PROXY_SYNC_PATH}`);
  assert.equal(proxySyncUrl("http://127.0.0.1:27890/"), `http://127.0.0.1:27890${PROXY_SYNC_PATH}`);
});

test("syncProxyUsage posts then polls the shared job", async () => {
  const calls: string[] = [];
  const responses = [
    { status: "running", total: 2, completed: 0 },
    { status: "completed", total: 2, completed: 2, succeeded: 2, failed: 0 },
  ];
  const outcome = await syncProxyUsage("http://127.0.0.1:27890", "master-key", {
    syncTimeoutMs: 5_000,
    fetchImpl: (async (input: unknown, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return jsonResponse(responses.shift() ?? { status: "completed" });
    }) as typeof fetch,
  });
  assert.equal(outcome.kind, "completed");
  assert.equal(outcome.succeeded, 2);
  assert.equal(outcome.failed, 0);
  assert.deepEqual(calls, [
    `POST http://127.0.0.1:27890${PROXY_SYNC_PATH}`,
    `GET http://127.0.0.1:27890${PROXY_SYNC_PATH}`,
  ]);
});

test("syncProxyUsage reports failure when every key came back 429", async () => {
  // This is the real shape the proxy returns after a burst: status
  // "completed", succeeded 0, failed 19. Treating that as success is what makes
  // the sidebar show frozen numbers with no warning.
  const outcome = await syncProxyUsage("http://127.0.0.1:27890", "master-key", {
    fetchImpl: (async () =>
      jsonResponse({
        status: "completed",
        total: 19,
        completed: 19,
        succeeded: 0,
        failed: 19,
        items: [
          {
            id: 19,
            status: "error",
            error:
              'upstream status 429: {"detail": {"error": "Your request has been blocked due to excessive requests."}}',
          },
        ],
      })) as typeof fetch,
  });
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.failed, 19);
  assert.equal(outcome.succeeded, 0);
  assert.match(outcome.error ?? "", /429/);
  // The error must be a single line so it fits in a toast.
  assert.doesNotMatch(outcome.error ?? "", /\n/);
});

test("syncProxyUsage reports a partial refresh", async () => {
  const outcome = await syncProxyUsage("http://127.0.0.1:27890", "master-key", {
    fetchImpl: (async () =>
      jsonResponse({ status: "completed", total: 4, succeeded: 3, failed: 1 })) as typeof fetch,
  });
  assert.equal(outcome.kind, "partial");
  assert.equal(outcome.succeeded, 3);
});

test("syncProxyUsage reports unavailable when the proxy rejects the master key", async () => {
  const outcome = await syncProxyUsage("http://127.0.0.1:27890", "master-key", {
    fetchImpl: (async () => new Response("nope", { status: 401 })) as typeof fetch,
  });
  assert.equal(outcome.kind, "unavailable");
});

test("fetchQuota syncs official usage before reading stats when asked", async () => {
  const calls: string[] = [];
  const result = await fetchQuota({
    env: {},
    apiKey: "master-key",
    proxyUrl: "http://127.0.0.1:27890",
    sync: true,
    fetchImpl: (async (input: unknown, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (String(input).endsWith(PROXY_SYNC_PATH)) {
        return jsonResponse({ status: "completed", total: 1, completed: 1, succeeded: 1, failed: 0 });
      }
      if (String(input).endsWith(PROXY_KEYS_PATH)) return jsonResponse({ items: [] });
      return jsonResponse(PROXY_STATS);
    }) as typeof fetch,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.sync?.kind, "completed");
    assert.equal(result.sync?.succeeded, 1);
  }
  assert.deepEqual(calls, [
    `POST http://127.0.0.1:27890${PROXY_SYNC_PATH}`,
    `GET http://127.0.0.1:27890${PROXY_STATS_PATH}`,
    `GET http://127.0.0.1:27890${PROXY_KEYS_PATH}`,
  ]);
});

test("deriveProxySnapshot sums the whole pool and names the key count", () => {
  const result = deriveProxySnapshot(PROXY_STATS, 99);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.snapshot.planName, "Tavily 池（6 个 key）");
  assert.equal(result.snapshot.limit, 6000);
  assert.equal(result.snapshot.used, 1157);
  assert.equal(result.snapshot.remaining, 4843);
  assert.equal(result.snapshot.updatedAt, 99);
  assert.ok(Math.abs(result.snapshot.percentRemaining - (4843 / 6000) * 100) < 1e-9);
});

test("deriveProxySnapshot falls back to quota minus used without total_remaining", () => {
  const result = deriveProxySnapshot({ total_quota: 1000, total_used: 250 }, 0);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.snapshot.remaining, 750);
});

test("deriveProxySnapshot clamps remaining at zero and errors without a pool quota", () => {
  const over = deriveProxySnapshot({ total_quota: 100, total_used: 150 });
  assert.equal(over.ok, true);
  if (over.ok) {
    assert.equal(over.snapshot.remaining, 0);
    assert.equal(over.snapshot.used, 150);
  }
  assert.equal(deriveProxySnapshot({ total_used: 5 }).ok, false);
  assert.equal(deriveProxySnapshot({ total_quota: 0 }).ok, false);
});

test("fetchQuota reads the proxy pool when proxyUrl is set", async () => {
  // LOCAL FORK: fetchQuota now makes a second, best-effort call to /api/keys.
  // Record every request instead of just the last one, so this still asserts
  // "stats first, then keys" rather than whichever call happened to be last.
  const urls: string[] = [];
  const authorizations: (string | null)[] = [];
  const result = await fetchQuota({
    env: {},
    apiKey: "master-key",
    proxyUrl: "http://127.0.0.1:27890/",
    now: 7,
    fetchImpl: (async (input: unknown, init?: RequestInit) => {
      urls.push(String(input));
      authorizations.push(new Headers(init?.headers).get("authorization"));
      // Only /api/stats has stats; /api/keys is absent on this proxy.
      return String(input).endsWith(PROXY_KEYS_PATH)
        ? jsonResponse({ error: "not found" }, 404)
        : jsonResponse(PROXY_STATS);
    }) as typeof fetch,
  });
  assert.deepEqual(urls, [
    `http://127.0.0.1:27890${PROXY_STATS_PATH}`,
    `http://127.0.0.1:27890${PROXY_KEYS_PATH}`,
  ]);
  assert.deepEqual(authorizations, ["Bearer master-key", "Bearer master-key"]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.snapshot.remaining, 4843);
});

test("fetchQuota attaches the per-key pool when the proxy serves /api/keys", async () => {
  const result = await fetchQuota({
    env: {},
    apiKey: "master-key",
    proxyUrl: "http://127.0.0.1:27890",
    now: 7,
    fetchImpl: (async (input: unknown) =>
      String(input).endsWith(PROXY_KEYS_PATH)
        ? jsonResponse(PROXY_KEYS)
        : jsonResponse(PROXY_STATS)) as typeof fetch,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const pool = result.snapshot.pool;
  assert.ok(pool, "pool detail should be attached");
  assert.equal(pool.total, 3);
  assert.equal(pool.exhausted, 1);
  assert.equal(pool.live, 2);
  assert.equal(pool.lastUsed?.id, 2);
});

test("fetchQuota degrades to no pool detail when /api/keys 404s", async () => {
  const result = await fetchQuota({
    env: {},
    apiKey: "master-key",
    proxyUrl: "http://127.0.0.1:27890",
    now: 7,
    fetchImpl: (async (input: unknown) =>
      String(input).endsWith(PROXY_KEYS_PATH)
        ? jsonResponse({ error: "not found" }, 404)
        : jsonResponse(PROXY_STATS)) as typeof fetch,
  });
  // A stats-only proxy must still render the headline quota.
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.snapshot.pool, undefined);
});

test("fetchQuota surfaces a rejected /api/keys instead of hiding it", async () => {
  const result = await fetchQuota({
    env: {},
    apiKey: "stale-master-key",
    proxyUrl: "http://127.0.0.1:27890",
    now: 7,
    fetchImpl: (async (input: unknown) =>
      String(input).endsWith(PROXY_KEYS_PATH)
        ? jsonResponse({ error: "unauthorized" }, 401)
        : jsonResponse(PROXY_STATS)) as typeof fetch,
  });
  // The headline quota still renders (it may be cached), but the rejected
  // credential must be visible rather than silently swallowed.
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.snapshot.pool, undefined);
    assert.match(result.snapshot.poolWarning ?? "", /401/);
  }
});

test("fetchQuota degrades to no pool detail when /api/keys throws", async () => {
  const result = await fetchQuota({
    env: {},
    apiKey: "master-key",
    proxyUrl: "http://127.0.0.1:27890",
    now: 7,
    fetchImpl: (async (input: unknown) => {
      if (String(input).endsWith(PROXY_KEYS_PATH)) throw new Error("socket hang up");
      return jsonResponse(PROXY_STATS);
    }) as typeof fetch,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.snapshot.pool, undefined);
});

test("derivePoolInfo counts exhausted and live keys and finds the last used", () => {
  const pool = derivePoolInfo(PROXY_KEYS);
  assert.ok(pool);
  assert.equal(pool.keys.length, 3);
  assert.equal(pool.exhausted, 1);
  assert.equal(pool.live, 2);
  assert.equal(pool.lastUsed?.id, 2);
  // Oldest id first, so the sidebar reads top to bottom.
  assert.deepEqual(pool.keys.map((k) => k.id), [1, 2, 3]);
});

test("derivePoolInfo returns undefined for anything unusable", () => {
  assert.equal(derivePoolInfo({}), undefined);
  assert.equal(derivePoolInfo({ items: [] }), undefined);
  assert.equal(derivePoolInfo({ items: null }), undefined);
  // Entries with neither quota nor usage carry no signal.
  assert.equal(derivePoolInfo({ items: [{ id: 1, alias: "x" }] }), undefined);
});

test("derivePoolInfo accepts SQLite 0/1 flags and boolean flags alike", () => {
  const numeric = derivePoolInfo({
    items: [
      { id: 1, alias: "a", total_quota: 10, used_quota: 10, is_active: 0, is_invalid: 0 },
      { id: 2, alias: "b", total_quota: 10, used_quota: 1, is_active: 1, is_invalid: 0 },
    ],
  });
  assert.ok(numeric);
  assert.equal(numeric.live, 1);
  assert.equal(numeric.exhausted, 1);

  const boolish = derivePoolInfo({
    items: [
      { id: 1, alias: "a", total_quota: 10, used_quota: 10, is_active: false, is_invalid: false },
      { id: 2, alias: "b", total_quota: 10, used_quota: 1, is_active: true, is_invalid: false },
    ],
  });
  assert.deepEqual(boolish?.live, numeric?.live);
  assert.deepEqual(boolish?.exhausted, numeric?.exhausted);
});

test("formatPoolLine renders an empty string without pool detail", () => {
  assert.equal(formatPoolLine(undefined), "");
  assert.equal(formatPoolTailLine({ ...KEY_PAYLOAD_SNAPSHOT }), "");
  // A stats-only proxy falls back to the original one-line summary.
  assert.deepEqual(formatPoolDetailLines({ ...KEY_PAYLOAD_SNAPSHOT }, Date.UTC(2026, 9, 10)), [
    "剩余 400/1000 · 40% · 距重置 22天0小时",
  ]);
});

test("formatPoolLine stays within the sidebar width", () => {
  const pool = derivePoolInfo(PROXY_KEYS);
  assert.ok(pool);
  const line = formatPoolLine(pool);
  assert.equal(displayWidth(line), SIDEBAR_WIDTH);
  assert.match(line, /2\/3 个$/);
});

test("formatPoolTailLine leads with absolute credits, then last used and spent", () => {
  const pool = derivePoolInfo(PROXY_KEYS);
  assert.ok(pool);
  const line = formatPoolTailLine({ ...KEY_PAYLOAD_SNAPSHOT, pool });
  assert.equal(line, "400/1000 · 最后 #2 · 1 个耗尽");
  // Headroom matters: the totals widen as keys are added, and the sidebar is 36.
  assert.ok(
    displayWidth(line) <= SIDEBAR_WIDTH - 3,
    `line is ${displayWidth(line)} cols, too wide to grow`,
  );
});

test("formatPoolTailLine says unused when no key has been called", () => {
  const pool = derivePoolInfo({
    items: [{ id: 1, alias: "a", total_quota: 10, used_quota: 0, last_used_at: null }],
  });
  assert.ok(pool);
  assert.equal(pool.lastUsed, null);
  assert.equal(formatPoolTailLine({ ...KEY_PAYLOAD_SNAPSHOT, pool }), "400/1000 · 未使用");
});

test("formatPoolTailLine omits the spent segment when nothing is exhausted", () => {
  const pool = derivePoolInfo({
    items: [
      { id: 1, alias: "a", total_quota: 10, used_quota: 2, last_used_at: "2026-10-10T02:37:35+08:00" },
    ],
  });
  assert.ok(pool);
  assert.equal(formatPoolTailLine({ ...KEY_PAYLOAD_SNAPSHOT, pool }), "400/1000 · 最后 #1");
});

test("formatPoolDetailLines marks the last used row", () => {
  const pool = derivePoolInfo(PROXY_KEYS);
  assert.ok(pool);
  const lines = formatPoolDetailLines({ ...KEY_PAYLOAD_SNAPSHOT, pool }, Date.UTC(2026, 0, 1));
  const last = lines.filter((l) => l.includes("← 最近"));
  assert.equal(last.length, 1);
  assert.match(last[0], /#2/);
});

test("fetchQuota reports a missing proxy master key without calling fetch", async () => {
  let called = false;
  const result = await fetchQuota({
    env: {},
    proxyUrl: "http://127.0.0.1:27890",
    fetchImpl: (async () => {
      called = true;
      return jsonResponse(PROXY_STATS);
    }) as typeof fetch,
  });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /未配置 Tavily 代理主密钥/);
});

test("fetchQuota maps a proxy 401 to a master-key message", async () => {
  const result = await fetchQuota({
    // In proxy mode the master key comes from `apiKey`; a raw `TAVILY_API_KEY`
    // must not be substituted for it (see resolveApiKey's `pooled` flag).
    env: { TAVILY_API_KEY: "raw-tvly-key" },
    apiKey: "master-key",
    proxyUrl: "http://127.0.0.1:27890",
    fetchImpl: (async () => new Response("nope", { status: 401 })) as typeof fetch,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /代理拒绝了主密钥/);
});
