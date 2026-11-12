// Tests: the audited gate on publishing and the daily-audit quota maths. Fakes only; the real library/queue are never touched.
//   node --test scripts/test-audit-gate.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alsuhaiby-audittest-'));
process.env.LIB_DIR = tmp;
const { isAudited, auditData } = await import('./lib/publishable.js');
const { plan, after, kuwaitDay, PER_DAY, CAP } = await import('./lib/audit-quota.js');

test('only changed|clean count as audited', () => {
  const a = { c: { status: 'changed' }, k: { status: 'clean' }, s: { status: 'skipped' }, d: { status: 'deferred' } };
  assert.equal(isAudited('c', a), true); assert.equal(isAudited('k', a), true);
  assert.equal(isAudited('s', a), false); assert.equal(isAudited('d', a), false); assert.equal(isAudited('none', a), false);
  assert.equal(isAudited('c', null), false, 'library not reachable → nothing audited');
});
test('audit list missing → null', () => assert.equal(auditData({ libDir: tmp }), null));
test('publishQueued refuses an unaudited article (before touching any file)', async () => {
  fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify({ x1: { has_video_file: true, stats: { likes: 1, comments: 1, saves: 1 } } }));
  fs.writeFileSync(path.join(tmp, 'audit.json'), JSON.stringify({ x1: { status: 'deferred' } }));
  const { publishQueued } = await import('./lib/pipeline.js');
  const { PublishBlockedError } = await import('./lib/publishable.js');
  assert.throws(() => publishQueued('x1'), PublishBlockedError);
});
test('first run owes one day (7)', () => assert.equal(plan({}, '2026-11-13').owed, 7));
test('today already done → skip', () => assert.equal(plan({ lastDoneDate: '2026-11-13' }, '2026-11-13').skip, true));
test('a missed day adds 7, three missed days hit the cap of 21', () => {
  assert.equal(plan({ lastAccrual: '2026-11-13', lastDoneDate: '2026-11-13' }, '2026-11-14').owed, 7);
  assert.equal(plan({ lastAccrual: '2026-11-13', lastDoneDate: '2026-11-13' }, '2026-11-16').owed, 21);
  assert.equal(plan({ lastAccrual: '2026-11-13', lastDoneDate: '2026-11-13' }, '2026-11-25').owed, CAP, 'never above 21');
});
test('a cut-short day keeps its debt; a restart the same day does not accrue twice', () => {
  const p1 = plan({}, '2026-11-13'); const s1 = after({}, p1, 3, 100, '2026-11-13');
  assert.equal(s1.done, false); assert.equal(s1.owed, 4); assert.equal(s1.lastDoneDate, undefined);
  const p2 = plan(s1, '2026-11-13'); assert.equal(p2.owed, 4, 'same day: no new accrual');
  const s2 = after(s1, p2, 4, 96, '2026-11-13'); assert.equal(s2.done, true); assert.equal(s2.lastDoneDate, '2026-11-13');
});
test('nothing left to audit marks the day done', () => assert.equal(after({}, plan({}, '2026-11-13'), 0, 0, '2026-11-13').done, true));
test('Kuwait day is UTC+3', () => { assert.equal(kuwaitDay(Date.parse('2026-11-12T21:30:00Z')), '2026-11-13'); assert.equal(PER_DAY, 7); });
