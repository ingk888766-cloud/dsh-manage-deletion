/**
 * Pure junk-session classification.
 *
 * Deliberately free of filesystem and Cordis access so the rules can be unit
 * tested and so the UI and the agent tools share exactly one decision path.
 *
 * An *entry* is the minimal fact set about one session:
 *   {
 *     id, createdAt, sizeBytes, cwd, cwdExists,
 *     title, parentSession, delegationDepth,
 *     live, pinned, archived, workspacePath, workspaceTitle
 *   }
 */

/** Reason codes, stable for the UI and for tests. */
export const REASON = {
  LIVE: 'live',
  PINNED: 'pinned',
  BLANK: 'blank',
  SUBAGENT: 'subagent',
  TEST_TITLE: 'test-title',
  ORPHAN: 'orphan',
  TINY_OLD: 'tiny-old'
};

/** Weight and display label per reason. Higher weight = stronger junk signal. */
export const REASON_META = {
  [REASON.BLANK]: { weight: 50, label: '空会话' },
  [REASON.ORPHAN]: { weight: 45, label: '工作目录已不存在' },
  [REASON.TEST_TITLE]: { weight: 25, label: '测试/临时标题' },
  [REASON.SUBAGENT]: { weight: 20, label: '子代理残留' },
  [REASON.TINY_OLD]: { weight: 20, label: '很小且很久没动' }
};

const DAY_MS = 86400000;

/** Trim, collapse whitespace and strip a leading list marker from a title. */
export function normalizeTitle(title) {
  if (typeof title !== 'string') return '';
  return title.replace(/\s+/g, ' ').trim();
}

/** Whole-title match against the configured patterns (invalid regexes are skipped). */
export function matchesJunkTitle(title, patterns) {
  const text = normalizeTitle(title).toLowerCase();
  if (!text) return false;
  if (text.length > 60) return false;
  for (const raw of patterns || []) {
    let re;
    try {
      re = new RegExp(raw, 'i');
    } catch {
      continue;
    }
    if (re.test(text)) return true;
  }
  return false;
}

/** Whole days between `createdAt` (ms) and `now` (ms); 0 when unknown or future. */
export function ageDays(createdAt, now) {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return 0;
  const diff = now - createdAt;
  return diff <= 0 ? 0 : Math.floor(diff / DAY_MS);
}

/**
 * Decide whether one session is junk.
 * @param {object} entry - facts about one session (see module doc).
 * @param {object} options - normalized config (threshold, blankMaxBytes, …).
 * @param {number} now - current epoch ms (injected for deterministic tests).
 * @returns {{id: string, junk: boolean, score: number, protectedReason: string|null,
 *            reasons: Array<{code: string, label: string, weight: number, detail: string}>}}
 */
export function classifySession(entry, options, now) {
  const opts = options || {};
  const threshold = Number.isFinite(opts.threshold) ? opts.threshold : 20;
  const blankMaxBytes = Number.isFinite(opts.blankMaxBytes) ? opts.blankMaxBytes : 1200;
  const tinyMaxBytes = Number.isFinite(opts.tinyMaxBytes) ? opts.tinyMaxBytes : 20480;
  const oldDays = Number.isFinite(opts.oldDays) ? opts.oldDays : 30;
  const reasons = [];

  const add = (code, detail) => {
    const meta = REASON_META[code];
    reasons.push({ code, label: meta.label, weight: meta.weight, detail });
  };

  if (entry.live && opts.keepLive !== false) {
    return { id: entry.id, junk: false, score: 0, protectedReason: REASON.LIVE, reasons: [] };
  }
  if (entry.pinned && opts.keepPinned !== false) {
    return { id: entry.id, junk: false, score: 0, protectedReason: REASON.PINNED, reasons: [] };
  }

  const size = Number.isFinite(entry.sizeBytes) ? entry.sizeBytes : 0;
  const title = normalizeTitle(entry.title);
  const age = ageDays(entry.createdAt, Number.isFinite(now) ? now : Date.now());

  if (size > 0 && size <= blankMaxBytes) {
    add(REASON.BLANK, `日志仅 ${size} 字节，没有有效对话`);
  }
  if (opts.includeSubagents !== false && (entry.parentSession || (Number.isFinite(entry.delegationDepth) && entry.delegationDepth > 0))) {
    add(REASON.SUBAGENT, entry.parentSession ? `父会话 ${entry.parentSession}` : '由子代理产生');
  }
  if (matchesJunkTitle(title, opts.titlePatterns)) {
    add(REASON.TEST_TITLE, `标题「${title.slice(0, 40)}」`);
  }
  if (entry.cwdExists === false) {
    add(REASON.ORPHAN, `目录不存在：${entry.cwd}`);
  }
  if (size > blankMaxBytes && size <= tinyMaxBytes && age >= oldDays) {
    add(REASON.TINY_OLD, `${Math.max(1, age)} 天未动，仅 ${size} 字节`);
  }

  const score = reasons.reduce((sum, r) => sum + r.weight, 0);
  return {
    id: entry.id,
    junk: reasons.length > 0 && score >= threshold,
    score,
    protectedReason: null,
    reasons
  };
}

/** Aggregate counts for the summary strip. */
export function summarize(entries, options, now) {
  const byReason = {};
  let junk = 0;
  let junkBytes = 0;
  let totalBytes = 0;
  for (const entry of entries || []) {
    const verdict = entry.junk === undefined ? classifySession(entry, options, now) : { junk: entry.junk, reasons: entry.reasons || [] };
    totalBytes += Number.isFinite(entry.sizeBytes) ? entry.sizeBytes : 0;
    if (verdict.junk) {
      junk += 1;
      junkBytes += Number.isFinite(entry.sizeBytes) ? entry.sizeBytes : 0;
    }
    for (const reason of verdict.reasons) {
      byReason[reason.code] = (byReason[reason.code] || 0) + 1;
    }
  }
  return {
    total: (entries || []).length,
    junk,
    junkBytes,
    totalBytes,
    byReason
  };
}
