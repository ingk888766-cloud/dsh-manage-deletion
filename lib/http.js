/**
 * The plugin's HTTP surface: one exact route, JSON in and out.
 *
 * Trust: delegate to the host's own `connection.requestRejection` when it
 * exists (desktop bridge and web both publish it). When it is absent, fall back
 * to a loopback Host-header check and document the difference; a destructive
 * route must never end up world-writable by accident.
 */

const MAX_BODY_BYTES = 256 * 1024;

function isLoopbackHost(hostHeader) {
  const host = String(hostHeader || '').trim().toLowerCase();
  if (!host) return false;
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);
}

/** 0 = allowed; otherwise an HTTP status to answer with. */
export function rejectStatus(ctx, req) {
  let connection;
  try {
    connection = ctx && typeof ctx.get === 'function' ? ctx.get('connection') : undefined;
  } catch {
    connection = undefined;
  }
  const reject = connection && connection.requestRejection;
  if (typeof reject === 'function') {
    try {
      const status = reject.call(connection, { headers: req.headers });
      return status === undefined || status === null ? 0 : Number(status) || 403;
    } catch {
      return 403;
    }
  }
  return isLoopbackHost(req.headers?.host) ? 0 : 403;
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('请求体太大'), { status: 413 });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 });
  }
}

function idsOf(value, maxBatch) {
  const ids = Array.isArray(value) ? value.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()) : [];
  if (ids.length > maxBatch) {
    throw Object.assign(new Error(`一次最多 ${maxBatch} 个会话`), { status: 400 });
  }
  return ids;
}

/**
 * Build the route handler.
 * @param {object} ctx
 * @param {object} service - janitor service from lib/service.js
 * @param {object} [logger]
 */
export function createHttpHandler(ctx, service) {
  return async function handler(req, res) {
    try {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' });
        res.end();
        return;
      }
      const rejected = rejectStatus(ctx, req);
      if (rejected) {
        send(res, rejected, { ok: false, error: 'request rejected' });
        return;
      }
      const body = await readJson(req);
      const method = typeof body.method === 'string' ? body.method : '';
      const maxBatch = service.config.maxBatch || 50;

      if (method === 'scan') {
        const report = await service.scan({
          oldDays: body.oldDays,
          includeSubagents: body.includeSubagents,
          threshold: body.threshold,
          titles: body.titles !== false,
          force: body.force === true,
          lean: body.lean === true
        });
        send(res, 200, { ok: true, ...report });
        return;
      }
      if (method === 'info') {
        const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string') : [];
        const rows = await service.info(ids);
        send(res, 200, { ok: true, sessions: rows });
        return;
      }
      if (method === 'archive' || method === 'trash' || method === 'unarchive') {
        const ids = idsOf(body.ids, maxBatch);
        if (ids.length === 0) {
          send(res, 400, { ok: false, error: '没有选中会话' });
          return;
        }
        const results = method === 'archive'
          ? await service.archive(ids)
          : method === 'trash'
            ? await service.trash(ids, { deleteFiles: body.deleteFiles === true })
            : await service.unarchive(ids);
        send(res, 200, { ok: true, results });
        return;
      }
      if (method === 'restore') {
        const ids = Array.isArray(body.trashIds) ? body.trashIds.filter((id) => typeof id === 'string') : [];
        if (ids.length === 0) {
          send(res, 400, { ok: false, error: '没有选中回收站条目' });
          return;
        }
        const results = await service.restore(ids);
        send(res, 200, { ok: true, results });
        return;
      }
      if (method === 'purge') {
        if (body.confirm !== true) {
          send(res, 400, { ok: false, error: '彻底删除需要 confirm=true' });
          return;
        }
        const ids = Array.isArray(body.trashIds) ? body.trashIds.filter((id) => typeof id === 'string') : [];
        const results = await service.purge(ids);
        send(res, 200, { ok: true, results });
        return;
      }
      send(res, 404, { ok: false, error: `未知方法：${method || '(空)'}` });
    } catch (error) {
      const status = Number(error?.status) || 500;
      send(res, status, { ok: false, error: String(error?.message || error), code: error?.code });
    }
  };
}
