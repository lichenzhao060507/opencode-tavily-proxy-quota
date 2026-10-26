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

import { RGBA, type MouseEvent } from "@opentui/core";
import { Plugin } from "@opencode/plugin/tui";
import { createSignal } from "solid-js";
import {
  displayWidth,
  fetchQuotaWithFallback,
  formatPoolDetailLines,
  formatPoolLine,
  formatPoolTailLine,
  formatQuotaLine,
  formatResetLine,
  type QuotaSnapshot,
  type SyncOutcome,
} from "./usage";
import type { QuotaResult } from "./usage";
import { messages, resolveLocale, type Locale } from "./i18n";
import { TavilyQuotaRpc } from "./rpc";

type Context = Plugin.Context;

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

type ViewState =
  | { status: "loading" }
  | { status: "ready"; snapshot: QuotaSnapshot; sync?: SyncOutcome }
  | { status: "error"; message: string };

type ThemeColors = {
  text?: RGBA;
  textMuted?: RGBA;
};

/**
 * OpenCode 2.0.7 exposes `text.default` / `text.subdued`; later builds renamed
 * the leaves to `text.base` / `text.muted`. Read whichever the running build
 * provides so the plugin matches the built-in quota sections on both.
 */
function readThemeColors(context: Context): ThemeColors {
  const text = context.theme.text as unknown as {
    default?: RGBA;
    base?: RGBA;
    subdued?: RGBA;
    muted?: RGBA;
  };
  return {
    text: text.default ?? text.base,
    textMuted: text.subdued ?? text.muted,
  };
}

export function buildLines(
  state: ViewState,
  now: number = Date.now(),
  locale: Locale = "zh",
): string[] {
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
  for (const line of [
    formatPoolLine(snapshot.pool, undefined, locale),
    formatPoolTailLine(snapshot, locale),
  ]) {
    if (line) lines.push(line);
  }
  // LOCAL FORK: `/api/keys` rejected the master key. The headline numbers above
  // may be cached, so say so instead of rendering a silently stale pool.
  if (snapshot.poolWarning) lines.push(`⚠ ${snapshot.poolWarning}`);
  // A sync that did not actually refresh the keys must not look like one that
  // did: the numbers above are whatever the proxy cached.
  const sync = state.sync;
  if (sync && sync.kind !== "completed") {
    const label =
      sync.kind === "partial"
        ? m.syncPartialSidebar(sync.failed, sync.total)
        : sync.kind === "failed"
          ? m.syncFailedSidebar(sync.failed, sync.total)
          : sync.kind === "timeout"
            ? m.syncTimeoutSidebar
            : m.syncUnavailableSidebar;
    lines.push(`⚠ ${label}${m.syncCachedSuffix}`);
  }
  return lines;
}

/**
 * One-line verdict for the toast. `syncProxyUsage` already separates "the job
 * finished" from "the keys were refreshed"; this only words it.
 */
export function syncSummary(sync: SyncOutcome, locale: Locale = "zh"): string {
  const m = messages(locale);
  const seconds = `${(sync.elapsedMs / 1000).toFixed(0)}s`;
  const head =
    sync.kind === "completed"
      ? m.syncCompleted(sync.succeeded, sync.total, seconds)
      : sync.kind === "partial"
        ? m.syncPartialSucceeded(sync.succeeded, sync.total, sync.failed)
        : sync.kind === "failed"
          ? m.syncFailedAll(sync.failed, sync.total)
          : sync.kind === "timeout"
            ? m.syncTimedOut(seconds)
            : m.syncNotDelivered;
  const detail = sync.error ? `\n${sync.error}` : "";
  return `${head}${detail}`;
}

