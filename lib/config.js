/**
 * Config normalization for dsh-session-janitor.
 *
 * The plugin deliberately exports no schemastery schema: it must load without
 * any @deepseek-ai runtime dependency so a `file:`-linked checkout and an npm
 * install behave identically. Options come from the composition entry; every
 * field is optional and defensive against wrong types.
 */

/** Default junk-title patterns (case-insensitive, whole-title match). */
export const DEFAULT_TITLE_PATTERNS = [
  '^(test|tests|testing|demo|tmp|temp|scratch|asdf|qwe|aaa+|abc|123+|0+|1+|hi|hello|hey|yo)$',
  '^(测试|临时|垃圾|随便|新会话|未命名|空会话|试试|试一下|test)$'
];

const DEFAULTS = {
  /** Sessions at or below this many bytes are header-only (≈0.4–0.5 KB on disk). */
  blankMaxBytes: 1200,
  /** Sessions at or below this size that are also older than `oldDays` are weak candidates. */
  tinyMaxBytes: 20480,
  /** Age in days that makes a tiny session a weak candidate. */
  oldDays: 30,
  /** Score at or above which a session counts as junk. */
  threshold: 20,
  /** Flag subagent sessions (parentSession/delegationDepth) as candidates. */
  includeSubagents: true,
  /** Never touch pinned sessions. */
  keepPinned: true,
  /** Never touch a live (running) session. */
  keepLive: true,
  /** Extra junk-title patterns appended to the defaults. */
  titlePatterns: [],
  /** How many sessions to fold titles for on one scan (0 disables). */
  titleResolveLimit: 200,
  /** Wall-clock budget for title folding, milliseconds. */
  titleResolveBudgetMs: 4000,
  /** Max sessions returned to the UI per scan. */
  listLimit: 1000,
  /** Max ids one clean/trash call accepts. */
  maxBatch: 50,
  /** Trash directory; empty means `$DSH_HOME/session-janitor/trash`. */
  trashDir: ''
};

/** Options the HTTP/tool layer is allowed to override at runtime. */
const RUNTIME_KEYS = ['threshold', 'oldDays', 'blankMaxBytes', 'tinyMaxBytes', 'includeSubagents'];

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function positiveInt(value, fallback) {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Turn a composition entry (possibly missing, possibly wrong) into a complete
 * option object. Unknown keys are dropped; known ones are type-checked.
 */
export function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const patterns = Array.isArray(input.titlePatterns)
    ? input.titlePatterns.filter(nonEmptyString).map((p) => String(p))
    : [];
  return {
    ...DEFAULTS,
    blankMaxBytes: positiveInt(input.blankMaxBytes, DEFAULTS.blankMaxBytes),
    tinyMaxBytes: positiveInt(input.tinyMaxBytes, DEFAULTS.tinyMaxBytes),
    oldDays: positiveInt(input.oldDays, DEFAULTS.oldDays),
    threshold: positiveInt(input.threshold, DEFAULTS.threshold),
    includeSubagents: bool(input.includeSubagents, DEFAULTS.includeSubagents),
    keepPinned: bool(input.keepPinned, DEFAULTS.keepPinned),
    keepLive: bool(input.keepLive, DEFAULTS.keepLive),
    titleResolveLimit: positiveInt(input.titleResolveLimit, DEFAULTS.titleResolveLimit),
    titleResolveBudgetMs: positiveInt(input.titleResolveBudgetMs, DEFAULTS.titleResolveBudgetMs),
    listLimit: positiveInt(input.listLimit, DEFAULTS.listLimit),
    maxBatch: positiveInt(input.maxBatch, DEFAULTS.maxBatch),
    trashDir: nonEmptyString(input.trashDir) ? input.trashDir.trim() : '',
    titlePatterns: [...DEFAULT_TITLE_PATTERNS, ...patterns]
  };
}

/**
 * Apply request-level overrides (from the UI or a tool call) on a normalized
 * config without letting callers reach destructive switches.
 */
export function withOverrides(config, overrides) {
  if (!overrides || typeof overrides !== 'object') return config;
  const next = { ...config };
  for (const key of RUNTIME_KEYS) {
    if (overrides[key] === undefined) continue;
    const value = overrides[key];
    if (key === 'includeSubagents') next[key] = bool(value, config[key]);
    else next[key] = positiveInt(value, config[key]);
  }
  return next;
}
