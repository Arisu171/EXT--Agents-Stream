(function () {
  'use strict';

  const T0 = performance.now();
  const tlog = (label) => {
    const ms = (performance.now() - T0).toFixed(0);
    console.log('[agents-check TIMING] +' + ms + 'ms ' + label);
  };
  tlog('script start');

  const vscodeApi = acquireVsCodeApi();
  const monacoBase = window.__MONACO_BASE__;

  require.config({ paths: { vs: monacoBase } });

  window.MonacoEnvironment = {
    getWorkerUrl: function () {
      const blob = new Blob(['self.onmessage=function(){};'], { type: 'text/javascript' });
      return URL.createObjectURL(blob);
    },
  };

  tlog('require(editor.main) called');
  const skeleton = document.getElementById('skeleton');
  require(['vs/editor/editor.main'], function () {
    tlog('editor.main loaded');

    if (monaco.languages.typescript) {
      const diagOff = {
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true,
      };
      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(diagOff);
      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(diagOff);
    }
    if (monaco.languages.css) {
      const cssOff = { validate: false };
      monaco.languages.css.cssDefaults.setOptions(cssOff);
      monaco.languages.css.scssDefaults.setOptions(cssOff);
      monaco.languages.css.lessDefaults.setOptions(cssOff);
    }
    if (monaco.languages.json) {
      monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: false });
    }

    const state = {
      editor: null,
      model: null,
      filePath: null,
      originalContent: '',
      currentContent: '',
      hunks: [],
      groups: [],
      groupWidgets: [],
      decorationIds: [],
      viewZoneIds: [],
      hoveredGroupIdx: -1,
      toolbarHovered: false,
      didAutoReveal: false,
      currentTheme: null,
      inFlight: false,
    };

    function getTopLine() {
      const ranges = state.editor && state.editor.getVisibleRanges();
      return ranges && ranges[0] ? ranges[0].startLineNumber : undefined;
    }

    function flushCursor() {
      const pos = state.editor && state.editor.getPosition();
      if (!pos) { return; }
      vscodeApi.postMessage({
        type: 'cursor',
        line: pos.lineNumber,
        column: pos.column,
        topLine: getTopLine(),
      });
    }

    function setInFlight(value) {
      state.inFlight = value;
      document.querySelectorAll('.hunk-btn').forEach((b) => { b.disabled = value; });
      ['btn-accept-hunk', 'btn-reject-hunk', 'btn-accept-file', 'btn-reject-file'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) { el.disabled = value; }
      });
    }

    function currentGroupIdx() {
      if (state.hoveredGroupIdx >= 0 && state.hoveredGroupIdx < state.groups.length) {
        return state.hoveredGroupIdx;
      }
      const pos = state.editor && state.editor.getPosition();
      if (pos) {
        const idx = findGroupIdxAtLine(pos.lineNumber);
        if (idx !== -1) { return idx; }
      }
      return state.groups.length > 0 ? 0 : -1;
    }

    function updateHunkCounter() {
      const el = document.getElementById('hunk-counter');
      if (!el) { return; }
      const total = state.groups.length;
      if (total === 0) {
        el.textContent = '0 / 0';
      } else {
        const idx = currentGroupIdx();
        el.textContent = ((idx >= 0 ? idx + 1 : 1) + ' / ' + total);
      }
      const prev = document.getElementById('btn-prev-hunk');
      const next = document.getElementById('btn-next-hunk');
      const accHunk = document.getElementById('btn-accept-hunk');
      const rejHunk = document.getElementById('btn-reject-hunk');
      const accFile = document.getElementById('btn-accept-file');
      const rejFile = document.getElementById('btn-reject-file');
      const has = total > 0;
      if (prev) { prev.disabled = !has; }
      if (next) { next.disabled = !has; }
      if (accHunk) { accHunk.disabled = !has || state.inFlight; }
      if (rejHunk) { rejHunk.disabled = !has || state.inFlight; }
      if (accFile) { accFile.disabled = !has || state.inFlight; }
      if (rejFile) { rejFile.disabled = !has || state.inFlight; }
    }

    const container = document.getElementById('container');
    tlog('before createEditor');
    state.editor = monaco.editor.create(container, {
      readOnly: false,
      automaticLayout: true,
      glyphMargin: false,
      scrollBeyondLastLine: false,
      renderOverviewRuler: true,
      minimap: { enabled: true },
    });
    tlog('createEditor done');

    let suppressEditEvent = false;
    let editDebounce = null;
    state.editor.onDidChangeModelContent(() => {
      if (suppressEditEvent) { return; }
      const value = state.model ? state.model.getValue() : '';
      state.currentContent = value;
      if (editDebounce) { clearTimeout(editDebounce); }
      editDebounce = setTimeout(() => {
        editDebounce = null;
        vscodeApi.postMessage({ type: 'editModified', newCurrent: value });
      }, 200);
    });

    let cursorDebounce = null;
    state.editor.onDidChangeCursorPosition((e) => {
      if (cursorDebounce) { clearTimeout(cursorDebounce); }
      cursorDebounce = setTimeout(() => {
        cursorDebounce = null;
        vscodeApi.postMessage({
          type: 'cursor',
          line: e.position.lineNumber,
          column: e.position.column,
          topLine: getTopLine(),
        });
      }, 150);
    });

    state.editor.onDidScrollChange(() => repositionVisibleBar());
    state.editor.onDidLayoutChange(() => repositionVisibleBar());
    state.editor.onMouseMove((e) => {
      const line = e.target && e.target.position && e.target.position.lineNumber;
      if (!line) { return; }
      const idx = findGroupIdxAtLine(line);
      if (idx !== -1) { setHoveredGroup(idx); }
    });
    state.editor.onMouseLeave(() => { updateHoveredGroupFromCursor(); });
    state.editor.onDidChangeCursorPosition(() => { updateHoveredGroupFromCursor(); });

    const toolbar = document.getElementById('toolbar');
    if (toolbar) {
      toolbar.addEventListener('pointerenter', () => {
        state.toolbarHovered = true;
        setHoveredGroup(-1);
      });
      toolbar.addEventListener('pointerleave', () => {
        state.toolbarHovered = false;
      });
      toolbar.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    }

    registerActions();

    document.getElementById('btn-accept-hunk').addEventListener('click', () => {
      const idx = currentGroupIdx();
      if (idx < 0 || !state.groups[idx]) { return; }
      acceptGroup(state.groups[idx]);
    });
    document.getElementById('btn-reject-hunk').addEventListener('click', () => {
      const idx = currentGroupIdx();
      if (idx < 0 || !state.groups[idx]) { return; }
      rejectGroup(state.groups[idx]);
    });
    document.getElementById('btn-accept-file').addEventListener('click', () => {
      if (state.inFlight) { return; }
      setInFlight(true);
      flushCursor();
      vscodeApi.postMessage({ type: 'acceptAll' });
    });
    document.getElementById('btn-reject-file').addEventListener('click', () => {
      if (state.inFlight) { return; }
      setInFlight(true);
      flushCursor();
      vscodeApi.postMessage({ type: 'rejectAll' });
    });
    document.getElementById('btn-prev-hunk').addEventListener('click', () => {
      gotoHunk(-1);
    });
    document.getElementById('btn-next-hunk').addEventListener('click', () => {
      gotoHunk(+1);
    });
    document.getElementById('btn-next-file').addEventListener('click', () => {
      setHoveredGroup(-1);
      vscodeApi.postMessage({ type: 'nextFile' });
    });
    document.getElementById('btn-prev-file').addEventListener('click', () => {
      setHoveredGroup(-1);
      vscodeApi.postMessage({ type: 'prevFile' });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg) { return; }
      switch (msg.type) {
        case 'set': applySet(msg); return;
        case 'nav': applyNav(msg.nav); return;
        case 'theme-change': applyTheme(msg.theme); return;
        case 'config-change':
          applyConfig(msg.editorConfig);
          if (state.hunks.length > 0) { renderDiffDecorations(); }
          return;
      }
    });

    tlog('post ready to extension');
    vscodeApi.postMessage({ type: 'ready' });

    function applySet(msg) {
      tlog('applySet received hunks=' + (msg.hunks ? msg.hunks.length : 0));
      const isSameFile = state.filePath === msg.filePath;
      state.filePath = msg.filePath;
      state.originalContent = msg.originalContent || '';
      state.currentContent = msg.currentContent || '';
      state.hunks = msg.hunks || [];
      state.groups = buildGroups(state.hunks);

      document.getElementById('toolbar-file').textContent = msg.filePath;
      applyNav(msg.nav);
      if (skeleton && skeleton.isConnected) { skeleton.remove(); }

      if (msg.theme && msg.theme !== state.currentTheme) {
        applyTheme(msg.theme);
      }
      if (msg.editorConfig) {
        applyConfig(msg.editorConfig);
      }

      suppressEditEvent = true;
      try {
        if (!state.model || (!isSameFile)) {
          if (state.model) { state.model.dispose(); }
          state.model = monaco.editor.createModel(state.currentContent, msg.language);
          state.editor.setModel(state.model);
          state.didAutoReveal = false;
        } else if (state.model.getValue() !== state.currentContent) {
          state.model.setValue(state.currentContent);
        }
      } finally {
        suppressEditEvent = false;
      }

      renderDiffDecorations();
      renderGroupWidgets();
      maybeAutoReveal();
      updateHunkCounter();
      tlog('applySet render done');
      setInFlight(false);
    }

    function applyNav(nav) {
      if (!nav) { return; }
      const counter = document.getElementById('file-counter');
      const prev = document.getElementById('btn-prev-file');
      const next = document.getElementById('btn-next-file');
      counter.textContent = nav.currentIdx + ' / ' + nav.total;
      const multi = nav.total > 1;
      prev.disabled = !multi;
      next.disabled = !multi;
    }

    function applyTheme(theme) {
      state.currentTheme = theme;
      monaco.editor.setTheme(theme);
    }

    function applyConfig(cfg) {
      if (!cfg) { return; }
      state.editor.updateOptions({
        fontFamily: cfg.fontFamily,
        fontSize: cfg.fontSize,
        lineHeight: cfg.lineHeight || undefined,
        tabSize: cfg.tabSize,
        insertSpaces: cfg.insertSpaces,
        wordWrap: cfg.wordWrap,
        renderWhitespace: cfg.renderWhitespace,
        minimap: { enabled: cfg.minimapEnabled },
      });
    }

    function renderDiffDecorations() {
      const decorations = [];
      for (const hunk of state.hunks) {
        for (const added of hunk.addedLines) {
          const line = added.modifiedLineIndex + 1;
          decorations.push({
            range: new monaco.Range(line, 1, line, 1),
            options: {
              isWholeLine: true,
              className: 'diff-added-line',
              linesDecorationsClassName: 'diff-added-gutter',
              overviewRuler: {
                color: 'rgba(46, 160, 67, 0.7)',
                position: monaco.editor.OverviewRulerLane.Center,
              },
            },
          });
        }
      }
      state.decorationIds = state.editor.deltaDecorations(state.decorationIds, decorations);

      state.editor.changeViewZones((accessor) => {
        for (const id of state.viewZoneIds) { accessor.removeZone(id); }
        state.viewZoneIds = [];
        const fontInfo = state.editor.getOption(monaco.editor.EditorOption.fontInfo);
        const model = state.editor.getModel();
        const tabSize = model ? model.getOptions().tabSize : 4;

        for (const hunk of state.hunks) {
          if (hunk.removedLines.length === 0) { continue; }
          const dom = document.createElement('div');
          dom.className = 'diff-removed-zone';
          if (fontInfo) {
            dom.style.lineHeight = fontInfo.lineHeight + 'px';
            dom.style.fontSize = fontInfo.fontSize + 'px';
            dom.style.fontFamily = fontInfo.fontFamily;
          }
          dom.style.tabSize = String(tabSize);
          for (const removed of hunk.removedLines) {
            const lineEl = document.createElement('div');
            lineEl.className = 'diff-removed-line';
            lineEl.textContent = removed.text;
            dom.appendChild(lineEl);
          }
          const after = Math.max(0, hunk.modifiedStart);
          const id = accessor.addZone({
            afterLineNumber: after,
            heightInLines: hunk.removedLines.length,
            domNode: dom,
          });
          state.viewZoneIds.push(id);
        }
      });
    }

    function buildGroups(hunks) {
      const groups = [];
      let cur = null;
      for (const h of hunks) {
        const sameBlock = cur
          && cur.groupId === h.groupId
          && !(h.removedLines.length > 0 && cur.addedTexts.length > 0);
        if (!sameBlock) {
          cur = {
            groupId: h.groupId,
            hunks: [h],
            originalStart: h.originalStart,
            modifiedStart: h.modifiedStart,
            removedTexts: h.removedLines.map(r => r.text),
            addedTexts: h.addedLines.map(a => a.text),
          };
          groups.push(cur);
        } else {
          cur.hunks.push(h);
          for (const r of h.removedLines) { cur.removedTexts.push(r.text); }
          for (const a of h.addedLines) { cur.addedTexts.push(a.text); }
        }
      }
      for (const g of groups) {
        g.removedCount = g.removedTexts.length;
        g.addedCount = g.addedTexts.length;
        g.anchorLine = Math.max(1, g.modifiedStart + 1);
        if (g.addedCount > 0) {
          g.startLine = g.modifiedStart + 1;
          g.endLine = g.modifiedStart + g.addedCount;
        } else {
          g.startLine = g.modifiedStart;
          g.endLine = Math.max(1, g.modifiedStart + 1);
        }
      }
      return groups;
    }

    function renderGroupWidgets() {
      for (const w of state.groupWidgets) {
        state.editor.removeOverlayWidget(w);
      }
      state.groupWidgets = [];
      state.hoveredGroupIdx = -1;

      state.groups.forEach((group, idx) => {
        const dom = makeGroupBar(group, idx);
        const widget = {
          _idx: idx,
          _group: group,
          _dom: dom,
          getId: () => 'agents-check.hunkBar.' + idx,
          getDomNode: () => dom,
          getPosition: () => null,
        };
        state.editor.addOverlayWidget(widget);
        state.groupWidgets.push(widget);
      });
      repositionVisibleBar();
      updateHoveredGroupFromCursor();
    }

    function repositionVisibleBar() {
      const w = state.groupWidgets[state.hoveredGroupIdx];
      if (!w) { return; }
      const layout = state.editor.getLayoutInfo();
      const minimapW = (layout && layout.minimap && layout.minimap.minimapWidth) || 0;
      const scrollbarW = (layout && layout.verticalScrollbarWidth) || 0;
      const top = state.editor.getBottomForLineNumber(w._group.endLine) - state.editor.getScrollTop();
      w._dom.style.top = top + 'px';
      w._dom.style.right = (minimapW + scrollbarW + 8) + 'px';

      const toolbar = document.getElementById('toolbar');
      const editorDom = state.editor.getDomNode();
      if (!toolbar || !editorDom) { return; }
      const barRect = w._dom.getBoundingClientRect();
      const toolbarRect = toolbar.getBoundingClientRect();
      const overlaps = barRect.left < toolbarRect.right
        && barRect.right > toolbarRect.left
        && barRect.top < toolbarRect.bottom
        && barRect.bottom > toolbarRect.top;
      if (!overlaps) { return; }

      const editorRect = editorDom.getBoundingClientRect();
      const topAboveToolbar = toolbarRect.top - barRect.height - 6;
      if (topAboveToolbar < editorRect.top + 4) {
        setHoveredGroup(-1);
        return;
      }
      w._dom.style.top = (topAboveToolbar - editorRect.top) + 'px';
    }

    function maybeAutoReveal() {
      if (state.didAutoReveal || state.groups.length === 0) { return; }
      state.didAutoReveal = true;
      const line = state.groups[0].anchorLine;
      state.editor.revealLineInCenter(line);
      state.editor.setPosition({ lineNumber: line, column: 1 });
    }

    function findGroupIdxAtLine(line) {
      if (!line || line < 1) { return -1; }
      for (let i = 0; i < state.groups.length; i++) {
        const g = state.groups[i];
        if (line >= g.startLine && line <= g.endLine) { return i; }
      }
      return -1;
    }

    function setHoveredGroup(idx) {
      if (state.toolbarHovered && idx !== -1) { return; }
      if (idx === state.hoveredGroupIdx) { return; }
      const prev = state.groupWidgets[state.hoveredGroupIdx];
      if (prev) { prev.getDomNode().classList.remove('visible'); }
      state.hoveredGroupIdx = idx;
      const next = state.groupWidgets[idx];
      if (next) {
        next.getDomNode().classList.add('visible');
        repositionVisibleBar();
      }
      updateHunkCounter();
    }

    function updateHoveredGroupFromCursor() {
      const pos = state.editor.getPosition();
      setHoveredGroup(pos ? findGroupIdxAtLine(pos.lineNumber) : -1);
    }

    function makeGroupBar(group, idx) {
      const node = document.createElement('div');
      node.className = 'hunk-bar';
      node.dataset.groupIdx = String(idx);
      node.addEventListener('mouseenter', () => setHoveredGroup(idx));

      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'hunk-btn accept';
      acceptBtn.textContent = 'Accept';
      acceptBtn.title = 'Accept this change block (Ctrl+Y)';
      acceptBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
      acceptBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        acceptGroup(group);
      });

      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'hunk-btn reject';
      rejectBtn.textContent = 'Reject';
      rejectBtn.title = 'Reject this change block (Ctrl+N)';
      rejectBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
      rejectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        rejectGroup(group);
      });

      node.appendChild(acceptBtn);
      node.appendChild(rejectBtn);
      return node;
    }

    function acceptGroup(group) {
      if (state.inFlight) { return; }
      const { newOriginal, newCurrent } = applyAccept(group);
      setInFlight(true);
      vscodeApi.postMessage({ type: 'acceptHunk', newOriginal, newCurrent });
    }

    function rejectGroup(group) {
      if (state.inFlight) { return; }
      const { newOriginal, newCurrent } = applyReject(group);
      setInFlight(true);
      vscodeApi.postMessage({ type: 'rejectHunk', newOriginal, newCurrent });
    }

    function registerActions() {
      state.editor.addAction({
        id: 'agents-check.acceptCurrentHunk',
        label: 'Agents Check: Accept Current Hunk',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY],
        run: () => {
          const g = findGroupAtCursor();
          if (g) { acceptGroup(g); }
        },
      });
      state.editor.addAction({
        id: 'agents-check.rejectCurrentHunk',
        label: 'Agents Check: Reject Current Hunk',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN],
        run: () => {
          const g = findGroupAtCursor();
          if (g) { rejectGroup(g); }
        },
      });
      state.editor.addAction({
        id: 'agents-check.nextHunk',
        label: 'Agents Check: Next Hunk',
        keybindings: [monaco.KeyCode.F7],
        run: () => gotoHunk(+1),
      });
      state.editor.addAction({
        id: 'agents-check.prevHunk',
        label: 'Agents Check: Previous Hunk',
        keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F7],
        run: () => gotoHunk(-1),
      });
      state.editor.addAction({
        id: 'agents-check.nextFile',
        label: 'Agents Check: Next File',
        keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyL],
        run: () => vscodeApi.postMessage({ type: 'nextFile' }),
      });
      state.editor.addAction({
        id: 'agents-check.prevFile',
        label: 'Agents Check: Previous File',
        keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyH],
        run: () => vscodeApi.postMessage({ type: 'prevFile' }),
      });
      state.editor.addAction({
        id: 'agents-check.acceptAll',
        label: 'Agents Check: Accept All Hunks',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyY],
        run: () => {
          if (state.inFlight) { return; }
          setInFlight(true);
          flushCursor();
          vscodeApi.postMessage({ type: 'acceptAll' });
        },
      });
      state.editor.addAction({
        id: 'agents-check.save',
        label: 'Agents Check: Save',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => vscodeApi.postMessage({ type: 'save' }),
      });
      state.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => {
        vscodeApi.postMessage({ type: 'undo' });
      });
      state.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ, () => {
        vscodeApi.postMessage({ type: 'redo' });
      });
    }

    function findGroupAtCursor() {
      const pos = state.editor.getPosition();
      if (!pos) { return null; }
      const idx = findGroupIdxAtLine(pos.lineNumber);
      if (idx !== -1) { return state.groups[idx]; }
      let best = null;
      let bestDist = Infinity;
      for (const g of state.groups) {
        const d = Math.abs(pos.lineNumber - g.anchorLine);
        if (d < bestDist) { best = g; bestDist = d; }
      }
      return best;
    }

    function gotoHunk(direction) {
      if (state.groups.length === 0) { return; }
      const pos = state.editor.getPosition();
      const line = pos ? pos.lineNumber : 1;
      const sorted = state.groups.slice().sort((a, b) => a.anchorLine - b.anchorLine);
      let target = null;
      if (direction > 0) {
        target = sorted.find(g => g.anchorLine > line) || sorted[0];
      } else {
        for (let i = sorted.length - 1; i >= 0; i--) {
          if (sorted[i].anchorLine < line) { target = sorted[i]; break; }
        }
        target = target || sorted[sorted.length - 1];
      }
      if (target) {
        state.editor.revealLineInCenter(target.anchorLine);
        state.editor.setPosition({ lineNumber: target.anchorLine, column: 1 });
      }
    }

    function applyAccept(group) {
      const origLines = state.originalContent.split('\n');
      const newOriginal = origLines
        .slice(0, group.originalStart)
        .concat(group.addedTexts, origLines.slice(group.originalStart + group.removedCount))
        .join('\n');
      return { newOriginal, newCurrent: state.currentContent };
    }

    function applyReject(group) {
      const modLines = state.currentContent.split('\n');
      const newCurrent = modLines
        .slice(0, group.modifiedStart)
        .concat(group.removedTexts, modLines.slice(group.modifiedStart + group.addedCount))
        .join('\n');
      return { newOriginal: state.originalContent, newCurrent };
    }
  }, function (err) {
    console.error('[agents-check] failed to load Monaco:', err);
    if (skeleton) {
      skeleton.classList.add('failed');
      skeleton.querySelector('.sk-error').hidden = false;
    }
  });
})();
