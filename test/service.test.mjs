import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { normalizeConfig } from '../lib/config.js';
import { createJanitorService } from '../lib/service.js';

const DAY = 86400000;

function sessionFixture(home, workspace, id, { bytes = 4096, age = 2 } = {}) {
  const dir = join(home, 'sessions', workspace, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), 'x'.repeat(bytes));
  return {
    dir,
    header: {
      id,
      cwd: join(home, 'projects', workspace),
      createdAt: Date.now() - age * DAY,
      parentSession: undefined,
      delegationDepth: 0
    },
    sizeBytes: bytes
  };
}

/** A ctx whose services are plain in-memory fakes. */
function makeCtx(rows, options = {}) {
  const state = {
    archived: new Set(options.archived || []),
    pinned: new Set(options.pinned || []),
    live: new Set(options.live || []),
    archiveCalls: [],
    detachCalls: [],
    unpinned: []
  };
  const snapshots = rows.map((row) => ({
    header: row.header,
    sizeBytes: row.sizeBytes,
    location: { kind: 'jsonl', path: join(row.dir, 'session.v4.jsonl.zstd') }
  }));
  const entity = {
    id: 'ws-1',
    path: join(options.homeRoot || '', 'projects', 'ws-demo'),
    title: 'ws-demo',
    sessionIds: rows.map((row) => row.header.id),
    async detachSession(id) {
      state.detachCalls.push(id);
      entity.sessionIds = entity.sessionIds.filter((candidate) => candidate !== id);
    },
    async attachSession(id) {
      if (!entity.sessionIds.includes(id)) entity.sessionIds = [id, ...entity.sessionIds];
    }
  };
  const services = {
    sessionPersistence: {
      list: async () => snapshots,
      stat: async (id) => snapshots.find((snapshot) => snapshot.header.id === id) || null
    },
    sessions: {
      list: () => [...state.live].map((id) => ({ id, header: { id } })),
      get: (id) => (state.live.has(id) ? { id, status: 'running' } : undefined)
    },
    agents: {
      get: (id) => (state.live.has(id) ? { id, status: 'running' } : undefined)
    },
    workspaceRegistry: {
      list: () => [entity],
      get archivedSessionIds() {
        return [...state.archived];
      },
      get pinnedSessionIds() {
        return [...state.pinned];
      },
      async archiveSession(id) {
        state.archiveCalls.push(id);
        state.archived.add(id);
      },
      async unarchiveSession(id) {
        state.archived.delete(id);
      },
      async unpinSession(id) {
        state.unpinned.push(id);
        state.pinned.delete(id);
      }
    },
    sessionQuery: {
      readTitleSnapshots: async (ids) => ids.map((id) => ({
        status: 'fulfilled',
        value: { session: { id }, title: options.titles?.[id] || '' }
      })),
      readSession: async (id) => (options.events && options.events[id]) || []
    }
  };
  const ctx = {
    get: (name) => services[name],
    tools: { register() {} },
    logger: { warn() {} }
  };
  return { ctx, state, entity, services };
}

function setup(options = {}) {
  const home = mkdtempSync(join(tmpdir(), 'janitor-svc-'));
  process.env.DSH_HOME = home;
  const workspace = 'ws-demo';
  const rows = [
    sessionFixture(home, workspace, 'session-blank0001', { bytes: 420, age: 1 }),
    sessionFixture(home, workspace, 'session-test00002', { bytes: 50_000, age: 3 }),
    sessionFixture(home, workspace, 'session-real00003', { bytes: 300_000, age: 2 }),
    sessionFixture(home, workspace, 'session-live00004', { bytes: 420, age: 1 })
  ];
  rows[1].header.parentSession = 'session-real00003';
  const built = makeCtx(rows, {
    homeRoot: home,
    titles: { 'session-test00002': '测试', 'session-real00003': '写报告', 'session-blank0001': '' },
    live: ['session-live00004'],
    pinned: ['session-real00003'],
    ...options
  });
  const service = createJanitorService(built.ctx, normalizeConfig(options.config));
  return { home, rows, service, ...built };
}

