import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
/** @jsxImportSource @opentui/solid */

/**
 * Tavily quota sidebar — an OpenCode 2 TUI plugin.
 *
 * Renders the remaining Tavily API credits in the session sidebar
 * (`sidebar.content`) with a clickable `refresh` button on the reset-countdown
 * row, and exposes a `/tavily-quota` slash command / "Refresh Tavily quota"
 * palette command that re-fetches on demand.
 *
 * The plugin owns no session state: Tavily credits are account-wide, so a
 * single snapshot is shared by every sidebar render and refreshed on a timer.
 * Colors follow the built-in quota sections: the heading uses the default text
 * color and the body (bar included) uses the muted/subdued text color.
 *
 * Authenticate with `TAVILY_API_KEY`, the `apiKey` plugin option in `cli.json`,
 * or OpenCode's active Tavily integration. Set `proxyUrl` to read pooled quota
 * from a TavilyProxyManager (`<proxyUrl>/api/stats`) instead of a single key.
 * A saved key is used server-side.
 */

import { RGBA } from "@opentui/core";
import { Plugin } from "@opencode/plugin/tui";
import { createSignal } from "solid-js";
import { displayWidth, fetchQuotaWithFallback, formatPoolDetailLines, formatPoolLine, formatPoolTailLine, formatQuotaLine, formatResetLine } from "./usage.js";
import { messages, resolveLocale } from "./i18n.js";
import { TavilyQuotaRpc } from "./rpc.js";
export const PLUGIN_ID = "opencode-tavily-quota";
// Direct mode hits Tavily's `/usage`, which allows at most 10 requests per 10
// minutes, so poll once per window and rely on `/tavily-quota` for on-demand
// reads.
const REFRESH_INTERVAL_MS = 600_000;
// Proxy mode only reads the local proxy's cached `/api/stats` (~0.5 s, no
// Tavily traffic), so it can afford to stay much closer to real time. The
// proxy's own auto-sync decides how fresh those numbers are.
const PROXY_REFRESH_INTERVAL_MS = 60_000;
// Neutral wash behind the refresh button, borrowed from the wesearch plugin's
// segmented buttons so the control reads the same way in the sidebar.
const BUTTON_WASH_IDLE = RGBA.fromValues(0.5, 0.5, 0.5, 0.2);
const BUTTON_WASH_HOVER = RGBA.fromValues(0.5, 0.5, 0.5, 0.38);
/**
 * OpenCode 2.0.7 exposes `text.default` / `text.subdued`; later builds renamed
 * the leaves to `text.base` / `text.muted`. Read whichever the running build
 * provides so the plugin matches the built-in quota sections on both.
 */
function readThemeColors(context) {
  const text = context.theme.text;
  return {
    text: text.default ?? text.base,
    textMuted: text.subdued ?? text.muted
  };
}
export function buildLines(state, now = Date.now(), locale = "zh") {
  const m = messages(locale);
  if (state.status === "loading") {
    return [m.loading];
  }
  if (state.status === "error") {
    return [`⚠ ${state.message}`];
  }
  const snapshot = state.snapshot;
  // Reset countdown sits between the heading and the bar, matching the sidebar
  // order used by the built-in quota section.
  const lines = [formatResetLine(now, locale), formatQuotaLine(snapshot, undefined, locale)];
  // LOCAL FORK: append the per-key lines, but only when the proxy actually
  // served `/api/keys`. Both formatters return "" without pool detail and are
  // filtered out, so a stats-only proxy renders byte-identically to upstream.
  for (const line of [formatPoolLine(snapshot.pool, undefined, locale), formatPoolTailLine(snapshot, locale)]) {
    if (line) lines.push(line);
  }
  // LOCAL FORK: `/api/keys` rejected the master key. The headline numbers above
  // may be cached, so say so instead of rendering a silently stale pool.
  if (snapshot.poolWarning) lines.push(`⚠ ${snapshot.poolWarning}`);
  // A sync that did not actually refresh the keys must not look like one that
  // did: the numbers above are whatever the proxy cached.
  const sync = state.sync;
  if (sync && sync.kind !== "completed") {
    const label = sync.kind === "partial" ? m.syncPartialSidebar(sync.failed, sync.total) : sync.kind === "failed" ? m.syncFailedSidebar(sync.failed, sync.total) : sync.kind === "timeout" ? m.syncTimeoutSidebar : m.syncUnavailableSidebar;
    lines.push(`⚠ ${label}${m.syncCachedSuffix}`);
  }
  return lines;
}

