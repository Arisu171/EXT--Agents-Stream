import * as vscode from 'vscode';
import {
  DEFAULT_BURST_DETECTION_SETTINGS,
  DEFAULT_FILE_LIMIT_SETTINGS,
  DEFAULT_FOCUS_SETTINGS,
  DEFAULT_SETTINGS,
} from './terminalTypes';
import { TERMINAL_THEMES } from './terminalThemes';

const TAB_ICON_ATTRS =
  'viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const TAB_ICON_SETTINGS = `<svg ${TAB_ICON_ATTRS}><path d="M4 8h16M4 16h16"/><circle cx="9" cy="8" r="2.5"/><circle cx="15" cy="16" r="2.5"/></svg>`;

export function buildChatTerminalHtml(args: {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
}): string {
  const { webview, extensionUri } = args;
  const nonce = randomNonce();
  const xtermCss = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'media', 'xterm.css'));
  const xtermJs = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'media', 'xterm.js'));
  const fitJs = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'media', 'xterm-addon-fit.js'));
  const terminalCss = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'assets', 'style', 'terminal.css')
  );
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
  ].join('; ');

  const defaults = {
    ...DEFAULT_SETTINGS,
    ...DEFAULT_BURST_DETECTION_SETTINGS,
    ...DEFAULT_FOCUS_SETTINGS,
    ...DEFAULT_FILE_LIMIT_SETTINGS,
  };
  const themes = Object.fromEntries(TERMINAL_THEMES.map((t) => [t.id, t.colors]));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${xtermCss}">
