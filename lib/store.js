/**
 * Filesystem side of the janitor: where sessions and the trash live, and the
 * only functions that move bytes.
 *
 * Design constraints:
 * - Deletion is recoverable by default. A "delete" moves the session directory
 *   into the plugin's own trash and records an index entry, so restore is a
 *   plain move back — no host API is needed to bring history back.
 * - Every path is derived from DSH_HOME at call time; nothing is cached between
 *   home changes (a profile switch changes the root).
 * - Cross-device moves fall back to copy + delete instead of failing.
 */
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** `$DSH_HOME`, else `~/.dsh` — the same precedence the host uses. */
export function resolveHome() {
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : '';
  return fromEnv ? resolve(fromEnv) : join(homedir(), '.dsh');
}

/** Root of the JSONL session store. */
export function sessionsRoot(home = resolveHome()) {
  return join(home, 'sessions');
}

/** Default trash root (`$DSH_HOME/manage-deletion/trash`). */
export function defaultTrashRoot(home = resolveHome()) {
  return join(home, 'manage-deletion', 'trash');
}

/** Trash root honoring the configured override. */
export function trashRootFor(config, home = resolveHome()) {
  const configured = config && typeof config.trashDir === 'string' ? config.trashDir.trim() : '';
  if (!configured) return defaultTrashRoot(home);
  return isAbsolute(configured) ? configured : join(home, configured);
}

const INDEX_NAME = 'index.json';

/** Read the trash index; a missing or unreadable index is an empty one. */
export async function readTrashIndex(root) {
  try {
    const raw = await readFile(join(root, INDEX_NAME), 'utf8');
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return entries.filter((entry) => entry && typeof entry.trashId === 'string' && typeof entry.sessionId === 'string');
  } catch {
    return [];
  }
}

/** Write the trash index atomically (temp file + rename). */
export async function writeTrashIndex(root, entries) {
  await mkdir(root, { recursive: true });
  const target = join(root, INDEX_NAME);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify({ version: 1, entries }, null, 2), 'utf8');
  await rename(tmp, target);
}

function isCrossDevice(error) {
  return Boolean(error) && error.code === 'EXDEV';
}

/** Move a file or directory, falling back to copy + remove across volumes. */
export async function movePath(from, to) {
  await mkdir(dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (error) {
    if (!isCrossDevice(error)) throw error;
    await cp(from, to, { recursive: true, force: false, errorOnExist: true });
    await rm(from, { recursive: true, force: true });
  }
}

let trashCounter = 0;

function nextTrashId(sessionId) {
  trashCounter = (trashCounter + 1) % 1000;
  const stamp = Date.now().toString(36);
  const short = String(sessionId).replace(/^session-/, '').slice(0, 8) || 'session';
  return `${stamp}-${short}-${trashCounter.toString(36)}`;
}

/**
 * Move one session directory into the trash and record it.
 *
 * @param {object} params
 * @param {string} params.sessionDir - absolute directory that holds the log.
 * @param {string} params.sessionId
 * @param {object} params.meta - title/workspace/cwd/createdAt/sizeBytes/archived.
 * @param {string} params.root - trash root.
 * @param {string} [params.sessionsRoot] - session store root, for relPath.
 * @returns {Promise<object>} the recorded entry.
 */
export async function trashSession({ sessionDir, sessionId, meta, root, sessionsRoot: storeRoot }) {
  if (!sessionDir || !existsSync(sessionDir)) throw new Error(`session directory not found: ${sessionDir}`);
  const base = storeRoot || sessionsRoot();
  const relPath = meta?.relPath && typeof meta.relPath === 'string'
    ? meta.relPath
    : relative(base, sessionDir);
  if (relPath.startsWith('..') || isAbsolute(relPath)) {
    throw new Error(`session directory escapes the session store: ${sessionDir}`);
  }
  const trashId = nextTrashId(sessionId);
  const entryDir = join(root, trashId);
  await mkdir(entryDir, { recursive: true });
  await movePath(sessionDir, join(entryDir, 'session'));

  let workspaceMoved = false;
  const workspacePath = typeof meta?.workspacePath === 'string' ? meta.workspacePath : '';
  if (meta?.moveWorkspace === true && workspacePath && existsSync(workspacePath)) {
    // Move the whole workspace folder into the same trash entry so the delete is
    // recoverable. Same-volume moves are a rename; cross-volume falls back to copy.
    await movePath(workspacePath, join(entryDir, 'workspace'));
    workspaceMoved = true;
  }

  const entry = {
    trashId,
    sessionId,
    relPath,
    title: typeof meta?.title === 'string' ? meta.title : '',
    workspacePath: typeof meta?.workspacePath === 'string' ? meta.workspacePath : '',
    cwd: typeof meta?.cwd === 'string' ? meta.cwd : '',
    createdAt: Number.isFinite(meta?.createdAt) ? meta.createdAt : 0,
    sizeBytes: Number.isFinite(meta?.sizeBytes) ? meta.sizeBytes : 0,
    deletedAt: Date.now(),
    archivedBefore: meta?.archived === true,
    workspaceMoved,
    restoredAt: null
  };

  const entries = await readTrashIndex(root);
  entries.unshift(entry);
  await writeTrashIndex(root, entries);
  return entry;
}

/**
 * Move one trashed session back to its original location.
 * The caller keeps ownership of the index update.
 */
export async function restoreSession({ entry, root, sessionsRoot: storeRoot }) {
  if (!entry || typeof entry.relPath !== 'string') throw new Error('trash entry has no relPath');
  const from = join(root, entry.trashId, 'session');
  if (!existsSync(from)) throw new Error(`trash copy is missing: ${entry.trashId}`);
  const base = storeRoot || sessionsRoot();
  const target = join(base, entry.relPath);
  if (existsSync(target)) throw new Error(`target already exists: ${target}`);
  await movePath(from, target);
  if (entry.workspaceMoved === true && entry.workspacePath) {
    const stored = join(root, entry.trashId, 'workspace');
    if (existsSync(stored) && !existsSync(entry.workspacePath)) {
      await movePath(stored, entry.workspacePath);
    }
  }
  await rm(join(root, entry.trashId), { recursive: true, force: true });
  return target;
}

/** Permanently delete one trash entry and its payload. */
export async function purgeEntry(entry, root) {
  if (!entry || typeof entry.trashId !== 'string') throw new Error('trash entry has no trashId');
  await rm(join(root, entry.trashId), { recursive: true, force: true });
}

/** Remove the projection-cache record for a session, if one exists. */
export async function removeProjectionCache(sessionId, home = resolveHome()) {
  const bare = String(sessionId).replace(/^session-/, '');
  const dir = join(home, 'storages', 'session_projcache', 'sessions');
  const targets = [join(dir, `${bare}.json`), join(dir, `${sessionId}.json`)];
  const removed = [];
  for (const target of targets) {
    try {
      await unlink(target);
      removed.push(basename(target));
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
    }
  }
  return removed;
}

/** Total bytes the trash index says it holds (recorded at delete time). */
export async function trashBytes(root) {
  const entries = await readTrashIndex(root);
  return entries.reduce((sum, entry) => sum + (Number.isFinite(entry.sizeBytes) ? entry.sizeBytes : 0), 0);
}
