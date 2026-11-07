/* ClearChoice — private decision comparison. All data lives in localStorage. */
(function () {
  'use strict';

  var STORE_KEY = 'clearchoice.v1';
  var EXPORT_APP = 'clearchoice';
  var EXPORT_VERSION = 1;

  var state = { decisions: [], currentId: null, view: 'decisions' };
  var storageOK = true;
  var lastFocus = null;

  var viewEl = document.getElementById('view');
  var dialogRoot = document.getElementById('dialog-root');
  var toastRoot = document.getElementById('toast-root');

  /* ---------- utilities ---------- */

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') { node.textContent = attrs[k]; }
        else if (k === 'class') { node.className = attrs[k]; }
        else if (k === 'htmlFor') { node.htmlFor = attrs[k]; }
        else if (k === 'dataset') {
          Object.keys(attrs[k]).forEach(function (dk) { node.dataset[dk] = attrs[k][dk]; });
        } else if (k in node) { node[k] = attrs[k]; }
        else { node.setAttribute(k, attrs[k]); }
      });
    }
    if (children) {
      children.forEach(function (c) {
        if (c === null || c === undefined) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function esc(s) { return String(s == null ? '' : s); }

  function todayStr(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  function toast(message) {
    var t = el('div', { class: 'toast', text: message, role: 'status' });
    toastRoot.appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }

  /* ---------- storage ---------- */

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) { state.decisions = []; return; }
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.app !== EXPORT_APP || !Array.isArray(parsed.decisions)) {
        state.decisions = [];
        return;
      }
      state.decisions = parsed.decisions.filter(isValidDecision);
    } catch (e) {
      storageOK = false;
      state.decisions = [];
    }
  }

  function save() {
    if (!storageOK) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ app: EXPORT_APP, version: EXPORT_VERSION, decisions: state.decisions }));
    } catch (e) {
      storageOK = false;
      toast('Could not save: browser storage is unavailable or full.');
    }
  }

  function touch(decision) { decision.updatedAt = Date.now(); }

  /* ---------- validation ---------- */

  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function isValidDecision(d) {
    if (!isPlainObject(d)) return false;
    if (typeof d.id !== 'string' || !d.id) return false;
    if (typeof d.title !== 'string' || !d.title.trim()) return false;
    if (typeof d.createdAt !== 'number' || typeof d.updatedAt !== 'number') return false;
    if (!Array.isArray(d.options) || !Array.isArray(d.criteria)) return false;
    if (!isPlainObject(d.scores)) return false;
    var optIds = {}, critIds = {};
    var i, o, c;
    for (i = 0; i < d.options.length; i++) {
      o = d.options[i];
      if (!isPlainObject(o) || typeof o.id !== 'string' || !o.id || typeof o.name !== 'string' || !o.name.trim()) return false;
      if (optIds[o.id]) return false;
      optIds[o.id] = true;
    }
    for (i = 0; i < d.criteria.length; i++) {
      c = d.criteria[i];
      if (!isPlainObject(c) || typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || !c.name.trim()) return false;
      if (!Number.isInteger(c.weight) || c.weight < 1 || c.weight > 5) return false;
      if (critIds[c.id]) return false;
      critIds[c.id] = true;
    }
    var optKeys = Object.keys(d.scores);
    for (i = 0; i < optKeys.length; i++) {
      if (!optIds[optKeys[i]]) return false;
      var row = d.scores[optKeys[i]];
      if (!isPlainObject(row)) return false;
      var critKeys = Object.keys(row);
      for (var j = 0; j < critKeys.length; j++) {
        if (!critIds[critKeys[j]]) return false;
        var cell = row[critKeys[j]];
        if (!isPlainObject(cell)) return false;
        if (cell.value !== null && (typeof cell.value !== 'number' || isNaN(cell.value) || cell.value < 0 || cell.value > 10)) return false;
        if (typeof cell.note !== 'string') return false;
      }
    }
    return true;
  }

  function validateBackup(data) {
    if (!isPlainObject(data)) return 'File is not a JSON object.';
    if (data.app !== EXPORT_APP) return 'This file is not a ClearChoice backup.';
    if (data.version !== EXPORT_VERSION) return 'Unsupported backup version.';
    if (!Array.isArray(data.decisions)) return 'Backup has no decisions list.';
    var seenIds = {};
    for (var i = 0; i < data.decisions.length; i++) {
      if (!isValidDecision(data.decisions[i])) return 'Decision ' + (i + 1) + ' in the file is invalid.';
      if (seenIds[data.decisions[i].id]) return 'Two decisions in the file share the same ID.';
      seenIds[data.decisions[i].id] = true;
    }
    return null;
  }

  /* ---------- model ---------- */

  function newDecision(title) {
    var now = Date.now();
    return { id: uid(), title: title, createdAt: now, updatedAt: now, options: [], criteria: [], scores: {} };
  }

  function getDecision(id) {
    for (var i = 0; i < state.decisions.length; i++) {
      if (state.decisions[i].id === id) return state.decisions[i];
    }
    return null;
  }

  function getCell(d, optionId, criterionId) {
    if (!d.scores[optionId]) d.scores[optionId] = {};
    if (!d.scores[optionId][criterionId]) d.scores[optionId][criterionId] = { value: null, note: '' };
    return d.scores[optionId][criterionId];
  }

  function computeResults(d) {
    var results = d.options.map(function (opt) {
      var total = 0, max = 0, missing = 0;
      d.criteria.forEach(function (crit) {
        var cell = getCell(d, opt.id, crit.id);
        if (cell.value === null) { missing++; }
        else { total += crit.weight * cell.value; max += crit.weight * 10; }
      });
      return {
        option: opt,
        total: total,
        max: max,
        pct: max > 0 ? Math.round((total / max) * 100) : null,
        missing: missing,
        complete: d.criteria.length > 0 && missing === 0
      };
    });
    var ranked = results.filter(function (r) { return r.complete; })
      .slice().sort(function (a, b) { return b.total - a.total; });
    var rankOf = {};
    var lastTotal = null, lastRank = 0;
    ranked.forEach(function (r, i) {
      var rank = (lastTotal !== null && r.total === lastTotal) ? lastRank : i + 1;
      rankOf[r.option.id] = rank;
      lastTotal = r.total; lastRank = rank;
    });
    var ties = {};
    ranked.forEach(function (r) {
      var same = ranked.filter(function (x) { return x.total === r.total; }).length;
      ties[r.option.id] = same > 1;
    });
    results.forEach(function (r) {
      r.rank = rankOf[r.option.id] || null;
      r.tie = !!ties[r.option.id];
    });
    return results;
  }

  /* ---------- dialogs ---------- */

  function setBackgroundInert(on) {
    ['.app-header', '.app-footer'].forEach(function (sel) {
      var node = document.querySelector(sel);
      if (node) node.inert = on;
    });
    viewEl.inert = on;
  }

  function openDialog(title, buildBody, actions) {
    lastFocus = document.activeElement;
    setBackgroundInert(true);
    dialogRoot.innerHTML = '';
    var overlay = el('div', { class: 'dialog-overlay' });
    var dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    dialog.appendChild(el('h2', { text: title, tabindex: -1, id: 'dialog-title' }));
    var body = buildBody(dialog);
    if (body) dialog.appendChild(body);
    var actionRow = el('div', { class: 'dialog-actions' });
    actions.forEach(function (a) {
      var btn = el('button', { type: 'button', class: 'btn ' + (a.kind || 'btn-secondary'), text: a.label });
      btn.addEventListener('click', function () {
        if (a.keepOpen) { if (a.onClick) a.onClick(); return; }
        closeDialog(); if (a.onClick) a.onClick();
      });
      actionRow.appendChild(btn);
    });
    dialog.appendChild(actionRow);
    overlay.appendChild(dialog);
    dialogRoot.appendChild(overlay);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeDialog(); });
    dialog.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeDialog(); }
      if (e.key === 'Tab') {
        var focusables = dialog.querySelectorAll('button, input, select, textarea, a[href]');
        if (!focusables.length) return;
        var first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    var firstFocusable = dialog.querySelector('input, textarea, select, button, a[href]');
    (firstFocusable || dialog.querySelector('h2')).focus();
    return dialog;
  }

  function closeDialog() {
    dialogRoot.innerHTML = '';
    setBackgroundInert(false);
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }

  function confirmDialog(title, message, confirmLabel, onConfirm) {
    openDialog(title, function () {
      return el('p', { text: message });
    }, [
      { label: 'Cancel', kind: 'btn-secondary' },
      { label: confirmLabel, kind: 'btn-danger', onClick: onConfirm }
    ]);
  }

  function promptTextDialog(title, label, initialValue, confirmLabel, onConfirm) {
    var input, err, submit;
    openDialog(title, function () {
      var wrap = el('div', {});
      var field = el('div', { class: 'field' });
      var lab = el('label', { text: label, htmlFor: 'dialog-text-input' });
      input = el('input', { type: 'text', id: 'dialog-text-input', value: initialValue || '' });
      err = el('p', { class: 'field-error', id: 'dialog-text-error', hidden: true });
      field.appendChild(lab);
      field.appendChild(input);
      field.appendChild(err);
      wrap.appendChild(field);
      submit = function () {
        var v = input.value.trim();
        if (!v) {
          err.textContent = 'Please enter a name.';
          err.hidden = false;
          input.focus();
          return;
        }
        closeDialog();
        onConfirm(v);
      };
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
      return wrap;
    }, [
      { label: 'Cancel', kind: 'btn-secondary' },
      { label: confirmLabel, kind: '', keepOpen: true, onClick: function () { submit(); } }
    ]);
  }

  function noteDialog(d, optionId, criterionId) {
    var opt = d.options.find(function (o) { return o.id === optionId; });
    var crit = d.criteria.find(function (c) { return c.id === criterionId; });
    var cell = getCell(d, optionId, criterionId);
    var area;
    openDialog('Note for ' + opt.name + ' — ' + crit.name, function () {
      var wrap = el('div', {});
      var field = el('div', { class: 'field' });
      var lab = el('label', { text: 'Why this score? (optional)', htmlFor: 'note-text' });
      area = el('textarea', { id: 'note-text' });
      area.value = cell.note || '';
      field.appendChild(lab);
      field.appendChild(area);
      wrap.appendChild(field);
      wrap.appendChild(el('p', { text: 'Notes stay in your browser with the decision. They appear in the printed report.' }));
      return wrap;
    }, [
      { label: 'Cancel', kind: 'btn-secondary' },
      { label: 'Save note', kind: '', onClick: function () {
        cell.note = area.value.trim();
        touch(d); save(); rerender('note:' + optionId + ':' + criterionId);
        toast('Note saved.');
      } }
    ]);
  }

  /* ---------- routing ---------- */

  function render() { rerender(null); }

  function rerender(focusKey) {
    if (state.view === 'comparison' && state.currentId) {
      var d = getDecision(state.currentId);
      if (d) { renderComparison(d, { initial: false, focusKey: focusKey }); return; }
    }
    if (state.view === 'guide') { renderGuide({ initial: false }); return; }
    renderDecisions({ initial: false, focusKey: focusKey });
  }

  function restoreFocus(focusKey) {
    if (!focusKey) return false;
    var target = document.getElementById(focusKey) ||
      viewEl.querySelector('[data-focus-key="' + focusKey + '"]');
    if (target) { target.focus(); return true; }
    return false;
  }

  function route() {
    var hash = location.hash || '#/decisions';
    var parts = hash.replace(/^#\//, '').split('/');
    if (parts[0] === 'guide') { state.view = 'guide'; state.currentId = null; renderGuide({ initial: true }); return; }
    if (parts[0] === 'decision' && parts[1]) {
      var d = getDecision(parts[1]);
      if (d) { state.view = 'comparison'; state.currentId = d.id; renderComparison(d, { initial: true }); return; }
      location.hash = '#/decisions';
      return;
    }
    state.view = 'decisions'; state.currentId = null;
    renderDecisions({ initial: true });
  }

  function setNav(current) {
    document.querySelectorAll('.nav-link').forEach(function (a) {
      if (a.dataset.nav === current) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  /* ---------- views ---------- */

  function renderDecisions(opts) {
    opts = opts || {};
    setNav('decisions');
    state.currentId = null;
    viewEl.innerHTML = '';
    var head = el('div', { class: 'view-head' });
    head.appendChild(el('div', {}, [
      el('h1', { text: 'Your decisions', tabindex: -1 }),
      el('p', { class: 'lede', text: 'Compare options side by side with criteria that matter to you. Pick a decision to open its workspace, or start a new one.' })
    ]));
    var newBtn = el('button', { type: 'button', class: 'btn', id: 'new-decision-btn', text: 'New decision' });
    newBtn.addEventListener('click', function () {
      promptTextDialog('New decision', 'What are you deciding?', '', 'Create decision', function (title) {
        var d = newDecision(title);
        state.decisions.unshift(d);
        save();
        location.hash = '#/decision/' + d.id;
        toast('Decision created.');
      });
    });
    head.appendChild(newBtn);
    viewEl.appendChild(head);

    if (!storageOK) {
      viewEl.appendChild(el('div', { class: 'notice', role: 'alert' }, [
        el('p', { text: 'Browser storage is unavailable, so decisions cannot be saved on this device. You can still compare options in this session, and export a backup file before you leave.' })
      ]));
    }

    if (!state.decisions.length) {
      var empty = el('div', { class: 'empty-state' });
      empty.appendChild(el('h2', { text: 'No decisions yet' }));
      empty.appendChild(el('p', { text: 'Create your first decision, for example “Which laptop should I buy?” Then add options, add criteria like price and battery life, and score each option.' }));
      var startBtn = el('button', { type: 'button', class: 'btn', text: 'Create your first decision' });
      startBtn.addEventListener('click', function () { newBtn.click(); });
      empty.appendChild(startBtn);
      viewEl.appendChild(empty);
      finishRenderDecisions(opts);
      return;
    }

    var list = el('ul', { class: 'decision-list' });
    state.decisions.forEach(function (d) {
      var results = computeResults(d);
      var scored = results.filter(function (r) { return r.complete; }).length;
      var missing = results.reduce(function (n, r) { return n + r.missing; }, 0);
      var li = el('li', { class: 'card decision-item' });
      var main = el('div', { class: 'decision-main' });
      var link = el('a', { href: '#/decision/' + d.id, text: d.title, dataset: { focusKey: 'open:' + d.id } });
      main.appendChild(link);
      var metaParts = [
        d.options.length + (d.options.length === 1 ? ' option' : ' options'),
        d.criteria.length + (d.criteria.length === 1 ? ' criterion' : ' criteria'),
        scored + ' ranked'
      ];
      if (missing > 0) metaParts.push(missing + ' score' + (missing === 1 ? '' : 's') + ' missing');
      metaParts.push('Updated ' + todayStr(d.updatedAt));
      main.appendChild(el('p', { class: 'decision-meta', text: metaParts.join(' · ') }));
      li.appendChild(main);

      var actions = el('div', { class: 'decision-actions' });
      var renameBtn = el('button', { type: 'button', class: 'icon-btn', text: 'Rename', 'aria-label': 'Rename ' + d.title, dataset: { focusKey: 'rename:' + d.id } });
      renameBtn.addEventListener('click', function () {
        promptTextDialog('Rename decision', 'Decision name', d.title, 'Save name', function (v) {
          d.title = v; touch(d); save(); rerender('rename:' + d.id);
          toast('Decision renamed.');
        });
      });
      var dupBtn = el('button', { type: 'button', class: 'icon-btn', text: 'Duplicate', 'aria-label': 'Duplicate ' + d.title, dataset: { focusKey: 'dup:' + d.id } });
      dupBtn.addEventListener('click', function () {
        var copy = JSON.parse(JSON.stringify(d));
        copy.id = uid();
        copy.title = d.title + ' (copy)';
        copy.createdAt = Date.now();
        copy.updatedAt = Date.now();
        state.decisions.unshift(copy);
        save(); rerender('open:' + copy.id);
        toast('Decision duplicated.');
      });
      var delBtn = el('button', { type: 'button', class: 'icon-btn danger', text: 'Delete', 'aria-label': 'Delete ' + d.title, dataset: { focusKey: 'del:' + d.id } });
      delBtn.addEventListener('click', function () {
        confirmDialog('Delete decision?', '"' + d.title + '" and all its options, criteria, scores and notes will be removed. This cannot be undone.', 'Delete', function () {
          state.decisions = state.decisions.filter(function (x) { return x.id !== d.id; });
          save(); rerender('new-decision-btn');
          toast('Decision deleted.');
        });
      });
      actions.appendChild(renameBtn);
      actions.appendChild(dupBtn);
      actions.appendChild(delBtn);
      li.appendChild(actions);
      list.appendChild(li);
    });
    viewEl.appendChild(list);
    finishRenderDecisions(opts);
  }

  function finishRenderDecisions(opts) {
    if (opts.initial) {
      var h1 = viewEl.querySelector('h1');
      if (h1) h1.focus();
    } else if (opts.focusKey) {
      restoreFocus(opts.focusKey);
    }
  }

  function scoreInput(d, optionId, criterionId) {
    var cell = getCell(d, optionId, criterionId);
    var crit = d.criteria.find(function (c) { return c.id === criterionId; });
    var opt = d.options.find(function (o) { return o.id === optionId; });
    var key = optionId + ':' + criterionId;
    var input = el('input', {
      type: 'number', min: '0', max: '10', step: '1',
      value: cell.value === null ? '' : String(cell.value),
      'aria-label': 'Score for ' + opt.name + ' on ' + crit.name + ', 0 to 10, leave empty if not scored yet',
      dataset: { focusKey: 'score:' + key }
    });
    input.addEventListener('change', function () {
      var raw = input.value.trim();
      if (raw === '') { cell.value = null; }
      else {
        var n = Number(raw);
        if (isNaN(n)) { input.value = cell.value === null ? '' : String(cell.value); return; }
        n = Math.max(0, Math.min(10, Math.round(n)));
        cell.value = n;
        input.value = String(n);
      }
      touch(d); save();
      updateScorePrintSpans(key, cell.value);
      refreshResults(d);
    });
    return input;
  }

  function updateScorePrintSpans(key, value) {
    viewEl.querySelectorAll('[data-score-print-for="' + key + '"]').forEach(function (span) {
      span.textContent = value === null ? 'Not scored' : String(value) + ' / 10';
    });
  }

  function totalText(r) { return r.max > 0 ? r.total + ' / ' + r.max + ' (' + r.pct + '%)' : '—'; }

  /* Update totals, ranks, summary and notices in place, without rebuilding
     the workspace, so keyboard focus stays where the user is working. */
  function refreshResults(d) {
    var results = computeResults(d);
    var missingTotal = results.reduce(function (n, r) { return n + r.missing; }, 0);
    var rankedCount = results.filter(function (r) { return r.complete; }).length;
    var leader = results.filter(function (r) { return r.complete; })
      .sort(function (a, b) { return b.total - a.total; })[0] || null;

    var setText = function (id, text) { var n = document.getElementById(id); if (n) n.textContent = text; };
    setText('chip-leader-value', leader ? leader.option.name : 'None yet');
    setText('chip-leader-sub', leader ? (leader.total + ' of ' + leader.max + ' points (' + leader.pct + '%)' + (leader.tie ? ' — tied' : '')) : 'Score every criterion to rank options.');
    setText('chip-ranked-value', rankedCount + ' of ' + d.options.length);
    setText('chip-missing-value', String(missingTotal));

    var notice = document.getElementById('missing-notice');
    if (notice) {
      notice.hidden = !(missingTotal > 0 && d.options.length && d.criteria.length);
      var noticeText = document.getElementById('missing-notice-text');
      if (noticeText) noticeText.textContent = missingTotal + ' score' + (missingTotal === 1 ? '' : 's') + ' still missing. ';
    }

    results.forEach(function (r) {
      var id = r.option.id;
      viewEl.querySelectorAll('[data-total-for="' + id + '"]').forEach(function (n) { n.textContent = totalText(r); });
      viewEl.querySelectorAll('[data-missing-for="' + id + '"]').forEach(function (n) { n.textContent = r.missing > 0 ? r.missing + ' missing' : ''; });
      viewEl.querySelectorAll('[data-missing-for-card="' + id + '"]').forEach(function (n) { n.textContent = r.missing > 0 ? r.missing + ' score' + (r.missing === 1 ? '' : 's') + ' missing' : ''; });
      viewEl.querySelectorAll('[data-rank-for="' + id + '"]').forEach(function (badge) {
        if (r.complete) {
          badge.className = 'rank-badge' + (r.tie ? ' tie' : '');
          badge.textContent = 'Rank ' + r.rank + (r.tie ? ' — tie' : '');
        } else {
          badge.className = 'rank-badge incomplete';
          badge.textContent = 'Not ranked';
        }
      });
    });
  }

  function noteButton(d, optionId, criterionId) {
    var cell = getCell(d, optionId, criterionId);
    var crit = d.criteria.find(function (c) { return c.id === criterionId; });
    var opt = d.options.find(function (o) { return o.id === optionId; });
    var btn = el('button', {
      type: 'button',
      class: 'icon-btn score-note-btn no-print',
      text: 'Note',
      'aria-label': 'Note for ' + opt.name + ' on ' + crit.name + (cell.note ? ': ' + cell.note : ''),
      dataset: { focusKey: 'note:' + optionId + ':' + criterionId }
    });
    if (cell.note) {
      var dot = el('span', { class: 'note-dot', 'aria-hidden': 'true' });
      btn.appendChild(dot);
    }
    btn.addEventListener('click', function () { noteDialog(d, optionId, criterionId); });
    return btn;
  }

  function renderComparison(d, opts) {
    opts = opts || {};
    setNav('decisions');
    state.currentId = d.id;
    viewEl.innerHTML = '';
    var results = computeResults(d);
    var missingTotal = results.reduce(function (n, r) { return n + r.missing; }, 0);
    var rankedCount = results.filter(function (r) { return r.complete; }).length;
    var leader = results.filter(function (r) { return r.complete; })
      .sort(function (a, b) { return b.total - a.total; })[0] || null;

    /* header */
    var head = el('div', { class: 'view-head' });
    var headText = el('div', {});
    headText.appendChild(el('h1', { text: d.title, tabindex: -1 }));
    headText.appendChild(el('p', { class: 'lede', text: 'Score each option from 0 to 10 on every criterion. Weights run from 1 (nice to have) to 5 (decisive). Totals update as you type, and everything saves automatically in your browser.' }));
    head.appendChild(headText);
    var backLink = el('a', { class: 'btn btn-secondary no-print', href: '#/decisions', text: 'All decisions' });
    head.appendChild(backLink);
    viewEl.appendChild(head);

    /* toolbar */
    var toolbar = el('div', { class: 'workspace-toolbar no-print' });
    var addOptBtn = el('button', { type: 'button', class: 'btn btn-secondary', id: 'add-option-btn', text: 'Add option' });
    addOptBtn.addEventListener('click', function () {
      promptTextDialog('Add option', 'Option name', '', 'Add option', function (v) {
        d.options.push({ id: uid(), name: v });
        touch(d); save(); rerender('add-option-btn');
      });
    });
    var addCritBtn = el('button', { type: 'button', class: 'btn btn-secondary', id: 'add-criterion-btn', text: 'Add criterion' });
    addCritBtn.addEventListener('click', function () {
      promptTextDialog('Add criterion', 'Criterion name', '', 'Add criterion', function (v) {
        d.criteria.push({ id: uid(), name: v, weight: 3 });
        touch(d); save(); rerender('add-criterion-btn');
      });
    });
    var exportBtn = el('button', { type: 'button', class: 'btn btn-ghost', text: 'Export this decision' });
    exportBtn.addEventListener('click', function () {
      download('clearchoice-' + d.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.json',
        JSON.stringify({ app: EXPORT_APP, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), decisions: [d] }, null, 2));
      toast('Decision exported as a JSON file.');
    });
    var printBtn = el('button', { type: 'button', class: 'btn btn-ghost', text: 'Print report' });
    printBtn.addEventListener('click', function () { window.print(); });
    toolbar.appendChild(addOptBtn);
    toolbar.appendChild(addCritBtn);
    toolbar.appendChild(exportBtn);
    toolbar.appendChild(printBtn);
    viewEl.appendChild(toolbar);

    /* notices */
    if (!d.options.length || !d.criteria.length) {
      var start = el('div', { class: 'notice info', role: 'status' });
      var msg = !d.options.length && !d.criteria.length
        ? 'Start by adding at least one option and one criterion below.'
        : !d.options.length
          ? 'Add at least one option below to start scoring.'
          : 'Add at least one criterion below to start scoring.';
      start.appendChild(el('p', { text: msg }));
      viewEl.appendChild(start);
    }
    var miss = el('div', { class: 'notice', role: 'status', id: 'missing-notice', hidden: !(missingTotal > 0 && d.options.length && d.criteria.length) });
    miss.appendChild(el('p', {}, [
      el('span', { id: 'missing-notice-text', text: missingTotal + ' score' + (missingTotal === 1 ? '' : 's') + ' still missing. ' }),
      el('strong', { text: 'Totals below are partial until every cell is scored.' })
    ]));
    viewEl.appendChild(miss);

    /* results summary */
    if (d.options.length && d.criteria.length) {
      var summary = el('section', { class: 'results-summary', 'aria-label': 'Results summary', 'aria-live': 'polite' });
      var leaderChip = el('div', { class: 'summary-chip' });
      leaderChip.appendChild(el('div', { class: 'chip-label', text: 'Leading option' }));
      leaderChip.appendChild(el('div', { class: 'chip-value', id: 'chip-leader-value', text: leader ? leader.option.name : 'None yet' }));
      leaderChip.appendChild(el('div', { class: 'chip-sub', id: 'chip-leader-sub', text: leader ? (leader.total + ' of ' + leader.max + ' points (' + leader.pct + '%)' + (leader.tie ? ' — tied' : '')) : 'Score every criterion to rank options.' }));
      var rankedChip = el('div', { class: 'summary-chip' });
      rankedChip.appendChild(el('div', { class: 'chip-label', text: 'Ranked' }));
      rankedChip.appendChild(el('div', { class: 'chip-value', id: 'chip-ranked-value', text: rankedCount + ' of ' + d.options.length }));
      rankedChip.appendChild(el('div', { class: 'chip-sub', text: 'Options with every criterion scored.' }));
      var missingChip = el('div', { class: 'summary-chip' });
      missingChip.appendChild(el('div', { class: 'chip-label', text: 'Scores missing' }));
      missingChip.appendChild(el('div', { class: 'chip-value', id: 'chip-missing-value', text: String(missingTotal) }));
      missingChip.appendChild(el('div', { class: 'chip-sub', text: 'Empty cells are not counted in totals.' }));
      summary.appendChild(leaderChip);
      summary.appendChild(rankedChip);
      summary.appendChild(missingChip);
      viewEl.appendChild(summary);
    }

    /* comparison table (desktop) */
    if (d.options.length && d.criteria.length) {
      var wrap = el('div', { class: 'table-wrap' });
      var table = el('table', { class: 'compare' });
      table.appendChild(el('caption', { text: 'Comparison for ' + d.title }));
      var thead = el('thead', {});
      var headRow = el('tr', {});
      headRow.appendChild(el('th', { scope: 'col', text: 'Option' }));
      d.criteria.forEach(function (crit) {
        var th = el('th', { scope: 'col', class: 'criterion-head num-col' });
        th.appendChild(document.createTextNode(crit.name));
        th.appendChild(el('span', { class: 'weight-line', text: 'Weight ' + crit.weight + ' of 5' }));
        headRow.appendChild(th);
      });
      headRow.appendChild(el('th', { scope: 'col', class: 'num-col', text: 'Weighted total' }));
      headRow.appendChild(el('th', { scope: 'col', text: 'Rank' }));
      thead.appendChild(headRow);
      table.appendChild(thead);
      var tbody = el('tbody', {});
      results.forEach(function (r) {
        var tr = el('tr', {});
        tr.appendChild(el('th', { scope: 'row', text: r.option.name }));
        d.criteria.forEach(function (crit) {
          var cell = getCell(d, r.option.id, crit.id);
          var td = el('td', { class: 'score-cell num-col' });
          td.appendChild(scoreInput(d, r.option.id, crit.id));
          td.appendChild(document.createTextNode(' '));
          td.appendChild(noteButton(d, r.option.id, crit.id));
          td.appendChild(el('span', { class: 'score-print', dataset: { scorePrintFor: r.option.id + ':' + crit.id }, text: cell.value === null ? 'Not scored' : String(cell.value) + ' / 10' }));
          tr.appendChild(td);
        });
        var totalTd = el('td', { class: 'total-cell num-col' });
        totalTd.appendChild(el('span', { dataset: { totalFor: r.option.id }, text: totalText(r) }));
        totalTd.appendChild(el('br', {}));
        totalTd.appendChild(el('span', { class: 'missing-flag', dataset: { missingFor: r.option.id }, text: r.missing > 0 ? r.missing + ' missing' : '' }));
        tr.appendChild(totalTd);
        var rankTd = el('td', {});
        if (r.complete) {
          rankTd.appendChild(el('span', { class: 'rank-badge' + (r.tie ? ' tie' : ''), dataset: { rankFor: r.option.id }, text: 'Rank ' + r.rank + (r.tie ? ' — tie' : '') }));
        } else {
          rankTd.appendChild(el('span', { class: 'rank-badge incomplete', dataset: { rankFor: r.option.id }, text: 'Not ranked' }));
        }
        tr.appendChild(rankTd);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      viewEl.appendChild(wrap);

      /* stacked option cards (mobile) */
      var cards = el('div', { class: 'option-cards' });
      results.forEach(function (r) {
        var card = el('section', { class: 'card option-card', 'aria-label': 'Scores for ' + r.option.name });
        var cardHead = el('div', { class: 'option-card-head' });
        cardHead.appendChild(el('h3', { text: r.option.name }));
        if (r.complete) {
          cardHead.appendChild(el('span', { class: 'rank-badge' + (r.tie ? ' tie' : ''), dataset: { rankFor: r.option.id }, text: 'Rank ' + r.rank + (r.tie ? ' — tie' : '') }));
        } else {
          cardHead.appendChild(el('span', { class: 'rank-badge incomplete', dataset: { rankFor: r.option.id }, text: 'Not ranked' }));
        }
        card.appendChild(cardHead);
        d.criteria.forEach(function (crit) {
          var row = el('div', { class: 'score-row' });
          var lab = el('div', { class: 'score-label' });
          lab.appendChild(document.createTextNode(crit.name));
          lab.appendChild(el('span', { class: 'weight-line', text: 'Weight ' + crit.weight + ' of 5' }));
          row.appendChild(lab);
          var controls = el('div', { class: 'score-controls' });
          controls.appendChild(scoreInput(d, r.option.id, crit.id));
          controls.appendChild(noteButton(d, r.option.id, crit.id));
          row.appendChild(controls);
          card.appendChild(row);
        });
        var foot = el('p', {});
        foot.appendChild(el('strong', { text: 'Weighted total: ' }));
        foot.appendChild(el('span', { dataset: { totalFor: r.option.id }, text: totalText(r) }));
        foot.appendChild(document.createTextNode(' '));
        foot.appendChild(el('span', { class: 'missing-flag', dataset: { missingForCard: r.option.id }, text: r.missing > 0 ? r.missing + ' score' + (r.missing === 1 ? '' : 's') + ' missing' : '' }));
        card.appendChild(foot);
        cards.appendChild(card);
      });
      viewEl.appendChild(cards);
    }

    /* editors */
    viewEl.appendChild(buildOptionsEditor(d));
    viewEl.appendChild(buildCriteriaEditor(d));
    viewEl.appendChild(buildNotesList(d));

    if (opts.initial) {
      var h1 = viewEl.querySelector('h1');
      if (h1) h1.focus();
    } else if (opts.focusKey) {
      restoreFocus(opts.focusKey);
    }
  }

  function moveItem(arr, index, dir) {
    var j = index + dir;
    if (j < 0 || j >= arr.length) return false;
    var tmp = arr[index]; arr[index] = arr[j]; arr[j] = tmp;
    return true;
  }

  function buildOptionsEditor(d) {
    var section = el('section', { class: 'editor-section no-print', 'aria-label': 'Manage options' });
    section.appendChild(el('h2', { text: 'Options' }));
    if (!d.options.length) {
      section.appendChild(el('p', { text: 'No options yet. Add one to start comparing.' }));
      return section;
    }
    var list = el('ul', { class: 'editor-list' });
    d.options.forEach(function (opt, idx) {
      var li = el('li', {});
      var nameInput = el('input', { type: 'text', value: opt.name, 'aria-label': 'Option name', dataset: { focusKey: 'optname:' + opt.id } });
      nameInput.addEventListener('change', function () {
        var v = nameInput.value.trim();
        if (!v) { nameInput.value = opt.name; toast('Option name cannot be empty.'); return; }
        opt.name = v; touch(d); save(); rerender('optname:' + opt.id);
      });
      li.appendChild(nameInput);
      var controls = el('div', { class: 'item-controls' });
      var up = el('button', { type: 'button', class: 'icon-btn', text: 'Up', 'aria-label': 'Move ' + opt.name + ' up', disabled: idx === 0, dataset: { focusKey: 'optup:' + opt.id } });
      up.addEventListener('click', function () { if (moveItem(d.options, idx, -1)) { touch(d); save(); rerender('optup:' + opt.id); } });
      var down = el('button', { type: 'button', class: 'icon-btn', text: 'Down', 'aria-label': 'Move ' + opt.name + ' down', disabled: idx === d.options.length - 1, dataset: { focusKey: 'optdown:' + opt.id } });
      down.addEventListener('click', function () { if (moveItem(d.options, idx, 1)) { touch(d); save(); rerender('optdown:' + opt.id); } });
      var del = el('button', { type: 'button', class: 'icon-btn danger', text: 'Remove', 'aria-label': 'Remove option ' + opt.name });
      del.addEventListener('click', function () {
        confirmDialog('Remove option?', '"' + opt.name + '" and its scores will be removed from this decision.', 'Remove', function () {
          d.options = d.options.filter(function (o) { return o.id !== opt.id; });
          delete d.scores[opt.id];
          touch(d); save(); rerender('add-option-btn');
          toast('Option removed.');
        });
      });
      controls.appendChild(up); controls.appendChild(down); controls.appendChild(del);
      li.appendChild(controls);
      list.appendChild(li);
    });
    section.appendChild(list);
    return section;
  }

  function buildCriteriaEditor(d) {
    var section = el('section', { class: 'editor-section no-print', 'aria-label': 'Manage criteria' });
    section.appendChild(el('h2', { text: 'Criteria and weights' }));
    section.appendChild(el('p', { text: 'Weight 1 means nice to have, 5 means decisive. A criterion with weight 5 counts five times as much as one with weight 1.' }));
    if (!d.criteria.length) {
      section.appendChild(el('p', { text: 'No criteria yet. Add one to start scoring.' }));
      return section;
    }
    var list = el('ul', { class: 'editor-list' });
    d.criteria.forEach(function (crit, idx) {
      var li = el('li', {});
      var nameInput = el('input', { type: 'text', value: crit.name, 'aria-label': 'Criterion name', dataset: { focusKey: 'critname:' + crit.id } });
      nameInput.addEventListener('change', function () {
        var v = nameInput.value.trim();
        if (!v) { nameInput.value = crit.name; toast('Criterion name cannot be empty.'); return; }
        crit.name = v; touch(d); save(); rerender('critname:' + crit.id);
      });
      li.appendChild(nameInput);
      var controls = el('div', { class: 'item-controls' });
      var weightWrap = el('label', { class: 'weight-control', text: 'Weight ' });
      var select = el('select', { 'aria-label': 'Weight for ' + crit.name, dataset: { focusKey: 'weight:' + crit.id } });
      [1, 2, 3, 4, 5].forEach(function (w) {
        var o = el('option', { value: String(w), text: String(w) });
        if (w === crit.weight) o.selected = true;
        select.appendChild(o);
      });
      select.addEventListener('change', function () {
        crit.weight = Number(select.value); touch(d); save(); rerender('weight:' + crit.id);
      });
      weightWrap.appendChild(select);
      weightWrap.appendChild(document.createTextNode(' of 5'));
      controls.appendChild(weightWrap);
      var up = el('button', { type: 'button', class: 'icon-btn', text: 'Up', 'aria-label': 'Move ' + crit.name + ' up', disabled: idx === 0, dataset: { focusKey: 'critup:' + crit.id } });
      up.addEventListener('click', function () { if (moveItem(d.criteria, idx, -1)) { touch(d); save(); rerender('critup:' + crit.id); } });
      var down = el('button', { type: 'button', class: 'icon-btn', text: 'Down', 'aria-label': 'Move ' + crit.name + ' down', disabled: idx === d.criteria.length - 1, dataset: { focusKey: 'critdown:' + crit.id } });
      down.addEventListener('click', function () { if (moveItem(d.criteria, idx, 1)) { touch(d); save(); rerender('critdown:' + crit.id); } });
      var del = el('button', { type: 'button', class: 'icon-btn danger', text: 'Remove', 'aria-label': 'Remove criterion ' + crit.name });
      del.addEventListener('click', function () {
        confirmDialog('Remove criterion?', '"' + crit.name + '" and its scores will be removed from this decision.', 'Remove', function () {
          d.criteria = d.criteria.filter(function (c) { return c.id !== crit.id; });
          Object.keys(d.scores).forEach(function (optId) { delete d.scores[optId][crit.id]; });
          touch(d); save(); rerender('add-criterion-btn');
          toast('Criterion removed.');
        });
      });
      controls.appendChild(up); controls.appendChild(down); controls.appendChild(del);
      li.appendChild(controls);
      list.appendChild(li);
    });
    section.appendChild(list);
    return section;
  }

  function buildNotesList(d) {
    var notes = [];
    d.options.forEach(function (opt) {
      d.criteria.forEach(function (crit) {
        var cell = d.scores[opt.id] && d.scores[opt.id][crit.id];
        if (cell && cell.note) notes.push({ opt: opt.name, crit: crit.name, note: cell.note });
      });
    });
    var section = el('section', { class: 'editor-section', 'aria-label': 'Score notes' });
    section.appendChild(el('h2', { text: 'Score notes' }));
    if (!notes.length) {
      section.appendChild(el('p', { text: 'No notes yet. Use the Note button next to any score to record why you gave it.' }));
      return section;
    }
    var list = el('ul', {});
    notes.forEach(function (n) {
      var li = el('li', {});
      li.appendChild(el('strong', { text: n.opt + ' — ' + n.crit + ': ' }));
      li.appendChild(document.createTextNode(n.note));
      list.appendChild(li);
    });
    section.appendChild(list);
    return section;
  }

  function renderGuide(opts) {
    opts = opts || {};
    setNav('guide');
    state.currentId = null;
    viewEl.innerHTML = '';
    var head = el('div', { class: 'view-head' });
    head.appendChild(el('div', {}, [
      el('h1', { text: 'Guide & Privacy', tabindex: -1 }),
      el('p', { class: 'lede', text: 'How ClearChoice scoring works, and what happens to your data (short answer: your decisions stay in your browser).' })
    ]));
    viewEl.appendChild(head);

    var grid = el('div', { class: 'guide-grid' });

    var how = el('section', { class: 'card' });
    how.appendChild(el('h2', { text: 'How scoring works' }));
    var ol = el('ol', {});
    [
      'Create a decision and add the options you are choosing between, for example three laptops.',
      'Add criteria that matter to you, for example price, battery life, and weight.',
      'Give each criterion a weight from 1 to 5. A weight of 5 counts five times as much as a weight of 1.',
      'Score every option from 0 to 10 on each criterion. 0 means it fails that criterion, 10 means it is ideal.',
      'ClearChoice multiplies each score by its criterion weight, adds them up, and ranks the options. The leader is the highest weighted total.',
      'Add a note to any score to record your reasoning. Notes appear in the printed report.'
    ].forEach(function (t) { ol.appendChild(el('li', { text: t })); });
    how.appendChild(ol);
    how.appendChild(el('p', { text: 'Ties: when two options end with the same weighted total, both show a “Tie” badge and share a rank. Missing scores: an option with any empty cell is not ranked, and its total is shown as partial.' }));
    grid.appendChild(how);

    var tips = el('section', { class: 'card' });
    tips.appendChild(el('h2', { text: 'Tips for a fair comparison' }));
    var ul = el('ul', {});
    [
      'Score all options on one criterion before moving to the next, so your scale stays consistent.',
      'Use the full 0–10 range. If everything scores 7 or 8, the criteria are not separating the options.',
      'Keep weights honest: if everything is a 5, nothing is decisive.',
      'Duplicate a decision to try a different set of weights without losing your first version.',
      'Print the report when you want to talk the decision through with someone else.'
    ].forEach(function (t) { ul.appendChild(el('li', { text: t })); });
    tips.appendChild(ul);
    grid.appendChild(tips);

    var privacy = el('section', { class: 'card' });
    privacy.appendChild(el('h2', { text: 'Privacy' }));
    privacy.appendChild(el('p', { text: 'ClearChoice has no account, no backend, and no analytics. Decisions, scores, and notes are saved only in this browser’s local storage, on this device.' }));
    privacy.appendChild(el('p', { text: 'The app requests only its own static files; decision content is never transmitted. The only way data leaves this browser is when you choose Export, which downloads a JSON file you control, or Print, which goes to your printer.' }));
    privacy.appendChild(el('p', { text: 'Clearing this browser’s site data will delete your decisions, so export a backup file if they matter to you.' }));
    grid.appendChild(privacy);

    var backup = el('section', { class: 'card' });
    backup.appendChild(el('h2', { text: 'Backup and restore' }));
    backup.appendChild(el('p', { text: 'Use Export all in the header to download every decision as one JSON file. Import reads that file back and replaces everything currently saved, after asking you to confirm. A file that is not a valid ClearChoice backup is rejected whole, and nothing is changed.' }));
    backup.appendChild(el('p', { text: 'You can also export a single decision from its workspace, and import it the same way.' }));
    grid.appendChild(backup);

    viewEl.appendChild(grid);

    if (opts.initial) {
      var h1 = viewEl.querySelector('h1');
      if (h1) h1.focus();
    }
  }

  /* ---------- header export/import ---------- */

  document.getElementById('export-all-btn').addEventListener('click', function () {
    download('clearchoice-backup-' + new Date().toISOString().slice(0, 10) + '.json',
      JSON.stringify({ app: EXPORT_APP, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), decisions: state.decisions }, null, 2));
    toast(state.decisions.length ? 'Backup downloaded.' : 'Backup downloaded (no decisions yet).');
  });

  var importInput = document.getElementById('import-file');
  document.getElementById('import-all-btn').addEventListener('click', function () { importInput.click(); });
  importInput.addEventListener('change', function () {
    var file = importInput.files && importInput.files[0];
    importInput.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(String(reader.result)); }
      catch (e) { toast('Import failed: the file is not valid JSON. Nothing changed.'); return; }
      var err = validateBackup(data);
      if (err) { toast('Import failed: ' + err + ' Nothing changed.'); return; }
      var count = data.decisions.length;
      confirmDialog('Replace all decisions?',
        'Importing will replace the ' + state.decisions.length + ' decision' + (state.decisions.length === 1 ? '' : 's') +
        ' currently saved with the ' + count + ' decision' + (count === 1 ? '' : 's') + ' in this file. This cannot be undone.',
        'Replace and import', function () {
          state.decisions = data.decisions;
          save(); render();
          toast('Imported ' + count + ' decision' + (count === 1 ? '' : 's') + '.');
        });
    };
    reader.onerror = function () { toast('Import failed: the file could not be read. Nothing changed.'); };
    reader.readAsText(file);
  });

  /* ---------- boot ---------- */

  load();
  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline support is optional */ });
    });
  }
})();
