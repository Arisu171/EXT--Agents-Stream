# Agents Check

Diff-review package for Agents Stream. Detects AI CLI file edits and opens a Monaco custom diff editor for hunk accept / revert.

## Layout

- `src/extension.ts`: activation and wiring
- `src/check/`: diff state, snapshots, hunks, Monaco host, navigation
- `src/watcher/`: baseline, path rules, burst hold, git branch / reflog
- `src/runner/`: optional Claude programmatic session
- `src/views/`: pending-files webview
- `src/cmds/`: commands
- `src/utils/`: coalesce, notify
- `../assets/view/`: `diff.monaco.js` / `diff.monaco.css` (via package `assets/` link)

## Build

From repo root, link assets first (`node assets/tools/sync-assets.mjs` or see `public/GUIDE.md`), then:

```bash
npm install
npm run compile
```

Primary workflow is the unified extension: open `ex.code-workspace` and run **Run Agents Stream**.

## Notes

- Custom editor id: `agents-check.diffEditor` (not the VS Code native diff)
- Snapshots persist in workspace state under `agents-check.snapshots`
- Accept advances the in-memory baseline; revert writes original content to disk
- Do not edit `out/` by hand
- Deep design: root `ARCHITECTURE.md`
