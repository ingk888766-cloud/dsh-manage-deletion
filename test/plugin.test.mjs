/**
 * Entry-point integration: import the real host entry, apply it to a fake
 * Cordis context and drive the HTTP route end to end.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { apply, name, routePath } from '../index.js';

function fakeResponse() {
  const captured = { status: 0, headers: null, body: '' };
  let resolveDone;
  captured.done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  return {
    captured,
    writeHead(status, headers) {
      captured.status = status;
      captured.headers = headers || {};
    },
    end(body) {
      captured.body = body === undefined ? '' : String(body);
      resolveDone();
    }
  };
}

function fakeRequest(payload, options = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = options.method || 'POST';
  req.headers = options.headers || { host: '127.0.0.1:50043' };
  return req;
}

function fakeContext({ archived = [], pinned = [], live = [] } = {}) {
  const registeredTools = [];
  const routes = [];
  const services = {
    sessionPersistence: { list: async () => [], stat: async () => null },
    sessions: { list: () => live.map((id) => ({ id, header: { id } })), get: () => undefined },
    workspaceRegistry: {
      list: () => [],
      get archivedSessionIds() {
        return archived;
      },
      get pinnedSessionIds() {
        return pinned;
      }
    },
    sessionQuery: { readTitleSnapshots: async () => [] }
  };
  const ctx = {
    get: (serviceName) => services[serviceName],
    tools: {
      register(definition) {
        registeredTools.push(definition);
      }
    },
    inject(_services, callback) {
      callback({ webServer: { register(route) { routes.push(route); return () => {}; } } });
    },
    effect() {
      return () => {};
    },
    logger: { warn() {} }
  };
  return { ctx, registeredTools, routes, services };
}

async function callRoute(route, payload, options) {
  const res = fakeResponse();
  await route.handler(fakeRequest(payload, options), res);
  await res.captured.done;
  return res.captured;
}

test('exports the plugin name and route path', () => {
  assert.equal(name, 'manage-deletion');
  assert.equal(routePath, '/manage-deletion');
});

test('apply registers three tools and one exact route', () => {
  const { ctx, registeredTools, routes } = fakeContext();
  apply(ctx);
  assert.deepEqual(registeredTools.map((tool) => tool.name).sort(), [
    'manage_deletion_clean',
    'manage_deletion_files',
    'manage_deletion_scan',
    'manage_deletion_trash'
  ]);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, 'exact');
  assert.equal(routes[0].path, '/manage-deletion');
});

test('the route answers a scan with JSON', async () => {
  const home = mkdtempSync(join(tmpdir(), 'janitor-entry-'));
  const dir = join(home, 'sessions', 'ws', 'session-aaaa');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), 'x'.repeat(400));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { ctx, routes, services } = fakeContext();
    services.sessionPersistence = {
      list: async () => [{
        header: { id: 'session-aaaa', cwd: join(home, 'ws'), createdAt: Date.now() - 86400000 },
        sizeBytes: 400,
        location: { kind: 'jsonl', path: join(dir, 'session.v4.jsonl.zstd') }
      }],
      stat: async () => null
    };
    apply(ctx);
    const captured = await callRoute(routes[0], { method: 'scan' });
    const payload = JSON.parse(captured.body);
    assert.equal(captured.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.stats.total, 1);
    assert.equal(payload.sessions[0].junk, true);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
  }
});

test('the route rejects GET and malformed JSON', async () => {
  const { ctx, routes } = fakeContext();
  apply(ctx);

  const getCaptured = await callRoute(routes[0], {}, { method: 'GET' });
  assert.equal(getCaptured.status, 405);

  const badCaptured = await callRoute(routes[0], '{ not json');
  assert.equal(badCaptured.status, 400);
});

test('the route refuses a non-loopback host when the host trust hook is absent', async () => {
  const { ctx, routes } = fakeContext();
  apply(ctx);
  const captured = await callRoute(routes[0], { method: 'scan' }, { headers: { host: 'evil.example.com' } });
  assert.equal(captured.status, 403);
});

test('trash through the route needs selected ids, and purge needs confirm', async () => {
  const { ctx, routes } = fakeContext();
  apply(ctx);

  const emptyTrash = await callRoute(routes[0], { method: 'trash', ids: [] });
  assert.equal(emptyTrash.status, 400);

  const purgeCaptured = await callRoute(routes[0], { method: 'purge' });
  assert.equal(purgeCaptured.status, 400);
  assert.match(JSON.parse(purgeCaptured.body).error, /confirm/);

  const unknown = await callRoute(routes[0], { method: 'nope' });
  assert.equal(unknown.status, 404);
});
