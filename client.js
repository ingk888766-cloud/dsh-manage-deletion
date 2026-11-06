/**
 * dsh-manage-deletion — browser half.
 *
 * 1. A main page (侧栏「删除管理」) that scans every session, lists them like the
 *    sidebar (title … time), and deletes in bulk.
 * 2. Session-row integrations: a hover trash button on every row, and a leading
 *    checkbox while multi-select mode is on.
 * 3. A select toolbar above the workspace list: 多选 / 全选 / 删除选中.
 * 4. One global confirm dialog (shell.overlay): 删除 / 放弃删除, plus the
 *    「同时删除工作区文件」 opt-in.
 *
 * Everything destructive goes through the host route and lands in the plugin
 * trash; the page has a 回收站 tab with select-all, restore and永久删除.
 */
window.__ModuleLoader__.load({
  id: 'dsh-manage-deletion',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var react = require('react');
    var h = react.createElement;

    var inject = ['slots', 'locale', 'sessions', 'layout'];
    var NS = 'manage-deletion';
    var PANEL_ID = 'manage-deletion';
    var API = '/manage-deletion';

    // ── dictionaries ──────────────────────────────────────────────────────
    var zh = {
      label: '删除管理',
      title: '删除管理',
      subtitle: '扫描全部会话，勾选后统一删除；删除一律进回收站，可恢复会话与工作区文件。',
      tabSessions: '会话',
      tabTrash: '回收站',
      scan: '快速扫描',
      scanning: '扫描中…',
      autoScanned: '已扫描',
      total: '会话',
      listed: '列出',
      trashCount: '回收站',
      selectMode: '多选',
      selectAll: '全选',
      clearAll: '取消全选',
      deleteSelected: '删除选中',
      restoreSelected: '恢复选中',
      purgeSelected: '彻底删除',
      cancel: '取消',
      selectedN: '已选 {n}',
      deleteOne: '删除会话',
      dialogTitle: '删除会话',
      dialogBody: '将删除 {n} 个会话，日志与缓存一起进入回收站，可在「删除管理 → 回收站」恢复。',
      dialogWorkspace: '同时删除工作区文件',
      dialogWorkspaceHint: '把会话所在的工作区文件夹一并移到回收站（仅当该文件夹里没有其他会话时可用）。',
      dialogWorkspaceBlocked: '该工作区还有 {n} 个其他会话，不能连文件夹一起删。',
      confirmDelete: '删除',
      giveUp: '放弃删除',
      deleted: '已删除 {n} 个会话，进入回收站。',
      restored: '已恢复 {n} 个会话。',
      purged: '已彻底删除 {n} 项。',
      failed: '失败 {n} 项：',
      empty: '这次扫描没有会话。',
      trashEmpty: '回收站是空的。',
      time: '时间',
      size: '大小',
      workspace: '工作区',
      junk: '可清理',
      blank: '空会话',
      subagent: '子代理',
      testTitle: '测试标题',
      orphan: '目录不存在',
      tinyOld: '很小且很久没动',
      filterAll: '全部',
      filterJunk: '仅可清理',
      colTitle: '会话',
      colTime: '时间',
      noTitle: '（无标题）',
      unregistered: '未登记工作区',
      loadFailed: '读取失败',
      confirmPurge: '彻底删除会丢弃回收站里的日志与工作区副本，无法恢复。确定删除 {n} 项？',
      scanHint: '按会话时间倒序排列；点「多选」后可勾选、全选。'
    };
    var en = {
      label: 'Deletion manager',
      title: 'Deletion manager',
      subtitle: 'Scan every session, select, and delete together. Deletes go to a restorable trash (sessions and workspace files).',
      tabSessions: 'Sessions',
      tabTrash: 'Trash',
      scan: 'Scan',
      scanning: 'Scanning…',
      autoScanned: 'Scanned',
      total: 'Sessions',
      listed: 'Listed',
      trashCount: 'Trash',
      selectMode: 'Select',
      selectAll: 'Select all',
      clearAll: 'Clear all',
      deleteSelected: 'Delete selected',
      restoreSelected: 'Restore',
      purgeSelected: 'Delete forever',
      cancel: 'Cancel',
      selectedN: '{n} selected',
      deleteOne: 'Delete session',
      dialogTitle: 'Delete session',
      dialogBody: 'Delete {n} session(s). Logs and caches move to the plugin trash and can be restored from Deletion manager → Trash.',
      dialogWorkspace: 'Also delete workspace files',
      dialogWorkspaceHint: 'Move the session folder to the trash as well (only when no other session lives in it).',
      dialogWorkspaceBlocked: 'That workspace still holds {n} other session(s); its folder cannot go with this delete.',
      confirmDelete: 'Delete',
      giveUp: 'Give up',
      deleted: '{n} session(s) deleted into the trash.',
      restored: '{n} session(s) restored.',
      purged: '{n} item(s) deleted forever.',
      failed: '{n} failed:',
      empty: 'No sessions in this scan.',
      trashEmpty: 'The trash is empty.',
      time: 'Time',
      size: 'Size',
      workspace: 'Workspace',
      junk: 'Cleanable',
      blank: 'Blank',
      subagent: 'Subagent',
      testTitle: 'Test title',
      orphan: 'Missing cwd',
      tinyOld: 'Tiny & old',
      filterAll: 'All',
      filterJunk: 'Cleanable only',
      colTitle: 'Session',
      colTime: 'Time',
      noTitle: '(untitled)',
      unregistered: 'unregistered workspace',
      loadFailed: 'Load failed',
      confirmPurge: 'Permanent delete drops the trashed logs and workspace copies. Delete {n} item(s)?',
      scanHint: 'Newest first. Turn on Select to tick rows or select all.'
    };

    // ── tiny store ────────────────────────────────────────────────────────
    function createStore(initial) {
      var state = initial;
      var listeners = new Set();
      return {
        get: function () { return state; },
        set: function (patch) {
          state = Object.assign({}, state, typeof patch === 'function' ? patch(state) : patch);
          listeners.forEach(function (fn) { fn(); });
        },
        subscribe: function (fn) {
          listeners.add(fn);
          return function () { listeners.delete(fn); };
        }
      };
    }

    var store = createStore({
      selectMode: false,
      selected: {},
      trashSelected: {},
      pending: null,
      tab: 'sessions',
      scan: null,
      scanning: false,
      busy: '',
      notice: '',
      error: '',
      autoRan: false
    });

    function useStore() {
      var pair = react.useState(0);
      var bump = pair[1];
      react.useEffect(function () {
        return store.subscribe(function () { bump(function (v) { return v + 1; }); });
      }, []);
      return store.get();
    }
    function setStore(patch) { store.set(patch); }

    // ── helpers ───────────────────────────────────────────────────────────
    function fmtBytes(n) {
      var v = typeof n === 'number' && isFinite(n) ? n : 0;
      if (v < 1024) return v + ' B';
      if (v < 1048576) return (v / 1024).toFixed(1) + ' KB';
      if (v < 1073741824) return (v / 1048576).toFixed(1) + ' MB';
      return (v / 1073741824).toFixed(2) + ' GB';
    }
    function relTime(ms, nowMs) {
      if (!ms) return '—';
      var diff = Math.max(0, nowMs - ms);
      var min = Math.floor(diff / 60000);
      if (min < 1) return '刚刚';
      if (min < 60) return min + ' 分钟';
      var hours = Math.floor(min / 60);
      if (hours < 24) return hours + ' 小时';
      var days = Math.floor(hours / 24);
      if (days < 30) return days + ' 天';
      var d = new Date(ms);
      function p(v) { return v < 10 ? '0' + v : '' + v; }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }
    function fmtDate(ms) {
      if (!ms) return '—';
      var d = new Date(ms);
      function p(v) { return v < 10 ? '0' + v : '' + v; }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    function interp(text, vars) {
      return String(text).replace(/\{(\w+)\}/g, function (_, key) {
        return vars && vars[key] !== undefined ? String(vars[key]) : '';
      });
    }
    async function api(method, params) {
      var res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({ method: method }, params || {}))
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || data.ok === false) throw new Error(data && data.error ? data.error : 'HTTP ' + res.status);
      return data;
    }

    // Live client-side session rows (title, updatedAt) — the same rows the
    // sidebar shows, so titles never disagree between the two surfaces.
    var sessionRows = null;
    function readSessionRows(ctx) {
      try {
        var sessions = ctx.get('sessions');
        if (sessions && sessions.list && typeof sessions.list.getSnapshot === 'function') {
          sessionRows = sessions.list.getSnapshot().byId || {};
        }
      } catch (error) { /* leave the previous map */ }
      return sessionRows || {};
    }
    function titleOf(ctx, id) {
      var rows = sessionRows || readSessionRows(ctx);
      var row = rows[id];
      if (row && typeof row.title === 'string' && row.title.trim()) return row.title.trim();
      return '';
    }
    function updatedOf(ctx, id) {
      var rows = sessionRows || readSessionRows(ctx);
      var row = rows[id];
      return row && row.updatedAt ? row.updatedAt : 0;
    }

    function selectionCount(state) { return Object.keys(state.selected).length; }

    function toggleId(id) {
      var state = store.get();
      var next = Object.assign({}, state.selected);
      if (next[id]) delete next[id]; else next[id] = true;
      setStore({ selected: next });
    }
    function setSelected(ids, on) {
      var next = Object.assign({}, store.get().selected);
      ids.forEach(function (id) { if (on) next[id] = true; else delete next[id]; });
      setStore({ selected: next });
    }
    function clearSelected() { setStore({ selected: {} }); }

    async function runScan() {
      setStore({ scanning: true, error: '' });
      try {
        var data = await api('scan');
        setStore({ scan: data, scanning: false, autoRan: true });
        return data;
      } catch (error) {
        setStore({ scanning: false, error: String(error && error.message ? error.message : error) });
        return null;
      }
    }

    function openDeleteDialog(ids) {
      var list = (ids || []).filter(Boolean);
      if (list.length === 0) return;
      setStore({ pending: { ids: list, deleteWorkspace: false, info: null } });
      api('info', { ids: list }).then(function (data) {
        var rows = data.sessions || [];
        var blocked = rows.some(function (row) { return !row.canDeleteWorkspace; });
        var others = rows.reduce(function (max, row) { return Math.max(max, row.otherSessions || 0); }, 0);
        var current = store.get().pending;
        if (!current || current.ids.join('|') !== list.join('|')) return;
        setStore({ pending: Object.assign({}, current, { info: rows, workspaceBlocked: blocked, others: others }) });
      }).catch(function () { /* dialog still works without size facts */ });
    }

    async function doDelete() {
      var pending = store.get().pending;
      if (!pending) return;
      setStore({ busy: 'delete', error: '' });
      try {
        var data = await api('trash', { ids: pending.ids, deleteWorkspace: pending.deleteWorkspace === true });
        var results = data.results || [];
        var ok = results.filter(function (row) { return row.ok; });
        var bad = results.filter(function (row) { return !row.ok; });
        var lines = [interp('已删除 {n} 个会话，进入回收站。', { n: ok.length })];
        if (bad.length > 0) {
          lines.push(interp('失败 {n} 项：', { n: bad.length }));
          bad.slice(0, 5).forEach(function (row) { lines.push('· ' + (row.id || '') + ' — ' + (row.message || row.code || '')); });
        }
        setStore({ busy: '', pending: null, notice: lines.join('\n'), selected: {} });
        await runScan();
      } catch (error) {
        setStore({ busy: '', error: String(error && error.message ? error.message : error) });
      }
    }

    function openPurgeDialog(ids) {
      if (!ids || ids.length === 0) return;
      setStore({ pending: { trashIds: ids, mode: 'purge' } });
    }

    async function doPurge() {
      var pending = store.get().pending;
      if (!pending || pending.mode !== 'purge') return;
      setStore({ busy: 'purge', error: '' });
      try {
        var data = await api('purge', { trashIds: pending.trashIds, confirm: true });
        var ok = (data.results || []).filter(function (row) { return row.ok; });
        setStore({ busy: '', pending: null, notice: interp('已彻底删除 {n} 项。', { n: ok.length }), trashSelected: {} });
        await runScan();
      } catch (error) {
        setStore({ busy: '', error: String(error && error.message ? error.message : error) });
      }
    }

    async function restoreTrash(trashIds) {
      if (!trashIds || trashIds.length === 0) return;
      setStore({ busy: 'restore', error: '' });
      try {
        var data = await api('restore', { trashIds: trashIds });
        var ok = (data.results || []).filter(function (row) { return row.ok; });
        var bad = (data.results || []).filter(function (row) { return !row.ok; });
        var lines = [interp('已恢复 {n} 个会话。', { n: ok.length })];
        if (bad.length > 0) {
          lines.push(interp('失败 {n} 项：', { n: bad.length }));
          bad.slice(0, 5).forEach(function (row) { lines.push('· ' + (row.sessionId || row.trashId) + ' — ' + (row.message || '')); });
        }
        setStore({ busy: '', notice: lines.join('\n'), trashSelected: {} });
        await runScan();
      } catch (error) {
        setStore({ busy: '', error: String(error && error.message ? error.message : error) });
      }
    }

    // ── shared styles ─────────────────────────────────────────────────────
    var CSS = [
      '.__md_page{display:flex;flex-direction:column;gap:12px;max-width:980px;padding:18px 20px;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.__md_head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
      '.__md_title{font-size:15px;font-weight:600;margin:0}',
      '.__md_sub{margin:4px 0 0;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.__md_row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.__md_btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 12px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
      '.__md_btn:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary)}',
      '.__md_btn:disabled{opacity:.45;cursor:default}',
      '.__md_btnPrimary{border-color:var(--dsw-alias-state-business-primary,#3964fe);background:var(--dsw-alias-state-business-primary,#3964fe);color:#fff}',
      '.__md_btnDanger{border-color:var(--dsw-alias-state-error-primary,#f85149);color:var(--dsw-alias-state-error-primary,#f85149)}',
      '.__md_btnGhost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary)}',
      '.__md_chips{display:flex;gap:6px;flex-wrap:wrap}',
      '.__md_chip{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:2px 10px;font:inherit;font-size:11px;cursor:pointer}',
      '.__md_chipOn{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}',
      '.__md_tabs{display:flex;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:6px}',
      '.__md_tab{border:none;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:4px 10px;border-radius:8px;cursor:pointer}',
      '.__md_tabOn{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.__md_list{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}',
      '.__md_line{display:grid;grid-template-columns:24px 1fr auto;gap:8px;align-items:center;padding:7px 10px;border-top:1px solid var(--dsw-alias-border-l2);cursor:default}',
      '.__md_line:first-child{border-top:none}',
      '.__md_lineHead{font-size:11px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2)}',
      '.__md_lineOn{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,transparent)}',
      '.__md_item{min-width:0}',
      '.__md_itemTitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__md_itemMeta{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__md_right{display:flex;align-items:center;gap:10px}',
      '.__md_time{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;min-width:64px;text-align:right}',
      '.__md_size{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;min-width:56px;text-align:right}',
      '.__md_badges{display:flex;gap:4px;flex-wrap:wrap}',
      '.__md_badge{border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:0 6px;font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.__md_empty{padding:20px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}',
      '.__md_notice{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap}',
      '.__md_err{font-size:12px;color:var(--dsw-alias-state-error-primary,#f85149);white-space:pre-wrap}',
      '.__md_check{accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}',
      '.__md_toolbar{display:flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.__md_toolbarBtn{border:none;background:none;color:inherit;font:inherit;cursor:pointer;padding:2px 6px;border-radius:6px}',
      '.__md_toolbarBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.__md_iconBtn{border:none;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:2px;border-radius:6px;display:inline-flex;align-items:center}',
      '.__md_iconBtn:hover{color:var(--dsw-alias-state-error-primary,#f85149);background:var(--dsw-alias-interactive-bg-hover)}',
      '.__md_mask{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.45));display:flex;align-items:center;justify-content:center;z-index:1000}',
      '.__md_dialog{width:min(460px,92vw);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px;box-shadow:0 18px 48px rgba(0,0,0,.28)}',
      '.__md_dialogTitle{font-size:14px;font-weight:600;margin:0}',
      '.__md_dialogBody{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;margin:0}',
      '.__md_dialogList{max-height:140px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;font-size:12px}',
      '.__md_dialogList div{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__md_opt{display:flex;gap:8px;align-items:flex-start;font-size:12px}',
      '.__md_hint{font-size:11px;color:var(--dsw-alias-label-tertiary)}'
    ].join('');

    function installStyles() {
      var tag = document.createElement('style');
      tag.setAttribute('data-dsh-plugin', NS);
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return tag;
    }

    // ── sidebar: select toolbar above the workspace list ───────────────────
    function SelectToolbar(props) {
      var state = useStore();
      var t = props.t;
      var count = selectionCount(state);
      var scan = state.scan;
      var ids = scan && scan.sessions ? scan.sessions.map(function (row) { return row.id; }) : [];
      var allOn = ids.length > 0 && ids.every(function (id) { return state.selected[id]; });
      return h('div', {
        className: '__md_toolbar',
        style: { margin: '4px 8px 6px', justifyContent: 'flex-start' }
      },
        h('button', {
          type: 'button',
          className: '__md_toolbarBtn',
          title: t('selectMode'),
          onClick: function () {
            var next = !store.get().selectMode;
            setStore({ selectMode: next });
            if (!next) clearSelected();
            if (next && !store.get().scan && !store.get().scanning) void runScan();
          }
        }, (state.selectMode ? '✓ ' : '☰ ') + t('selectMode')),
        state.selectMode ? h('span', { role: 'separator' }, '·') : null,
        state.selectMode ? h('button', {
          type: 'button',
          className: '__md_toolbarBtn',
          onClick: function () { setSelected(ids, !allOn); }
        }, allOn ? t('clearAll') : t('selectAll')) : null,
        state.selectMode ? h('span', { role: 'separator' }, '·') : null,
        state.selectMode ? h('button', {
          type: 'button',
          className: '__md_toolbarBtn',
          style: { color: count > 0 ? 'var(--dsw-alias-state-error-primary,#f85149)' : undefined },
          disabled: count === 0,
          onClick: function () { openDeleteDialog(Object.keys(store.get().selected)); }
        }, t('deleteSelected') + (count > 0 ? ' (' + count + ')' : '')) : null
      );
    }

    // ── sidebar: leading checkbox per session row ──────────────────────────
    function RowCheck(props) {
      var state = useStore();
      if (!state.selectMode) return null;
      var id = props.sessionId;
      var checked = state.selected[id] === true;
      return h('input', {
        type: 'checkbox',
        className: '__md_check',
        checked: checked,
        'aria-label': id,
        onClick: function (event) { event.stopPropagation(); },
        onChange: function (event) {
          event.stopPropagation();
          toggleId(id);
        }
      });
    }

    // ── sidebar: hover trash button per session row ────────────────────────
    function RowDelete(props) {
      var t = props.t;
      var id = props.sessionId;
      return h('button', {
        type: 'button',
        className: '__md_iconBtn',
        title: t('deleteOne'),
        'aria-label': t('deleteOne'),
        onClick: function (event) {
          event.preventDefault();
          event.stopPropagation();
          openDeleteDialog([id]);
        }
      }, h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M3 4h10M6.5 4V2.8h3V4M4.4 4l.5 9.1h6.2l.5-9.1', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
      ));
    }

    // ── global dialog ─────────────────────────────────────────────────────
    function DialogHost(props) {
      var state = useStore();
      var t = props.t;
      var pending = state.pending;
      if (!pending) return null;

      if (pending.mode === 'purge') {
        return h('div', { className: '__md_mask', onMouseDown: function (event) { if (event.target === event.currentTarget) setStore({ pending: null }); } },
          h('div', { className: '__md_dialog', role: 'dialog', 'aria-modal': 'true' },
            h('p', { className: '__md_dialogTitle' }, t('purgeSelected')),
            h('p', { className: '__md_dialogBody' }, interp(t('confirmPurge'), { n: pending.trashIds.length })),
            h('div', { className: '__md_row', style: { justifyContent: 'flex-end' } },
              h('button', { type: 'button', className: '__md_btn', onClick: function () { setStore({ pending: null }); } }, t('cancel')),
              h('button', {
                type: 'button',
                className: '__md_btn __md_btnDanger',
                disabled: state.busy === 'purge',
                onClick: function () { void doPurge(); }
              }, state.busy === 'purge' ? t('purgeSelected') + '…' : t('purgeSelected'))
            )
          )
        );
      }

      var ids = pending.ids || [];
      var info = pending.info || [];
      var titles = ids.map(function (id, index) {
        var row = info[index];
        var title = titleOf(props.ctx, id) || (row && row.title) || t('noTitle');
        return h('div', { key: id }, title);
      });
      var blocked = pending.workspaceBlocked === true;
      var others = pending.others || 0;
      return h('div', { className: '__md_mask', onMouseDown: function (event) { if (event.target === event.currentTarget) setStore({ pending: null }); } },
        h('div', { className: '__md_dialog', role: 'dialog', 'aria-modal': 'true' },
          h('p', { className: '__md_dialogTitle' }, t('dialogTitle') + ' · ' + ids.length),
          h('p', { className: '__md_dialogBody' }, interp(t('dialogBody'), { n: ids.length })),
          h('div', { className: '__md_dialogList' }, titles),
          h('label', { className: '__md_opt' },
            h('input', {
              type: 'checkbox',
              className: '__md_check',
              disabled: blocked,
              checked: !blocked && pending.deleteWorkspace === true,
              onChange: function (event) {
                var current = store.get().pending;
                if (!current) return;
                setStore({ pending: Object.assign({}, current, { deleteWorkspace: event.target.checked }) });
              }
            }),
            h('span', null,
              h('div', null, t('dialogWorkspace')),
              h('div', { className: '__md_hint' }, blocked ? interp(t('dialogWorkspaceBlocked'), { n: others }) : t('dialogWorkspaceHint'))
            )
          ),
          state.error ? h('div', { className: '__md_err' }, state.error) : null,
          h('div', { className: '__md_row', style: { justifyContent: 'flex-end' } },
            h('button', {
              type: 'button',
              className: '__md_btn',
              onClick: function () { setStore({ pending: null, error: '' }); }
            }, t('giveUp')),
            h('button', {
              type: 'button',
              className: '__md_btn __md_btnDanger',
              disabled: state.busy === 'delete',
              onClick: function () { void doDelete(); }
            }, state.busy === 'delete' ? t('confirmDelete') + '…' : t('confirmDelete'))
          )
        )
      );
    }

    // ── main page ─────────────────────────────────────────────────────────
    function Page(props) {
      var state = useStore();
      var t = props.t;
      var ctx = props.ctx;

      react.useEffect(function () {
        if (!state.autoRan && !state.scanning) void runScan();
      }, []);

      var scan = state.scan;
      var trash = scan && scan.trash ? scan.trash : { entries: [] };
      var now = Date.now();
      var rows = (scan && scan.sessions ? scan.sessions : []).slice();
      var filter = state.filter || 'all';
      if (filter === 'junk') rows = rows.filter(function (row) { return row.junk; });
      rows.sort(function (a, b) {
        var ta = updatedOf(ctx, a.id) || a.createdAt || 0;
        var tb = updatedOf(ctx, b.id) || b.createdAt || 0;
        return tb - ta;
      });

      var allIds = rows.map(function (row) { return row.id; });
      var allOn = allIds.length > 0 && allIds.every(function (id) { return state.selected[id]; });
      var count = selectionCount(state);
      var trashIds = trash.entries.map(function (entry) { return entry.trashId; });
      var trashAllOn = trashIds.length > 0 && trashIds.every(function (id) { return state.trashSelected[id]; });
      var trashCount = Object.keys(state.trashSelected).length;

      function toggleTrash(id) {
        var next = Object.assign({}, store.get().trashSelected);
        if (next[id]) delete next[id]; else next[id] = true;
        setStore({ trashSelected: next });
      }

      return h('div', { className: '__md_page' },
        h('div', { className: '__md_head' },
          h('div', null,
            h('p', { className: '__md_title' }, t('title')),
            h('p', { className: '__md_sub' }, t('subtitle'))
          ),
          h('div', { className: '__md_row' },
            h('button', { type: 'button', className: '__md_btn __md_btnPrimary', disabled: state.scanning, onClick: function () { void runScan(); } },
              state.scanning ? t('scanning') : t('scan'))
          )
        ),

        h('div', { className: '__md_row', style: { gap: 14 } },
          h('span', { className: '__md_itemMeta' }, t('total') + ' ' + (scan && scan.stats ? scan.stats.total : '—')),
          h('span', { className: '__md_itemMeta' }, t('listed') + ' ' + rows.length),
          h('span', { className: '__md_itemMeta' }, t('trashCount') + ' ' + (trash.entries.length || 0)),
          h('span', { className: '__md_itemMeta' }, scan && scan.scannedAt ? t('autoScanned') + ' ' + fmtDate(scan.scannedAt) : '')
        ),

        h('div', { className: '__md_tabs' },
          h('button', { type: 'button', className: '__md_tab' + (state.tab === 'sessions' ? ' __md_tabOn' : ''), onClick: function () { setStore({ tab: 'sessions' }); } }, t('tabSessions')),
          h('button', { type: 'button', className: '__md_tab' + (state.tab === 'trash' ? ' __md_tabOn' : ''), onClick: function () { setStore({ tab: 'trash' }); } }, t('tabTrash') + ' (' + (trash.entries.length || 0) + ')')
        ),

        state.notice ? h('div', { className: '__md_notice' }, state.notice) : null,
        state.error ? h('div', { className: '__md_err', role: 'alert' }, t('loadFailed') + ': ' + state.error) : null,

        state.tab === 'sessions' ? h(react.Fragment, null,
          h('div', { className: '__md_row' },
            h('button', {
              type: 'button',
              className: '__md_btn',
              onClick: function () {
                var next = !state.selectMode;
                setStore({ selectMode: next });
                if (!next) clearSelected();
              }
            }, (state.selectMode ? '✓ ' : '☰ ') + t('selectMode')),
            state.selectMode ? h('button', {
              type: 'button',
              className: '__md_btn',
              onClick: function () { setSelected(allIds, !allOn); }
            }, allOn ? t('clearAll') : t('selectAll')) : null,
            state.selectMode ? h('button', {
              type: 'button',
              className: '__md_btn __md_btnDanger',
              disabled: count === 0,
              onClick: function () { openDeleteDialog(Object.keys(store.get().selected)); }
            }, t('deleteSelected') + (count > 0 ? ' (' + count + ')' : '')) : null,
            h('span', { style: { flex: '1 1 auto' } }),
            h('span', { className: '__md_itemMeta' }, t('scanHint'))
          ),
          h('div', { className: '__md_list' },
            h('div', { className: '__md_line __md_lineHead' },
              h('span', null, state.selectMode ? '☑' : ''),
              h('span', null, t('colTitle')),
              h('span', null, t('colTime'))
            ),
            rows.length === 0
              ? h('div', { className: '__md_empty' }, state.scanning ? t('scanning') : t('empty'))
              : rows.map(function (row) {
                var id = row.id;
                var on = state.selected[id] === true;
                var title = titleOf(ctx, id) || row.title || t('noTitle');
                var when = updatedOf(ctx, id) || row.createdAt || 0;
                return h('div', {
                  key: id,
                  className: '__md_line' + (on ? ' __md_lineOn' : ''),
                  onClick: function () { if (state.selectMode) toggleId(id); }
                },
                  h('span', null,
                    state.selectMode
                      ? h('input', { type: 'checkbox', className: '__md_check', checked: on, onChange: function () { toggleId(id); }, onClick: function (e) { e.stopPropagation(); } })
                      : null
                  ),
                  h('div', { className: '__md_item' },
                    h('div', { className: '__md_itemTitle' }, title),
                    h('div', { className: '__md_itemMeta' }, (row.workspaceTitle || t('unregistered')) + ' · ' + fmtBytes(row.sizeBytes))
                  ),
                  h('div', { className: '__md_right' },
                    h('span', { className: '__md_time', title: fmtDate(when) }, relTime(when, now)),
                    h('button', {
                      type: 'button',
                      className: '__md_iconBtn',
                      title: t('deleteOne'),
                      onClick: function (event) { event.stopPropagation(); openDeleteDialog([id]); }
                    }, h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
                      h('path', { d: 'M3 4h10M6.5 4V2.8h3V4M4.4 4l.5 9.1h6.2l.5-9.1', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
                    ))
                  )
                );
              })
          )
        ) : null,

        state.tab === 'trash' ? h(react.Fragment, null,
          h('div', { className: '__md_row' },
            h('button', {
              type: 'button',
              className: '__md_btn',
              disabled: trashIds.length === 0,
              onClick: function () {
                var next = Object.assign({}, store.get().trashSelected);
                var on = !trashAllOn;
                trashIds.forEach(function (id) { if (on) next[id] = true; else delete next[id]; });
                setStore({ trashSelected: next });
              }
            }, trashAllOn ? t('clearAll') : t('selectAll')),
            h('button', {
              type: 'button',
              className: '__md_btn',
              disabled: trashCount === 0 || state.busy === 'restore',
              onClick: function () { void restoreTrash(Object.keys(store.get().trashSelected)); }
            }, t('restoreSelected') + (trashCount > 0 ? ' (' + trashCount + ')' : '')),
            h('button', {
              type: 'button',
              className: '__md_btn __md_btnDanger',
              disabled: trashCount === 0,
              onClick: function () { openPurgeDialog(Object.keys(store.get().trashSelected)); }
            }, t('purgeSelected') + (trashCount > 0 ? ' (' + trashCount + ')' : ''))
          ),
          h('div', { className: '__md_list' },
            h('div', { className: '__md_line __md_lineHead' },
              h('span', null, '☑'),
              h('span', null, t('colTitle')),
              h('span', null, t('time'))
            ),
            trash.entries.length === 0
              ? h('div', { className: '__md_empty' }, t('trashEmpty'))
              : trash.entries.slice().sort(function (a, b) { return (b.deletedAt || 0) - (a.deletedAt || 0); }).map(function (entry) {
                var on = state.trashSelected[entry.trashId] === true;
                return h('div', { key: entry.trashId, className: '__md_line' + (on ? ' __md_lineOn' : '') },
                  h('input', { type: 'checkbox', className: '__md_check', checked: on, onChange: function () { toggleTrash(entry.trashId); } }),
                  h('div', { className: '__md_item' },
                    h('div', { className: '__md_itemTitle' }, entry.title || titleOf(ctx, entry.sessionId) || t('noTitle')),
                    h('div', { className: '__md_itemMeta' }, entry.sessionId + ' · ' + fmtBytes(entry.sizeBytes) + (entry.workspaceMoved ? ' · 含工作区文件' : ''))
                  ),
                  h('div', { className: '__md_right' },
                    h('span', { className: '__md_time', title: fmtDate(entry.deletedAt) }, relTime(entry.deletedAt, now)),
                    h('button', {
                      type: 'button',
                      className: '__md_btn',
                      disabled: state.busy === 'restore',
                      onClick: function () { void restoreTrash([entry.trashId]); }
                    }, t('restoreSelected'))
                  )
                );
              })
          )
        ) : null,

        scan && scan.warnings && scan.warnings.length > 0
          ? h('div', { className: '__md_itemMeta' }, scan.warnings.join(' ｜ '))
          : null
      );
    }

    // ── icons ─────────────────────────────────────────────────────────────
    function PanelGlyph(props) {
      var size = props && props.size ? props.size : 16;
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M3 4h10M6.5 4V2.8h3V4M4.4 4l.5 9.1h6.2l.5-9.1', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
      );
    }

    function useLocale(locale) {
      var refresh = react.useState(0)[1];
      react.useEffect(function () {
        if (!locale || typeof locale.subscribe !== 'function') return;
        return locale.subscribe(function () { refresh(function (v) { return v + 1; }); });
      }, [locale]);
    }

    function withLocale(Component, ctx, t) {
      return function Bound(props) {
        useLocale(ctx.locale);
        return h(Component, Object.assign({}, props, { t: t, ctx: ctx }));
      };
    }

    function apply(ctx) {
      var styleTag = installStyles();
      ctx.effect(function () {
        return function () { try { styleTag.remove(); } catch (error) { /* ignore */ } };
      }, 'dsh-manage-deletion: styles');
      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, 'dsh-manage-deletion: dictionaries');
      var t = ctx.locale.bind(NS);

      // Keep titles fresh in the background: the client session store updates
      // as sessions change, so the page never shows stale names.
      try {
        var sessions = ctx.get('sessions');
        if (sessions && sessions.list && typeof sessions.list.subscribe === 'function') {
          ctx.effect(function () {
            return sessions.list.subscribe(function () { readSessionRows(ctx); });
          }, 'dsh-manage-deletion: session titles');
        }
      } catch (error) { /* titles fall back to the host scan */ }

      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 5,
          label: t('label'),
          locale: NS
        }, PanelGlyph);
      });

      ctx.slots.inject('main', function () {
        return ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS
        }, function MainPage(props) {
          return h(Page, { t: t, ctx: ctx, locale: ctx.locale });
        });
      });

      ctx.slots.inject('sidebar.workspaces', function () {
        return ctx.slots.register({
          name: 'sidebar.workspaces',
          id: 'manage-deletion.toolbar',
          order: -100,
          locale: NS
        }, withLocale(function ToolbarHost(props) { return h(SelectToolbar, { t: props.t }); }, ctx, t));
      });

      ctx.slots.inject('sidebar.session.row.leading', function () {
        return ctx.slots.register({
          name: 'sidebar.session.row.leading',
          id: 'manage-deletion.check',
          order: 0
        }, withLocale(function CheckHost(props) { return h(RowCheck, { sessionId: props.sessionId }); }, ctx, t));
      });

      ctx.slots.inject('sidebar.workspaces.session.row.action', function () {
        return ctx.slots.register({
          name: 'sidebar.workspaces.session.row.action',
          id: 'manage-deletion.delete',
          order: 0,
          locale: NS
        }, withLocale(function DeleteHost(props) { return h(RowDelete, { sessionId: props.sessionId, t: props.t }); }, ctx, t));
      });

      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({
          name: 'shell.overlay',
          id: 'manage-deletion.dialog',
          locale: NS
        }, withLocale(function DialogHostBound(props) { return h(DialogHost, { t: props.t, ctx: props.ctx }); }, ctx, t));
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
