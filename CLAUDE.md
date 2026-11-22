# CLAUDE.md

Monorepo **Agents Stream**: two source packages, one shippable extension.

Local use only; no public GitHub remote yet.

License: MIT. Copyright (c) 2026 orias \<alongworkez@gmail.com\>. See `LICENSE`.

## Packages

| Folder | Role | Docs |
| --- | --- | --- |
| `agents-check/` | Diff review | `agents-check/AGENTS.md`, root `ARCHITECTURE.md` |
| `agents-boxes/` | Terminal / chat | `agents-boxes` sources, root `ARCHITECTURE.md` |
| `agents-stream/` | Unified shell | `agents-stream/package.json` |
| `assets/` | Shared static files + tools | `assets/tools/`, `public/GUIDE.md` |

Root holds workspace + project docs (`README.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `public/GUIDE.md`). Edit feature code in Check / Boxes; edit shared static files in `assets/`; F5 via `agents-stream`.

## Commands

```bash
node assets/tools/sync-assets.mjs
cd agents-stream && npm install && npm run compile
```

Open `ex.code-workspace` and launch **Run Agents Stream**.

Comment rules: English only, no inline comments inside function bodies, no em-dashes (`.agents/rules/comment.mdc`).
