import * as vscode from 'vscode';
import { DiffManager } from '../check/diffManager';
import { coalesce } from '../utils/coalesce';

export class PendingFilesPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agents-check.pendingFiles';

  private view: vscode.WebviewView | undefined;
  private readonly refreshSoon: { schedule: () => void; dispose: () => void };

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly diffManager: DiffManager,
  ) {
    this.refreshSoon = coalesce(() => { void this.refresh(); }, 120, 600);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.buildHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: unknown) => {
      void this.onMessage(msg);
    });
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });
    void this.refresh();
  }

  scheduleRefresh(): void {
    this.refreshSoon.schedule();
  }

  dispose(): void {
    this.refreshSoon.dispose();
  }

  private async onMessage(msg: unknown): Promise<void> {
    if (!msg || typeof msg !== 'object') {
      return;
    }
    const m = msg as { type?: string; path?: string };
    if (m.type === 'ready') {
      await this.refresh();
      return;
    }
    if (m.type === 'open' && typeof m.path === 'string') {
      try {
        await this.diffManager.openDiff(m.path);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Agents Check: could not open file - ${message}`);
      }
      return;
    }
    if (m.type === 'accept' && typeof m.path === 'string') {
      try {
        await this.diffManager.accept(m.path);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Agents Check: could not accept file - ${message}`);
      }
      await this.refresh();
      return;
    }
    if (m.type === 'acceptAll') {
      try {
        await this.diffManager.acceptAllPending();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Agents Check: could not accept all - ${message}`);
      }
      await this.refresh();
    }
  }

  private async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const files = await this.diffManager.getPendingSummaries();
    const count = files.length;
    this.view.badge = count > 0
      ? { value: count, tooltip: `${count} pending file${count === 1 ? '' : 's'}` }
      : undefined;
    void this.view.webview.postMessage({ type: 'pending', files });
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = Array.from({ length: 24 }, () =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(
        Math.floor(Math.random() * 62)
      )
    ).join('');
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  html, body {
    margin: 0; padding: 0; height: 100%;
    background: var(--vscode-sideBar-background, #1e1e1e);
    color: var(--vscode-foreground, #cccccc);
    font-family: var(--vscode-font-family);
    font-size: 13px;
  }
  body {
    display: flex; flex-direction: column; overflow: hidden;
  }
  #list {
    --pending-row-h: 22px;
    flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0;
    box-sizing: border-box;
  }
  .row {
    display: flex; align-items: center; gap: 6px;
    height: var(--pending-row-h); padding: 0 8px; cursor: pointer; box-sizing: border-box;
  }
  .row:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.14)); }
  .meta {
    flex: 1 1 auto; min-width: 0;
    display: flex; flex-direction: row; align-items: baseline; gap: 6px;
  }
  .name {
    flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--vscode-foreground, #cccccc);
  }
  .path {
    flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 12px; opacity: 0.45;
  }
  .stats {
    flex: 0 0 auto; display: flex; align-items: center; gap: 6px;
    font-variant-numeric: tabular-nums; font-size: 12px;
  }
  .add { color: var(--vscode-gitDecoration-addedResourceForeground, #81b88b); }
  .del { color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39); }
  .accept {
    flex: 0 0 auto; width: 22px; height: 22px; padding: 0; border: none; border-radius: 4px;
    background: transparent; cursor: pointer; line-height: 0;
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--vscode-gitDecoration-addedResourceForeground, #81b88b);
  }
  .accept svg { display: block; }
  .accept:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
  .empty {
    padding: 10px 12px; opacity: 0.55; font-size: 12px;
  }
  #footer {
    flex: 0 0 auto; padding: 6px 8px;
    border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
  }
  #btn-accept-all {
    width: 100%; height: 28px; border-radius: 7px; cursor: pointer;
    font-family: inherit; font-size: 12px; font-weight: 600;
    color: var(--vscode-foreground, #cccccc);
    background: color-mix(in srgb, var(--vscode-sideBar-background, #1e1e1e) 72%, #000);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.45));
    transition: border-color 0.12s, filter 0.12s, opacity 0.12s;
  }
  #btn-accept-all.has-pending {
    border-color: var(--vscode-focusBorder, #007acc);
  }
  #btn-accept-all:disabled {
    opacity: 0.45; cursor: default;
  }
  #btn-accept-all:not(:disabled):hover { filter: brightness(1.1); }
</style>
</head>
<body>
  <div id="list"><div class="empty">No pending files</div></div>
  <div id="footer">
    <button id="btn-accept-all" type="button" disabled>Accept all 0 pending files</button>
  </div>
  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const list = document.getElementById('list');
      const btnAcceptAll = document.getElementById('btn-accept-all');
      let pendingCount = 0;
      const ICON_TICK = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M2.5 8.5L6 12L13.5 3.5"/></svg>';

      function updateAcceptAll(n) {
        pendingCount = n;
        btnAcceptAll.textContent = 'Accept all ' + n + ' pending file' + (n === 1 ? '' : 's');
        btnAcceptAll.disabled = n === 0;
        btnAcceptAll.classList.toggle('has-pending', n > 0);
      }

      function parentFolder(rel, name) {
        const r = String(rel || '').replace(/\\\\/g, '/');
        const base = name || r.split('/').pop() || '';
        if (!r || r === base) return '';
        if (base && r.endsWith('/' + base)) return r.slice(0, -(base.length + 1));
        const i = r.lastIndexOf('/');
        return i === -1 ? '' : r.slice(0, i);
      }

      function render(files) {
        list.innerHTML = '';
        const items = files || [];
        updateAcceptAll(items.length);
        if (!items.length) {
          const empty = document.createElement('div');
          empty.className = 'empty';
          empty.textContent = 'No pending files';
          list.appendChild(empty);
          return;
        }
        items.forEach((f) => {
          const row = document.createElement('div');
          row.className = 'row';
          const meta = document.createElement('div');
          meta.className = 'meta';
          const name = document.createElement('div');
          name.className = 'name';
          name.textContent = f.name || f.path;
          const folder = parentFolder(f.relativePath, f.name);
          if (folder) {
            const pathEl = document.createElement('div');
            pathEl.className = 'path';
            pathEl.textContent = folder;
            pathEl.title = f.path;
            meta.appendChild(name);
            meta.appendChild(pathEl);
          } else {
            meta.appendChild(name);
          }
          const stats = document.createElement('div');
          stats.className = 'stats';
          const add = document.createElement('span');
          add.className = 'add';
          add.textContent = '+' + (f.additions || 0);
          const del = document.createElement('span');
          del.className = 'del';
          del.textContent = '-' + (f.deletions || 0);
          stats.appendChild(add);
          stats.appendChild(del);
          const acc = document.createElement('button');
          acc.type = 'button';
          acc.className = 'accept';
          acc.innerHTML = ICON_TICK;
          acc.title = 'Accept';
          acc.setAttribute('aria-label', 'Accept');
          acc.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'accept', path: f.path });
          });
          row.appendChild(meta);
          row.appendChild(stats);
          row.appendChild(acc);
          row.addEventListener('click', () => {
            vscode.postMessage({ type: 'open', path: f.path });
          });
          list.appendChild(row);
        });
      }

      btnAcceptAll.addEventListener('click', () => {
        if (pendingCount === 0) return;
        vscode.postMessage({ type: 'acceptAll' });
      });

      window.addEventListener('message', (e) => {
        const msg = e.data;
        if (msg && msg.type === 'pending') render(msg.files || []);
      });
      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
  }
}
