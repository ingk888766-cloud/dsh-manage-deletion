/**
 * dsh-manage-deletion — browser half.
 *
 * Slots used (all list/keyed seats that the host bundles declare):
 *   main                                → the manager page
 *   sidebar.panellist (id, order, label) → the「删除管理」row
 *   sidebar.session.row.leading          → checkbox while selecting
 *   sidebar.workspaces.session.row.action→ hover delete + select toggle
 *   shell.overlay                        → the confirm dialog
 *
 * `sidebar.workspaces` is deliberately NOT used: it is a single-occupant seat,
 * and taking it hides the official workspace list.
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

    var zh = {
      label: '删除管理',
      title: '删除管理',
      subtitle: '扫描全部会话，勾选后统一删除；会话日志与它自己产生并修改过的文件一起进回收站，可恢复。',
      tabSessions: '会话',
      tabTrash: '回收站',
      scan: '快速扫描',
      scanning: '扫描中…',
      total: '会话',
      listed: '列出',
      trashCount: '回收站',
      selectMode: '多选',
      selectAll: '全选',
      clearAll: '取消全选',
      deleteSelected: '删除选中',
      restoreSelected: '恢复',
      purgeSelected: '彻底删除',
      cancel: '取消',
      deleteOne: '删除会话',
      selectToggle: '多选',
      dialogTitle: '删除会话',
      dialogBody: '将删除 {n} 个会话：日志与下面这些文件一起移到回收站，可在「删除管理 → 回收站」恢复。',
      dialogFiles: '同时删除这些会话产生的文件',
      dialogFilesHint: '只包含这些会话自己写过或改过的文件（都在各自会话的工作目录内）；不会动工作区里其他文件。',
      dialogNoFiles: '没有扫描到这些会话写过的文件。',
      dialogBlocked: '{n} 个文件不在会话工作目录内，已被排除。',
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
      junk: '可清理',
      colTitle: '会话',
      colTime: '时间',
      noTitle: '（无标题）',
      unregistered: '未登记工作区',
      loadFailed: '读取失败',
      confirmPurge: '彻底删除会丢弃回收站里的日志与文件副本，无法恢复。确定删除 {n} 项？',
      scanHint: '按会话时间倒序；点「多选」后可勾选、全选。',
      more: '加载更多',
      filesBadge: '{n} 个文件',
      fileScanFailed: '文件清单读取失败',
      filesLoading: '正在读取这个会话写过的文件…',
      dialogExtras: '额外文件（默认不删）',
      dialogExtrasHint: '这些文件在会话目录之外，或只是命令里提到过。勾选才会一起移入回收站，恢复时一并还原。',
      selectBar: '多选',
      exit: '退出',
      restoredFiles: '恢复 {n} 个文件'
    };
    var en = {
      label: 'Deletion manager',
      title: 'Deletion manager',
      subtitle: 'Scan every session, select and delete together. Logs and the files each session wrote move to a restorable trash.',
      tabSessions: 'Sessions',
      tabTrash: 'Trash',
      scan: 'Scan',
      scanning: 'Scanning…',
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
      deleteOne: 'Delete session',
      selectToggle: 'Select',
      dialogTitle: 'Delete session',
      dialogBody: 'Delete {n} session(s): the logs and the files listed below move to the trash and can be restored.',
      dialogFiles: 'Also delete the files these sessions wrote',
      dialogFilesHint: 'Only files these sessions created or edited inside their own working directory. Nothing else in the workspace is touched.',
      dialogNoFiles: 'No files were found for these sessions.',
      dialogBlocked: '{n} file(s) outside the session directory were excluded.',
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
      junk: 'Cleanable',
      colTitle: 'Session',
      colTime: 'Time',
      noTitle: '(untitled)',
      unregistered: 'unregistered workspace',
      loadFailed: 'Load failed',
      confirmPurge: 'Permanent delete drops the trashed logs and file copies. Delete {n} item(s)?',
      scanHint: 'Newest first. Turn on Select to tick rows or select all.',
      more: 'Load more',
      filesBadge: '{n} files',
      fileScanFailed: 'File list failed',
      filesLoading: 'Reading the files this session wrote…',
      selectBar: 'Select',
      restoredFiles: '{n} files restored'
    };

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
      autoRan: false,
      limit: 50,
      toast: null
    });

    async function refreshTrash() {
      try {
        var data = await api('trashList', {});
        if (!data || !data.trash) return false;
        var scan = store.get().scan;
        setStore({ scan: Object.assign({}, scan || {}, { trash: data.trash }) });
        return true;
      } catch (error) {
        return false;
      }
    }

    function resyncSessionsSoon(ctx) {
      // The host list is pushed asynchronously; a second ask a moment later
      // catches the update when the first one landed too early.
      setTimeout(function () { resyncSessions(ctx); }, 1500);
    }

    function dropRowsLocally(sessions, ids) {
      // Same call the UI makes when a session scope is discarded: it removes the
      // row from the client list without touching the archive set. Uses only
      // public-ish handles (list snapshot + manager.drop), and no-ops safely.
      var dropped = 0;
      var manager = sessions && sessions.manager;
      if (!manager || typeof manager.drop !== 'function') return dropped;
      var byId = {};
      try {
        byId = (sessions.list.getSnapshot() || {}).byId || {};
      } catch (error) {
        return dropped;
      }
      for (var i = 0; i < ids.length; i += 1) {
        var id = ids[i];
        try {
          var resident = null;
          if (manager.sessions && typeof manager.sessions.get === 'function') resident = manager.sessions.get(id);
          if (!resident && byId[id]) resident = byId[id].session;
          if (resident) {
            void manager.drop(id, resident);
            dropped += 1;
            continue;
          }
          if (typeof sessions.handleSessionRemoved === 'function') {
            sessions.handleSessionRemoved(id);
            dropped += 1;
          }
        } catch (error) { /* keep going: one bad id must not block the rest */ }
      }
      return dropped;
    }

    function resyncSessions(ctx, removedIds) {
      var sessions = null;
      try {
        sessions = ctx.get('sessions');
      } catch (error) {
        return false;
      }
      if (!sessions) return false;
      var told = 0;
      if (Array.isArray(removedIds) && removedIds.length > 0) {
        told = dropRowsLocally(sessions, removedIds);
      }
      // The same hook the host uses when it broadcasts a removal: dropping the
      // row locally is what makes the sidebar update without a restart.
      if (Array.isArray(removedIds) && typeof sessions.handleSessionRemoved === 'function') {
        for (var i = 0; i < removedIds.length; i += 1) {
          try {
            sessions.handleSessionRemoved(removedIds[i]);
            told += 1;
          } catch (error) { /* older client: fall through to refresh */ }
        }
      }
      try {
        if (typeof sessions.refresh === 'function') {
          void sessions.refresh();
          return true;
        }
        if (typeof sessions.refreshProjections === 'function') {
          void sessions.refreshProjections();
          return told > 0;
        }
      } catch (error) { /* the reload button stays the fallback */ }
      return told > 0;
    }

    function useStore() {
      var bump = react.useState(0)[1];
      react.useEffect(function () {
        return store.subscribe(function () { bump(function (v) { return v + 1; }); });
      }, []);
      return store.get();
    }
    function setStore(patch) { store.set(patch); }

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
      var controller = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { try { controller.abort(); } catch (error) { /* noop */ } }, 45000) : null;
      var res;
      try {
        res = await fetch(API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.assign({ method: method }, params || {})),
          signal: controller ? controller.signal : undefined
        });
      } finally {
        if (timer) clearTimeout(timer);
      }
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || data.ok === false) throw new Error(data && data.error ? data.error : 'HTTP ' + res.status);
      return data;
    }

    var sessionRows = null;
    function readSessionRows(ctx) {
      try {
        var sessions = ctx.get('sessions');
        if (sessions && sessions.list && typeof sessions.list.getSnapshot === 'function') {
          sessionRows = sessions.list.getSnapshot().byId || {};
        }
      } catch (error) { /* keep the previous map */ }
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
      var next = Object.assign({}, store.get().selected);
      if (next[id]) delete next[id]; else next[id] = true;
      setStore({ selected: next });
    }
    function setSelected(ids, on) {
      var next = Object.assign({}, store.get().selected);
      ids.forEach(function (id) { if (on) next[id] = true; else delete next[id]; });
      setStore({ selected: next });
    }
    function clearSelected() { setStore({ selected: {} }); }

    async function runScan(force) {
      setStore({ scanning: true, error: '' });
      try {
        // Fast mode: the page reads titles from the live client session store,
        // so the host does not need to fold titles (the expensive part).
        var data = await api('scan', { titles: false, lean: true, force: force === true });
        setStore({ scan: data, scanning: false, autoRan: true, limit: 50 });
        return data;
      } catch (error) {
        setStore({ scanning: false, error: String(error && error.message ? error.message : error) });
        return null;
      }
    }

    function openDeleteDialog(ids) {
      var list = (ids || []).filter(Boolean);
      if (list.length === 0) return;
      setStore({ pending: { ids: list, deleteFiles: true, deleteExtraFiles: false, info: null, files: [], otherFiles: [], loading: true } });
      setTimeout(function () {
        var current = store.get().pending;
        if (!current || current.ids.join('|') !== list.join('|') || current.loading !== true) return;
        setStore({ pending: Object.assign({}, current, { loading: false, infoError: '文件清单读取超时，可直接删除会话日志' }) });
      }, 6000);
      api('info', { ids: list }).then(function (data) {
        var rows = data.sessions || [];
        var files = [];
        var otherFiles = [];
        for (var i = 0; i < rows.length; i += 1) {
          var rowFiles = rows[i].files || [];
          for (var j = 0; j < rowFiles.length; j += 1) files.push(rowFiles[j]);
          var rowExtras = rows[i].otherFiles || [];
          for (var k = 0; k < rowExtras.length; k += 1) otherFiles.push(rowExtras[k]);
        }
        var current = store.get().pending;
        if (!current || current.ids.join('|') !== list.join('|')) return;
        setStore({
          pending: Object.assign({}, current, {
            info: rows,
            files: files,
            otherFiles: otherFiles,
            deleteFiles: files.length > 0,
            loading: false
          })
        });
      }).catch(function (error) {
        var current = store.get().pending;
        if (!current) return;
        setStore({ pending: Object.assign({}, current, { loading: false, infoError: String(error && error.message ? error.message : error) }) });
      });
    }

    async function doDelete() {
      var pending = store.get().pending;
      if (!pending) return;
      setStore({ busy: 'delete', error: '' });
      try {
        var payload = {
          ids: pending.ids,
          deleteFiles: pending.deleteFiles === true,
          deleteExtraFiles: pending.deleteExtraFiles === true
        };
        var data;
        try {
          data = await api('trash', payload);
        } catch (firstError) {
          if (!/清理操作/.test(String(firstError && firstError.message ? firstError.message : firstError))) throw firstError;
          await new Promise(function (resolve) { setTimeout(resolve, 500); });
          data = await api('trash', payload);
        }
        var results = data.results || [];
        var ok = results.filter(function (row) { return row.ok; });
        var bad = results.filter(function (row) { return !row.ok; });
        var lines = [interp('已删除 {n} 个会话，进入回收站。', { n: ok.length })];
        if (bad.length > 0) {
          lines.push(interp('失败 {n} 项：', { n: bad.length }));
          bad.slice(0, 5).forEach(function (row) { lines.push('· ' + (row.id || '') + ' — ' + (row.message || row.code || '')); });
        }
        setStore({
          busy: '',
          pending: null,
          notice: lines.join('\n'),
          selected: {},
          toast: { kind: bad.length > 0 ? 'warn' : 'ok', text: bad.length > 0 ? interp('删除 {ok} 个，失败 {n} 个：', { ok: ok.length, n: bad.length }) + (bad[0].message || bad[0].code || '') : interp('已移入回收站 {n} 个，可在「删除管理 → 回收站」还原。', { n: ok.length }) }
        });
        setTimeout(function () { setStore({ toast: null }); }, 8000);
        // Update the two lists we already have instead of rescanning 900+
        // sessions: the deleted rows leave the list, the trash gains them.
        var removed = {};
        ok.forEach(function (row) { removed[row.id] = true; });
        var scan = store.get().scan;
        if (scan && Array.isArray(scan.sessions)) {
          setStore({
            scan: Object.assign({}, scan, {
              sessions: scan.sessions.filter(function (row) { return !removed[row.id]; })
            })
          });
        }
        var removedIds = ok.map(function (row) { return row.id; });
        var synced = resyncSessions(ctx, removedIds);
        if (synced) setTimeout(function () { resyncSessions(ctx, removedIds); }, 1200);
        await refreshTrash();
        setStore({
          toast: {
            kind: bad.length > 0 ? 'warn' : 'ok',
            text: (bad.length > 0
              ? interp('删除 {ok} 个，失败 {n} 个：', { ok: ok.length, n: bad.length }) + (bad[0].message || bad[0].code || '')
              : interp('已移入回收站 {n} 个。', { n: ok.length }))
              + (synced ? '（已从列表移除 ' + removedIds.length + ' 行）' : '（未找到可用的列表接口，请刷新页面）')
          }
        });
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
        var results = data.results || [];
        var ok = results.filter(function (row) { return row.ok; });
        var bad = results.filter(function (row) { return !row.ok; });
        var lines = [interp('已彻底删除 {n} 项。', { n: ok.length })];
        if (bad.length > 0) {
          lines.push(interp('有 {n} 项没删掉：', { n: bad.length }));
          bad.slice(0, 6).forEach(function (row) {
            lines.push('· ' + (row.trashId || '') + ' — ' + (row.message || row.code || ''));
          });
        }
        setStore({
          busy: '',
          pending: null,
          notice: lines.join('\n'),
          trashSelected: {},
          toast: {
            kind: bad.length > 0 ? 'warn' : 'ok',
            text: bad.length > 0
              ? interp('彻底删除 {ok} 项，失败 {n} 项（原因见页面提示）', { ok: ok.length, n: bad.length })
              : interp('已彻底删除 {n} 项。', { n: ok.length })
          }
        });
        setTimeout(function () { setStore({ toast: null }); }, 8000);
        await refreshTrash();
        resyncSessions(ctx, results.filter(function (row) { return row.ok; }).map(function (row) { return row.sessionId; }).filter(Boolean));
      } catch (error) {
        setStore({ busy: '', error: String(error && error.message ? error.message : error) });
      }
    }

    async function restoreTrash(trashIds) {
      if (!trashIds || trashIds.length === 0) return;
      setStore({ busy: 'restore', error: '' });
      try {
        var data = await api('restore', { trashIds: trashIds });
        var results = data.results || [];
        var ok = results.filter(function (row) { return row.ok; });
        var bad = results.filter(function (row) { return !row.ok; });
        var files = results.reduce(function (sum, row) { return sum + (row.restoredFiles || 0); }, 0);
        var lines = [interp('已恢复 {n} 个会话。', { n: ok.length }) + (files > 0 ? '（含 ' + interp('恢复 {n} 个文件', { n: files }) + '）' : '')];
        if (bad.length > 0) {
          lines.push(interp('失败 {n} 项：', { n: bad.length }));
          bad.slice(0, 5).forEach(function (row) { lines.push('· ' + (row.sessionId || row.trashId) + ' — ' + (row.message || '')); });
        }
        setStore({ busy: '', notice: lines.join('\n'), trashSelected: {} });
        await refreshTrash();
        resyncSessions(ctx);
        await runScan(true);
      } catch (error) {
        setStore({ busy: '', error: String(error && error.message ? error.message : error) });
      }
    }

    var CSS = [
      'html .__md_page{display:flex;flex-direction:column;gap:12px;max-width:1060px;height:100%;overflow-y:auto;overflow-x:hidden;padding:22px 26px 30px;font-size:13px;box-sizing:border-box;',
      'font-family:"Noto Sans SC","Microsoft YaHei UI","Microsoft YaHei","Segoe UI",system-ui,sans-serif;letter-spacing:.2px;line-height:1.65;',
      '--md-ink:#e8eef8;--md-ink2:#a3b3c9;--md-card:rgba(23,28,38,.94);--md-card2:rgba(30,36,48,.92);--md-line:#243044;',
      '--md-accent:#3f6bb5;--md-accent2:#6f97d8;--md-accent-deep:#2b4a80;color:var(--md-ink);',
      'background:linear-gradient(180deg,#0b1017 0%,#0e1420 45%,#0a0f16 100%)}',
      '.__md_page::-webkit-scrollbar{width:10px}',
      '.__md_page::-webkit-scrollbar-thumb{background:rgba(120,150,190,.28);border-radius:6px}',
      '.__md_sticky{position:sticky;top:-22px;z-index:4;display:flex;flex-direction:column;gap:8px;padding:18px 0 2px;',
      'background:linear-gradient(180deg,rgba(11,16,23,.98) 0%,rgba(14,20,32,.94) 72%,rgba(10,15,22,0) 100%)}',
      '.__md_head{display:flex;align-items:center;gap:12px}',
      '.__md_headText{flex:1 1 auto;min-width:0}',
      '.__md_title{font-size:19px;font-weight:700;margin:0;letter-spacing:.5px;color:var(--md-ink)}',
      '.__md_title:before{content:"";display:inline-block;width:13px;height:13px;border-radius:5px;margin-right:10px;vertical-align:-1px;',
      'background:linear-gradient(135deg,var(--md-accent2),var(--md-accent));box-shadow:0 0 12px rgba(63,107,181,.55)}',
      '.__md_sub{margin:6px 0 0;font-size:12.5px;line-height:1.7;color:var(--md-ink2)}',
      '.__md_row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.__md_btn{border:1px solid var(--md-line);background:var(--md-card);color:var(--md-ink);border-radius:16px;padding:9px 18px;font:inherit;font-size:12.5px;cursor:pointer;',
      'white-space:nowrap;transition:transform .1s ease,border-color .18s,color .18s,background .18s}',
      '.__md_btn:hover:not(:disabled){border-color:var(--md-accent2);color:#cfe0f8;transform:translateY(-1px)}',
      '.__md_btnExit:hover:not(:disabled){border-color:#5fd6c2;background:rgba(72,196,180,.24);color:#b8f4ea;transform:none;box-shadow:0 0 0 2px rgba(72,196,180,.28)}',
      '.__md_btn:disabled{opacity:.4;cursor:default}',
      '.__md_btnPrimary{border-color:transparent;background:linear-gradient(135deg,var(--md-accent-deep),var(--md-accent));color:#eef4ff;font-weight:600;',
      'box-shadow:0 4px 14px rgba(30,60,110,.32)}',
      '.__md_btnPrimary:hover:not(:disabled){color:#fff;border-color:transparent}',
      '.__md_btnDanger{border-color:#6b3a3a;color:#e79c96;background:rgba(38,24,26,.9)}',
      '.__md_btnSoft{border-color:#2c4472;color:#a8c4ea;background:rgba(26,36,54,.9)}',
      '.__md_btnActive{border-color:var(--md-accent2);color:#cfe0f8;background:rgba(35,45,64,.95)}',
      '.__md_btnExit{border-color:rgba(72,196,180,.6);background:rgba(72,196,180,.14);color:#8fe3d4;font-weight:600;font-size:14px;padding:8px 15px;letter-spacing:.3px;box-shadow:0 0 0 1px rgba(72,196,180,.22)}',
      '.__md_btnClose{border-color:#e0a33a;color:#ffd79a;background:rgba(224,163,58,.22);font-weight:600;font-size:16px;line-height:1;letter-spacing:0;box-shadow:0 0 0 1px rgba(224,163,58,.28);padding:0;width:38px;min-width:38px;height:38px;border-radius:13px;display:inline-flex;align-items:center;justify-content:center}',
      '.__md_btnClose:hover:not(:disabled){border-color:#f0b455;color:#ffe6bb;background:rgba(224,163,58,.32);box-shadow:0 0 0 2px rgba(224,163,58,.3)}',
      '.__md_metaBar{display:flex;align-items:center;gap:0;flex-wrap:wrap;padding:0 2px;color:#8595ad}',
      '.__md_stat{display:inline-flex;align-items:baseline;gap:6px;padding:0;background:none;border:none;border-radius:0;box-shadow:none}',
      '.__md_stat+.__md_stat{padding-left:16px;border-left:1px solid rgba(147,161,184,.22)}',
      '.__md_stat b{font-size:15px;font-weight:600;color:#dbe6f7;font-variant-numeric:tabular-nums}',
      '.__md_stat i{font-style:normal;font-size:11.5px;color:#8595ad}',
      '.__md_tabs{display:inline-flex;gap:4px;padding:4px;border-radius:18px;background:rgba(18,24,34,.9);border:1px solid var(--md-line);width:max-content}',
      '.__md_tab{border:none;background:transparent;color:var(--md-ink2);font:inherit;font-size:12.5px;padding:9px 22px;border-radius:14px;cursor:pointer;font-weight:600;transition:background .18s,color .18s}',
      '.__md_tabOn{background:rgba(48,62,86,.95);color:#dbe8fa}',
      '.__md_toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:0}',
      '.__md_list{display:flex;flex-direction:column;gap:9px;max-height:calc(100vh - 340px);overflow-y:auto;padding:2px;min-height:160px}',
      '.__md_card{display:flex;align-items:center;gap:14px;padding:14px 18px;border-radius:20px;background:var(--md-card);border:1px solid var(--md-line);',
      'transition:transform .12s ease,border-color .18s,background .18s}',
      '.__md_card:hover{transform:translateY(-1px);background:var(--md-card2);border-color:#31415c}',
      '.__md_cardOn{border-color:var(--md-accent2);box-shadow:0 0 0 1px rgba(111,151,216,.5),0 10px 26px rgba(0,0,0,.35)}',
      '.__md_avatar{width:34px;height:34px;border-radius:12px;flex:none;display:flex;align-items:center;justify-content:center;color:#9fc0ee;',
      'background:rgba(63,107,181,.16);border:1px solid rgba(63,107,181,.4)}',
      '.__md_item{min-width:0;flex:1 1 auto}',
      '.__md_itemTitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;font-weight:600;letter-spacing:.2px;color:var(--md-ink)}',
      '.__md_itemMeta{display:flex;align-items:center;gap:7px;margin-top:4px;font-size:11.5px;color:var(--md-ink2);overflow:hidden;white-space:nowrap}',
      '.__md_tag{padding:2px 10px;border-radius:10px;background:rgba(63,107,181,.18);color:#9fbde6;max-width:230px;overflow:hidden;text-overflow:ellipsis}',
      '.__md_dot{opacity:.4}',
      '.__md_right{display:flex;align-items:center;gap:9px;flex:none}',
      '.__md_pill{font-size:11px;color:#9fb0c8;padding:4px 12px;border-radius:999px;background:rgba(30,38,52,.9);border:1px solid var(--md-line);white-space:nowrap}',
      '.__md_empty{padding:40px 16px;text-align:center;color:var(--md-ink2);font-size:12.5px;display:flex;flex-direction:column;align-items:center}',
      '.__md_notice{font-size:12px;color:#a9c8ee;background:rgba(26,38,58,.9);border:1px solid #2c4472;border-radius:14px;padding:10px 14px;white-space:pre-wrap}',
      '.__md_err{font-size:12px;color:#efa9a3;background:rgba(44,26,28,.92);border:1px solid #6b3a3a;border-radius:14px;padding:10px 14px;white-space:pre-wrap}',
      '.__md_hint{font-size:11px;color:var(--md-ink2)}',
      '.__md_check{accent-color:var(--md-accent2);cursor:pointer;width:16px;height:16px;flex:none}',
      '.__md_iconBtn{border:none;background:rgba(32,40,54,.85);color:#8fa4c0;cursor:pointer;padding:6px;border-radius:11px;display:inline-flex;align-items:center;transition:color .18s,background .18s}',
      '.__md_iconBtn:hover{color:#f0a8a2;background:rgba(60,32,34,.9)}',
      '.__md_iconBtnDanger{color:#d98b84}',
      '.__md_toast{position:fixed;right:20px;bottom:20px;z-index:1200;max-width:min(420px,90vw);display:flex;flex-direction:column;gap:10px;padding:14px 16px;border-radius:16px;background:rgba(23,28,38,.97);border:1px solid #2c4472;box-shadow:0 18px 48px rgba(0,0,0,.55);color:#e8eef8;font-size:12.5px;line-height:1.6}',
      '.__md_toastText{color:#dbe8fa}',
      '.__md_menuItem{display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border:none;border-radius:9px;background:transparent;color:#e8eef8;font:inherit;font-size:12.5px;text-align:left;cursor:pointer}',
      '.__md_menuItem:hover{background:rgba(63,107,181,.25)}',
      '.__md_mask,.__md_bar{--md-ink:#e8eef8;--md-ink2:#93a1b8;--md-card:rgba(23,28,38,.94);--md-card2:rgba(30,36,48,.92);--md-line:#243044;--md-accent:#3f6bb5;--md-accent2:#6f97d8;--md-accent-deep:#2b4a80;color:#e8eef8}',
      '.__md_mask{position:fixed;inset:0;background:rgba(3,7,12,.66);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:1000}',
      '.__md_dialog{width:min(560px,92vw);background:linear-gradient(180deg,#161c27,#111721);color:var(--md-ink);border:1px solid var(--md-line);border-radius:24px;padding:26px 28px;display:flex;flex-direction:column;gap:13px;',
      'box-shadow:0 30px 80px rgba(0,0,0,.6)}',
      '.__md_dialogTitle{font-size:16px;font-weight:700;margin:0;letter-spacing:.4px}',
      '.__md_dialogBody{font-size:12.5px;color:var(--md-ink2);white-space:pre-wrap;margin:0;line-height:1.7}',
      '.__md_dialogList{max-height:150px;overflow:auto;border:1px solid var(--md-line);border-radius:14px;padding:9px 13px;font-size:12px;background:rgba(18,24,34,.9)}',
      '.__md_dialogList div{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 0}',
      '.__md_opt{display:flex;gap:10px;align-items:flex-start;font-size:12px;padding:12px 14px;border:1px solid var(--md-line);border-radius:16px;background:rgba(24,31,42,.9)}',
      '.__md_files{margin:0;padding-left:18px;font-size:11.5px;color:var(--md-ink2);max-height:120px;overflow:auto}'
    ].join('');

    function installStyles() {
      var tag = document.createElement('style');
      tag.setAttribute('data-dsh-plugin', NS);
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return tag;
    }

    // ── sidebar row: checkbox ──────────────────────────────────────────────
    function RowCheck(props) {
      var state = useStore();
      if (!state.selectMode) return null;
      var id = props.sessionId;
      return h('input', {
        type: 'checkbox',
        className: '__md_check',
        checked: state.selected[id] === true,
        'aria-label': id,
        onClick: function (event) { event.stopPropagation(); },
        onChange: function (event) { event.stopPropagation(); toggleId(id); }
      });
    }

    // ── sidebar row: hover actions (select toggle + delete) ────────────────
    function RowActions(props) {
      var t = props.t;
      var id = props.sessionId;
      var state = useStore();
      if (!id) return null;
      return h(react.Fragment, null,
        h('button', {
          type: 'button',
          className: '__md_iconBtn',
          title: t('selectMode'),
          'aria-label': t('selectMode'),
          onClick: function (event) {
            event.preventDefault();
            event.stopPropagation();
            setStore({ selectMode: true });
          }
        }, h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
          h('rect', { x: 2.5, y: 3, width: 4, height: 4, rx: 1, stroke: 'currentColor', 'stroke-width': 1.2 }),
          h('path', { d: 'M8.5 5h5', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-linecap': 'round' })
        )),
        h('button', {
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
        )),
        state.selectMode ? null : null
      );
    }

    // ── global confirm dialog ─────────────────────────────────────────────
    function MenuDeleteItem(props) {
      var t = props.t;
      var id = props.sessionId;
      if (!id) return null;
      return h('button', {
        type: 'button',
        role: 'menuitem',
        className: '__md_menuItem',
        onClick: function (event) {
          event.preventDefault();
          event.stopPropagation();
          openDeleteDialog([id]);
          try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          } catch (error) { /* some hosts close the menu themselves */ }
        }
      }, '🗑 ' + t('deleteOne'));
    }

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
              h('button', { type: 'button', className: '__md_btn __md_btnDanger', disabled: state.busy === 'purge', onClick: function () { void doPurge(); } },
                state.busy === 'purge' ? t('purgeSelected') + '…' : t('purgeSelected'))
            )
          )
        );
      }

      var ids = pending.ids || [];
      var info = pending.info || [];
      var files = pending.files || [];
      var titles = ids.map(function (id, index) {
        var row = info[index];
        return h('div', { key: id }, titleOf(props.ctx, id) || (row && row.title) || t('noTitle'));
      });
      return h('div', { className: '__md_mask', onMouseDown: function (event) { if (event.target === event.currentTarget) setStore({ pending: null }); } },
        h('div', { className: '__md_dialog', role: 'dialog', 'aria-modal': 'true' },
          h('p', { className: '__md_dialogTitle' }, t('dialogTitle') + ' · ' + ids.length),
          h('p', { className: '__md_dialogBody' }, interp(t('dialogBody'), { n: ids.length })),
          h('div', { className: '__md_dialogList' }, titles),
          h('label', { className: '__md_opt' },
            h('input', {
              type: 'checkbox',
              className: '__md_check',
              disabled: files.length === 0,
              checked: files.length > 0 && pending.deleteFiles === true,
              onChange: function (event) {
                var current = store.get().pending;
                if (!current) return;
                setStore({ pending: Object.assign({}, current, { deleteFiles: event.target.checked }) });
              }
            }),
            h('span', null,
              h('div', null, t('dialogFiles') + (files.length > 0 ? '（' + interp(t('filesBadge'), { n: files.length }) + '）' : '')),
              h('div', { className: '__md_hint' }, pending.loading === true ? t('filesLoading') : (files.length > 0 ? t('dialogFilesHint') : t('dialogNoFiles')))
            )
          ),
          files.length > 0 ? h('ul', { className: '__md_files' }, files.slice(0, 40).map(function (file) {
            return h('li', { key: file.path, title: file.path }, file.rel || file.path);
          })) : null,
          (pending.otherFiles || []).length > 0 ? h('label', { className: '__md_opt' },
            h('input', {
              type: 'checkbox',
              className: '__md_check',
              checked: pending.deleteExtraFiles === true,
              onChange: function (event) {
                var current = store.get().pending;
                if (!current) return;
                setStore({ pending: Object.assign({}, current, { deleteExtraFiles: event.target.checked }) });
              }
            }),
            h('span', null,
              h('div', null, t('dialogExtras') + '（' + pending.otherFiles.length + '）'),
              h('div', { className: '__md_hint' }, t('dialogExtrasHint'))
            )
          ) : null,
          (pending.otherFiles || []).length > 0 ? h('ul', { className: '__md_files' }, pending.otherFiles.slice(0, 20).map(function (file) {
            return h('li', { key: file.path, title: file.path }, file.path);
          })) : null,
          pending.infoError ? h('div', { className: '__md_err' }, t('fileScanFailed') + ': ' + pending.infoError) : null,
          state.error ? h('div', { className: '__md_err' }, state.error) : null,
          h('div', { className: '__md_row', style: { justifyContent: 'flex-end' } },
            h('button', { type: 'button', className: '__md_btn', onClick: function () { setStore({ pending: null, error: '' }); } }, t('giveUp')),
            h('button', { type: 'button', className: '__md_btn __md_btnDanger', disabled: state.busy === 'delete' || pending.loading === true, onClick: function () { void doDelete(); } },
              state.busy === 'delete' ? t('confirmDelete') + '…' : t('confirmDelete'))
          )
        )
      );
    }

    // ── floating select bar ───────────────────────────────────────────────
    // The sidebar's workspace block has no plugin seat (it is a single-owner
    // slot), so the bar floats just under our own sidebar row instead of
    // taking that seat and hiding the official workspace list.
    function FloatingSelectBar(props) {
      var state = useStore();
      var t = props.t;
      var pair = react.useState(null);
      var rect = pair[0];
      var setRect = pair[1];
      react.useEffect(function () {
        var alive = true;
        function measure() {
          if (!alive) return;
          var region = document.querySelector('[class*="regionArea"]');
          if (region) {
            var rbox = region.getBoundingClientRect();
            if (rbox.width > 100) {
              setRect({ left: rbox.left + 8, top: Math.max(8, rbox.top - 34), width: Math.max(150, rbox.width - 16) });
              return;
            }
          }
          var anchor = document.querySelector('button[aria-label="' + t('label') + '"]');
          if (anchor) {
            var box = anchor.getBoundingClientRect();
            setRect({ left: box.left, top: box.bottom + 6, width: Math.max(150, box.width) });
            return;
          }
          var col = document.querySelector('[class*="sidebarCol"]');
          if (col) {
            var cbox = col.getBoundingClientRect();
            setRect({ left: cbox.left + 10, top: cbox.top + 96, width: Math.max(150, cbox.width - 20) });
            return;
          }
          setRect(null);
        }
        measure();
        var timer = setInterval(measure, 1200);
        window.addEventListener('resize', measure);
        return function () {
          alive = false;
          clearInterval(timer);
          window.removeEventListener('resize', measure);
        };
      }, []);
      if (!rect) return null;

      var all = state.scan && state.scan.sessions ? state.scan.sessions : [];
      var allOn = all.length > 0 && all.every(function (row) { return state.selected[row.id]; });
      var count = Object.keys(state.selected).length;

      if (!state.selectMode) {
        return h('div', { className: '__md_bar', style: { position: 'fixed', left: rect.left, top: rect.top, width: rect.width, zIndex: 45 } },
          h('button', {
            type: 'button',
            className: '__md_btn',
            style: { width: '100%', background: 'rgba(26,34,48,.96)', color: '#dbe8fa', borderColor: '#243044' },
            onClick: function () { setStore({ selectMode: true }); if (!store.get().scan) void runScan(false); }
          }, '☰ ' + t('selectBar'))
        );
      }
      return h('div', {
        className: '__md_bar',
        style: {
          position: 'fixed', left: rect.left, top: rect.top, width: Math.max(rect.width, 220), zIndex: 45,
          display: 'flex', gap: 6, flexWrap: 'wrap', padding: 6, borderRadius: 10,
          background: 'rgba(20,26,36,.97)', color: '#dbe8fa', boxShadow: '0 12px 32px rgba(0,0,0,.5)', border: '1px solid #243044'
        }
      },
        h('button', {
          type: 'button',
          className: '__md_btn __md_btnClose',
          title: t('clearAll'),
          'aria-label': t('clearAll'),
          style: { flex: '0 0 auto', width: 36, minWidth: 36, height: 36, borderRadius: 12, fontSize: 16 },
          onClick: function () { setStore({ selectMode: false, selected: {} }); }
        }, '×'),
        h('button', { type: 'button', className: '__md_btn', style: { flex: '1 1 auto', background: 'transparent', color: '#dbe8fa', borderColor: '#2c3a52' }, onClick: function () { setSelected(all.map(function (row) { return row.id; }), !allOn); } }, allOn ? t('clearAll') : t('selectAll')),
        h('button', { type: 'button', className: '__md_btn', style: { flex: '1 1 auto', color: '#fff', borderColor: '#2c3a52', background: count > 0 ? '#a33a33' : 'transparent' }, disabled: count === 0, onClick: function () { openDeleteDialog(Object.keys(store.get().selected)); } }, t('deleteSelected') + (count > 0 ? ' (' + count + ')' : ''))
      );
    }

    // ── manager page ──────────────────────────────────────────────────────
    function avatarOf(title) {
      var text = String(title || '').trim();
      if (!text) return '·';
      return text.charAt(0).toUpperCase();
    }

    function EmptyState(text) {
      return h('div', { className: '__md_empty' },
        h('svg', { width: 56, height: 40, viewBox: '0 0 56 40', fill: 'none', 'aria-hidden': 'true' },
          h('ellipse', { cx: 28, cy: 33, rx: 20, ry: 3.5, fill: '#1a2230' }),
          h('path', { d: 'M15 30c-4.4 0-8-3.2-8-7.2 0-3.7 3-6.7 6.8-7.1C15.4 11.5 19.6 8 24.7 8c5.9 0 10.7 4.4 11.1 9.9 3.6.5 6.3 3.3 6.3 6.7 0 3.8-3.4 6.9-7.6 6.9H15z', fill: '#182231', stroke: '#31507b', 'stroke-width': 1.4 })
        ),
        h('div', { style: { marginTop: 10 } }, text)
      );
    }

    function RowAvatar(title) {
      return h('div', { className: '__md_avatar', 'aria-hidden': 'true', title: title || '' },
        h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none' },
          h('path', { d: 'M4 2.2h5l3 3v8.6H4z', stroke: 'currentColor', 'stroke-width': 1.25, 'stroke-linejoin': 'round' }),
          h('path', { d: 'M9 2.2V5.2h3', stroke: 'currentColor', 'stroke-width': 1.25, 'stroke-linejoin': 'round' })
        ));
    }

    function Page(props) {
      var state = useStore();
      var t = props.t;
      var ctx = props.ctx;
      var tabPair = react.useState('sessions');
      var tab = tabPair[0];
      var setTab = tabPair[1];
      var limitPair = react.useState(50);
      var limit = limitPair[0];
      var setLimit = limitPair[1];
      react.useEffect(function () {
        if (!state.autoRan && !state.scanning) void runScan(false);
      }, []);

      var scan = state.scan;
      var trash = scan && scan.trash ? scan.trash : { entries: [] };
      var now = Date.now();
      var all = (scan && scan.sessions ? scan.sessions.slice() : []);
      all.sort(function (a, b) {
        return (updatedOf(ctx, b.id) || b.createdAt || 0) - (updatedOf(ctx, a.id) || a.createdAt || 0);
      });
      var rows = all.slice(0, limit);
      var allOn = all.length > 0 && all.every(function (row) { return state.selected[row.id]; });
      var count = Object.keys(state.selected).length;
      var trashIds = trash.entries.map(function (entry) { return entry.trashId; });
      var trashAllOn = trashIds.length > 0 && trashIds.every(function (id) { return state.trashSelected[id]; });
      var trashCount = Object.keys(state.trashSelected).length;

      function toggleTrash(id) {
        var next = Object.assign({}, store.get().trashSelected);
        if (next[id]) delete next[id]; else next[id] = true;
        setStore({ trashSelected: next });
      }

      var sessionCards = rows.map(function (row) {
        var id = row.id;
        var on = state.selected[id] === true;
        var title = titleOf(ctx, id) || row.title || t('noTitle');
        var when = updatedOf(ctx, id) || row.createdAt || 0;
        return h('div', {
          key: id,
          className: '__md_card' + (on ? ' __md_cardOn' : ''),
          onClick: function () { if (state.selectMode) toggleId(id); }
        },
          state.selectMode
            ? h('input', { type: 'checkbox', className: '__md_check', checked: on, onChange: function () { toggleId(id); }, onClick: function (e) { e.stopPropagation(); } })
            : null,
          RowAvatar(title),
          h('div', { className: '__md_item' },
            h('div', { className: '__md_itemTitle' }, title),
            h('div', { className: '__md_itemMeta' },
              h('span', { className: '__md_tag' }, row.workspaceTitle || t('unregistered')),
              h('span', { className: '__md_dot' }, '·'),
              h('span', null, fmtBytes(row.sizeBytes))
            )
          ),
          h('div', { className: '__md_right' },
            h('span', { className: '__md_pill', title: fmtDate(when) }, when ? relTime(when, now) : '—'),
            h('button', {
              type: 'button',
              className: '__md_iconBtn',
              title: t('deleteOne'),
              'aria-label': t('deleteOne'),
              onClick: function (event) { event.stopPropagation(); openDeleteDialog([id]); }
            }, h('svg', { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
              h('path', { d: 'M3 4h10M6.5 4V2.8h3V4M4.4 4l.5 9.1h6.2l.5-9.1', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
            ))
          )
        );
      });

      var trashCards = trash.entries.slice().sort(function (a, b) {
        return (b.deletedAt || 0) - (a.deletedAt || 0);
      }).map(function (entry) {
        var on = state.trashSelected[entry.trashId] === true;
        var title = entry.title || titleOf(ctx, entry.sessionId) || t('noTitle');
        var fileCount = Array.isArray(entry.files) ? entry.files.length : 0;
        var extraCount = Array.isArray(entry.extraFiles) ? entry.extraFiles.length : 0;
        return h('div', { key: entry.trashId, className: '__md_card' + (on ? ' __md_cardOn' : '') },
          h('input', { type: 'checkbox', className: '__md_check', checked: on, onChange: function () { toggleTrash(entry.trashId); } }),
          RowAvatar(title),
          h('div', { className: '__md_item' },
            h('div', { className: '__md_itemTitle' }, title),
            h('div', { className: '__md_itemMeta' },
              h('span', { className: '__md_tag' }, fmtBytes(entry.sizeBytes)),
              fileCount + extraCount > 0 ? h('span', { className: '__md_dot' }, '·') : null,
              fileCount + extraCount > 0 ? h('span', { className: '__md_tag' }, interp(t('filesBadge'), { n: fileCount + extraCount })) : null
            )
          ),
          h('div', { className: '__md_right' },
            h('span', { className: '__md_pill', title: fmtDate(entry.deletedAt) }, entry.deletedAt ? relTime(entry.deletedAt, now) : '—'),
            h('button', {
              type: 'button',
              className: '__md_btn __md_btnSoft',
              disabled: state.busy === 'restore',
              onClick: function () { void restoreTrash([entry.trashId]); }
            }, t('restoreSelected')),
            h('button', {
              type: 'button',
              className: '__md_iconBtn __md_iconBtnDanger',
              title: '彻底删除这条（不可恢复）',
              'aria-label': '彻底删除这条',
              disabled: state.busy === 'purge',
              onClick: function (event) {
                event.stopPropagation();
                openPurgeDialog([entry.trashId]);
              }
            }, h('svg', { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
              h('path', { d: 'M3 4h10M6.5 4V2.8h3V4M4.4 4l.5 9.1h6.2l.5-9.1', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
            ))
          )
        );
      });

      return h('div', { className: '__md_page' },
        h('div', { className: '__md_sticky' },
          h('div', { className: '__md_head' },
            h('button', {
              type: 'button',
              className: '__md_btn __md_btnExit',
              title: t('exit'),
              onClick: function () {
                try {
                  if (ctx && ctx.layout && typeof ctx.layout.selectPanel === 'function') ctx.layout.selectPanel(null);
                } catch (error) { /* the host may gate panel switching */ }
              }
            }, '← ' + t('exit')),
            h('div', { className: '__md_headText' },
              h('p', { className: '__md_title' }, t('title')),
              h('p', { className: '__md_sub' }, t('subtitle'))
            ),
            h('div', { className: '__md_row' },
              h('button', { type: 'button', className: '__md_btn', onClick: function () { setTab(tab === 'trash' ? 'sessions' : 'trash'); } },
                t('tabTrash') + ' (' + (trash.entries.length || 0) + ')'),
              h('button', { type: 'button', className: '__md_btn __md_btnPrimary', disabled: state.scanning, onClick: function () { void runScan(true); } },
                state.scanning ? t('scanning') : t('scan'))
            )
          ),
          h('div', { className: '__md_metaBar' },
            h('span', { className: '__md_stat' }, h('b', null, String(scan && scan.stats ? scan.stats.total : '—')), h('i', null, t('total'))),
            h('span', { className: '__md_stat' }, h('b', null, String(all.length)), h('i', null, t('listed'))),
            h('span', { className: '__md_stat' }, h('b', null, String(trash.entries.length || 0)), h('i', null, t('trashCount')))
          ),
          h('div', { className: '__md_tabs' },
            h('button', {
              type: 'button',
              className: '__md_tab' + (tab === 'sessions' ? ' __md_tabOn' : ''),
              onPointerDown: function () { setTab('sessions'); },
              onClick: function () { setTab('sessions'); }
            }, t('tabSessions')),
            h('button', {
              type: 'button',
              className: '__md_tab' + (tab === 'trash' ? ' __md_tabOn' : ''),
              onPointerDown: function () { setTab('trash'); void refreshTrash(); },
              onClick: function () { setTab('trash'); void refreshTrash(); }
            }, t('tabTrash') + ' (' + (trash.entries.length || 0) + ')')
          ),
          state.notice ? h('div', { className: '__md_notice' }, state.notice) : null,
          state.error ? h('div', { className: '__md_err', role: 'alert' }, t('loadFailed') + ': ' + state.error) : null
        ),

        tab === 'sessions' ? h('div', { className: '__md_toolbar' },
          state.selectMode ? h('button', {
            type: 'button',
            className: '__md_btn __md_btnClose',
            title: t('clearAll'),
            'aria-label': t('clearAll'),
            onClick: function () {
              setStore({ selectMode: false });
              clearSelected();
            }
          }, '×') : null,
          state.selectMode ? null : h('button', {
            type: 'button',
            className: '__md_btn',
            onClick: function () {
              setStore({ selectMode: true });
              if (!store.get().scan) void runScan(false);
            }
          }, t('selectMode')),
          state.selectMode ? h('button', { type: 'button', className: '__md_btn', onClick: function () { setSelected(all.map(function (row) { return row.id; }), !allOn); } }, allOn ? t('clearAll') : t('selectAll')) : null,
          state.selectMode && count > 0 ? h('button', {
            type: 'button',
            className: '__md_btn __md_btnDanger',
            onClick: function () { openDeleteDialog(Object.keys(store.get().selected)); }
          }, t('deleteSelected') + ' (' + count + ')') : null,
          h('span', { style: { flex: '1 1 auto' } }),
          h('span', { className: '__md_hint' }, t('scanHint'))
        ) : null,

        tab === 'sessions' ? h('div', { className: '__md_list' },
          rows.length === 0 ? EmptyState(state.scanning ? t('scanning') : t('empty')) : sessionCards,
          all.length > rows.length ? h('div', { style: { padding: '12px 0', textAlign: 'center' } },
            h('button', { type: 'button', className: '__md_btn', onClick: function () { setLimit(limit + 50); } },
              t('more') + ' (' + (all.length - rows.length) + ')')) : null
        ) : null,

        tab === 'trash' ? h('div', { className: '__md_toolbar' },
          h('button', {
            type: 'button',
            className: '__md_btn',
            disabled: state.scanning,
            title: '重新读取回收站目录',
            onClick: function () { void refreshTrash(); }
          }, state.scanning ? t('scanning') : '刷新回收站'),
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
          h('button', { type: 'button', className: '__md_btn', disabled: trashCount === 0 || state.busy === 'restore', onClick: function () { void restoreTrash(Object.keys(store.get().trashSelected)); } },
            t('restoreSelected') + (trashCount > 0 ? ' (' + trashCount + ')' : '')),
          h('button', { type: 'button', className: '__md_btn __md_btnDanger', disabled: trashCount === 0, onClick: function () { openPurgeDialog(Object.keys(store.get().trashSelected)); } },
            t('purgeSelected') + (trashCount > 0 ? ' (' + trashCount + ')' : ''))
        ) : null,

        tab === 'trash' ? h('div', { className: '__md_list' },
          trash.entries.length === 0 ? EmptyState(t('trashEmpty')) : trashCards
        ) : null
      );
    }

    function ToastHost(props) {
      var state = useStore();
      var t = props.t;
      var toast = state.toast;
      if (!toast) return null;
      return h('div', {
        className: '__md_toast',
        role: 'status'
      },
        h('div', { className: '__md_toastText' }, toast.text),
        h('div', { className: '__md_row', style: { gap: 6 } },
          h('button', {
            type: 'button',
            className: '__md_btn __md_btnSoft',
            onClick: function () { try { window.location.reload(); } catch (error) { /* noop */ } }
          }, '刷新列表'),
          h('button', {
            type: 'button',
            className: '__md_btn',
            onClick: function () { setStore({ toast: null }); }
          }, '关闭')
        )
      );
    }

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

    function apply(ctx) {
      var styleTag = installStyles();
      ctx.effect(function () { return function () { try { styleTag.remove(); } catch (error) { /* ignore */ } }; }, 'dsh-manage-deletion: styles');
      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, 'dsh-manage-deletion: dictionaries');
      var t = ctx.locale.bind(NS);

      try {
        var sessions = ctx.get('sessions');
        if (sessions && sessions.list && typeof sessions.list.subscribe === 'function') {
          ctx.effect(function () { return sessions.list.subscribe(function () { readSessionRows(ctx); }); }, 'dsh-manage-deletion: session titles');
        }
      } catch (error) { /* titles fall back to the host scan */ }

      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: t('label'), locale: NS }, PanelGlyph);
      });

      ctx.slots.inject('main', function () {
        return ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, function MainPage() {
          return h(Page, { t: t, ctx: ctx, locale: ctx.locale });
        });
      });

      ctx.slots.inject('sidebar.session.row.leading', function () {
        return ctx.slots.register({ name: 'sidebar.session.row.leading', id: 'manage-deletion.check', order: 0 }, function CheckHost(props) {
          useLocale(ctx.locale);
          return h(RowCheck, { sessionId: props.sessionId });
        });
      });

      ctx.slots.inject('sidebar.workspaces.session.row.action', function () {
        return ctx.slots.register({ name: 'sidebar.workspaces.session.row.action', id: 'manage-deletion.delete', order: 0, locale: NS }, function ActionHost(props) {
          useLocale(ctx.locale);
          return h(RowActions, { sessionId: props.sessionId, t: t });
        });
      });

      ctx.slots.inject('sidebar.workspaces.session.menu.item', function () {
        return ctx.slots.register({ name: 'sidebar.workspaces.session.menu.item', id: 'manage-deletion.menu', order: 0, locale: NS }, function MenuHost(props) {
          useLocale(ctx.locale);
          return h(MenuDeleteItem, { sessionId: props.sessionId, t: t });
        });
      });

      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({ name: 'shell.overlay', id: 'manage-deletion.toast', locale: NS }, function ToastHostBound() {
          useLocale(ctx.locale);
          return h(ToastHost, { t: t });
        });
      });

      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({ name: 'shell.overlay', id: 'manage-deletion.dialog', locale: NS }, function DialogHostBound() {
          useLocale(ctx.locale);
          return h(DialogHost, { t: t, ctx: ctx });
        });
      });

      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({ name: 'shell.overlay', id: 'manage-deletion.selectbar', locale: NS }, function SelectBarHost() {
          useLocale(ctx.locale);
          return h(FloatingSelectBar, { t: t });
        });
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
