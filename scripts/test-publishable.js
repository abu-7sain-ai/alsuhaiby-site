// Tests for the owner's rule (2026-11-10): a video with incomplete data is never published.
// Fakes only: a temp library folder and fake records; the real library, queue and R2 are never touched.
//   node --test scripts/test-publishable.js      (npm test)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alsuhaiby-pubtest-'));
process.env.LIB_DIR = tmp; // must be set before the modules load
const nums = { views: 1000, likes: 10, comments: 2, shares: 1, saves: 3, source: 'test' };
const meta = {
  complete: { has_video_file: true, stats: nums },
  noFileFlag: { has_video_file: false, stats: nums },            // numbers but no file (like the 4 excluded videos)
  notOnR2: { stats: nums },
  noNumbers: { has_video_file: true },
  partialNumbers: { has_video_file: true, stats: { likes: 10, comments: null, saves: 3 } },
  removedButComplete: { has_video_file: true, status: 'removed_by_tiktok', stats: { views: null, likes: 1852, comments: 134, shares: null, saves: 718 } },
  excluded: { has_video_file: true, stats: nums, excludeFromPublishing: { reason: 'test' } },
};
fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify(meta));
const r2 = { complete: {}, noFileFlag: {}, noNumbers: {}, partialNumbers: {}, removedButComplete: {}, excluded: {} };
const { checkPublishable, assertPublishable, PublishBlockedError, numbersComplete } = await import('./lib/publishable.js');
const data = { meta, r2 };

test('a video with its file on R2 and its numbers is publishable', () => {
  assert.equal(checkPublishable('complete', data).ok, true);
});
test('has_video_file false blocks it, even when an R2 entry exists', () => {
  const c = checkPublishable('noFileFlag', data);
  assert.equal(c.ok, false); assert.match(c.reasons.join(), /has_video_file is false/);
});
test('no R2 object blocks it; a step that uploads the file itself may skip only that check', () => {
  assert.equal(checkPublishable('notOnR2', data).ok, false);
  assert.equal(checkPublishable('notOnR2', data, { needFile: false }).ok, true);
  assert.equal(checkPublishable('noFileFlag', data, { needFile: false }).ok, false); // a known missing file is never skipped
});
test('missing or partial numbers block it; shares and views may be null', () => {
  assert.equal(checkPublishable('noNumbers', data).ok, false);
  assert.equal(checkPublishable('partialNumbers', data).ok, false);
  assert.equal(numbersComplete({ likes: 1, comments: 0, saves: 0, shares: null, views: null }), true);
});
test('removed by TikTok is not by itself a reason: file + numbers = publishable', () => {
  assert.equal(checkPublishable('removedButComplete', data).ok, true);
});
test('excluded, unknown id, or no library = not publishable', () => {
  assert.equal(checkPublishable('excluded', data).ok, false);
  assert.equal(checkPublishable('nope', data).ok, false);
  assert.equal(checkPublishable('complete', { meta: null, r2 }).ok, false);
});
test('assertPublishable throws PublishBlockedError with the reasons', () => {
  assert.throws(() => assertPublishable('noFileFlag', data), (e) => e instanceof PublishBlockedError && /has_video_file is false/.test(e.message));
  assert.equal(assertPublishable('complete', data), true);
});
test('publishQueued refuses an incomplete video even if it sits in the queue, before touching any file', async () => {
  const { publishQueued } = await import('./lib/pipeline.js');
  assert.throws(() => publishQueued('noFileFlag'), PublishBlockedError);
  assert.throws(() => publishQueued('noNumbers'), PublishBlockedError);
});
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