/**
 * One-line verdict for the toast. `syncProxyUsage` already separates "the job
 * finished" from "the keys were refreshed"; this only words it.
 */
export function syncSummary(sync, locale = "zh") {
  const m = messages(locale);
  const seconds = `${(sync.elapsedMs / 1000).toFixed(0)}s`;
  const head = sync.kind === "completed" ? m.syncCompleted(sync.succeeded, sync.total, seconds) : sync.kind === "partial" ? m.syncPartialSucceeded(sync.succeeded, sync.total, sync.failed) : sync.kind === "failed" ? m.syncFailedAll(sync.failed, sync.total) : sync.kind === "timeout" ? m.syncTimedOut(seconds) : m.syncNotDelivered;
  const detail = sync.error ? `\n${sync.error}` : "";
  return `${head}${detail}`;
}
export function TavilyQuotaSidebar(props) {
  const m = messages(props.locale);
  const colors = () => readThemeColors(props.context);
  // Keep the quota line on one line; let an error message wrap instead of
  // truncating it, since it can be longer than the sidebar.
  const wrapMode = () => props.state().status === "error" ? "word" : "none";
  // LOCAL FORK: two mouse-clickable buttons sharing the reset row -- the host
  // enables mouse tracking by default, and OpenTUI bubbles mouse events from
  // the deepest renderable, so each box can own its own press.
  const [hovered, setHovered] = createSignal(false);
  const [detailHovered, setDetailHovered] = createSignal(false);
  const refreshLabel = () => props.busy() ? m.refreshing : m.refreshButton;
  const detailLabel = () => m.detailButton;
  // Width follows the label so the Chinese and English builds both fit their
  // own text instead of hardcoding a size for one language.
  const refreshWidth = () => displayWidth(m.refreshButton) + 2;
  const detailWidth = () => displayWidth(m.detailButton) + 2;
  const pad = (label, width) => {
    const left = Math.max(0, Math.floor((width - displayWidth(label)) / 2));
    return " ".repeat(left) + label;
  };
  const pressRefresh = event => {
    if (event.button !== 0) return;
    event.stopPropagation();
    void props.refresh({
      sync: true
    });
  };
  const pressDetail = event => {
    if (event.button !== 0) return;
    event.stopPropagation();
    props.showDetail();
  };
  const allLines = () => buildLines(props.state(), Date.now(), props.locale);
  // The reset countdown shares the button's row. Loading does too; an error
  // keeps the full width so it can wrap.
  const inlineLine = () => {
    if (props.state().status === "ready") return allLines()[0] ?? "";
    if (props.state().status === "loading") return m.loading;
    return "";
  };
  const bodyLines = () => {
    if (props.state().status === "ready") return allLines().slice(1);
    if (props.state().status === "error") return allLines();
    return [];
  };
  return (() => {
    var _el$ = _$createElement("box"),
      _el$2 = _$createElement("text"),
      _el$3 = _$createElement("b"),
      _el$5 = _$createElement("box"),
      _el$6 = _$createElement("box"),
      _el$7 = _$createElement("text"),
      _el$8 = _$createElement("box"),
      _el$9 = _$createElement("text"),
      _el$0 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$5);
    _$setProp(_el$, "gap", 0);
    _$setProp(_el$, "flexDirection", "column");
    _$insertNode(_el$2, _el$3);
    _$insertNode(_el$3, _$createTextNode(`Tavily`));
    _$insertNode(_el$5, _el$6);
    _$insertNode(_el$5, _el$8);
    _$insertNode(_el$5, _el$0);
    _$setProp(_el$5, "flexDirection", "row");
    _$setProp(_el$5, "gap", 1);
    _$setProp(_el$5, "alignItems", "center");
    _$insertNode(_el$6, _el$7);
    _$setProp(_el$6, "height", 1);
    _$setProp(_el$6, "onMouseUp", pressRefresh);
    _$setProp(_el$6, "onMouseOver", () => setHovered(true));
    _$setProp(_el$6, "onMouseOut", () => setHovered(false));
    _$setProp(_el$7, "width", "100%");
    _$setProp(_el$7, "selectable", false);
    _$insert(_el$7, () => pad(refreshLabel(), refreshWidth()));
    _$insertNode(_el$8, _el$9);
    _$setProp(_el$8, "height", 1);
    _$setProp(_el$8, "onMouseUp", pressDetail);
    _$setProp(_el$8, "onMouseOver", () => setDetailHovered(true));
    _$setProp(_el$8, "onMouseOut", () => setDetailHovered(false));
    _$setProp(_el$9, "width", "100%");
    _$setProp(_el$9, "selectable", false);
    _$insert(_el$9, () => pad(detailLabel(), detailWidth()));
    _$setProp(_el$0, "wrapMode", "none");
    _$insert(_el$0, inlineLine);
    _$insert(_el$, () => bodyLines().map(line => (() => {
      var _el$1 = _$createElement("text");
      _$insert(_el$1, line);
      _$effect(_p$ => {
        var _v$9 = colors().textMuted,
          _v$0 = wrapMode();
        _v$9 !== _p$.e && (_p$.e = _$setProp(_el$1, "fg", _v$9, _p$.e));
        _v$0 !== _p$.t && (_p$.t = _$setProp(_el$1, "wrapMode", _v$0, _p$.t));
        return _p$;
      }, {
        e: undefined,
        t: undefined
      });
      return _el$1;
    })()), null);
    _$effect(_p$ => {
      var _v$ = colors().text,
        _v$2 = refreshWidth(),
        _v$3 = hovered() ? BUTTON_WASH_HOVER : BUTTON_WASH_IDLE,
        _v$4 = hovered() ? colors().text : colors().textMuted,
        _v$5 = detailWidth(),
        _v$6 = detailHovered() ? BUTTON_WASH_HOVER : BUTTON_WASH_IDLE,
        _v$7 = detailHovered() ? colors().text : colors().textMuted,
        _v$8 = colors().textMuted;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$6, "width", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$6, "backgroundColor", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$7, "fg", _v$4, _p$.o));
      _v$5 !== _p$.i && (_p$.i = _$setProp(_el$8, "width", _v$5, _p$.i));
      _v$6 !== _p$.n && (_p$.n = _$setProp(_el$8, "backgroundColor", _v$6, _p$.n));
      _v$7 !== _p$.s && (_p$.s = _$setProp(_el$9, "fg", _v$7, _p$.s));
      _v$8 !== _p$.h && (_p$.h = _$setProp(_el$0, "fg", _v$8, _p$.h));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined,
      h: undefined
    });
    return _el$;
  })();
}
function TavilyQuotaCommands(props) {
  const m = messages(props.locale);
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [{
      id: `${PLUGIN_ID}.refresh`,
      title: m.commandTitle,
      description: m.commandDescription,
      group: "Tavily",
      palette: true,
      slash: {
        name: "tavily-quota"
      },
      // Showing the detail view is a read: it must not trigger a Tavily sync,
      // which takes 10-20 s and is what the refresh button is for.
      run: () => props.showDetail()
    }]
  }));
  return null;
}
export const TavilyQuotaTuiPlugin = Plugin.define({
  id: PLUGIN_ID,
  async setup(context) {
    const [state, setState] = createSignal({
      status: "loading"
    });
    const apiKey = typeof context.options.apiKey === "string" ? context.options.apiKey : undefined;
    const proxyUrl = typeof context.options.proxyUrl === "string" ? context.options.proxyUrl : undefined;
    const remote = context.client.rpc(TavilyQuotaRpc);
    const locale = resolveLocale(typeof context.options.locale === "string" ? context.options.locale : undefined);
    const m = messages(locale);
    const refreshMs = typeof context.options.refreshMs === "number" && context.options.refreshMs > 0 ? context.options.refreshMs : proxyUrl ? PROXY_REFRESH_INTERVAL_MS : REFRESH_INTERVAL_MS;
    let disposed = false;
    let inFlight = false;
    const [busy, setBusy] = createSignal(false);

    /**
     * LOCAL FORK: two phases, because a proxy sync takes ~10–20 s and the user
     * should not stare at "刷新中…" for that long.
     *
     *   1. read the proxy's cached numbers and paint them (~0.5 s)
     *   2. only if asked, run the Tavily sync and repaint with its verdict
     *
     * The cached numbers are honest either way — phase 2 either refreshes them
     * or reports that it could not.
     */
    const refresh = async (options = {}) => {
      if (inFlight) return state();
      inFlight = true;
      setBusy(true);
      const load = sync => fetchQuotaWithFallback({
        apiKey,
        proxyUrl,
        sync,
        locale,
        remote: () => remote.usage({}, {
          location: context.location ?? context.data.location.default()
        })
      });
      try {
        const cached = await load(false);
        if (!disposed) {
          setState(cached.ok ? {
            status: "ready",
            snapshot: cached.snapshot
          } : {
            status: "error",
            message: cached.message
          });
        }
        if (options.sync && proxyUrl) {
          const synced = await load(true);
          if (!disposed) {
            setState(synced.ok ? {
              status: "ready",
              snapshot: synced.snapshot,
              sync: synced.sync
            } : {
              status: "error",
              message: synced.message
            });
          }
        }
      } catch (error) {
        // `fetchQuota` is written never to throw, but a rejected promise here
        // must not take down the sidebar: surface it inline instead.
        if (!disposed) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      } finally {
        inFlight = false;
        if (!disposed) setBusy(false);
      }
      return state();
    };

    /**
     * LOCAL FORK: the detail view, shared by the `Details` sidebar button and
     * the `/tavily-quota` command.
     *
     * Reads current state only. It never syncs: viewing is not refreshing, and
     * a sync costs 19 upstream requests plus 10-20 s of waiting.
     */
    const showDetail = async () => {
      const current = state();
      const view = current.status === "loading" ? await refresh() : current;
      const lines = view.status === "ready" ? formatPoolDetailLines(view.snapshot, Date.now(), locale) : [];
      if (view.status === "ready" && view.sync) lines.push(syncSummary(view.sync, locale));
      const message = view.status === "ready" ? lines.join("\n") : view.status === "error" ? view.message : m.stillLoading;
      // Tie the toast to the open session so the host can title it and offer to
      // open it if the session's family is not on screen.
      const route = context.ui.router.current();
      const sessionID = route.type === "session" ? route.sessionID : undefined;
      context.ui.toast.show({
        title: m.toastTitle,
        message,
        variant: view.status === "error" ? "error" : "info",
        ...(sessionID ? {
          sessionID
        } : {})
      });
    };
    const stopSidebar = context.ui.slot({
      append: "sidebar.content",
      render: () => _$createComponent(TavilyQuotaSidebar, {
        context: context,
        state: state,
        refresh: refresh,
        showDetail: showDetail,
        busy: busy,
        locale: locale
      })
    });

    // `keymap.layer` reads Solid context, so it must be mounted from a slot
    // component rather than called directly during plugin setup.
    const stopCommands = context.ui.slot({
      append: "app",
      render: () => _$createComponent(TavilyQuotaCommands, {
        context: context,
        refresh: refresh,
        showDetail: showDetail,
        locale: locale
      })
    });
    void refresh();
    const interval = setInterval(() => void refresh(), refreshMs);
    return () => {
      disposed = true;
      clearInterval(interval);
      stopSidebar();
      stopCommands();
    };
  }
});
export default TavilyQuotaTuiPlugin;
