/**
 * Session janitor service: one place that reads host session facts and one
 * place that mutates them.
 *
 * Sources of truth (all optional; each degrades independently):
 *   ctx.sessionPersistence → stored snapshots (header, sizeBytes, location)
 *   ctx.sessions           → live sessions (never touched)
 *   ctx.workspaceRegistry  → archive/pin sets, workspace membership
 *   ctx.sessionQuery       → folded titles (bounded, cached)
 *
 * Deletion policy: archive first (host-supported, reversible), then move the
 * log directory into the plugin trash, then detach registry membership. A move
 * failure rolls the archive back so a failed delete never hides a session.
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { classifySession, summarize } from './classify.js';
import { withOverrides } from './config.js';
import {
  purgeEntry,
  readTrashIndex,
  removeProjectionCache,
  resolveHome,
  restoreSession,
  sessionsRoot,
  trashBytes,
  trashRootFor,
  trashSession,
  writeTrashIndex
} from './store.js';

const DAY_MS = 86400000;

function safeGet(ctx, name) {
  try {
    return ctx && typeof ctx.get === 'function' ? ctx.get(name) : undefined;
  } catch {
    return undefined;
  }
}

function headerOf(snapshot) {
  return (snapshot && (snapshot.header || snapshot)) || {};
}

function liveIdOf(session) {
  if (!session) return '';
  return session.id || session.header?.id || '';
}

/** Membership test that works for both the registry's arrays and a Set. */
function hasId(collection, id) {
  if (!collection) return false;
  if (typeof collection.has === 'function') return collection.has(id);
  if (Array.isArray(collection)) return collection.includes(id);
  if (typeof collection[Symbol.iterator] === 'function') return [...collection].includes(id);
  return false;
}

/** Locate a session directory by id when persistence gives no location. */
async function findSessionDir(root, sessionId) {
  const bare = String(sessionId).replace(/^session-/, '');
  let workspaces = [];
  try {
    workspaces = await readdir(root, { withFileTypes: true });
  } catch {
    return '';
  }
  for (const ws of workspaces) {
    if (!ws.isDirectory()) continue;
    const wsDir = join(root, ws.name);
    let entries = [];
    try {
      entries = await readdir(wsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === sessionId || entry.name === bare) return join(wsDir, entry.name);
    }
  }
  return '';
}

/**
 * Fold titles for a bounded set of sessions.
 * @returns {Promise<{titles: Map<string,string>, error: string}>} per-id titles plus the
 *   first failure message (folded failures are counted, never silently swallowed).
 */
async function foldTitles(query, ids, budgetMs) {
  const titles = new Map();
  const result = { titles, error: '', rejected: 0 };
  if (!query || typeof query.readTitleSnapshots !== 'function' || ids.length === 0) return result;
  const deadline = Date.now() + Math.max(250, budgetMs);
  for (let index = 0; index < ids.length; index += 40) {
    if (Date.now() > deadline) break;
    const chunk = ids.slice(index, index + 40);
    let rows;
    try {
      rows = await query.readTitleSnapshots(chunk);
    } catch (error) {
      if (!result.error) result.error = error && error.message ? error.message : String(error);
      continue;
    }
    for (const row of rows || []) {
      if (row && row.status === 'fulfilled' && row.value) {
        const title = row.value.title;
        if (typeof title === 'string' && title.trim()) titles.set(row.value.session?.id, title.trim());
      } else {
        result.rejected += 1;
      }
    }
  }
  return result;
}

/**
 * Build the janitor service for one plugin instance.
 * @param {object} ctx - Cordis plugin context.
 * @param {object} config - normalized config.
 */
