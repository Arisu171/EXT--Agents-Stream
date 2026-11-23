# Agents Stream: run guide

This guide is for developers cloning the monorepo. Follow the **assets link** step before any compile.

## Prerequisites

- Node.js 20+ (or the version you already use for VS Code extension work)
- npm
- VS Code or Cursor
- Windows: Developer Mode or an elevated shell helps if symlink creation fails (junctions usually work without elevation)

## 1. Link `assets/` into the three packages (required)

Every package loads icons and webview files from `./assets/...`. That folder must point at the repo-root `assets/` directory.

### Option A: use the sync script (recommended)

From the repository root:

```bash
node assets/tools/sync-assets.mjs
```

This creates `agents-check/assets`, `agents-boxes/assets`, and `agents-stream/assets` as junctions (Windows) or directory symlinks (POSIX), and copies `LICENSE` into each package.
It also hardlinks the repo-root `README.md` into `agents-stream/README.md` so VS Code can read the extension README from the VSIX.

### Option B: manual links

**Windows (PowerShell, repo root):**

```powershell
New-Item -ItemType Junction -Path "agents-check\assets" -Target (Resolve-Path "assets")
New-Item -ItemType Junction -Path "agents-boxes\assets" -Target (Resolve-Path "assets")
New-Item -ItemType Junction -Path "agents-stream\assets" -Target (Resolve-Path "assets")
Copy-Item -Force "LICENSE" "agents-check\LICENSE"
Copy-Item -Force "LICENSE" "agents-boxes\LICENSE"
Copy-Item -Force "LICENSE" "agents-stream\LICENSE"
```

**macOS / Linux (repo root):**

```bash
ln -s ../assets agents-check/assets
ln -s ../assets agents-boxes/assets
ln -s ../assets agents-stream/assets
cp LICENSE agents-check/LICENSE
cp LICENSE agents-boxes/LICENSE
cp LICENSE agents-stream/LICENSE
```

Verify:

```bash
# Expect icon.png under each package assets path
ls agents-check/assets/icon.png
ls agents-boxes/assets/icon.png
ls agents-stream/assets/icon.png
```

`npm run compile` / `precompile` also runs sync, but linking once up front avoids editor and vsce surprises.

## 2. Install dependencies

```bash
cd agents-stream
npm install
```

If you debug Check or Boxes alone, also run `npm install` inside those folders.

## 3. Compile

```bash
cd agents-stream
npm run compile
```

This compiles Check, Boxes, and the shell, stages `out/check` and `out/boxes`, and re-runs asset sync.

## 4. Launch (F5)

1. Open `ex.code-workspace` in VS Code / Cursor.
2. Run launch configuration **Run Agents Stream**.
3. A new Extension Development Host window opens with the unified extension.

Optional: **Run Diff Extension (Check only)** or **Run Chat Extension (Boxes only)** for isolated debugging.

## 5. Package a `.vsix`

```bash
cd agents-stream
npm run package
```

Artifact: `build/agents-stream-<version>.vsix` at the repo root.

Install from the VSIX in VS Code: **Extensions: Install from VSIX...**

Production dependencies (`diff`, `ignore`, `monaco-editor`, `node-pty`, xterm packages) are bundled into the `.vsix`. Native `node-pty` is built for the machine that ran `npm run package`; another OS/arch may need a local rebuild.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Missing icon or blank diff/terminal chrome | `assets` link missing; re-run `node assets/tools/sync-assets.mjs` |
| Terminal fails to spawn | Rebuild `node-pty` for the host Electron ABI |
| `vsce` license warning | Root `LICENSE` must be copied into `agents-stream/` (sync script does this) |
| Stale Check/Boxes behavior after edit | Re-run `npm run compile` in `agents-stream`, then reload the Extension Development Host |

## Related docs

- [README.md](../README.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [ROADMAP.md](../ROADMAP.md)
