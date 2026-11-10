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
import { readFile, readdir, stat } from 'node:fs/promises';
import { zstdDecompressSync } from 'node:zlib';
import { dirname, join, relative, resolve } from 'node:path';
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

/** Tools whose calls create or modify a file (read-only tools are excluded). */
const WRITE_TOOLS = new Set(['write', 'edit', 'multi_edit', 'apply_patch', 'str_replace_editor', 'write_file', 'create_file', 'notebook_edit']);
/** Tools whose command string may name a file the session produced. */
const SHELL_TOOLS = new Set(['pwsh', 'bash', 'shell', 'terminal']);

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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
  let scanCache = { at: 0, report: null };

  async function scan(overrides) {
    const opts = withOverrides(config, overrides);
    const now = Date.now();
    const force = overrides && overrides.force === true;
    const withTitles = !(overrides && overrides.titles === false);
    if (!force && scanCache.report && now - scanCache.at < 60000) return scanCache.report;
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
    const ordered = withTitles ? [...new Set([...suspicious, ...missing])].slice(0, opts.titleResolveLimit) : [];
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

    const lean = overrides && overrides.lean === true;
    const visible = classified.slice(0, opts.listLimit).map((entry) => (lean ? {
      id: entry.id,
      title: entry.title,
      sizeBytes: entry.sizeBytes,
      createdAt: entry.createdAt,
      junk: entry.junk,
      live: entry.live,
      archived: entry.archived,
      workspaceTitle: entry.workspaceTitle
    } : entry));
    const stats = summarize(classified, opts, now);
    const trash = await readTrashIndex(trashRoot());

    const report = {
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
    scanCache = { at: now, report };
    return report;
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
    const agents = safeGet(ctx, 'agents');
    if (agents && typeof agents.get === 'function') {
      try {
        const agent = agents.get(sessionId);
        if (agent && agent.status === 'running') return 'live';
      } catch {
        /* ignore */
      }
    } else {
      // No agent registry to ask: be conservative and refuse any session the
      // host still holds open. Archive-time activity checks remain the second
      // fence when the registry is available.
      const sessions = safeGet(ctx, 'sessions');
      if (sessions && typeof sessions.get === 'function') {
        try {
          if (sessions.get(sessionId)) return 'live';
        } catch {
          /* ignore */
        }
      }
    }
    return '';
  }

  /** Remove a pin before the session disappears; a dead id must not stay pinned. */
  async function unpinIfNeeded(sessionId) {
    const registry = safeGet(ctx, 'workspaceRegistry');
    if (!registry) return false;
    try {
      if (!hasId(registry.pinnedSessionIds, sessionId)) return false;
      if (typeof registry.unpinSession === 'function') {
        await registry.unpinSession(sessionId);
        return true;
      }
    } catch {
      /* a failed unpin must not block the delete */
    }
    return false;
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
      await unpinIfNeeded(id);
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
        try {
          await registry.archiveSession(id);
        } catch (error) {
          // A session that is open (or still winding work down) refuses a plain
          // archive. The registry supports stopping it first; that is the same
          // path the host uses for "archive a running session".
          if (error && /active/i.test(String(error.name || ''))) {
            await registry.archiveSession(id, { stopActivity: true });
          } else {
            throw error;
          }
        }
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
   * @param {{ deleteFiles?: boolean }} [options] - also move the files this
   *   session created (inside its own cwd) into the same trash entry.
   */
  async function trashIds(ids, options = {}) {
    const registry = safeGet(ctx, 'workspaceRegistry');
    if (!registry || typeof registry.archiveSession !== 'function') {
      throw new Error('workspaceRegistry 缺少归档能力：出于安全，删除已停用');
    }
    const root = trashRoot();
    const storeRoot = sessionsRoot(home());
    const results = [];
    for (const id of ids) {
      await unpinIfNeeded(id);
      const protection = checkProtection(id);
      if (protection) {
        results.push({ id, ok: false, code: protection, message: '会话正在运行，不能删除' });
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
          try {
            await registry.archiveSession(id);
          } catch (error) {
            if (error && /active/i.test(String(error.name || ''))) {
              await registry.archiveSession(id, { stopActivity: true });
            } else {
              throw error;
            }
          }
          archivedNow = true;
        }
      } catch (error) {
        results.push({ id, ok: false, code: error?.name || 'archive-failed', message: `归档失败，已放弃删除：${error?.message || error}` });
        continue;
      }

      try {
        await removeProjectionCache(id, home());
        const cwd = snapshot?.cwd || '';
        // Only files this session wrote are candidates; the store re-checks
        // that each one really sits inside this session's own cwd.
        const bundle = options.deleteFiles === true
          ? await sessionFiles(id, cwd)
          : { files: [], otherFiles: [] };
        const files = bundle.files;
        const extraFiles = options.deleteExtraFiles === true ? bundle.otherFiles.map((file) => file.path) : [];
        const entry = await trashSession({
          sessionDir,
          sessionId: id,
          sessionsRoot: storeRoot,
          root,
          files: files.map((file) => file.path),
          extraFiles,
          meta: {
            title: snapshot?.title || titleCache.get(id) || '',
            workspacePath: cwd,
            cwd,
            createdAt: snapshot?.createdAt || 0,
            sizeBytes: snapshot?.sizeBytes || 0,
            archived: true
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
        // Drop the archive flag we just set: the log no longer exists, and a
        // stale id in archivedSessionIds keeps the row alive in archive views.
        if (archivedNow && typeof registry.unarchiveSession === 'function') {
          try {
            await registry.unarchiveSession(id);
          } catch {
            /* cosmetic only */
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

  const fileCache = new Map();

  /**
   * Files this session created or modified, read from its own tool calls.
   * Only create/modify tools count, and only paths inside the session's cwd —
   * a read, a glob or a command-line redirect never binds a file.
   * @param {string} sessionId
   * @param {string} cwd
   */
  async function sessionFiles(sessionId, cwd) {
    if (!cwd) return { files: [], otherFiles: [] };
    const cached = fileCache.get(sessionId);
    if (cached && Date.now() - cached.at < 5 * 60000) return cached.value;
    const events = await readSessionEvents(sessionId);
    const written = new Map();
    const mentioned = new Map();
    for (const event of events || []) {
      if (!event || event.type !== 'tool/call') continue;
      const name = String(event.data?.name || '').toLowerCase();
      const args = parseArgs(event.data?.arguments);
      if (!args || typeof args !== 'object') continue;
      if (WRITE_TOOLS.has(name)) {
        for (const key of ['path', 'file_path', 'filePath', 'absolutePath', 'target', 'destination', 'dest']) {
          const value = args[key];
          if (typeof value !== 'string' || !value.trim()) continue;
          const absolute = resolve(cwd, value.trim());
          written.set(absolute.toLowerCase(), absolute);
        }
        continue;
      }
      if (!SHELL_TOOLS.has(name)) continue;
      // Shell commands are a hint, not a promise: only absolute-looking paths
      // with a file extension are collected, and they land in otherFiles.
      const command = typeof args.command === 'string' ? args.command : '';
      for (const match of command.matchAll(/[A-Za-z]:\\[^"'\r\n|<>*?]+\.[A-Za-z0-9]{1,8}/g)) {
        const candidate = match[0].trim();
        if (candidate.length < 6) continue;
        mentioned.set(candidate.toLowerCase(), candidate);
      }
    }
    const base = resolve(cwd);
    const inside = [];
    const outside = [];
    for (const absolute of written.values()) {
      if (!existsSync(absolute)) continue;
      if (absolute.startsWith(base + (process.platform === 'win32' ? '\\' : '/'))) {
        inside.push({ path: absolute, rel: relative(base, absolute), sizeBytes: 0 });
      } else {
        outside.push({ path: absolute, rel: absolute, sizeBytes: 0 });
      }
    }
    for (const absolute of mentioned.values()) {
      if (outside.length >= 20) break;
      if (inside.some((file) => file.path.toLowerCase() === absolute.toLowerCase())) continue;
      if (outside.some((file) => file.path.toLowerCase() === absolute.toLowerCase())) continue;
      if (!existsSync(absolute)) continue;
      outside.push({ path: absolute, rel: absolute, sizeBytes: 0 });
    }
    // Third tier: files under the session cwd that changed while the session
    // was writing. Generated artifacts (docx/pdf) never appear in a write tool,
    // so this is the only way to see them; they stay out of the safe tier and
    // are unchecked in the dialog by default.
    const times = [];
    for (const event of events || []) {
      if (Number.isFinite(event?.time)) times.push(event.time);
    }
    if (times.length === 0) {
      const logEvents = await readLogEvents(sessionId);
      for (const event of logEvents) {
        if (Number.isFinite(event?.time)) times.push(event.time);
      }
    }
    if (times.length > 0 && outside.length < 60) {
      const from = Math.min(...times) - 120000;
      const to = Math.max(...times) + 120000;
      const skipDirs = new Set(['node_modules', '.git', '.gradle', 'build', 'dist', 'out', '.idea', '.vs', '.dsh-pilot']);
      const walk = async (dir, depth) => {
        if (depth > 5 || outside.length >= 60) return;
        let entries = [];
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (outside.length >= 60) return;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (skipDirs.has(entry.name)) continue;
            await walk(full, depth + 1);
            continue;
          }
          if (!entry.isFile()) continue;
          const lowered = full.toLowerCase();
          if (inside.some((file) => file.path.toLowerCase() === lowered)) continue;
          if (outside.some((file) => file.path.toLowerCase() === lowered)) continue;
          let statInfo;
          try {
            statInfo = await stat(full);
          } catch {
            continue;
          }
          if (statInfo.size === 0) continue;
          if (statInfo.mtimeMs < from || statInfo.mtimeMs > to) continue;
          outside.push({ path: full, rel: relative(base, full), sizeBytes: statInfo.size, reason: 'window' });
        }
      };
      await walk(base, 0);
      outside.sort((left, right) => (right.sizeBytes || 0) - (left.sizeBytes || 0));
    }
    const value = { files: inside, otherFiles: outside };
    fileCache.set(sessionId, { at: Date.now(), value });
    return value;
  }

  /** Read a session's events: the query service first, the log file as fallback. */
  async function readSessionEvents(sessionId) {
    const query = safeGet(ctx, 'sessionQuery');
    if (query && typeof query.readSession === 'function') {
      try {
        const raw = await query.readSession(sessionId);
        const list = Array.isArray(raw) ? raw : Array.isArray(raw?.events) ? raw.events : Array.isArray(raw?.records) ? raw.records : null;
        if (list && list.length > 0) return list;
      } catch {
        /* fall through to the file */
      }
    }
    return readLogEvents(sessionId);
  }

  /** Decode a JSONL session log locally (concatenated zstd frames or plain lines). */
  async function readLogEvents(sessionId) {
    const persistence = safeGet(ctx, 'sessionPersistence');
    let file = '';
    if (persistence && typeof persistence.stat === 'function') {
      try {
        const snap = await persistence.stat(sessionId);
        file = snap?.location?.path || '';
      } catch {
        file = '';
      }
    }
    if (!file || !existsSync(file)) {
      // No location from persistence: locate the session directory directly.
      const storeRoot = sessionsRoot(home());
      const dir = await findSessionDir(storeRoot, sessionId);
      if (dir) {
        try {
          const entries = await readdir(dir);
          const logs = entries.filter((name) => /^session\..*jsonl/i.test(name)).sort();
          if (logs.length > 0) file = join(dir, logs[logs.length - 1]);
        } catch {
          file = '';
        }
      }
    }
    if (!file || !existsSync(file)) return [];
    let buffer;
    try {
      buffer = await readFile(file);
    } catch {
      return [];
    }
    const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
    const offsets = [];
    let at = 0;
    while ((at = buffer.indexOf(magic, at)) !== -1) {
      offsets.push(at);
      at += 4;
    }
    let text = '';
    if (offsets.length === 0) {
      text = buffer.toString('utf8');
    } else {
      for (let index = 0; index < offsets.length; index += 1) {
        const start = offsets[index];
        const end = index + 1 < offsets.length ? offsets[index + 1] : buffer.length;
        try {
          text += zstdDecompressSync(buffer.subarray(start, end)).toString('utf8');
        } catch {
          /* torn frame */
        }
      }
    }
    const events = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        /* skip */
      }
    }
    return events;
  }

  /**
   * Facts for one batch of sessions: title, times, size, workspace and the
   * files this session produced.
   * @param {string[]} ids
   */
  async function info(ids) {
    const wanted = new Set(Array.isArray(ids) ? ids : []);
    if (wanted.size === 0) return [];
    // Always scan: the user wants the file list no matter how many are
    // selected. The scan below runs four at a time so it stays responsive.
    const snapshot = await collect();
    const counts = new Map();
    for (const entry of snapshot.entries) {
      const key = entry.cwd || '';
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!entry.title) entry.title = titleCache.get(entry.id) || '';
    }
    const rows = [];
    const pick = snapshot.entries.filter((entry) => wanted.has(entry.id));
    const bundles = new Map();
    // Four at a time: decompressing logs is CPU-bound and doing it strictly
    // in series is what made a 20-session multi-select feel stuck.
    let cursor = 0;
    const worker = async () => {
      while (cursor < pick.length) {
        const index = cursor;
        cursor += 1;
        const entry = pick[index];
        bundles.set(entry.id, await sessionFiles(entry.id, entry.cwd));
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, pick.length) }, worker));
    for (const entry of pick) {
      const others = Math.max(0, (counts.get(entry.cwd || '') || 0) - 1);
      const bundle = bundles.get(entry.id) || { files: [], otherFiles: [] };
      const files = bundle.files;
      rows.push({
        id: entry.id,
        title: entry.title,
        sizeBytes: entry.sizeBytes,
        createdAt: entry.createdAt,
        cwd: entry.cwd,
        workspaceTitle: entry.workspaceTitle,
        workspacePath: entry.workspacePath,
        otherSessions: others,
        canDeleteWorkspace: false,
        files,
        otherFiles: bundle.otherFiles,
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
    const seen = new Set();
    for (const entry of entries) {
      if (wanted && !wanted.has(entry.trashId)) {
        kept.push(entry);
        continue;
      }
      seen.add(entry.trashId);
      try {
        await purgeEntry(entry, root);
        results.push({ trashId: entry.trashId, sessionId: entry.sessionId, ok: true, code: 'purged' });
      } catch (error) {
        // A directory that is already gone must not pin an index row forever:
        // that is exactly the "回收站里删不掉的那几条" a user sees.
        if (error && (error.code === 'ENOENT' || error.code === undefined)) {
          let stillThere = false;
          try {
            stillThere = existsSync(join(root, entry.trashId));
          } catch {
            stillThere = false;
          }
          if (!stillThere) {
            results.push({ trashId: entry.trashId, sessionId: entry.sessionId, ok: true, code: 'already-gone' });
            continue;
          }
        }
        kept.push(entry);
        results.push({ trashId: entry.trashId, sessionId: entry.sessionId, ok: false, code: 'purge-failed', message: String(error?.message || error) });
      }
    }
    if (wanted) {
      for (const id of wanted) {
        if (seen.has(id)) continue;
        results.push({ trashId: id, ok: false, code: 'not-found', message: '回收站里没有这一条，可能已经被删掉了' });
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
