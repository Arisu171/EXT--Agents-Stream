# Agents Check (Claude context)

Inline review for AI CLI file edits inside VS Code / Cursor.

## Commands

```bash
npm install
npm run compile
npm run watch
```

Link repo-root `assets/` before compile (`node ../assets/tools/sync-assets.mjs`). Prefer launching via **Run Agents Stream** from `ex.code-workspace`.

## Architecture (short)

- `WorkspaceWatcher` + baseline store detect external writes
- `DiffManager` owns before-images, panels, and accept / revert
- `DiffEditorProvider` hosts Monaco DiffEditor in a webview (`assets/view/`)
- `GitBranchWatcher` clears or holds burst writes on branch / reflog events
- Optional `ClaudeRunner` for built-in `startSession` (Claude only)

EOL handling: normalize to LF for hunk math; restore document EOL on write-back.

See root `ARCHITECTURE.md` for the full monorepo picture.