<link rel="stylesheet" href="${terminalCss}">
<style>
  #header-actions { margin-left: auto; }
  #tab-strip .tab-add { margin-right: 0; }
  .tab-add-wrap { position: relative; display: inline-flex; flex: 0 0 auto; align-items: center; }
  .launch-menu {
    position: absolute; z-index: 50; top: 30px; right: 0; left: auto;
    width: min(420px, calc(100vw - 16px)); height: 240px;
    display: grid; grid-template-columns: 1fr 1fr; padding: 0; overflow: hidden;
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)));
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, rgba(128,128,128,0.35)));
    border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
    font-family: var(--vscode-font-family); font-size: 13px;
  }
  .launch-menu[hidden] { display: none; }
  .launch-col { display: flex; flex-direction: column; min-width: 0; border-right: 1px solid rgba(128,128,128,0.3); }
  .launch-col:last-child { border-right: none; }
  .launch-col-title {
    padding: 6px 10px 4px; font-size: 11px; opacity: 0.6;
    border-bottom: 1px solid var(--vscode-menu-separatorBackground, rgba(128,128,128,0.3));
  }
  .launch-col-list { flex: 1; overflow: auto; padding: 6px; }
  .launch-item {
    display: flex; align-items: center; gap: 10px; width: 100%;
    padding: 7px 10px; border: none; border-radius: 7px; background: transparent;
    color: inherit; font: inherit; text-align: left; cursor: pointer;
  }
  .launch-item:hover {
    background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground, rgba(128,128,128,0.2)));
    color: var(--vscode-menu-selectionForeground, inherit);
  }
  .launch-item .meta { margin-left: auto; font-size: 12px; opacity: 0.6; }
  .launch-empty { padding: 10px 8px; opacity: 0.55; font-size: 12px; }

  #app-footer {
    flex: 0 0 auto; padding: 6px 8px;
    border-top: 1px solid var(--chrome-border, var(--vscode-panel-border, rgba(128,128,128,0.25)));
    background: var(--chrome-bg, var(--vscode-sideBar-background));
  }
  .accept-combo {
    position: relative; display: flex; align-items: stretch; gap: 1px; width: 100%;
  }
  #btn-accept-all, #btn-accept-combo {
    height: 28px; cursor: pointer; font-family: inherit; font-size: 12px; font-weight: 600;
    color: var(--vscode-foreground, #cccccc);
    background: color-mix(in srgb, var(--chrome-bg, var(--vscode-sideBar-background, #1e1e1e)) 72%, #000);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.45));
    transition: border-color 0.12s, filter 0.12s, opacity 0.12s;
  }
  #btn-accept-all {
    flex: 1 1 auto; min-width: 0; border-radius: 7px 0 0 7px; text-align: center; padding: 0 10px;
  }
  #btn-accept-combo {
    flex: 0 0 28px; width: 28px; border-radius: 0 7px 7px 0; padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .accept-combo.has-pending #btn-accept-all,
  .accept-combo.has-pending #btn-accept-combo {
    border-color: var(--vscode-focusBorder, #007acc);
  }
  .accept-combo:not(.has-pending) #btn-accept-all,
  .accept-combo:not(.has-pending) #btn-accept-combo {
    border-color: var(--vscode-panel-border, rgba(128,128,128,0.45));
  }
  #btn-accept-all:disabled, #btn-accept-combo:disabled { opacity: 0.45; cursor: default; }
  #btn-accept-all:not(:disabled):hover, #btn-accept-combo:not(:disabled):hover { filter: brightness(1.1); }
  #pending-menu {
    --pending-row-h: 22px;
    position: absolute; z-index: 40; left: 0; right: 0; bottom: calc(100% + 4px);
    max-height: calc(var(--pending-row-h) * 10.5); overflow: auto; padding: 2px 0;
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)));
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, rgba(128,128,128,0.35)));
    border-radius: 6px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
    font-family: var(--vscode-font-family); font-size: 13px;
  }
  #pending-menu[hidden] { display: none; }
  .pending-row {
    display: flex; align-items: center; gap: 6px; width: 100%;
    height: var(--pending-row-h); padding: 0 8px; border: none; border-radius: 0; background: transparent;
    color: inherit; font: inherit; text-align: left; cursor: pointer; box-sizing: border-box;
  }
  .pending-row:hover {
    background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.16));
  }
  .pending-meta {
    flex: 1 1 auto; min-width: 0;
    display: flex; flex-direction: row; align-items: baseline; gap: 6px;
  }
  .pending-name {
    flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .pending-path {
    flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 12px; opacity: 0.45;
  }
  .pending-add { color: var(--vscode-gitDecoration-addedResourceForeground, #81b88b); font-variant-numeric: tabular-nums; flex: 0 0 auto; font-size: 12px; }
  .pending-del { color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39); font-variant-numeric: tabular-nums; flex: 0 0 auto; font-size: 12px; }
  .pending-accept {
    flex: 0 0 auto; width: 22px; height: 22px; margin-left: 2px; padding: 0;
    border: none; border-radius: 4px; background: transparent; cursor: pointer; line-height: 0;
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--vscode-gitDecoration-addedResourceForeground, #81b88b);
  }
  .pending-accept svg { display: block; }
  .pending-accept:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
  .pending-empty { padding: 6px 8px; opacity: 0.55; font-size: 12px; }

  #settings-overlay {
    color: var(--vscode-foreground, #cccccc);
    font-family: var(--vscode-font-family);
    font-size: 13px;
  }
  .settings-cards {
    display: block !important;
    grid-template-columns: none !important;
    margin-top: 10px;
  }
  .settings-card {
    border: none !important;
    border-radius: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    padding: 0 !important;
    margin: 0 0 0 0;
  }
  .settings-card-title {
    margin: 0 0 10px !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    background: transparent !important;
    text-transform: none !important;
    letter-spacing: 0 !important;
    text-shadow: none !important;
    font-size: 13px !important;
    font-weight: 700 !important;
    color: var(--vscode-foreground, #cccccc);
  }
  .settings-spacer {
    width: 66.666%;
    height: 0;
    margin: 18px auto;
    border: none;
    border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.45));
  }
  .settings-table { display: flex; flex-direction: column; gap: 8px; }
  #tpl-editor { display: flex; flex-direction: column; gap: 8px; }
  .settings-row {
    display: flex; align-items: center; gap: 12px; min-height: 26px;
  }
  .settings-row > label {
    flex: 0 0 160px; color: var(--vscode-foreground, #cccccc);
    opacity: 0.9; white-space: nowrap; font-size: 13px;
  }
  .settings-row > .settings-value,
  .settings-row > input,
  .settings-row > select,
  .settings-row > textarea {
    flex: 1 1 auto; min-width: 0;
  }
  .settings-row input[type="text"],
  .settings-row input[type="number"],
  .settings-row select,
  .settings-row textarea {
    height: 26px; box-sizing: border-box;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #cccccc);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px; padding: 2px 6px; font: inherit;
  }
  .settings-row input[type="number"] {
    -moz-appearance: textfield;
    appearance: textfield;
  }
  .settings-row input[type="number"]::-webkit-outer-spin-button,
  .settings-row input[type="number"]::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .settings-row textarea.tpl-commands {
    height: auto; min-height: 72px; resize: vertical; padding: 6px;
  }
  .settings-row.align-start { align-items: flex-start; }
  .settings-row.align-start > label { padding-top: 4px; }
  .settings-row.field-check { justify-content: flex-start; }
  .settings-row.field-check input[type="checkbox"] { flex: 0 0 auto; width: auto; height: auto; }
  .settings-actions {
    display: flex; gap: 8px; margin: 10px 0 0; flex-wrap: wrap;
    justify-content: flex-end;
  }
  .settings-actions .btn-settings {
    height: auto; min-height: 28px; padding: 4px 16px; border-radius: 4px; cursor: pointer;
    font-family: inherit; font-size: 13px; font-weight: 700; line-height: 1.2;
    color: var(--vscode-foreground, #cccccc);
    background: color-mix(in srgb, var(--vscode-sideBar-background, #1e1e1e) 70%, #000);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.45));
    box-shadow: none !important;
    text-shadow: none !important;
    background-image: none !important;
  }
  .settings-actions .btn-settings:hover { filter: brightness(1.1); }
</style>
</head>
<body class="page-terminal">
  <div id="tab-strip">
    <div id="tabs" class="tabs"></div>
    <div id="header-actions">
      <div class="tab-add-wrap">
        <button id="tab-add" class="tab-add" type="button" title="Profiles and templates" aria-label="New terminal" aria-haspopup="menu" aria-expanded="false">+</button>
        <div id="launch-menu" class="launch-menu" role="menu" hidden>
          <div class="launch-col">
            <div class="launch-col-title">Terminals</div>
            <div id="launch-profiles" class="launch-col-list"></div>
          </div>
          <div class="launch-col">
            <div class="launch-col-title">Templates</div>
            <div id="launch-templates" class="launch-col-list"></div>
          </div>
        </div>
      </div>
      <button id="btn-settings" class="header-btn" type="button" title="Settings" aria-label="Settings">
        ${TAB_ICON_SETTINGS}
      </button>
    </div>
  </div>
  <div id="content">
    <div id="term-wrap">
      <div id="err"></div>
      <div id="term-host"></div>
      <div id="settings-overlay" hidden>
        <div class="settings-cards">
          <section class="settings-card">
            <h3 class="settings-card-title">Configurations</h3>
            <div class="settings-table">
              <div class="settings-row field-check"><label for="f-burst-enabled">Burst detection</label><input id="f-burst-enabled" type="checkbox"></div>
              <div class="settings-row"><label for="f-burst-threshold">Burst threshold</label><input id="f-burst-threshold" type="number" min="2" max="500"></div>
              <div class="settings-row"><label for="f-burst-window">Burst window (ms)</label><input id="f-burst-window" type="number" min="50" max="5000"></div>
              <div class="settings-row"><label for="f-burst-hold">Burst hold (ms)</label><input id="f-burst-hold" type="number" min="500" max="10000"></div>
              <div class="settings-row"><label for="f-max-file-lines">Max file lines</label><input id="f-max-file-lines" type="number" min="0" max="200000"></div>
              <div class="settings-row field-check"><label for="f-prevent-alt-menu-focus">Keep focus on Alt</label><input id="f-prevent-alt-menu-focus" type="checkbox"></div>
            </div>
            <div class="settings-actions">
              <button id="btn-reset" class="btn-settings" type="button">Reset</button>
              <button id="btn-apply" class="btn-settings" type="button">Apply</button>
            </div>
          </section>
          <div class="settings-spacer"></div>
          <section class="settings-card">
            <h3 class="settings-card-title">Templates</h3>
            <div class="settings-table">
              <div class="settings-row">
                <label for="tpl-select">Template</label>
                <select id="tpl-select"></select>
              </div>
              <div id="tpl-editor">
                <div class="settings-row"><label for="tpl-name">Name</label><input id="tpl-name" type="text"></div>
                <div class="settings-row"><label for="tpl-profile">Terminal</label><select id="tpl-profile"></select></div>
                <div class="settings-row align-start"><label for="tpl-commands">Commands</label><textarea id="tpl-commands" class="tpl-commands" placeholder="one command per line (runs with the shell, e.g. claude)"></textarea></div>
                <input type="hidden" id="tpl-id" value="">
                <div class="settings-actions">
                  <button id="btn-tpl-new" class="btn-settings" type="button">New</button>
                  <button id="btn-tpl-save" class="btn-settings" type="button">Save</button>
                  <button id="btn-tpl-delete" class="btn-settings" type="button">Delete</button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
  <div id="app-footer">
    <div id="accept-combo" class="accept-combo">
      <button id="btn-accept-all" type="button" title="Requires Agents Check extension">Accept all 0 pending file</button>
      <button id="btn-accept-combo" type="button" title="Pending files" aria-haspopup="menu" aria-expanded="false" aria-label="Pending files">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M4.5 6.5L8 10l3.5-3.5"/></svg>
      </button>
      <div id="pending-menu" role="menu" hidden></div>
    </div>
  </div>
  <script nonce="${nonce}" src="${xtermJs}"></script>
  <script nonce="${nonce}" src="${fitJs}"></script>
  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const DEFAULTS = ${JSON.stringify(defaults)};
      const BUILTIN_THEMES = ${JSON.stringify(themes)};
      let currentSettings = JSON.parse(JSON.stringify(DEFAULTS));
      let appliedSettings = JSON.parse(JSON.stringify(DEFAULTS));
      const sessions = new Map();
      let activeId = null;
      let launchProfiles = [];
      let launchTemplates = [];
      let pendingFiles = [];
      let diffAvailable = false;
      let selectedTplId = '';
      const ICON_TICK = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M2.5 8.5L6 12L13.5 3.5"/></svg>';

      const tabsEl = document.getElementById('tabs');
      const termHost = document.getElementById('term-host');
      const errEl = document.getElementById('err');
      const btnAdd = document.getElementById('tab-add');
      const launchMenu = document.getElementById('launch-menu');
      const overlay = document.getElementById('settings-overlay');
      const acceptCombo = document.getElementById('accept-combo');
      const btnAcceptAll = document.getElementById('btn-accept-all');
      const btnAcceptCombo = document.getElementById('btn-accept-combo');
      const pendingMenu = document.getElementById('pending-menu');
      if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

      function writeTerminalError(id, msg) {
        const text = String(msg || 'error');
        const s = (id && sessions.get(id)) || sessions.get(activeId);
        if (s) {
          try {
            s.term.writeln('');
            s.term.writeln('\\x1b[31m' + text + '\\x1b[0m');
            s.term.writeln('');
            s.term.focus();
          } catch (_) {}
          return;
        }
        if (errEl) {
          errEl.style.display = 'block';
          errEl.textContent = text;
          setTimeout(() => {
            if (errEl.textContent === text) {
              errEl.style.display = 'none';
              errEl.textContent = '';
            }
          }, 8000);
        }
      }
      function pickVar(name, fallback) {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
          || getComputedStyle(document.body).getPropertyValue(name).trim();
        return v || fallback;
      }
      function resolveVscodeTheme() {
        const bg = pickVar('--vscode-terminal-background', '') || pickVar('--vscode-editor-background', '#1f1f1f');
        const fg = pickVar('--vscode-terminal-foreground', '') || pickVar('--vscode-editor-foreground', '#cccccc');
        const cursor = pickVar('--vscode-terminalCursor-foreground', '') || fg;
        const selection = pickVar('--vscode-terminal-selectionBackground', '') || pickVar('--vscode-editor-selectionBackground', '#264f78');
        const ansi = (name, fb) => pickVar('--vscode-terminal-ansi' + name, fb);
        return {
          background: bg,
          foreground: fg,
          cursor,
          cursorAccent: pickVar('--vscode-terminalCursor-background', '') || bg,
          selectionBackground: selection,
          black: ansi('Black', '#000000'),
          red: ansi('Red', '#cd3131'),
          green: ansi('Green', '#0dbc79'),
          yellow: ansi('Yellow', '#e5e510'),
          blue: ansi('Blue', '#2472c8'),
          magenta: ansi('Magenta', '#bc3fbc'),
          cyan: ansi('Cyan', '#11a8cd'),
          white: ansi('White', '#e5e5e5'),
          brightBlack: ansi('BrightBlack', '#666666'),
          brightRed: ansi('BrightRed', '#f14c4c'),
          brightGreen: ansi('BrightGreen', '#23d18b'),
          brightYellow: ansi('BrightYellow', '#f5f543'),
          brightBlue: ansi('BrightBlue', '#3b8eea'),
          brightMagenta: ansi('BrightMagenta', '#d670d6'),
          brightCyan: ansi('BrightCyan', '#29b8db'),
          brightWhite: ansi('BrightWhite', '#e5e5e5'),
        };
      }
      function resolveTheme(s) {
        if (s.themePreset === 'vscode' || !s.themePreset) return resolveVscodeTheme();
        if (BUILTIN_THEMES[s.themePreset]) return BUILTIN_THEMES[s.themePreset];
        if (s.themePreset === 'custom') return s.customColors;
        return resolveVscodeTheme();
      }
      function applySettings(s) {
        currentSettings = s;
        const theme = resolveTheme(s);
        document.documentElement.style.setProperty('--term-bg', theme.background);
        document.body.style.background = theme.background;
        const termWrap = document.getElementById('term-wrap');
        if (termWrap) termWrap.style.background = theme.background;
        for (const sess of sessions.values()) {
          sess.term.options.fontFamily = s.fontFamily;
          sess.term.options.fontSize = s.fontSize;
          sess.term.options.theme = theme;
          try { sess.fit.fit(); } catch (_) {}
        }
      }

      function startSession(opts) {
        opts = opts || {};
        const active = sessions.get(activeId);
        vscode.postMessage({
          type: 'createSession',
          cols: active ? active.term.cols : 80,
          rows: active ? active.term.rows : 24,
          profileId: opts.profileId,
          templateId: opts.templateId,
        });
        closeLaunchMenu();
      }

      function closeLaunchMenu() {
        launchMenu.hidden = true;
        btnAdd.setAttribute('aria-expanded', 'false');
      }

      function renderLaunchColumn(el, items, empty, onPick) {
        el.innerHTML = '';
        if (!items.length) {
          const d = document.createElement('div'); d.className = 'launch-empty'; d.textContent = empty; el.appendChild(d); return;
        }
        items.forEach((item) => {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'launch-item';
          const name = document.createElement('span'); name.className = 'agent-name'; name.textContent = item.label; b.appendChild(name);
          if (item.meta) { const m = document.createElement('span'); m.className = 'meta'; m.textContent = item.meta; b.appendChild(m); }
          b.addEventListener('click', () => onPick(item));
          el.appendChild(b);
        });
      }

      function renderLaunchMenu() {
        renderLaunchColumn(
          document.getElementById('launch-profiles'),
          launchProfiles.map((p) => ({ label: p.label, meta: p.isDefault ? 'default' : '', profileId: p.id })),
          'No profiles',
          (i) => startSession({ profileId: i.profileId })
        );
        const list = document.getElementById('launch-templates');
        renderLaunchColumn(
          list,
          launchTemplates.map((t) => ({ label: t.name, templateId: t.id })),
          'No templates',
          (i) => startSession({ templateId: i.templateId })
        );
        const add = document.createElement('button');
        add.type = 'button'; add.className = 'launch-item'; add.textContent = '+ New template…';
        add.addEventListener('click', () => { closeLaunchMenu(); openSettings(); });
        list.appendChild(add);
      }

      function fillTemplateProfileSelect() {
        const sel = document.getElementById('tpl-profile');
        const cur = sel.value; sel.innerHTML = '';
        launchProfiles.forEach((p) => {
          const o = document.createElement('option'); o.value = p.id;
          o.textContent = p.isDefault ? p.label + ' (default)' : p.label; sel.appendChild(o);
        });
        if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
        else { const d = launchProfiles.find((p) => p.isDefault); if (d) sel.value = d.id; }
      }

      function fillTemplateSelect() {
        const sel = document.getElementById('tpl-select');
        const prev = selectedTplId || sel.value;
        sel.innerHTML = '';
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = launchTemplates.length ? 'Select a template…' : 'No templates yet';
        sel.appendChild(blank);
        launchTemplates.forEach((t) => {
          const o = document.createElement('option');
          o.value = t.id;
          o.textContent = t.name;
          sel.appendChild(o);
        });
        if (prev && [...sel.options].some((o) => o.value === prev)) {
          sel.value = prev;
          selectedTplId = prev;
        } else {
          sel.value = '';
          selectedTplId = '';
        }
        loadSelectedTemplate();
      }

      function loadSelectedTemplate() {
        const id = document.getElementById('tpl-select').value;
        selectedTplId = id;
        fillTemplateProfileSelect();
        if (!id) {
          document.getElementById('tpl-id').value = '';
          document.getElementById('tpl-name').value = '';
          document.getElementById('tpl-commands').value = '';
          return;
        }
        const t = launchTemplates.find((x) => x.id === id);
        if (!t) return;
        document.getElementById('tpl-id').value = t.id;
        document.getElementById('tpl-name').value = t.name;
        document.getElementById('tpl-profile').value = t.profileId;
        document.getElementById('tpl-commands').value = (t.commands || []).join('\\n');
      }

      function updateAcceptUi() {
        const n = pendingFiles.length;
        btnAcceptAll.textContent = 'Accept all ' + n + ' pending file' + (n === 1 ? '' : 's');
        acceptCombo.classList.toggle('has-pending', n > 0 && diffAvailable);
        btnAcceptAll.disabled = !diffAvailable;
        btnAcceptCombo.disabled = !diffAvailable;
        btnAcceptAll.title = diffAvailable
          ? 'Accept all pending diffs (Agents Check)'
          : 'Install Agents Check to enable Accept All';
      }

      function parentFolder(rel, name) {
        const r = String(rel || '').replace(/\\\\/g, '/');
        const base = name || r.split('/').pop() || '';
        if (!r || r === base) return '';
        if (base && r.endsWith('/' + base)) return r.slice(0, -(base.length + 1));
        const i = r.lastIndexOf('/');
        return i === -1 ? '' : r.slice(0, i);
      }

      function renderPendingMenu() {
        pendingMenu.innerHTML = '';
        if (!pendingFiles.length) {
          const empty = document.createElement('div');
          empty.className = 'pending-empty';
          empty.textContent = 'No pending files';
          pendingMenu.appendChild(empty);
          return;
        }
        pendingFiles.forEach((f) => {
          const row = document.createElement('div');
          row.className = 'pending-row';
          row.setAttribute('role', 'menuitem');
          const meta = document.createElement('div');
          meta.className = 'pending-meta';
          const name = document.createElement('span');
          name.className = 'pending-name';
          name.textContent = f.name || f.path;
          meta.appendChild(name);
          const folder = parentFolder(f.relativePath, f.name);
          if (folder) {
            const pathEl = document.createElement('span');
            pathEl.className = 'pending-path';
            pathEl.textContent = folder;
            pathEl.title = f.path;
            meta.appendChild(pathEl);
          }
          const add = document.createElement('span');
          add.className = 'pending-add';
          add.textContent = '+' + (f.additions || 0);
          const del = document.createElement('span');
          del.className = 'pending-del';
          del.textContent = '-' + (f.deletions || 0);
          const acc = document.createElement('button');
          acc.type = 'button';
          acc.className = 'pending-accept';
          acc.innerHTML = ICON_TICK;
          acc.title = 'Accept';
          acc.setAttribute('aria-label', 'Accept');
          acc.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'acceptPendingFile', path: f.path });
          });
          row.appendChild(meta);
          row.appendChild(add);
          row.appendChild(del);
          row.appendChild(acc);
          row.addEventListener('click', () => {
            closePendingMenu();
            vscode.postMessage({ type: 'openPendingFile', path: f.path });
          });
          pendingMenu.appendChild(row);
        });
      }

      function closePendingMenu() {
        pendingMenu.hidden = true;
        btnAcceptCombo.setAttribute('aria-expanded', 'false');
      }

      function openPendingMenu() {
        renderPendingMenu();
        pendingMenu.hidden = false;
        btnAcceptCombo.setAttribute('aria-expanded', 'true');
        vscode.postMessage({ type: 'requestPendingSummaries' });
      }

      function populateForm(s) {
        if (!s) return;
        document.getElementById('f-burst-enabled').checked = !!s.burstDetectionEnabled;
        document.getElementById('f-burst-window').value = s.burstDetectionWindowMs;
        document.getElementById('f-burst-threshold').value = s.burstDetectionThreshold;
        document.getElementById('f-burst-hold').value = s.burstDetectionHoldMs;
        document.getElementById('f-max-file-lines').value = s.maxFileLines;
        document.getElementById('f-prevent-alt-menu-focus').checked = !!s.preventAltMenuFocus;
      }
      function collectForm() {
        return {
          ...currentSettings,
          burstDetectionEnabled: document.getElementById('f-burst-enabled').checked,
          burstDetectionWindowMs: Number(document.getElementById('f-burst-window').value),
          burstDetectionThreshold: Number(document.getElementById('f-burst-threshold').value),
          burstDetectionHoldMs: Number(document.getElementById('f-burst-hold').value),
          maxFileLines: Number(document.getElementById('f-max-file-lines').value),
          preventAltMenuFocus: document.getElementById('f-prevent-alt-menu-focus').checked,
        };
      }
      const btnSettings = document.getElementById('btn-settings');
      const SETTINGS_ID = '__cfg__';
      let cfgTab = null;
      let settingsOpen = false;
      let lastSessionId = null;
      let dragSessionId = null;

      function pinCfgTabAtEnd() {
        if (cfgTab && cfgTab.parentNode === tabsEl) tabsEl.appendChild(cfgTab);
      }

      function sessionTabOrder() {
        return Array.from(tabsEl.querySelectorAll('.tab:not(.tab-cfg)'));
      }

      function ensureCfgTab() {
        if (cfgTab) return;
        cfgTab = document.createElement('div');
        cfgTab.className = 'tab tab-cfg';
        cfgTab.dataset.kind = 'cfg';
        const titleEl = document.createElement('span');
        titleEl.className = 'tab-title';
        titleEl.textContent = 'CFG';
        const closeEl = document.createElement('span');
        closeEl.className = 'tab-close';
        closeEl.textContent = '×';
        cfgTab.appendChild(titleEl);
        cfgTab.appendChild(closeEl);
        cfgTab.addEventListener('click', (e) => {
          if (e.target !== closeEl) openSettings();
        });
        closeEl.addEventListener('click', (e) => {
          e.stopPropagation();
          closeSettings();
        });
        tabsEl.appendChild(cfgTab);
      }

      function hideSettingsPanel() {
        settingsOpen = false;
        overlay.hidden = true;
        if (cfgTab) cfgTab.classList.remove('active');
      }

      function closeSettings() {
        hideSettingsPanel();
        if (cfgTab) {
          cfgTab.remove();
          cfgTab = null;
        }
        const ordered = sessionTabOrder();
        const fallback = (lastSessionId && sessions.has(lastSessionId))
          ? lastSessionId
          : (ordered[0] && ordered[0].dataset.sessionId);
        if (fallback && sessions.has(fallback)) activateTab(fallback);
        else activeId = null;
      }

      function openSettings() {
        if (activeId && activeId !== SETTINGS_ID && sessions.has(activeId)) {
          lastSessionId = activeId;
        }
        ensureCfgTab();
        settingsOpen = true;
        overlay.hidden = false;
        activeId = SETTINGS_ID;
        for (const sess of sessions.values()) {
          sess.host.classList.remove('active');
          sess.tab.classList.remove('active');
        }
        cfgTab.classList.add('active');
        vscode.postMessage({ type: 'getSettings' });
        vscode.postMessage({ type: 'requestLaunchMenu' });
      }

      function bindTabDrag(tab, id) {
        tab.draggable = true;
        tab.addEventListener('dragstart', (e) => {
          if (e.target && e.target.closest && e.target.closest('.tab-close')) {
            e.preventDefault();
            return;
          }
          dragSessionId = id;
          tab.classList.add('dragging');
          try {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', id);
          } catch (_) {}
        });
        tab.addEventListener('dragend', () => {
          tab.classList.remove('dragging');
          dragSessionId = null;
          tabsEl.querySelectorAll('.tab.drag-over').forEach((el) => el.classList.remove('drag-over'));
          pinCfgTabAtEnd();
        });
        tab.addEventListener('dragover', (e) => {
          if (!dragSessionId || dragSessionId === id) return;
          e.preventDefault();
          try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
          const dragged = sessions.get(dragSessionId);
          if (!dragged || !dragged.tab || dragged.tab === tab) return;
          const rect = tab.getBoundingClientRect();
          const before = e.clientX < rect.left + rect.width / 2;
          if (before) tabsEl.insertBefore(dragged.tab, tab);
          else tabsEl.insertBefore(dragged.tab, tab.nextSibling);
          pinCfgTabAtEnd();
        });
        tab.addEventListener('drop', (e) => {
          e.preventDefault();
          pinCfgTabAtEnd();
        });
      }

      function activateTab(id) {
        if (id === SETTINGS_ID) {
          openSettings();
          return;
        }
        if (!sessions.has(id)) return;
        if (settingsOpen) hideSettingsPanel();
        activeId = id;
        lastSessionId = id;
        vscode.postMessage({ type: 'activeSession', id });
        for (const [sid, sess] of sessions) {
          sess.host.classList.toggle('active', sid === id);
          sess.tab.classList.toggle('active', sid === id);
        }
        if (cfgTab) cfgTab.classList.remove('active');
        const sess = sessions.get(id);
        if (sess) { try { sess.fit.fit(); sess.term.focus(); } catch (_) {} }
      }

      function onSessionCreated(id, title) {
        const host = document.createElement('div'); host.className = 'term-pane'; termHost.appendChild(host);
        const term = new Terminal({
          fontFamily: currentSettings.fontFamily,
          fontSize: currentSettings.fontSize,
          cursorBlink: true,
          theme: resolveTheme(currentSettings),
        });
        const fit = new FitAddon.FitAddon();
        term.loadAddon(fit);
        term.open(host);
        fit.fit();
        term.onData((data) => vscode.postMessage({ type: 'input', id, data }));
        const tab = document.createElement('div');
        tab.className = 'tab';
        tab.dataset.sessionId = id;
        const titleEl = document.createElement('span'); titleEl.className = 'tab-title'; titleEl.textContent = title || id;
        const closeEl = document.createElement('span'); closeEl.className = 'tab-close'; closeEl.textContent = '×';
        tab.appendChild(titleEl); tab.appendChild(closeEl);
        tab.addEventListener('click', (e) => { if (e.target !== closeEl) activateTab(id); });
        closeEl.addEventListener('click', (e) => { e.stopPropagation(); vscode.postMessage({ type: 'closeSession', id }); });
        bindTabDrag(tab, id);
        if (cfgTab && cfgTab.parentNode === tabsEl) tabsEl.insertBefore(tab, cfgTab);
        else tabsEl.appendChild(tab);
        sessions.set(id, { id, term, fit, host, tab, titleEl });
        activateTab(id);
        const ro = new ResizeObserver(() => {
          try { fit.fit(); vscode.postMessage({ type: 'resize', id, cols: term.cols, rows: term.rows }); } catch (_) {}
        });
        ro.observe(host);
      }

      function onSessionClosed(id) {
        const sess = sessions.get(id); if (!sess) return;
        const tabs = sessionTabOrder();
        const idx = tabs.indexOf(sess.tab);
        try { sess.term.dispose(); } catch (_) {}
        sess.host.remove(); sess.tab.remove(); sessions.delete(id);
        if (activeId === id) {
          const remaining = sessionTabOrder();
          const nextTab = remaining[Math.min(idx, remaining.length - 1)];
          const nextId = nextTab && nextTab.dataset.sessionId;
          if (nextId) activateTab(nextId);
          else if (cfgTab) openSettings();
          else activeId = null;
        }
      }

      async function onRestore(list, active) {
        for (const snap of list || []) {
          onSessionCreated(snap.id, snap.title);
          const sess = sessions.get(snap.id);
          if (sess && snap.serialized) { try { sess.term.write(snap.serialized); } catch (_) {} }
        }
        if (active && sessions.has(active)) activateTab(active);
      }

      btnAdd.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!launchMenu.hidden) { closeLaunchMenu(); return; }
        launchMenu.hidden = false;
        btnAdd.setAttribute('aria-expanded', 'true');
        renderLaunchMenu();
        vscode.postMessage({ type: 'requestLaunchMenu' });
      });
      document.addEventListener('click', (e) => {
        if (!launchMenu.hidden && !launchMenu.contains(e.target) && !btnAdd.contains(e.target)) closeLaunchMenu();
        if (!pendingMenu.hidden && !pendingMenu.contains(e.target) && !btnAcceptCombo.contains(e.target) && !btnAcceptAll.contains(e.target)) {
          closePendingMenu();
        }
      });
      btnSettings.addEventListener('click', () => {
        if (settingsOpen && activeId === SETTINGS_ID) closeSettings();
        else openSettings();
      });
      document.getElementById('btn-reset').addEventListener('click', () => populateForm(appliedSettings));
      document.getElementById('btn-apply').addEventListener('click', () => {
        vscode.postMessage({ type: 'updateSettings', settings: collectForm() });
      });
      document.getElementById('tpl-select').addEventListener('change', loadSelectedTemplate);
      document.getElementById('btn-tpl-save').addEventListener('click', () => {
        const id = document.getElementById('tpl-id').value || undefined;
        const name = document.getElementById('tpl-name').value.trim();
        const profileId = document.getElementById('tpl-profile').value;
        const commands = document.getElementById('tpl-commands').value.split(/\\r?\\n/).map((s) => s.trim()).filter(Boolean);
        if (!name || !profileId) return;
        vscode.postMessage({ type: 'upsertTemplate', template: { id, name, profileId, commands } });
      });
      document.getElementById('btn-tpl-new').addEventListener('click', () => {
        document.getElementById('tpl-select').value = '';
        selectedTplId = '';
        document.getElementById('tpl-id').value = '';
        document.getElementById('tpl-name').value = '';
        document.getElementById('tpl-commands').value = '';
        fillTemplateProfileSelect();
      });
      document.getElementById('btn-tpl-delete').addEventListener('click', () => {
        const id = document.getElementById('tpl-id').value; if (!id) return;
        vscode.postMessage({ type: 'deleteTemplate', id });
      });
      btnAcceptAll.addEventListener('click', () => {
        if (!diffAvailable || !pendingFiles.length) return;
        closePendingMenu();
        vscode.postMessage({ type: 'acceptAllChanges' });
      });
      btnAcceptCombo.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!diffAvailable) return;
        if (!pendingMenu.hidden) { closePendingMenu(); return; }
        openPendingMenu();
      });

      window.addEventListener('message', (e) => {
        const msg = e.data; if (!msg) return;
        if (msg.type === 'sessionCreated') onSessionCreated(msg.id, msg.title);
        else if (msg.type === 'sessionClosed') onSessionClosed(msg.id);
        else if (msg.type === 'restoreSessions') onRestore(msg.sessions, msg.activeId);
        else if (msg.type === 'data') { const s = sessions.get(msg.id); if (s) s.term.write(msg.data); }
        else if (msg.type === 'exit') { const s = sessions.get(msg.id); if (s) s.term.writeln('\\r\\n[process exited: ' + msg.code + ']'); }
        else if (msg.type === 'error') writeTerminalError(msg.id, msg.message || 'error');
        else if (msg.type === 'launchMenu') {
          launchProfiles = msg.profiles || []; launchTemplates = msg.templates || [];
          renderLaunchMenu(); fillTemplateProfileSelect(); fillTemplateSelect();
        } else if (msg.type === 'settings') {
          if (msg.settings) {
            applySettings(msg.settings);
            appliedSettings = JSON.parse(JSON.stringify(msg.settings));
            populateForm(appliedSettings);
          }
          if (msg.templates) { launchTemplates = msg.templates; fillTemplateSelect(); }
        } else if (msg.type === 'focusTerminal') {
          if (settingsOpen) hideSettingsPanel();
          const focusId = (activeId && sessions.has(activeId)) ? activeId : lastSessionId;
          if (focusId && sessions.has(focusId)) activateTab(focusId);
          const s = sessions.get(activeId); if (s) try { s.term.focus(); } catch (_) {}
        } else if (msg.type === 'diffExtensionState') {
          diffAvailable = !!msg.available;
          updateAcceptUi();
        } else if (msg.type === 'pendingSummaries') {
          if (typeof msg.available === 'boolean') diffAvailable = msg.available;
          pendingFiles = Array.isArray(msg.files) ? msg.files : [];
          updateAcceptUi();
          if (!pendingMenu.hidden) renderPendingMenu();
        }
      });

      applySettings(currentSettings);
      updateAcceptUi();
      vscode.postMessage({ type: 'ready' });
      vscode.postMessage({ type: 'requestLaunchMenu' });
      setInterval(() => {
        if (diffAvailable) vscode.postMessage({ type: 'requestPendingSummaries' });
      }, 2500);
    })();
  </script>
</body>
</html>`;
}

function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 24; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}