test('scan classifies blank, test-titled and subagent sessions but protects live/pinned ones', async () => {
  const { service } = setup();
  const report = await service.scan();
  const byId = new Map(report.sessions.map((row) => [row.id, row]));

  assert.equal(report.stats.total, 4);
  assert.equal(byId.get('session-blank0001').junk, true);
  assert.equal(byId.get('session-test00002').junk, true);
  assert.ok(byId.get('session-test00002').reasons.some((reason) => reason.code === 'subagent'));
  assert.ok(byId.get('session-test00002').reasons.some((reason) => reason.code === 'test-title'));
  assert.equal(byId.get('session-real00003').junk, false);
  assert.equal(byId.get('session-real00003').protectedReason, 'pinned');
  assert.equal(byId.get('session-live00004').protectedReason, 'live');
  assert.equal(report.stats.junk, 2);
});

test('archive refuses running sessions, and unpins a pinned one before archiving', async () => {
  const { service, state } = setup();
  const results = await service.archive(['session-blank0001', 'session-live00004', 'session-real00003']);
  const byId = new Map(results.map((row) => [row.id, row]));

  assert.equal(byId.get('session-blank0001').ok, true);
  assert.equal(byId.get('session-live00004').ok, false);
  assert.equal(byId.get('session-live00004').code, 'live');
  assert.equal(byId.get('session-real00003').ok, true, 'pinned sessions are deletable now');
  assert.deepEqual(state.unpinned, ['session-real00003'], 'pin is dropped first');
  assert.deepEqual(state.archiveCalls.sort(), ['session-blank0001', 'session-real00003']);
});

test('trash moves the log, detaches the workspace and records trash without an archive round-trip', async () => {
  const { home, rows, service, state } = setup();
  const results = await service.trash(['session-blank0001']);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].code, 'trashed');
  assert.equal(existsSync(rows[0].dir), false, 'log directory moved away');
  assert.equal(state.archiveCalls.includes('session-blank0001'), false, 'no archive round-trip on delete');
  assert.deepEqual(state.detachCalls, ['session-blank0001']);

  const report = await service.scan();
  assert.equal(report.trash.count, 1);
  assert.ok(report.trash.bytes > 0);
  assert.equal(existsSync(join(home, 'manage-deletion', 'trash')), true);
});

test('trash refuses a running session and leaves its files alone', async () => {
  const { rows, service, state } = setup();
  const results = await service.trash(['session-live00004']);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].code, 'live');
  assert.equal(existsSync(rows[3].dir), true);
  assert.deepEqual(state.archiveCalls, []);
});

test('restore brings the session back, re-attaches and unarchives', async () => {
  const { rows, service, state, entity } = setup();
  const trashed = await service.trash(['session-blank0001']);
  const trashId = trashed[0].trashId;

  const restored = await service.restore([trashId]);
  assert.equal(restored[0].ok, true);
  assert.equal(existsSync(rows[0].dir), true, 'log directory is back');
  assert.equal(entity.sessionIds.includes('session-blank0001'), true, 'workspace membership restored');
  assert.equal(state.archived.has('session-blank0001'), false, 'unarchived');

  const report = await service.scan();
  assert.equal(report.trash.count, 0);
});

test('unarchive drops the archive mark without touching files', async () => {
  const { service, state, rows } = setup();
  await service.archive(['session-blank0001']);
  assert.equal(state.archived.has('session-blank0001'), true);

  const results = await service.unarchive(['session-blank0001']);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].code, 'unarchived');
  assert.equal(state.archived.has('session-blank0001'), false);
  assert.equal(existsSync(rows[0].dir), true, 'files untouched');

  const again = await service.unarchive(['session-blank0001']);
  assert.equal(again[0].code, 'not-archived');
});

