## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run build` run and `dist/` committed (CI fails if it is stale)
- [ ] Behaviour changes have a test; formatting changes have none but still pass
- [ ] `README.md` updated if an option, command, or the rendered output changed
- [ ] `CHANGELOG.md` updated under `[Unreleased]`

## Credentials

- [ ] No API keys, tokens, or `.env` contents in this diff

If the change touches credential handling, read [SECURITY.md](./SECURITY.md):
the key must never leave the process except as a request header to the
configured endpoint, and a rejected credential must never be presented as
success.
