/**
 * Agent-facing tools.
 *
 * `defineTool` is optional at runtime: when @deepseek-ai/dsh-tools cannot be
 * resolved from this package (file-linked checkouts), the plain definition is
 * registered instead — the registry accepts an object with the same shape.
 */

function identityTool(definition) {
  return definition;
}

function textResult(value) {
  return [{ type: 'text', text: value }];
}

function formatBytes(bytes) {
  const n = Number.isFinite(bytes) ? bytes : 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function describeRow(row) {
  const labels = (row.reasons || []).map((reason) => reason.label).join('/');
  return `${row.id} · ${formatBytes(row.sizeBytes)} · ${row.ageDays}天 · ${labels || row.protectedReason || '—'}${row.title ? ` · ${row.title.slice(0, 40)}` : ''}`;
}

function resultSummary(results) {
  if (!Array.isArray(results) || results.length === 0) return '没有可处理的会话。';
  return results
    .map((row) => `${row.ok ? '✓' : '✗'} ${row.sessionId || row.trashId || row.id} ${row.code || (row.ok ? 'done' : '')}${row.message ? ` — ${row.message}` : ''}`)
    .join('\n');
}

/**
 * Register the janitor tools on the host tool registry.
 * @param {object} ctx - Cordis context with `tools`.
 * @param {object} service - janitor service.
 * @param {object} defineTool - the host `defineTool` factory (or identity).
 */
export function registerTools(ctx, service, defineTool = identityTool) {
  if (!ctx || typeof ctx.tools?.register !== 'function') return;

  ctx.tools.register(defineTool({
    name: 'manage_deletion_scan',
    description:
      '只读扫描 DSH 会话，找出可清理的垃圾会话（空会话、测试/临时标题、子代理残留、工作目录已不存在的孤儿会话、很小且很久没动的会话）。'
      + '不会删除任何东西。返回统计、候选清单（默认最多 20 条）与回收站状态。',
    parameters: {
      olderThanDays: { type: 'number', description: '把“很小且很久没动”的判定门槛改成这么多天（默认 30）' },
      includeSubagents: { type: 'boolean', description: '是否把子代理会话算作候选（默认 true）' },
      limit: { type: 'number', description: '返回多少条候选（默认 20，最多 100）' }
    },
    output: { schema: { type: 'string' }, render: (_args, value) => textResult(value) },
    async execute(args) {
      const limit = Math.min(100, Math.max(1, Number(args?.limit) || 20));
      const report = await service.scan({
        oldDays: args?.olderThanDays,
        includeSubagents: args?.includeSubagents
      });
      const lines = [];
      lines.push(`会话总数 ${report.stats.total}｜候选 ${report.stats.junk}｜可释放 ${formatBytes(report.stats.junkBytes)}｜已归档 ${report.stats.archived}｜运行中 ${report.stats.live}`);
      if (report.sessions.filter((row) => row.junk).length === 0) {
        lines.push('没有发现候选垃圾会话。');
      } else {
        lines.push('候选：');
        for (const row of report.sessions.filter((row) => row.junk).slice(0, limit)) {
          lines.push(`- ${describeRow(row)}`);
        }
      }
      if (report.trash.count > 0) {
        lines.push(`回收站：${report.trash.count} 个会话，${formatBytes(report.trash.bytes)}；可用 manage_deletion_trash 恢复或清空。`);
      }
      for (const warning of report.warnings || []) lines.push(`注意：${warning}`);
      lines.push('下一步：把要清理的 id 交给 manage_deletion_clean，mode=archive（可逆归档）或 mode=trash（移入回收站），并传 confirm=true。');
      return lines.join('\n');
    }
  }));

  ctx.tools.register(defineTool({
    name: 'manage_deletion_clean',
    description:
      '清理指定会话：mode=archive 归档（隐藏但不删文件）；mode=unarchive 取消归档；mode=trash 移入插件回收站（从会话列表消失，文件移到 /session-janitor/trash，可恢复）。'
      + '运行中的会话与置顶会话一律拒绝。必须先调用 manage_deletion_scan 拿到 id，并显式传 confirm=true。',
    parameters: {
      ids: { type: 'array', items: { type: 'string' }, required: true, description: '要清理的会话 id 列表（最多 50 个）' },
      mode: { type: 'string', required: true, description: 'archive / unarchive / trash' },
      deleteFiles: { type: 'boolean', description: 'trash 时是否连同该会话自己产生并修改过的文件一起移入回收站（只限该会话 cwd 内的文件）' },
      confirm: { type: 'boolean', description: '必须是 true；否则只返回将要做什么' }
    },
    output: { schema: { type: 'string' }, render: (_args, value) => textResult(value) },
    async execute(args) {
      const ids = Array.isArray(args?.ids) ? args.ids.filter((id) => typeof id === 'string' && id.trim()) : [];
      const mode = args?.mode === 'trash' ? 'trash' : (args?.mode === 'unarchive' ? 'unarchive' : 'archive');
      if (ids.length === 0) return '没有给 ids：先运行 manage_deletion_scan 挑选候选，再一次清理。';
      if (ids.length > (service.config.maxBatch || 50)) return `一次最多 ${service.config.maxBatch} 个，请分批处理。`;
      if (args?.confirm !== true) {
        return `将执行 mode=${mode}，共 ${ids.length} 个：\n${ids.join('\n')}\n要把 confirm 设为 true 才会真正执行。`;
      }
      const results = mode === 'trash' ? await service.trash(ids, { deleteFiles: args?.deleteFiles === true })
        : mode === 'unarchive' ? await service.unarchive(ids)
          : await service.archive(ids);
      return `mode=${mode} 完成：\n${resultSummary(results)}`;
    }
  }));

  ctx.tools.register(defineTool({
    name: 'manage_deletion_trash',
    description: '查看插件回收站（action=list）、把回收的会话恢复回原位置（action=restore）、或彻底删除回收站内容（action=purge）。彻底删除不可恢复。',
    parameters: {
      action: { type: 'string', required: true, description: 'list / restore / purge' },
      trashIds: { type: 'array', items: { type: 'string' }, description: 'restore/purge 时的回收站条目 id；purge 省略表示清空' },
      confirm: { type: 'boolean', description: 'purge 必须为 true' }
    },
    output: { schema: { type: 'string' }, render: (_args, value) => textResult(value) },
    async execute(args) {
      const action = args?.action;
      if (action === 'list') {
        const report = await service.scan();
        if (report.trash.count === 0) return '回收站是空的。';
        return `回收站 ${report.trash.count} 项，共 ${formatBytes(report.trash.bytes)}：\n`
          + report.trash.entries.map((entry) => `- ${entry.trashId} · ${entry.sessionId} · ${formatBytes(entry.sizeBytes)} · ${entry.title ? entry.title.slice(0, 40) : '（无标题）'}`).join('\n');
      }
      if (action === 'restore') {
        const ids = Array.isArray(args?.trashIds) ? args.trashIds : [];
        if (ids.length === 0) return 'restore 需要 trashIds。';
        return resultSummary(await service.restore(ids));
      }
      if (action === 'purge') {
        if (args?.confirm !== true) return '彻底删除不可恢复：把 confirm 设为 true 才会执行。';
        const ids = Array.isArray(args?.trashIds) ? args.trashIds : [];
        return resultSummary(await service.purge(ids));
      }
      return 'action 只能是 list / restore / purge。';
    }
  }));
}
