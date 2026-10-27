// Root TUI entrypoint.
//
// OpenCode loads a *directory* plugin from entry files at the plugin root; it
// does not consult package.json `exports` in that mode. Without this file the
// plugin reports `features: { server: true }` only and the sidebar never
// renders.
//
// It forwards to `dist/tui.js`, which is babel-compiled with babel-preset-solid.
// Loading the raw `tui.tsx` instead fails, because the Solid JSX runtime cannot
// be resolved from a plugin cache.
export * from "./dist/tui.js";
export { default } from "./dist/tui.js";
