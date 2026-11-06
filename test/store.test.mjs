import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultTrashRoot,
  movePath,
  purgeEntry,
  readTrashIndex,
  restoreSession,
  sessionsRoot,
  trashBytes,
  trashRootFor,
  trashSession,
  writeTrashIndex
} from '../lib/store.js';

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'janitor-store-'));
  const store = join(home, 'sessions');
  const dir = join(store, 'ws-demo', 'session-aaaa1111');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), 'header\n');
  return { home, store, dir };
}

test('default paths derive from the home passed in', () => {
  assert.equal(sessionsRoot('/tmp/home'), join('/tmp/home', 'sessions'));
  assert.equal(defaultTrashRoot('/tmp/home'), join('/tmp/home', 'manage-deletion', 'trash'));
  assert.equal(trashRootFor({ trashDir: '' }, '/tmp/home'), defaultTrashRoot('/tmp/home'));
  assert.equal(trashRootFor({ trashDir: 'custom/trash' }, '/tmp/home'), join('/tmp/home', 'custom/trash'));
  assert.equal(trashRootFor({ trashDir: '/abs/trash' }, '/tmp/home'), '/abs/trash');
});

test('trash then restore round-trips the session directory', async () => {
  const { home, store, dir } = fixture();
  const root = defaultTrashRoot(home);

  const entry = await trashSession({
    sessionDir: dir,
    sessionId: 'session-aaaa1111',
    root,
    sessionsRoot: store,
    meta: { title: '测试', sizeBytes: 7, createdAt: 1, cwd: join(home, 'ws-demo'), archived: true }
  });

  assert.equal(existsSync(dir), false, 'session directory moved away');
  assert.equal(existsSync(join(root, entry.trashId, 'session', 'session.v4.jsonl.zstd')), true);

  const index = await readTrashIndex(root);
  assert.equal(index.length, 1);
  assert.equal(index[0].sessionId, 'session-aaaa1111');
  assert.equal(index[0].relPath, join('ws-demo', 'session-aaaa1111'));
  assert.equal(await trashBytes(root), 7);

  const restored = await restoreSession({ entry: index[0], root, sessionsRoot: store });
  assert.equal(restored.path, dir);
  assert.equal(existsSync(join(dir, 'session.v4.jsonl.zstd')), true);
  assert.equal(existsSync(join(root, entry.trashId)), false, 'trash payload removed after restore');
});

test('restoring onto an existing path refuses instead of overwriting', async () => {
  const { home, store, dir } = fixture();
  const root = defaultTrashRoot(home);
  const entry = await trashSession({ sessionDir: dir, sessionId: 'session-aaaa1111', root, sessionsRoot: store, meta: {} });
  mkdirSync(dir, { recursive: true });
  await assert.rejects(() => restoreSession({ entry, root, sessionsRoot: store }), /target already exists/);
});

test('a session directory outside the store is refused', async () => {
  const { home, store, dir } = fixture();
  const root = defaultTrashRoot(home);
  await assert.rejects(
    () => trashSession({ sessionDir: dir, sessionId: 'session-aaaa1111', root, sessionsRoot: store, meta: { relPath: '../escape' } }),
    /escapes the session store/
  );
});

test('purge removes the payload and the index is rewritten by the caller', async () => {
  const { home, store, dir } = fixture();
  const root = defaultTrashRoot(home);
  const entry = await trashSession({ sessionDir: dir, sessionId: 'session-aaaa1111', root, sessionsRoot: store, meta: {} });
  await purgeEntry(entry, root);
  assert.equal(existsSync(join(root, entry.trashId)), false);
  await writeTrashIndex(root, []);
  assert.deepEqual(await readTrashIndex(root), []);
});

test('index reads tolerate a missing or corrupt file', async () => {
  const home = mkdtempSync(join(tmpdir(), 'janitor-index-'));
  assert.deepEqual(await readTrashIndex(join(home, 'nope')), []);
  const root = join(home, 'trash');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'index.json'), '{ not json');
  assert.deepEqual(await readTrashIndex(root), []);
});

test('movePath falls back to copy and reports missing sources', async () => {
  const home = mkdtempSync(join(tmpdir(), 'janitor-move-'));
  const from = join(home, 'a.txt');
  writeFileSync(from, 'data');
  await movePath(from, join(home, 'nested', 'b.txt'));
  assert.equal(await readFile(join(home, 'nested', 'b.txt'), 'utf8'), 'data');
  assert.equal(existsSync(from), false);
  await assert.rejects(() => movePath(join(home, 'missing.txt'), join(home, 'x.txt')));
});
