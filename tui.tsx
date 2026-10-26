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
  fetchQuotaWithFallback,
  formatPoolDetailLines,
  formatPoolLine,
  formatPoolTailLine,
  formatQuotaLine,
  formatResetLine,
  type QuotaSnapshot,
} from "./usage";
import type { QuotaResult } from "./usage";
import { TavilyQuotaRpc } from "./rpc";

type Context = Plugin.Context;

export const PLUGIN_ID = "opencode-tavily-quota";
// Tavily's `/usage` endpoint allows at most 10 requests per 10 minutes, so poll
// once per window and rely on the `/tavily-quota` command for on-demand reads.
const REFRESH_INTERVAL_MS = 600_000;
// Neutral wash behind the refresh button, borrowed from the wesearch plugin's
// segmented buttons so the control reads the same way in the sidebar.
const BUTTON_WASH_IDLE = RGBA.fromValues(0.5, 0.5, 0.5, 0.2);
const BUTTON_WASH_HOVER = RGBA.fromValues(0.5, 0.5, 0.5, 0.38);
const REFRESH_BUTTON_WIDTH = 10;

type ViewState =
  | { status: "loading" }
  | { status: "ready"; snapshot: QuotaSnapshot }
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

export function buildLines(state: ViewState, now: number = Date.now()): string[] {
  if (state.status === "loading") {
    return ["加载中…"];
  }
  if (state.status === "error") {
    return [`⚠ ${state.message}`];
  }

  const snapshot = state.snapshot;
  // Reset countdown sits between the heading and the bar, matching the sidebar
  // order used by the built-in quota section.
  const lines = [formatResetLine(now), formatQuotaLine(snapshot)];
  // LOCAL FORK: append the per-key lines, but only when the proxy actually
  // served `/api/keys`. Both formatters return "" without pool detail and are
  // filtered out, so a stats-only proxy renders byte-identically to upstream.
  for (const line of [formatPoolLine(snapshot.pool), formatPoolTailLine(snapshot)]) {
    if (line) lines.push(line);
  }
  // LOCAL FORK: `/api/keys` rejected the master key. The headline numbers above
  // may be cached, so say so instead of rendering a silently stale pool.
  if (snapshot.poolWarning) lines.push(`⚠ ${snapshot.poolWarning}`);
  return lines;
}

export function TavilyQuotaSidebar(props: {
  context: Context;
  state: () => ViewState;
  refresh: (options?: { sync?: boolean }) => Promise<ViewState>;
  busy: () => boolean;
}) {
  const colors = () => readThemeColors(props.context);
  // Keep the quota line on one line; let an error message wrap instead of
  // truncating it, since it can be longer than the sidebar.
  const wrapMode = () => (props.state().status === "error" ? "word" : "none");
  // LOCAL FORK: a mouse-clickable refresh button sharing the reset row.
  // The host enables mouse tracking by default, and OpenTUI bubbles mouse
  // events from the deepest renderable, so the box can own the press.
  const [hovered, setHovered] = createSignal(false);
  const label = () => (props.busy() ? " 刷新中… " : " 刷新额度 ");
  const press = (event: MouseEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    void props.refresh({ sync: true });
  };
  const allLines = () => buildLines(props.state());
  // The reset countdown shares the button's row. Loading does too; an error
  // keeps the full width so it can wrap.
  const inlineLine = () => {
    if (props.state().status === "ready") return allLines()[0] ?? "";
    if (props.state().status === "loading") return "加载中…";
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
          width={REFRESH_BUTTON_WIDTH}
          height={1}
          backgroundColor={hovered() ? BUTTON_WASH_HOVER : BUTTON_WASH_IDLE}
          onMouseUp={press}
          onMouseOver={() => setHovered(true)}
          onMouseOut={() => setHovered(false)}
        >
          <text
            width="100%"
            selectable={false}
            fg={hovered() ? colors().text : colors().textMuted}
          >
            {label()}
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
}) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: `${PLUGIN_ID}.refresh`,
        title: "刷新 Tavily 额度",
        description: "重新拉取 Tavily 剩余额度并显示汇总",
        group: "Tavily",
        palette: true,
        slash: { name: "tavily-quota" },
        run: async () => {
          const next = await props.refresh({ sync: true });
          // LOCAL FORK: multi-line breakdown. Falls back to the original
          // one-line summary when the proxy served no `/api/keys`.
          const message =
            next.status === "ready"
              ? formatPoolDetailLines(next.snapshot).join("\n")
              : next.status === "error"
                ? next.message
                : "仍在加载…";
          // Tie the toast to the open session so the host can title it and offer
          // to open it if the session's family is not on screen.
          const route = props.context.ui.router.current();
          const sessionID = route.type === "session" ? route.sessionID : undefined;
          props.context.ui.toast.show({
            title: "Tavily 额度",
            message,
            variant: next.status === "error" ? "error" : "info",
            ...(sessionID ? { sessionID } : {}),
          });
        },
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
    const refreshMs =
      typeof context.options.refreshMs === "number" && context.options.refreshMs > 0
        ? context.options.refreshMs
        : REFRESH_INTERVAL_MS;

    let disposed = false;
    let inFlight = false;
    const [busy, setBusy] = createSignal(false);

    const refresh = async (options: { sync?: boolean } = {}): Promise<ViewState> => {
      if (inFlight) return state();
      inFlight = true;
      setBusy(true);
      try {
        const result = await fetchQuotaWithFallback({
          apiKey,
          proxyUrl,
          sync: options.sync,
          remote: () => remote.usage({}, {
            location: context.location ?? context.data.location.default(),
          }) as Promise<QuotaResult>,
        });
        if (!disposed) {
          setState(
            result.ok
              ? { status: "ready", snapshot: result.snapshot }
              : { status: "error", message: result.message },
          );
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

    const stopSidebar = context.ui.slot({
      append: "sidebar.content",
      render: () => (
        <TavilyQuotaSidebar context={context} state={state} refresh={refresh} busy={busy} />
      ),
    });

    // `keymap.layer` reads Solid context, so it must be mounted from a slot
    // component rather than called directly during plugin setup.
    const stopCommands = context.ui.slot({
      append: "app",
      render: () => <TavilyQuotaCommands context={context} refresh={refresh} />,
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
