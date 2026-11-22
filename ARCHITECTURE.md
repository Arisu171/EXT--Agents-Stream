# Architecture

## Overview

Agents Stream is a local VS Code extension monorepo. Two source packages implement features; one shell package ships them together under a single `extensionDevelopmentPath` / `.vsix`.

```
agents-stream (activate)
  ├── out/check/*   ← assembled from agents-check
  └── out/boxes/*   ← assembled from agents-boxes

assets/ (repo root)
  └── junction/symlink as <pkg>/assets in each package
```

## Package boundaries

### agents-check

Detects file edits from AI CLIs (workspace watcher + baseline), stores before-images, and opens a Monaco **custom** diff editor (`agents-check.diffEditor`) for hunk-level accept / revert.

Main areas under `agents-check/src/`:

| Area | Responsibility |
| --- | --- |
| `check/` | Diff state, snapshots, hunks, Monaco webview host, navigation |
| `watcher/` | Baseline scan, path rules, burst hold, git branch / reflog |
| `runner/` | Optional Claude programmatic runner (`startSession`) |
| `views/` | Pending-files webview |
| `cmds/` | Command registration |
| `utils/` | Coalesced refresh, notify helpers |

Webview assets for the diff UI live in `assets/view/` (`diff.monaco.js`, `diff.monaco.css`). Monaco itself is loaded from `node_modules/monaco-editor/min` at runtime.

### agents-boxes

Embedded PTY terminal (xterm.js + node-pty) with multi-tab sessions, IDE profiles, and launch templates. When running inside Agents Stream, Check API is injected; when running alone, Boxes may fall back to the `orias.agents-check` extension id.

Main areas under `agents-boxes/src/boxes/`:

| Area | Responsibility |
| --- | --- |
| `chatTerminalPanel.ts` / `chatTerminalHtml.ts` | Webview host and HTML shell |
| `terminalSessions.ts` / `ptySession.ts` | Session store and PTY lifecycle |
| `terminalProfiles.ts` / `launchTemplates.ts` / `terminalThemes.ts` | Profiles, templates, themes |
| `freshEnv.ts` / `cwdTracker.ts` / `altMenuFocus.ts` | Windows env refresh, cwd, focus tweak |

Static terminal assets: `assets/media/` (xterm scripts), `assets/style/terminal.css`.

### agents-stream

Thin activate/deactivate shell. `assets/tools/assemble.mjs` compiles Check and Boxes, copies `out/` into `agents-stream/out/check` and `out/boxes`, then syncs the `assets/` link.

### assets

Single shared tree (not duplicated per package):

| Path | Contents |
| --- | --- |
| `icon.png` / `icon.svg` | Extension and activity-bar icons |
| `media/` | xterm browser bundles |
| `style/` | Shared CSS (terminal) |
| `view/` | Diff webview scripts |
| `tools/` | `sync-assets.mjs`, `assemble.mjs`, `package.mjs` |

Each of `agents-check`, `agents-boxes`, and `agents-stream` must expose `./assets` as a directory junction (Windows) or symlink (POSIX) to the repo-root `assets/` folder. Runtime URIs are always `extensionUri/assets/...`.

## Activation flow

1. Host loads `agents-stream` (`onStartupFinished`).
2. Shell `require`s assembled `./check/extension` then `./boxes/extension`.
3. Check activates and returns its API.
4. Boxes activates with that API (pending list, accept/revert hooks, settings bridge).

## Diff pipeline (Check)

1. Baseline scanner snapshots eligible text files per workspace folder.
2. `WorkspaceWatcher` observes saves and external writes; exclusions, gitignore, size limits, and burst detection filter noise.
3. On a qualifying edit, `DiffManager` keeps the before-image and opens the Monaco custom editor.
4. Webview posts hunk accept/reject; accept advances the in-memory baseline, reject writes original content back to disk.
5. Snapshots persist in workspace state so pending diffs survive reload.

## Build and package

| Script | Action |
| --- | --- |
| `assets/tools/sync-assets.mjs` | Link `assets/`, copy root `LICENSE` into each package |
| `assets/tools/assemble.mjs` | Compile Check + Boxes + shell, stage `out/` |
| `assets/tools/package.mjs` | `vsce package` into repo-root `build/*.vsix` |

`agents-stream` npm scripts: `compile` → assemble; `package` → compile then package.