export function createJanitorService(ctx, config) {
  const titleCache = new Map();
  let inFlight = false;

  function home() {
    return resolveHome();
  }

  function trashRoot() {
    return trashRootFor(config, home());
  }

  function guard() {
    if (inFlight) throw new Error('另一个清理操作还在进行，请稍后再试');
    inFlight = true;
  }

  function release() {
    inFlight = false;
  }

  function rememberTitle(id, title) {
    if (!id || !title) return;
    titleCache.set(id, title);
    if (titleCache.size > 4000) {
      const oldest = titleCache.keys().next().value;
      titleCache.delete(oldest);
    }
  }

  /** Collect one fact object per known session. */
  async function collect() {
    const warnings = [];
    const persistence = safeGet(ctx, 'sessionPersistence');
    const sessions = safeGet(ctx, 'sessions');
    const registry = safeGet(ctx, 'workspaceRegistry');

    const rows = new Map();

    if (persistence && typeof persistence.list === 'function') {
      try {
        const snapshots = await persistence.list();
        for (const snapshot of snapshots || []) {
          const header = headerOf(snapshot);
          const id = header.id;
          if (!id) continue;
          rows.set(id, {
            id,
            cwd: typeof header.cwd === 'string' ? header.cwd : '',
            createdAt: Number.isFinite(header.createdAt) ? header.createdAt : 0,
            parentSession: typeof header.parentSession === 'string' ? header.parentSession : '',
            delegationDepth: Number.isFinite(header.delegationDepth) ? header.delegationDepth : 0,
            sizeBytes: Number.isFinite(snapshot.sizeBytes) ? snapshot.sizeBytes : 0,
            path: snapshot.location?.path || '',
            persisted: true
          });
        }
      } catch (error) {
        warnings.push(`会话列表读取失败：${error && error.message ? error.message : error}`);
      }
    } else {
      warnings.push('sessionPersistence 不可用：只能看到运行中的会话');
    }

    const liveIds = new Set();
    if (sessions && typeof sessions.list === 'function') {
      try {
        for (const session of sessions.list() || []) {
          const id = liveIdOf(session);
          if (!id) continue;
          liveIds.add(id);
          if (!rows.has(id)) {
            const header = session.header || {};
            rows.set(id, {
              id,
              cwd: typeof header.cwd === 'string' ? header.cwd : '',
              createdAt: Number.isFinite(header.createdAt) ? header.createdAt : 0,
              parentSession: typeof header.parentSession === 'string' ? header.parentSession : '',
              delegationDepth: Number.isFinite(header.delegationDepth) ? header.delegationDepth : 0,
              sizeBytes: 0,
              path: '',
              persisted: false
            });
          }
        }
      } catch {
        /* live listing is best effort */
      }
    }

    let archived = new Set();
    let pinned = new Set();
    const workspaceBySession = new Map();
    const workspaces = [];
    if (registry) {
      try {
        archived = new Set(registry.archivedSessionIds || []);
        pinned = new Set(registry.pinnedSessionIds || []);
      } catch {
        /* older registry without these accessors */
      }
      try {
        for (const entity of registry.list() || []) {
          const record = {
            id: entity.id,
            path: entity.path,
            title: entity.title,
            sessionIds: []
          };
          let ids = [];
          try {
            ids = entity.sessionIds || [];
          } catch {
            ids = [];
          }
          record.sessionIds = ids;
          workspaces.push(record);
          for (const id of ids) {
            if (!workspaceBySession.has(id)) workspaceBySession.set(id, record);
          }
        }
      } catch (error) {
        warnings.push(`工作区列表读取失败：${error && error.message ? error.message : error}`);
      }
    } else {
      warnings.push('workspaceRegistry 不可用：归档与工作区分组可能不准确');
    }

    const root = sessionsRoot(home());
    const entries = [];
    for (const row of rows.values()) {
      const workspace = workspaceBySession.get(row.id) || null;
      const cwd = row.cwd;
      const entry = {
        id: row.id,
        title: titleCache.get(row.id) || '',
        cwd,
        cwdExists: cwd ? existsSync(cwd) : undefined,
        createdAt: row.createdAt,
        sizeBytes: row.sizeBytes,
        path: row.path,
        parentSession: row.parentSession,
        delegationDepth: row.delegationDepth,
        live: liveIds.has(row.id),
        pinned: pinned.has(row.id),
        archived: archived.has(row.id),
        workspacePath: workspace ? workspace.path : (cwd || ''),
        workspaceTitle: workspace ? workspace.title : (cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : '')
      };
      entries.push(entry);
    }

    return { entries, warnings, workspaces, root, archived, pinned, liveIds };
  }

  /**
   * Scan sessions and classify them. Read-only.
   * @param {object} [overrides] - request-level threshold overrides.
   */
  async function scan(overrides) {
    const opts = withOverrides(config, overrides);
    const now = Date.now();
    const { entries, warnings, root } = await collect();

    for (const entry of entries) {
      entry.junk = undefined;
      entry.reasons = undefined;
    }

    // Title folding is the only expensive read; bound it to the newest sessions
    // and to sessions that already look suspicious by size.
    const missing = entries
      .filter((entry) => !entry.title)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const suspicious = missing.filter((entry) => entry.sizeBytes > 0 && entry.sizeBytes <= opts.tinyMaxBytes);
    const ordered = [...new Set([...suspicious, ...missing])].slice(0, opts.titleResolveLimit);
    const query = safeGet(ctx, 'sessionQuery');
    if (query && ordered.length > 0) {
      const folded = await foldTitles(query, ordered.map((entry) => entry.id), opts.titleResolveBudgetMs);
      for (const [id, title] of folded.titles) {
        rememberTitle(id, title);
        const entry = entries.find((candidate) => candidate.id === id);
        if (entry) entry.title = title;
      }
      if (folded.error) {
        warnings.push(`标题读取失败：${folded.error}（本次只按字节大小与目录状态判定）`);
      } else if (folded.titles.size === 0 && folded.rejected > 0) {
        warnings.push(`标题折叠 ${folded.rejected} 个全部失败（本次只按字节大小与目录状态判定）`);
      }
    } else if (!query && missing.length > 0) {
      warnings.push('sessionQuery 不可用：标题未解析');
    }

    const classified = [];
    for (const entry of entries) {
      const verdict = classifySession(entry, opts, now);
      classified.push({
        ...entry,
        junk: verdict.junk,
        score: verdict.score,
        reasons: verdict.reasons,
        protectedReason: verdict.protectedReason,
        ageDays: entry.createdAt ? Math.max(0, Math.floor((now - entry.createdAt) / DAY_MS)) : 0
      });
    }

    classified.sort((a, b) => {
      if (a.junk !== b.junk) return a.junk ? -1 : 1;
      if (a.junk && b.junk && a.score !== b.score) return b.score - a.score;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    const visible = classified.slice(0, opts.listLimit);
    const stats = summarize(classified, opts, now);
    const trash = await readTrashIndex(trashRoot());

    return {
      scannedAt: now,
      root,
      config: {
        threshold: opts.threshold,
        oldDays: opts.oldDays,
        blankMaxBytes: opts.blankMaxBytes,
        tinyMaxBytes: opts.tinyMaxBytes,
        includeSubagents: opts.includeSubagents,
        keepPinned: opts.keepPinned,
        maxBatch: opts.maxBatch
      },
      stats: {
        ...stats,
        archived: classified.filter((entry) => entry.archived).length,
        live: classified.filter((entry) => entry.live).length,
        pinned: classified.filter((entry) => entry.pinned).length
      },
      sessions: visible,
      trash: {
        count: trash.length,
        bytes: await trashBytes(trashRoot()),
        entries: trash
      },
      warnings
    };
  }

  async function snapshotFor(sessionId) {
    const persistence = safeGet(ctx, 'sessionPersistence');
    if (persistence && typeof persistence.stat === 'function') {
      try {
        const snapshot = await persistence.stat(sessionId);
        const header = headerOf(snapshot);
        return {
          id: sessionId,
          cwd: typeof header.cwd === 'string' ? header.cwd : '',
          createdAt: Number.isFinite(header.createdAt) ? header.createdAt : 0,
          sizeBytes: Number.isFinite(snapshot.sizeBytes) ? snapshot.sizeBytes : 0,
          path: snapshot.location?.path || '',
          title: titleCache.get(sessionId) || ''
        };
      } catch {
        /* fall through to the directory search */
      }
    }
    return null;
  }

  function checkProtection(sessionId) {
    const sessions = safeGet(ctx, 'sessions');
    if (sessions && typeof sessions.get === 'function') {
      try {
        if (sessions.get(sessionId)) return 'live';
      } catch {
        /* ignore */
      }
    }
    const registry = safeGet(ctx, 'workspaceRegistry');
    if (registry && config.keepPinned) {
      try {
        if (hasId(registry.pinnedSessionIds, sessionId)) return 'pinned';
      } catch {
        /* ignore */
      }
    }
    return '';
  }

  function isArchived(sessionId) {
    const registry = safeGet(ctx, 'workspaceRegistry');
    try {
      return registry ? hasId(registry.archivedSessionIds, sessionId) : false;
    } catch {
      return false;
    }
  }

  function entityFor(sessionId, cwd) {
    const registry = safeGet(ctx, 'workspaceRegistry');
    if (!registry || typeof registry.list !== 'function') return null;
    try {
      for (const entity of registry.list() || []) {
        let ids = [];
        try {
          ids = entity.sessionIds || [];
        } catch {
          ids = [];
        }
        if (ids.includes(sessionId)) return entity;
      }
      if (cwd) {
        for (const entity of registry.list() || []) {
          if (entity.path === cwd) return entity;
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  async function archiveIds(ids) {
    const registry = safeGet(ctx, 'workspaceRegistry');
    if (!registry || typeof registry.archiveSession !== 'function') {
      throw new Error('workspaceRegistry 不支持归档：请升级 DSH 或改用回收站删除');
    }
    const results = [];
    for (const id of ids) {
      const protection = checkProtection(id);
      if (protection) {
        results.push({ id, ok: false, code: protection, message: protection === 'live' ? '会话正在运行，不能归档' : '会话已置顶，不能归档' });
        continue;
      }
      if (isArchived(id)) {
        results.push({ id, ok: true, code: 'already-archived', message: '已经是归档状态' });
        continue;
      }
      try {
        await registry.archiveSession(id);
        results.push({ id, ok: true, code: 'archived' });
      } catch (error) {
        results.push({ id, ok: false, code: error?.name || 'error', message: String(error?.message || error) });
      }
    }
    return results;
  }

  /** Undo an archive (drop the id from the archive set). */
  async function unarchiveIds(ids) {
    const registry = safeGet(ctx, 'workspaceRegistry');
    if (!registry || typeof registry.unarchiveSession !== 'function') {
      throw new Error('workspaceRegistry 不支持取消归档');
    }
    const results = [];
    for (const id of ids) {
      if (!isArchived(id)) {
        results.push({ id, ok: true, code: 'not-archived', message: '不在归档集合里' });
        continue;
      }
      try {
        await registry.unarchiveSession(id);
        results.push({ id, ok: true, code: 'unarchived' });
      } catch (error) {
        results.push({ id, ok: false, code: error?.name || 'error', message: String(error?.message || error) });
      }
    }
    return results;
  }

  /**
   * Archive + move to trash + detach from its workspace.
   * @param {string[]} ids
   * @param {{ moveWorkspace?: boolean }} [options] - delete the workspace folder too,
   *   only honored when no other session lives in that folder.
   */
  async function trashIds(ids, options = {}) {
    const registry = safeGet(ctx, 'workspaceRegistry');
    if (!registry || typeof registry.archiveSession !== 'function') {
      throw new Error('workspaceRegistry 缺少归档能力：出于安全，删除已停用');
    }
    const root = trashRoot();
    const storeRoot = sessionsRoot(home());
    const results = [];
    let workspaceCounts = null;
    if (options.moveWorkspace === true) {
      const snapshot = await collect();
      workspaceCounts = new Map();
      for (const entry of snapshot.entries) {
        const key = entry.cwd || '';
        workspaceCounts.set(key, (workspaceCounts.get(key) || 0) + 1);
      }
    }
    for (const id of ids) {
      const protection = checkProtection(id);
      if (protection) {
        results.push({ id, ok: false, code: protection, message: protection === 'live' ? '会话正在运行，不能删除' : '会话已置顶，不能删除' });
        continue;
      }
      const snapshot = await snapshotFor(id);
      const sessionDir = snapshot?.path ? dirname(snapshot.path) : await findSessionDir(storeRoot, id);
      if (!sessionDir || !existsSync(sessionDir)) {
        results.push({ id, ok: false, code: 'no-location', message: '找不到这个会话的日志目录' });
        continue;
      }
      const wasArchived = isArchived(id);
      let archivedNow = false;
      try {
        if (!wasArchived) {
          await registry.archiveSession(id);
          archivedNow = true;
        }
      } catch (error) {
        results.push({ id, ok: false, code: error?.name || 'archive-failed', message: `归档失败，已放弃删除：${error?.message || error}` });
        continue;
      }

      try {
        await removeProjectionCache(id, home());
        const cwd = snapshot?.cwd || '';
        // A workspace folder may only travel with its last session: deleting a
        // folder other conversations still use would take their files too.
        const moveWorkspace = options.moveWorkspace === true
          && cwd !== ''
          && workspaceCounts !== null
          && (workspaceCounts.get(cwd) || 0) <= 1;
        const entry = await trashSession({
          sessionDir,
          sessionId: id,
          sessionsRoot: storeRoot,
          root,
          meta: {
            title: snapshot?.title || titleCache.get(id) || '',
            workspacePath: cwd,
            cwd,
            createdAt: snapshot?.createdAt || 0,
            sizeBytes: snapshot?.sizeBytes || 0,
            archived: true,
            moveWorkspace
          }
        });
        const entity = entityFor(id, snapshot?.cwd);
        if (entity && typeof entity.detachSession === 'function') {
          try {
            await entity.detachSession(id);
          } catch {
            /* the log is gone; stale membership is cosmetic */
          }
        }
        results.push({ id, ok: true, code: 'trashed', trashId: entry.trashId });
      } catch (error) {
        if (archivedNow) {
          try {
            await registry.unarchiveSession(id);
          } catch {
            /* rollback is best effort; report the original failure */
          }
        }
        results.push({ id, ok: false, code: 'move-failed', message: String(error?.message || error) });
      }
    }
    return results;
  }

  /**
   * Facts for one batch of sessions: title, times, size, workspace and whether
   * the workspace folder can travel with a delete (no other session inside).
   * @param {string[]} ids
   */
  async function info(ids) {
    const wanted = new Set(Array.isArray(ids) ? ids : []);
    if (wanted.size === 0) return [];
    const snapshot = await collect();
    const counts = new Map();
    for (const entry of snapshot.entries) {
      const key = entry.cwd || '';
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!entry.title) entry.title = titleCache.get(entry.id) || '';
    }
    const rows = [];
    for (const entry of snapshot.entries) {
      if (!wanted.has(entry.id)) continue;
      const others = Math.max(0, (counts.get(entry.cwd || '') || 0) - 1);
      rows.push({
        id: entry.id,
        title: entry.title,
        sizeBytes: entry.sizeBytes,
        createdAt: entry.createdAt,
        cwd: entry.cwd,
        workspaceTitle: entry.workspaceTitle,
        workspacePath: entry.workspacePath,
        otherSessions: others,
        canDeleteWorkspace: entry.cwd !== '' && others === 0 && existsSync(entry.cwd),
        live: entry.live,
        pinned: entry.pinned,
        archived: entry.archived,
        parentSession: entry.parentSession || ''
      });
    }
    return rows;
  }

  async function restore(trashIdsToRestore) {
    const registry = safeGet(ctx, 'workspaceRegistry');
    const root = trashRoot();
    const storeRoot = sessionsRoot(home());
    const entries = await readTrashIndex(root);
    const wanted = new Set(trashIdsToRestore);
    const results = [];
    for (const entry of entries) {
      if (!wanted.has(entry.trashId)) continue;
      try {
        const target = await restoreSession({ entry, root, sessionsRoot: storeRoot });
        const entity = entityFor(entry.sessionId, entry.cwd || entry.workspacePath);
        if (entity && typeof entity.attachSession === 'function') {
          try {
            await entity.attachSession(entry.sessionId);
          } catch {
            /* membership re-attaches on the next registry rebuild */
          }
        }
        if (registry && typeof registry.unarchiveSession === 'function') {
          try {
            await registry.unarchiveSession(entry.sessionId);
          } catch {
            /* restoring an id that is not archived is a no-op */
          }
        }
        results.push({ trashId: entry.trashId, sessionId: entry.sessionId, ok: true, path: target });
      } catch (error) {
        results.push({ trashId: entry.trashId, sessionId: entry.sessionId, ok: false, message: String(error?.message || error) });
      }
    }
    const restored = new Set(results.filter((row) => row.ok).map((row) => row.trashId));
    await writeTrashIndex(root, entries.filter((entry) => !restored.has(entry.trashId)));
    return results;
  }

  async function purge(trashIdsToPurge) {
    const root = trashRoot();
    const entries = await readTrashIndex(root);
    const wanted = Array.isArray(trashIdsToPurge) && trashIdsToPurge.length > 0 ? new Set(trashIdsToPurge) : null;
    const results = [];
    const kept = [];
    for (const entry of entries) {
      if (wanted && !wanted.has(entry.trashId)) {
        kept.push(entry);
        continue;
      }
      try {
        await purgeEntry(entry, root);
        results.push({ trashId: entry.trashId, sessionId: entry.sessionId, ok: true });
      } catch (error) {
        kept.push(entry);
        results.push({ trashId: entry.trashId, sessionId: entry.sessionId, ok: false, message: String(error?.message || error) });
      }
    }
    await writeTrashIndex(root, kept);
    return results;
  }

  /** Wrap a mutating call so concurrent runs are refused, not interleaved. */
  async function mutate(fn) {
    guard();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return {
    config,
    scan,
    info,
    archive: (ids) => mutate(() => archiveIds(ids)),
    unarchive: (ids) => mutate(() => unarchiveIds(ids)),
    trash: (ids, options) => mutate(() => trashIds(ids, options)),
    restore: (ids) => mutate(() => restore(ids)),
    purge: (ids) => mutate(() => purge(ids)),
    trashRoot,
    home
  };
}