test('info reports sizes, times and the files the session wrote', async () => {
  const built = setup();
  const home = built.home;
  mkdirSync(join(home, 'projects', 'ws-demo'), { recursive: true });
  writeFileSync(join(home, 'projects', 'ws-demo', 'a.txt'), 'x');
  writeFileSync(join(home, 'projects', 'ws-demo', 'b.txt'), 'y');
  built.services.sessionQuery.readSession = async () => [
    { type: 'tool/call', data: { name: 'write', arguments: JSON.stringify({ file_path: join(home, 'projects', 'ws-demo', 'a.txt') }) } },
    { type: 'tool/call', data: { name: 'read', arguments: JSON.stringify({ file_path: join(home, 'projects', 'ws-demo', 'b.txt') }) } }
  ];

  const rowsOut = await built.service.info(['session-blank0001']);
  assert.equal(rowsOut.length, 1);
  assert.equal(rowsOut[0].files.length, 1, 'only the written file binds');
  assert.equal(rowsOut[0].files[0].rel, 'a.txt');
});

test('trash can move the files the session wrote, and restore brings them back', async () => {
  const built = setup();
  const home = built.home;
  const projectDir = join(home, 'projects', 'ws-demo');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'report.md'), 'hello');
  writeFileSync(join(projectDir, 'untouched.txt'), 'keep me');
  built.services.sessionQuery.readSession = async () => [
    { type: 'tool/call', data: { name: 'edit', arguments: JSON.stringify({ file_path: join(projectDir, 'report.md') }) } }
  ];

  const trashed = await built.service.trash(['session-blank0001'], { deleteFiles: true });
  assert.equal(trashed[0].ok, true);
  assert.equal(existsSync(join(projectDir, 'report.md')), false, 'written file moved to trash');
  assert.equal(existsSync(join(projectDir, 'untouched.txt')), true, 'other workspace files untouched');

  const report = await built.service.scan({ force: true });
  const entry = report.trash.entries[0];
  assert.equal(entry.files.length, 1);

  const restored = await built.service.restore([entry.trashId]);
  assert.equal(restored[0].ok, true);
  assert.equal(existsSync(join(projectDir, 'report.md')), true, 'file came back');
  assert.equal(existsSync(built.rows[0].dir), true, 'session log came back');
});

test('a file outside the session cwd is never bound', async () => {
  const built = setup();
  const home = built.home;
  mkdirSync(join(home, 'outside'), { recursive: true });
  writeFileSync(join(home, 'outside', 'secret.txt'), 'nope');
  built.services.sessionQuery.readSession = async () => [
    { type: 'tool/call', data: { name: 'write', arguments: JSON.stringify({ file_path: join(home, 'outside', 'secret.txt') }) } }
  ];

  const rowsOut = await built.service.info(['session-blank0001']);
  assert.equal(rowsOut[0].files.length, 0);
});

test('falls back to decoding the session log when the query service has no events', async () => {
  const { home, rows, services, service } = setup();
  const projectDir = join(home, 'projects', 'ws-demo');
  mkdirSync(projectDir, { recursive: true });
  const target = join(projectDir, 'from-log.md');
  writeFileSync(target, 'hello');

  const header = JSON.stringify({ type: 'session', version: 4, id: rows[0].header.id, cwd: projectDir, createdAt: Date.now() });
  const call = JSON.stringify({ type: 'tool/call', seq: 1, data: { name: 'write', arguments: JSON.stringify({ file_path: target }) } });
  const logPath = join(rows[0].dir, 'session.v4.jsonl.zstd');
  writeFileSync(logPath, Buffer.concat([
    zstdCompressSync(Buffer.from(header + '\n', 'utf8')),
    zstdCompressSync(Buffer.from(call + '\n', 'utf8'))
  ]));

  // Query service present but event-less: the local decoder must take over.
  services.sessionQuery.readSession = async () => [];
  services.sessionPersistence.stat = async () => ({ header: rows[0].header, sizeBytes: 10, location: { kind: 'jsonl', path: logPath } });

  const out = await service.info([rows[0].header.id]);
  assert.equal(out[0].files.length, 1);
  assert.equal(out[0].files[0].rel, 'from-log.md');
});

test('purge without ids empties the trash', async () => {
  const { service, home } = setup();
  await service.trash(['session-blank0001']);
  const results = await service.purge([]);
  assert.equal(results[0].ok, true);
  const report = await service.scan();
  assert.equal(report.trash.count, 0);
  assert.equal(existsSync(join(home, 'manage-deletion', 'trash', results[0].trashId)), false);
});