export function TavilyQuotaSidebar(props: {
  context: Context;
  state: () => ViewState;
  refresh: (options?: { sync?: boolean }) => Promise<ViewState>;
  showDetail: () => void;
  busy: () => boolean;
  locale: Locale;
}) {
  const m = messages(props.locale);
  const colors = () => readThemeColors(props.context);
  // Keep the quota line on one line; let an error message wrap instead of
  // truncating it, since it can be longer than the sidebar.
  const wrapMode = () => (props.state().status === "error" ? "word" : "none");
  // LOCAL FORK: two mouse-clickable buttons sharing the reset row -- the host
  // enables mouse tracking by default, and OpenTUI bubbles mouse events from
  // the deepest renderable, so each box can own its own press.
  const [hovered, setHovered] = createSignal(false);
  const [detailHovered, setDetailHovered] = createSignal(false);
  const refreshLabel = () => (props.busy() ? m.refreshing : m.refreshButton);
  const detailLabel = () => m.detailButton;
  // Width follows the label so the Chinese and English builds both fit their
  // own text instead of hardcoding a size for one language.
  const refreshWidth = () => displayWidth(m.refreshButton) + 2;
  const detailWidth = () => displayWidth(m.detailButton) + 2;
  const pad = (label: string, width: number) => {
    const left = Math.max(0, Math.floor((width - displayWidth(label)) / 2));
    return " ".repeat(left) + label;
  };
  const pressRefresh = (event: MouseEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    void props.refresh({ sync: true });
  };
  const pressDetail = (event: MouseEvent) => {
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

  return (
    <box gap={0} flexDirection="column">
      <text fg={colors().text}>
        <b>Tavily</b>
      </text>
      <box flexDirection="row" gap={1} alignItems="center">
        <box
          width={refreshWidth()}
          height={1}
          backgroundColor={hovered() ? BUTTON_WASH_HOVER : BUTTON_WASH_IDLE}
          onMouseUp={pressRefresh}
          onMouseOver={() => setHovered(true)}
          onMouseOut={() => setHovered(false)}
        >
          <text
            width="100%"
            selectable={false}
            fg={hovered() ? colors().text : colors().textMuted}
          >
            {pad(refreshLabel(), refreshWidth())}
          </text>
        </box>
        <box
          width={detailWidth()}
          height={1}
          backgroundColor={detailHovered() ? BUTTON_WASH_HOVER : BUTTON_WASH_IDLE}
          onMouseUp={pressDetail}
          onMouseOver={() => setDetailHovered(true)}
          onMouseOut={() => setDetailHovered(false)}
        >
          <text
            width="100%"
            selectable={false}
            fg={detailHovered() ? colors().text : colors().textMuted}
          >
            {pad(detailLabel(), detailWidth())}
          </text>
        </box>
        <text fg={colors().textMuted} wrapMode="none">
          {inlineLine()}
        </text>
      </box>
      {bodyLines().map((line) => (
        <text fg={colors().textMuted} wrapMode={wrapMode()}>
          {line}
        </text>
      ))}
    </box>
  );
}

function TavilyQuotaCommands(props: {
  context: Context;
  refresh: (options?: { sync?: boolean }) => Promise<ViewState>;
  showDetail: () => void;
  locale: Locale;
}) {
  const m = messages(props.locale);
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: `${PLUGIN_ID}.refresh`,
        title: m.commandTitle,
        description: m.commandDescription,
        group: "Tavily",
        palette: true,
        slash: { name: "tavily-quota" },
        // Showing the detail view is a read: it must not trigger a Tavily sync,
        // which takes 10-20 s and is what the refresh button is for.
        run: () => props.showDetail(),
      },
    ],
  }));

  return null;
}

export const TavilyQuotaTuiPlugin = Plugin.define({
  id: PLUGIN_ID,
  async setup(context) {
    const [state, setState] = createSignal<ViewState>({ status: "loading" });
    const apiKey = typeof context.options.apiKey === "string" ? context.options.apiKey : undefined;
    const proxyUrl =
      typeof context.options.proxyUrl === "string" ? context.options.proxyUrl : undefined;
    const remote = context.client.rpc(TavilyQuotaRpc);
    const locale = resolveLocale(
      typeof context.options.locale === "string" ? context.options.locale : undefined,
    );
    const m = messages(locale);
    const refreshMs =
      typeof context.options.refreshMs === "number" && context.options.refreshMs > 0
        ? context.options.refreshMs
        : proxyUrl
          ? PROXY_REFRESH_INTERVAL_MS
          : REFRESH_INTERVAL_MS;

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
    const refresh = async (options: { sync?: boolean } = {}): Promise<ViewState> => {
      if (inFlight) return state();
      inFlight = true;
      setBusy(true);

      const load = (sync: boolean) =>
        fetchQuotaWithFallback({
          apiKey,
          proxyUrl,
          sync,
          locale,
          remote: () =>
            remote.usage({}, {
              location: context.location ?? context.data.location.default(),
            }) as Promise<QuotaResult>,
        });

      try {
        const cached = await load(false);
        if (!disposed) {
          setState(
            cached.ok
              ? { status: "ready", snapshot: cached.snapshot }
              : { status: "error", message: cached.message },
          );
        }

        if (options.sync && proxyUrl) {
          const synced = await load(true);
          if (!disposed) {
            setState(
              synced.ok
                ? { status: "ready", snapshot: synced.snapshot, sync: synced.sync }
                : { status: "error", message: synced.message },
            );
          }
        }
      } catch (error) {
        // `fetchQuota` is written never to throw, but a rejected promise here
        // must not take down the sidebar: surface it inline instead.
        if (!disposed) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
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
      const lines =
        view.status === "ready"
          ? formatPoolDetailLines(view.snapshot, Date.now(), locale)
          : [];
      if (view.status === "ready" && view.sync) lines.push(syncSummary(view.sync, locale));
      const message =
        view.status === "ready"
          ? lines.join("\n")
          : view.status === "error"
            ? view.message
            : m.stillLoading;
      // Tie the toast to the open session so the host can title it and offer to
      // open it if the session's family is not on screen.
      const route = context.ui.router.current();
      const sessionID = route.type === "session" ? route.sessionID : undefined;
      context.ui.toast.show({
        title: m.toastTitle,
        message,
        variant: view.status === "error" ? "error" : "info",
        ...(sessionID ? { sessionID } : {}),
      });
    };

    const stopSidebar = context.ui.slot({
      append: "sidebar.content",
      render: () => (
        <TavilyQuotaSidebar
          context={context}
          state={state}
          refresh={refresh}
          showDetail={showDetail}
          busy={busy}
          locale={locale}
        />
      ),
    });

    // `keymap.layer` reads Solid context, so it must be mounted from a slot
    // component rather than called directly during plugin setup.
    const stopCommands = context.ui.slot({
      append: "app",
      render: () => (
        <TavilyQuotaCommands
          context={context}
          refresh={refresh}
          showDetail={showDetail}
          locale={locale}
        />
      ),
    });

    void refresh();
    const interval = setInterval(() => void refresh(), refreshMs);

    return () => {
      disposed = true;
      clearInterval(interval);
      stopSidebar();
      stopCommands();
    };
  },
});

export default TavilyQuotaTuiPlugin;
