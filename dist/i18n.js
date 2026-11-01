/**
 * Sidebar strings in Chinese and English.
 *
 * The plugin ships both because the sidebar is the whole product: a Chinese-only
 * UI is unusable for most people who find this on GitHub, and an English-only UI
 * is worse for the original audience. Pick with the `locale` option; `auto`
 * reads the OS locale.
 *
 * Every entry is a function or a string so callers never do string arithmetic.
 */

const ZH = {
  heading: "Tavily",
  loading: "加载中…",
  stillLoading: "仍在加载…",
  refreshButton: "刷新额度",
  detailButton: "详情",
  refreshing: "刷新中…",
  toastTitle: "Tavily 额度",
  commandTitle: "Tavily 额度详情",
  commandDescription: "查看每把 key 的额度，以及最近一次同步的结果",
  quotaLeft: percent => `${percent} 剩余`,
  creditsLeft: remaining => `剩余 ${remaining} 额度`,
  creditsAvailable: (remaining, limit) => `可用${remaining}/${limit}`,
  keysFraction: (live, total) => `${live}/${total} 个`,
  lastUsed: tag => `最后 ${tag}`,
  unused: "未使用",
  exhaustedCount: count => `${count} 个耗尽`,
  spentTag: "已耗尽",
  invalidTag: "无效",
  resetLine: countdown => `距重置 ${countdown}`,
  countdownDays: (days, hours) => `${days}天${hours}小时`,
  countdownHours: (hours, minutes) => `${hours}小时${minutes}分`,
  countdownMinutes: minutes => `${minutes}分`,
  countdownNow: "0分",
  detailHead: (remaining, limit, percent, countdown) => `剩余 ${remaining}/${limit} · ${percent} · 距重置 ${countdown}`,
  detailPoolSummary: (live, total, exhausted) => `${live}/${total} 个可用 · ${exhausted} 个已耗尽`,
  recentlyUsed: "← 最近",
  syncPartialSidebar: (failed, total) => `同步部分失败 ${failed}/${total}`,
  syncFailedSidebar: (failed, total) => `同步失败 ${failed}/${total}`,
  syncTimeoutSidebar: "同步超时",
  syncUnavailableSidebar: "同步未送达",
  syncCachedSuffix: "，数字为缓存",
  syncRateLimitedSidebar: age => age ? `Tavily 限流，显示 ${age}的缓存` : "Tavily 限流，显示缓存",
  syncCooldownSidebar: minutes => `限流冷却中，${minutes} 分钟后再试`,
  syncCacheAgeMinutes: minutes => minutes <= 0 ? "刚刚" : `${minutes} 分钟前`,
  syncCacheAgeHours: hours => `${hours} 小时前`,
  syncCompleted: (succeeded, total, seconds) => `已同步 ${succeeded}/${total} · ${seconds}`,
  syncPartialSucceeded: (succeeded, total, failed) => `部分同步 ${succeeded}/${total}，${failed} 把失败`,
  syncFailedAll: (failed, total) => `同步失败：${failed}/${total} 把全部失败`,
  syncTimedOut: seconds => `同步超时（${seconds}）`,
  syncNotDelivered: "同步请求未送达代理",
  syncRateLimitedToast: age => age ? `Tavily 拒绝了这批同步（429 限流），显示 ${age}的缓存；后台自动同步会在下一轮重试` : "Tavily 拒绝了这批同步（429 限流），显示缓存；后台自动同步会在下一轮重试",
  syncCooldownToast: minutes => `刚才已被限流，${minutes} 分钟后再试`,
  credUnavailable: reason => `OpenCode 的 Tavily 凭据不可用：${reason}`,
  fileReadFailed: (match, path) => `无法读取文件引用："${match}"（${path}）`,
  fileTooLong: (match, path, length, max) => `文件引用不是凭据格式："${match}"（${path}）：内容 ${length} 字符，超过 ${max} 上限`,
  fileMultiline: (match, path) => `文件引用不是凭据格式："${match}"（${path}）：内容含空白或多行`,
  noLimitForKey: "Tavily 未返回该 key 的额度上限",
  proxyNoPoolQuota: "Tavily 代理未返回池子额度（请检查代理是否运行、是否已添加 key）",
  poolNameWithCount: count => `Tavily 池（${count} 个 key）`,
  poolName: "Tavily 池",
  missingProxyKey: "未配置 Tavily 代理主密钥（请设置 apiKey 插件选项）",
  missingKey: "未配置 Tavily API Key（请设置 TAVILY_API_KEY 或 apiKey 插件选项）",
  requestFailed: reason => `请求失败：${reason}`,
  unauthorizedProxy: "代理拒绝了主密钥（401）",
  unauthorized: "API Key 被拒绝（401）",
  rateLimited: label => `触发限流：${label}（10 次 / 10 分钟）`,
  httpError: (label, status) => `${label} 返回 HTTP ${status}`,
  invalidJson: label => `${label} 返回的不是有效 JSON`,
  poolDenied: status => `读取池子明细被拒（HTTP ${status}）：主密钥可能已失效`
};
const EN = {
  heading: "Tavily",
  loading: "loading…",
  stillLoading: "still loading…",
  refreshButton: "Refresh",
  detailButton: "Details",
  refreshing: "refreshing…",
  toastTitle: "Tavily quota",
  commandTitle: "Tavily quota details",
  commandDescription: "Show per-key quota and what the last sync did",
  quotaLeft: percent => `${percent} left`,
  creditsLeft: remaining => `${remaining} credits left`,
  creditsAvailable: (remaining, limit) => `${remaining}/${limit} left`,
  keysFraction: (live, total) => `${live}/${total} keys`,
  lastUsed: tag => `last ${tag}`,
  unused: "unused",
  exhaustedCount: count => `${count} spent`,
  spentTag: "spent",
  invalidTag: "invalid",
  resetLine: countdown => `reset ${countdown}`,
  countdownDays: (days, hours) => `${days}d ${hours}h`,
  countdownHours: (hours, minutes) => `${hours}h ${minutes}m`,
  countdownMinutes: minutes => `${minutes}m`,
  countdownNow: "0m",
  detailHead: (remaining, limit, percent, countdown) => `${remaining}/${limit} left · ${percent} · reset ${countdown}`,
  detailPoolSummary: (live, total, exhausted) => `${live}/${total} usable · ${exhausted} spent`,
  recentlyUsed: "← last",
  syncPartialSidebar: (failed, total) => `sync partly failed ${failed}/${total}`,
  syncFailedSidebar: (failed, total) => `sync failed ${failed}/${total}`,
  syncTimeoutSidebar: "sync timed out",
  syncUnavailableSidebar: "sync not delivered",
  syncCachedSuffix: " · numbers are cached",
  syncRateLimitedSidebar: age => age ? `Tavily throttled · cache from ${age}` : "Tavily throttled · showing cache",
  syncCooldownSidebar: minutes => `throttled · retry in ${minutes} min`,
  syncCacheAgeMinutes: minutes => minutes <= 0 ? "just now" : `${minutes} min ago`,
  syncCacheAgeHours: hours => `${hours} h ago`,
  syncCompleted: (succeeded, total, seconds) => `synced ${succeeded}/${total} · ${seconds}`,
  syncPartialSucceeded: (succeeded, total, failed) => `partly synced ${succeeded}/${total}, ${failed} failed`,
  syncFailedAll: (failed, total) => `sync failed: all ${failed}/${total} keys`,
  syncTimedOut: seconds => `sync timed out (${seconds})`,
  syncNotDelivered: "sync request did not reach the proxy",
  syncRateLimitedToast: age => age ? `Tavily rejected the sync batch (429) · cache from ${age}; the background sync retries next cycle` : "Tavily rejected the sync batch (429) · showing cache; the background sync retries next cycle",
  syncCooldownToast: minutes => `throttled a moment ago · retry in ${minutes} min`,
  credUnavailable: reason => `OpenCode Tavily credential unavailable: ${reason}`,
  fileReadFailed: (match, path) => `cannot read file reference: "${match}" (${path})`,
  fileTooLong: (match, path, length, max) => `file reference is not a credential: "${match}" (${path}) is ${length} chars, over the ${max} limit`,
  fileMultiline: (match, path) => `file reference is not a credential: "${match}" (${path}) contains whitespace or newlines`,
  noLimitForKey: "Tavily returned no credit limit for this key",
  proxyNoPoolQuota: "Tavily proxy reported no pooled quota (check the proxy is running and keys are added)",
  poolNameWithCount: count => `Tavily pool (${count} keys)`,
  poolName: "Tavily pool",
  missingProxyKey: "no Tavily proxy master key (set the apiKey plugin option)",
  missingKey: "no Tavily API key (set TAVILY_API_KEY or the apiKey plugin option)",
  requestFailed: reason => `request failed: ${reason}`,
  unauthorizedProxy: "proxy rejected the master key (401)",
  unauthorized: "API key rejected (401)",
  rateLimited: label => `rate limited on ${label} (10 requests / 10 minutes)`,
  httpError: (label, status) => `HTTP ${status} from ${label}`,
  invalidJson: label => `invalid JSON from ${label}`,
  poolDenied: status => `pool detail rejected (HTTP ${status}): the master key may be stale`
};
const TABLE = {
  zh: ZH,
  en: EN
};
export function messages(locale) {
  return TABLE[locale] ?? ZH;
}

/**
 * Resolve the `locale` plugin option.
 *
 * `auto` (the default) reads `LC_ALL` / `LC_MESSAGES` / `LANG`, then the OS
 * locale via `Intl`, and falls back to Chinese. Anything starting with `zh`
 * means Chinese; a non-empty other locale means English.
 */
export function resolveLocale(option, env = process.env) {
  const raw = (option ?? "").trim().toLowerCase();
  if (raw === "zh" || raw.startsWith("zh-")) return "zh";
  if (raw === "en" || raw.startsWith("en-")) return "en";
  if (raw && raw !== "auto") return "zh";
  const fromEnv = (env.LC_ALL || env.LC_MESSAGES || env.LANG || "").trim().toLowerCase();
  if (fromEnv) return fromEnv.startsWith("zh") ? "zh" : "en";
  try {
    const system = (Intl.DateTimeFormat().resolvedOptions().locale || "").toLowerCase();
    return system.startsWith("zh") ? "zh" : "en";
  } catch {
    return "zh";
  }
}