test('concurrent mutations are refused instead of interleaving', async () => {
  const { service } = setup();
  const first = service.archive(['session-blank0001']);
  await assert.rejects(() => service.archive(['session-test00002']), /还在进行/);
  await first;
});

test('scan tolerates a host without sessionQuery', async () => {
  const home = mkdtempSync(join(tmpdir(), 'janitor-noquery-'));
  process.env.DSH_HOME = home;
  const row = sessionFixture(home, 'ws-demo', 'session-blank0001', { bytes: 420 });
  const built = makeCtx([row], { homeRoot: home });
  delete built.services.sessionQuery;
  const service = createJanitorService(built.ctx, normalizeConfig());
  const report = await service.scan();
  assert.equal(report.stats.total, 1);
  assert.ok(report.warnings.some((warning) => warning.includes('sessionQuery')));
  assert.equal(report.sessions[0].junk, true, 'size alone still flags a blank session');
});

test('scan tolerates a host without workspaceRegistry', async () => {
  const home = mkdtempSync(join(tmpdir(), 'janitor-noreg-'));
  process.env.DSH_HOME = home;
  const row = sessionFixture(home, 'ws-demo', 'session-blank0001', { bytes: 420 });
  const built = makeCtx([row], { homeRoot: home });
  delete built.services.workspaceRegistry;
  const service = createJanitorService(built.ctx, normalizeConfig());
  const report = await service.scan();
  assert.equal(report.stats.total, 1);
  assert.ok(report.warnings.some((warning) => warning.includes('workspaceRegistry')));
});


test('purge reports ids that are not in the trash as not-found', async () => {
  const { service } = setup();
  const results = await service.purge(['mw-bogus-id']);
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].code, 'not-found');
});

test('purge drops an orphan index row whose directory is already gone', async () => {
  const { service, home } = setup();
  const trashed = await service.trash(['session-blank0001']);
  const trashId = trashed[0].trashId;
  rmSync(join(home, 'manage-deletion', 'trash', trashId), { recursive: true, force: true });
  const results = await service.purge([trashId]);
  assert.equal(results[0].ok, true, 'missing directory must not pin the row');
  assert.ok(results[0].code === 'purged' || results[0].code === 'already-gone', 'code=' + results[0].code);
  const report = await service.scan();
  assert.equal(report.trash.count, 0, 'orphan row removed from the index');
});

test('info scans files for every requested session and never sets a skip flag', async () => {
  const { service, rows, services, home } = setup();
  const written = join(home, 'projects', 'ws-demo', 'w.txt');
  mkdirSync(join(home, 'projects', 'ws-demo'), { recursive: true });
  writeFileSync(written, 'x');
  services.sessionQuery.readSession = async () => [
    { type: 'tool/call', data: { name: 'write', arguments: JSON.stringify({ file_path: written }) } }
  ];
  const out = await service.info(rows.map((row) => row.header.id));
  assert.equal(out.length, 4);
  for (const row of out) {
    assert.equal('filesSkipped' in row, false);
    assert.equal(row.files.length, 1, 'every selected session still gets its file list');
    assert.ok(Array.isArray(row.otherFiles));
  }
});


test('deleting a session whose log is already gone cleans the leftovers instead of failing', async () => {
  const { service, rows, state } = setup();
  const id = rows[0].header.id;
  rmSync(rows[0].dir, { recursive: true, force: true });
  const results = await service.trash([id]);
  assert.equal(results[0].ok, true, 'a ghost row must not stay undeletable');
  assert.equal(results[0].code, 'already-gone');
  assert.ok(state.detachCalls.includes(id), 'workspace membership released');
});


test('trashList reads only the trash index and matches scan counts', async () => {
  const { service } = setup();
  await service.trash(['session-blank0001']);
  const list = await service.trashList();
  const report = await service.scan();
  assert.equal(list.count, 1);
  assert.equal(list.count, report.trash.count);
  assert.equal(list.entries[0].sessionId, 'session-blank0001');
  assert.ok(list.bytes > 0);
});
