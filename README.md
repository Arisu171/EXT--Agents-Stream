<p align="center">
  <img src="assets/icon.png" width="128" alt="Agents Stream icon">
</p>

<h1 align="center">Agents Stream</h1>

<p align="center">
  Review AI-generated file edits with confidence and run AI CLI tools inside VS Code or Cursor.
</p>

<p align="center">
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License">
  </a>
  <a href="https://github.com/Arisu171/EXT--Agents-Stream/releases">
    <img src="https://img.shields.io/badge/status-local%20extension-orange.svg" alt="Local extension">
  </a>
  <a href="https://github.com/Arisu171/EXT--Agents-Stream/issues">
    <img src="https://img.shields.io/badge/support-issues-lightgrey.svg" alt="Report an issue">
  </a>
</p>

Agents Stream combines diff review and an embedded terminal in one extension:

- **Agents Check** detects edits made by AI tools, opens them in a clear Monaco diff view, and lets you accept or revert individual hunks or whole files.
- **Agents Boxes** provides a multi-tab terminal with IDE-aware profiles and launch templates for AI CLI workflows.

## Features

### Review AI edits

- Detect changes in tracked workspace files
- Keep before-images for each edit session
- Compare original and modified content in a dedicated diff editor
- Accept or revert changes by hunk or by file
- Navigate pending files from the Agents Check activity-bar view
- Resume pending edits after VS Code reload
- Exclude files or folders using `.gitignore`-style patterns

### Work in an embedded terminal

- Open multiple terminal tabs
- Run AI CLIs without leaving VS Code
- Use IDE-aware terminal profiles
- Keep terminal sessions organized with launch templates
- Prevent Alt+Tab from moving focus away from the terminal

## Requirements

- VS Code 1.85 or newer, or a compatible editor such as Cursor
- Node.js and platform-specific native dependencies when building from source
- `node-pty` must match the Electron ABI used by the host editor

## Installation

### Install a VSIX

1. Download `agents-stream-<version>.vsix`.
2. Open VS Code.
3. Run **Extensions: Install from VSIX...**.
4. Select the `.vsix` file.
5. Reload the window if prompted.

For local development, you can also launch the extension with VS Code's Extension Development Host.

## Getting started

1. Open a workspace folder.
2. Start an AI CLI in the Agents Boxes terminal.
3. Let the AI edit files in the workspace.
4. Open **Agents Check** in the Activity Bar.
5. Review the pending files and accept or revert the changes.

## Commands

| Command | Description |
| --- | --- |
| `Agents Check: Start Claude Session` | Start a Claude session |
| `Agents Check: Accept All Changes` | Accept all hunks across the pending files |
| `Agents Check: Accept All Changes (All Files)` | Accept every pending file |
| `Agents Check: Revert All Changes` | Revert all pending hunks |
| `Agents Check: Open Pending File` | Open a pending file |
| `Agents Check: Accept File` | Accept all changes in a file |
| `Agents Check: Get Pending Summaries` | Refresh pending file summaries |
| `Agents Check: Next Edited File` | Navigate to the next edited file |
| `Agents Check: Previous Edited File` | Navigate to the previous edited file |
| `Agents Boxes: Focus Terminal` | Focus the embedded terminal |

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+A` | Start Claude session |
| `Cmd+Shift+A` | Start Claude session on macOS |
| `Ctrl+Shift+Y` | Accept all hunks |
| `Ctrl+Shift+Z` | Revert all hunks |
| `Alt+H` | Open the previous edited file |
| `Alt+L` | Open the next edited file |

## Settings

### Agents Check

- `agents-check.supportedFileDetectionMode`
- `agents-check.includedPaths`
- `agents-check.excludedPaths`
- `agents-check.respectGitignore`
- `agents-check.maxFileLines`
- `agents-check.baselineScanConcurrency`
- `agents-check.burstDetectionEnabled`
- `agents-check.burstDetectionWindowMs`
- `agents-check.burstDetectionThreshold`
- `agents-check.burstDetectionHoldMs`

Deprecated extension settings for file detection remain available for backward compatibility. New configurations should use `agents-check.includedPaths` and `agents-check.excludedPaths`.

### Agents Boxes

- `agents-boxes.preventAltMenuFocus`

## Privacy

Agents Stream operates locally in VS Code or Cursor. It does not provide a cloud backend or account system. AI CLI tools may have their own network access, authentication, data handling, and usage policies.

## Troubleshooting

### Terminal does not start

Rebuild or reinstall `node-pty` for the Electron ABI used by your VS Code or Cursor build.

### Extension assets are missing

When running from source, synchronize the shared assets and rebuild the extension:

```bash
node assets/tools/sync-assets.mjs
cd agents-stream
npm run compile
```

### VSIX is not working

Remove older copies, package the extension again, and install the fresh VSIX.

```bash
cd agents-stream
npm run package
```

## License

MIT License. Copyright (c) 2026 orias \<alongworkez@gmail.com\>.

See [LICENSE](LICENSE).

---

<p align="center">
  <strong>Agents Stream</strong><br>
  AI-assisted diff review and terminal workflows for VS Code and Cursor
</p>

<p align="center">
  <a href="https://github.com/Arisu171/EXT--Agents-Stream">Repository</a>
  ·
  <a href="https://github.com/Arisu171/EXT--Agents-Stream/issues">Report an issue</a>
  ·
  <a href="LICENSE">MIT License</a>
</p>
