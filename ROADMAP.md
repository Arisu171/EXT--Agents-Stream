# Roadmap

Status is local-only (no public marketplace publish yet). Order may change.

## Now

- [x] Unified Agents Stream shell (Check + Boxes)
- [x] Shared `assets/` tree with package junctions
- [x] MIT license and copyright (orias)
- [x] Atomic extension icon
- [x] Package `.vsix` into repo-root `build/`
- [ ] Complete NOTICE-free MIT provenance across all entry docs
- [ ] Smoke checklist for F5: diff accept/revert, terminal tabs, pending files

## Next

- [ ] Bundle or document native dependency rebuild (`node-pty` / Electron ABI)
- [ ] Optional: include required `node_modules` slices in `.vsix` without `--no-dependencies` gaps
- [ ] Tighten `.vscodeignore` (drop debug `.vscode/` from package)
- [ ] User-facing settings pass: Check file rules + Boxes profiles in one settings story
- [ ] Windows / macOS / Linux terminal profile verification matrix

## Later

- [ ] Publish path (marketplace or private feed) and repository metadata
- [ ] Automated smoke tests (Extension Test Host or Playwright-style UI harness)
- [ ] Agent-mode / preview surface restoration if product scope returns it
- [ ] Telemetry-free diagnostics channel polish for support

## Non-goals (current)

- Cloud backend or account system
- Replacing VS Code native SCM diff for human edits
- Shipping separate Check and Boxes `.vsix` as the primary distribution (unified Stream is primary)
