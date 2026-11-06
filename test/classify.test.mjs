import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REASON,
  ageDays,
  classifySession,
  matchesJunkTitle,
  normalizeTitle,
  summarize
} from '../lib/classify.js';
import { normalizeConfig } from '../lib/config.js';

const NOW = 1_800_000_000_000; // fixed clock for deterministic ages
const DAY = 86400000;

function config(overrides = {}) {
  return normalizeConfig(overrides);
}

function base(overrides = {}) {
  return {
    id: 'session-a',
    createdAt: NOW - 2 * DAY,
    sizeBytes: 200_000,
    cwd: 'C:\\work',
    cwdExists: true,
    title: 'real work',
    parentSession: '',
    delegationDepth: 0,
    live: false,
    pinned: false,
    archived: false,
    ...overrides
  };
}

test('normalizeTitle collapses whitespace and normalizeConfig fills defaults', () => {
  assert.equal(normalizeTitle('  hello\n  world  '), 'hello world');
  const cfg = config();
  assert.equal(cfg.threshold, 20);
  assert.equal(cfg.blankMaxBytes, 1200);
  assert.equal(cfg.oldDays, 30);
  assert.equal(cfg.includeSubagents, true);
  assert.ok(cfg.titlePatterns.length >= 2);
});

test('a normal recent session is not junk', () => {
  const verdict = classifySession(base(), config(), NOW);
  assert.equal(verdict.junk, false);
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.protectedReason, null);
});

test('header-only log is a blank session', () => {
  const verdict = classifySession(base({ sizeBytes: 420, title: '' }), config(), NOW);
  assert.equal(verdict.junk, true);
  assert.ok(verdict.reasons.some((reason) => reason.code === REASON.BLANK));
  assert.equal(verdict.score, 50);
});

test('missing working directory is an orphan', () => {
  const verdict = classifySession(base({ cwdExists: false }), config(), NOW);
  assert.equal(verdict.junk, true);
  assert.ok(verdict.reasons.some((reason) => reason.code === REASON.ORPHAN));
});

test('junk titles match whole titles only', () => {
  const cfg = config();
  assert.equal(matchesJunkTitle('测试', cfg.titlePatterns), true);
  assert.equal(matchesJunkTitle('asdf', cfg.titlePatterns), true);
  assert.equal(matchesJunkTitle('123', cfg.titlePatterns), true);
  assert.equal(matchesJunkTitle('测试一下 PPT 模板', cfg.titlePatterns), false, 'substring must not match');
  assert.equal(matchesJunkTitle('test plan for the report', cfg.titlePatterns), false);
});

test('test title flags a session but not when it is otherwise normal-sized', () => {
  const verdict = classifySession(base({ title: 'test' }), config(), NOW);
  assert.equal(verdict.reasons.some((reason) => reason.code === REASON.TEST_TITLE), true);
  assert.equal(verdict.junk, true);
});

test('subagent sessions are candidates only while includeSubagents is on', () => {
  const withSub = classifySession(base({ parentSession: 'session-parent' }), config(), NOW);
  assert.ok(withSub.reasons.some((reason) => reason.code === REASON.SUBAGENT));

  const off = classifySession(base({ parentSession: 'session-parent' }), config({ includeSubagents: false }), NOW);
  assert.equal(off.junk, false);
});

test('tiny old sessions become weak candidates after oldDays', () => {
  const fresh = classifySession(base({ sizeBytes: 9000, createdAt: NOW - 5 * DAY }), config(), NOW);
  assert.equal(fresh.junk, false);

  const old = classifySession(base({ sizeBytes: 9000, createdAt: NOW - 40 * DAY }), config(), NOW);
  assert.equal(old.junk, true);
  assert.ok(old.reasons.some((reason) => reason.code === REASON.TINY_OLD));
});

test('live and pinned sessions are protected regardless of score', () => {
  const live = classifySession(base({ sizeBytes: 300, live: true }), config(), NOW);
  assert.equal(live.junk, false);
  assert.equal(live.protectedReason, REASON.LIVE);

  const pinned = classifySession(base({ sizeBytes: 300, pinned: true }), config(), NOW);
  assert.equal(pinned.junk, false);
  assert.equal(pinned.protectedReason, REASON.PINNED);
});

test('threshold is configurable and gates weak reasons', () => {
  const weakOnly = base({ sizeBytes: 9000, createdAt: NOW - 40 * DAY });
  assert.equal(classifySession(weakOnly, config({ threshold: 20 }), NOW).junk, true);
  assert.equal(classifySession(weakOnly, config({ threshold: 100 }), NOW).junk, false);
});

test('ageDays never returns a negative age', () => {
  assert.equal(ageDays(NOW + DAY, NOW), 0);
  assert.equal(ageDays(0, NOW), 0);
  assert.equal(ageDays(NOW - 3 * DAY, NOW), 3);
});

test('summarize counts junk, bytes and per-reason totals', () => {
  const entries = [
    { ...base({ id: 'a', sizeBytes: 400 }), junk: true, reasons: [{ code: REASON.BLANK, label: 'blank', weight: 50, detail: '' }] },
    { ...base({ id: 'b', sizeBytes: 2000 }), junk: false, reasons: [] },
    { ...base({ id: 'c', sizeBytes: 500 }), junk: true, reasons: [{ code: REASON.BLANK, label: 'blank', weight: 50, detail: '' }] }
  ];
  const stats = summarize(entries, config(), NOW);
  assert.equal(stats.total, 3);
  assert.equal(stats.junk, 2);
  assert.equal(stats.junkBytes, 900);
  assert.equal(stats.totalBytes, 2900);
  assert.equal(stats.byReason[REASON.BLANK], 2);
});
