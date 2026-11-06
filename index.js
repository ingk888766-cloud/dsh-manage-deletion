/**
 * dsh-session-janitor — host half.
 *
 * Scans the durable session store for junk sessions (blank, test-titled,
 * subagent leftovers, orphaned working directories, tiny and old) and cleans
 * them two ways: the host's own reversible archive, or a plugin-owned trash
 * directory that can be restored later.
 *
 * Everything runs through host services (sessionPersistence, sessions,
 * workspaceRegistry, sessionQuery) and never parses host-internal files, so a
 * future storage backend keeps working. The web UI talks to one POST route;
 * the agent gets three tools.
 */
import { normalizeConfig } from './lib/config.js';
import { createJanitorService } from './lib/service.js';
import { registerTools } from './lib/tools.js';
import { createHttpHandler } from './lib/http.js';

/** Cordis plugin name. */
export const name = 'manage-deletion';
/** Services this plugin needs injected; the rest are read on demand. */
export const inject = ['tools'];

const ROUTE = '/manage-deletion';

function warn(ctx, message, error) {
  try {
    ctx.logger?.warn?.(`manage-deletion: ${message}`);
    if (error) ctx.logger?.warn?.(error);
  } catch {
    /* logging must never break the plugin */
  }
}

/**
 * @param {object} ctx - Cordis plugin context.
 * @param {object} rawConfig - composition entry (optional, normalized here).
 */
export function apply(ctx, rawConfig) {
  if (!ctx || typeof ctx !== 'object') return;
  const config = normalizeConfig(rawConfig);

  let service;
  try {
    service = createJanitorService(ctx, config);
  } catch (error) {
    warn(ctx, '无法启动（服务初始化失败）', error);
    return;
  }

  try {
    registerTools(ctx, service);
  } catch (error) {
    warn(ctx, '工具注册失败（界面仍可用）', error);
  }

  const mountRoute = (hostCtx) => {
    try {
      const server = hostCtx?.webServer;
      if (!server || typeof server.register !== 'function') {
        warn(ctx, 'webServer 不可用：界面不可用，工具仍可用');
        return;
      }
      const handler = createHttpHandler(ctx, service);
      const dispose = server.register({ kind: 'exact', path: ROUTE, handler: (req, res) => handler(req, res) });
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => {
          try {
            dispose?.();
          } catch {
            /* disposal is best effort */
          }
        }, 'manage-deletion.webRoute');
      }
    } catch (error) {
      warn(ctx, '路由注册失败', error);
    }
  };

  try {
    if (typeof ctx.inject === 'function') ctx.inject(['webServer'], mountRoute);
    else if (typeof ctx.get === 'function') mountRoute(ctx);
  } catch (error) {
    warn(ctx, '注入 webServer 失败', error);
  }
}

/** Exported for tests: the route path the client must call. */
export const routePath = ROUTE;
