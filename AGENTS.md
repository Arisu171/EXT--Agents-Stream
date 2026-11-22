# Repository Guidelines

## Purpose

Agents Stream is a local VS Code / Cursor extension monorepo:

- `agents-check/`: diff review (Monaco, watcher, snapshots)
- `agents-boxes/`: embedded terminal / chat (xterm, node-pty)
- `agents-stream/`: one shippable extension (`orias.agents-stream`)
- `assets/`: shared icons, media, style, view scripts, and tools
- `public/`: end-user setup guide

## Docs

- `README.md`: overview and quick start
- `ARCHITECTURE.md`: package boundaries and runtime flow
- `ROADMAP.md`: near-term plan
- `public/GUIDE.md`: symlink, compile, F5, package
- `LICENSE`: MIT, Copyright (c) 2026 orias \<alongworkez@gmail.com\>

## Build

Link `assets/` first (see `public/GUIDE.md`), then:

```bash
cd agents-stream && npm install && npm run compile
```

Package: `cd agents-stream && npm run package` writes `build/*.vsix`.

## Safety

- Do not edit generated `out/` by hand
- Do not commit secrets, `.env*`, or `.vsix`
- Keep MIT `LICENSE` and copyright attribution
- Edit shared assets under repo-root `assets/`; package `assets/` entries are links only
- Comments: English only, no inline narration (see `.agents/rules/comment.mdc`), no em-dashes
