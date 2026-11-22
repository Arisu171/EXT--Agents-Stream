# Agents Stream

VS Code / Cursor extension monorepo that combines **Agents Check** (inline diff review for AI CLI edits) and **Agents Boxes** (embedded multi-tab terminal) into one shippable extension: `orias.agents-stream`.

**License:** MIT  
**Copyright:** (c) 2026 orias \<alongworkez@gmail.com\>

## Packages

| Path | Role |
| --- | --- |
| `agents-check/` | Diff review: baseline, watcher, Monaco custom editor |
| `agents-boxes/` | Terminal / chat: xterm, node-pty, profiles, templates |
| `agents-stream/` | Unified extension shell (F5 / vsce) |
| `assets/` | Shared icons, media, style, view scripts, build tools |
| `public/` | End-user guides |
| `build/` | Packaged `.vsix` output (gitignored) |

## Quick start

1. Link `assets/` into the three packages (required before compile). See [public/GUIDE.md](public/GUIDE.md).
2. Install and compile:

```bash
cd agents-stream
npm install
npm run compile
```

3. Open `ex.code-workspace` and launch **Run Agents Stream**.

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md): runtime shape and package boundaries
- [ROADMAP.md](ROADMAP.md): near-term plan
- [public/GUIDE.md](public/GUIDE.md): setup, symlink, F5, package `.vsix`
- [LICENSE](LICENSE): MIT terms

## Package from source

```bash
cd agents-stream
npm run package
```

Output: `build/agents-stream-<version>.vsix`
