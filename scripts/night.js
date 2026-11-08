// night.js — LINE 1 (PREP), on his PC: `npm run night`. Free except Gemini (~$0.01 per video).
// For each archive video (highest views first) that the ledger has not handled yet:
//   1. download with yt-dlp (his PC)              2. Gemini watches it (OpenRouter, cached)
//   3. dedup against live + queued pages (Claude) → duplicate: embed on that page · skip: not an article
//   4. new topic: Claude (his subscription) writes the Arabic article and reviews it twice, strictly
//   5. MP4 → R2, page → queue/<id>/ (published later by the cloud job, N per day)
//   6. commit + push both repos after EVERY video → stoppable any time (Ctrl+C), nothing lost, nothing paid twice.
//   Telegram: ⚠️ only (failed videos, TikTok block). Nothing on success; the result goes to data/status.json → lastNight.
//   npm run night                    run until the archive is done (or Claude's limit / TikTok stops it)
//   npm run night -- --limit 3       stop after 3 videos
//   npm run night -- --ids a,b       only these videos
//   npm run night -- --dry-run       show what it would do (no download, no paid call, no push)
//   Machine guard: before every video it obeys scripts/machine/watcher.py (data/machine.json): slow → 2 min wait · pause → waits
//   until the PC recovers · stop (free disk < 5 GB) → stops cleanly + ONE Telegram ⚠️. Never shuts the PC down.
//   npm run night -- --minutes=60   time limit: when it is reached, the video in progress is finished, then the run stops
//                                    cleanly (not an error). Default: `maxMinutes` in config/site.json; 0 or empty = no limit.
import fs from 'node:fs';
import { ROOT, LIB_DIR, args, cachePath, readJson, writeJson, setLedger, loadLedger, DONE, ClaudeLimitError } from './lib/common.js';
import { writeArticle, reviewArticle } from './lib/article.js';
import { download, analyze, decide, mergeInto, queuePage, remaining, queued, gitSync, RateLimitError } from './lib/pipeline.js';
import { guard, alert } from './lib/status.js';
import { machineGate, MachineStopError, setStage, startStage } from './lib/machine.js';
guard('night');

const A = args();
const DRY = !!A['dry-run'];
const LIMIT = A.limit ? Number(A.limit) : Infinity;
const CLAUDE = 'claude-cli';
// Time limit in minutes: the --minutes flag wins over config/site.json → maxMinutes; 0 / empty / missing = unlimited.
const MAX_MIN = Number(A.minutes ?? readJson(`${ROOT}/config/site.json`, {}).maxMinutes ?? 0) || 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Everything printed also goes to data/run-night.log (not committed), and the running totals to data/run-night.json after
// every video — so the desktop window's summary (scripts/night-summary.js) is right even if the window is closed mid-run.
const LOG = `${ROOT}/data/run-night.log`, PROGRESS = `${ROOT}/data/run-night.json`;
for (const k of ['log', 'warn', 'error']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { orig(...a); try { fs.appendFileSync(LOG, a.map(String).join(' ') + '\n'); } catch {} };
}
const startedAt = new Date();
function saveProgress(extra = {}) {
  const hours = Math.max((Date.now() - startedAt) / 3600e3, 1 / 60);
  const n = done.queued.length + done.merged.length + done.skipped.length + done.failed.length;
  writeJson(PROGRESS, {
    startedAt: startedAt.toISOString(), updatedAt: new Date().toISOString(), minutes: Math.round(hours * 60),
    processed: n, written: done.queued.length, merged: done.merged.length, skipped: done.skipped.length, failed: done.failed.length,
    perHour: Math.round((n / hours) * 10) / 10, writtenPerHour: Math.round((done.queued.length / hours) * 10) / 10,
    archiveLeft: remaining().length, queueWaiting: queued().length, maxMinutes: MAX_MIN || null, running: true, stopped: null, ...extra, details: done,
  });
}

// pages the cloud published since the last night run: record them in the ledger
for (const [id, e] of Object.entries(readJson(`${ROOT}/data/published.json`, {}))) if (loadLedger()[id]?.status !== 'published') setLedger(id, { status: 'published', page: e.slug, line: e.line || 'night → cloud' });

let todo = remaining().sort((a, b) => b.views - a.views);
if (A.ids) { const want = String(A.ids).split(','); todo = todo.filter((v) => want.includes(v.id)); }
const ledger = loadLedger();
todo = todo.filter((v) => (ledger[v.id]?.tries || 0) < 3); // a video that failed 3 times waits for a human look

console.log(`night: ${todo.length} videos to handle · queue ${queued().length} · library ${LIB_DIR} · time limit ${MAX_MIN ? `${MAX_MIN} min` : 'none'}`);
if (DRY) {
  for (const v of todo.slice(0, Number.isFinite(LIMIT) ? LIMIT : 10)) {
    const steps = [v.path ? 'local file' : 'download', fs.existsSync(cachePath(v, 'analysis')) ? 'analysis cached' : 'Gemini analysis (~$0.01)', 'dedup (Claude)', 'write + 2 reviews (Claude) if new', 'R2 + queue + push'];
    console.log(`  would do ${v.id} · ${v.views.toLocaleString('en')} views · ${v.date} · ${steps.join(' → ')}`);
  }
  console.log('dry run: nothing downloaded, paid, written or pushed.');
  process.exit(0);
}

var done = { queued: [], merged: [], skipped: [], failed: [] };
let stopReason = '', stopKind = '', backoff = 0, failStreak = 0;
fs.appendFileSync(LOG, `\n===== night run ${startedAt.toISOString()} =====\n`);
saveProgress();
startStage('night', { left: todo.length });
for (const v of todo) {
  if (done.queued.length + done.merged.length + done.skipped.length + done.failed.length >= LIMIT) break;
  // time limit: checked only between videos, so the one in progress is always finished and pushed first
  if (MAX_MIN && Date.now() - startedAt >= MAX_MIN * 60e3) { stopReason = `time limit reached (${MAX_MIN} min)`; stopKind = 'time'; break; }
  // machine guard (his rule 2026-11-08): checked only between videos too, so the one in progress is finished and pushed first
  try { await machineGate(); } catch (e) {
    if (e instanceof MachineStopError) { stopReason = e.message; stopKind = 'machine'; console.warn(`  ⛔ ${e.message}`); break; }
    throw e;
  }
  const at = (stage) => setStage(stage, { current: v.id, left: remaining().length });
  console.log(`\n[${new Date().toLocaleTimeString('en-GB')}] ${v.id} · ${v.views.toLocaleString('en')} views`);
  try {
    const hadFile = !!v.path;
    at('downloading');
    download(v);
    backoff = 0;
    at('analyzing');
    const an = await analyze(v, { script: 'night' });
    at('deciding');
    const d = await decide({ v, an, model: CLAUDE, script: 'night' });
    if (d.decision === 'skip') {
      setLedger(v.id, { status: 'skipped', reason: d.reason, line: 'night' });
      done.skipped.push(v.id); console.log(`  skip: ${d.reason}`);
    } else if (d.decision === 'duplicate') {
      mergeInto(d.page, v, an);
      setLedger(v.id, { status: 'merged', page: d.page.slug, reason: d.reason, line: 'night' });
      done.merged.push(`${v.id} → ${d.page.slug}`); console.log(`  merged into ${d.page.where} page ${d.page.slug}: ${d.reason}`);
    } else {
      const key = `tk-${v.id}`;
      at('writing');
      const draft = readJson(cachePath(v, 'write.ar'), null) || await writeArticle({ key, id: v.id, an, v, model: CLAUDE, script: 'night' });
      writeJson(cachePath(v, 'write.ar'), draft);
      at('reviewing');
      const { review, final } = await reviewArticle({ key, id: v.id, an, draft, model: CLAUDE, script: 'night' });
      writeJson(cachePath(v, 'review.ar'), review);
      writeJson(cachePath(v, 'final.ar'), final);
      const slug = queuePage(v, final);
      setLedger(v.id, { status: 'queued', page: slug, reason: d.reason, line: 'night', words: final.words, score: review.total });
      done.queued.push(`${slug} (${final.words} words, ${review.total}/60)`); console.log(`  queued: ${slug}`);
    }
    at('pushing');
    gitSync(LIB_DIR, ['.'], `night: ${v.id} ${loadLedger()[v.id].status}`);
    gitSync(ROOT, ['queue', 'content/videos', 'public/covers', 'public/og', 'data/r2.json', 'data/spend.json'], `night: ${v.id} ${loadLedger()[v.id].status}`);
    failStreak = 0;
    saveProgress();
    if (!hadFile) await sleep(4000 + Math.random() * 4000); // be gentle with TikTok between downloads
  } catch (e) {
    if (e instanceof ClaudeLimitError) { stopReason = e.message; stopKind = 'claude-limit'; break; }
    if (e instanceof RateLimitError) {
      backoff++;
      console.warn(`  TikTok rate limit (${backoff}/3): ${e.message}`);
      if (backoff >= 3) { stopReason = `TikTok rate-limited this PC 3 times in a row (${e.message}). Stopped; run again later.`; stopKind = 'tiktok'; break; }
      await sleep(backoff * 5 * 60e3); // 5, then 10 minutes
      continue;
    }
    const tries = (loadLedger()[v.id]?.tries || 0) + 1;
    setLedger(v.id, { status: 'failed', tries, reason: e.message.slice(0, 300), line: 'night' });
    done.failed.push(`${v.id}: ${e.message.slice(0, 120)}`); console.warn(`  ! ${e.message}`);
    try { gitSync(LIB_DIR, ['.'], `night: ${v.id} failed`); } catch {}
    saveProgress();
    // 3 different videos failing in a row = something is broken (internet, a key, git): stop instead of burning the list
    if (++failStreak >= 3) { stopReason = `3 videos failed in a row; last error: ${e.message.slice(0, 150)}`; stopKind = 'errors'; break; }
  }
}

// final push of both repos (normally a no-op: every video is already pushed)
try { gitSync(LIB_DIR, ['.'], 'night: end of run'); } catch (e) { console.warn(`  ! final push (library): ${e.message}`); }
try { gitSync(ROOT, ['queue', 'content/videos', 'public/covers', 'public/og', 'data/r2.json', 'data/spend.json'], 'night: end of run'); } catch (e) { console.warn(`  ! final push (site): ${e.message}`); }
const left = remaining().length;
const lines = [
  `🌙 alsuhaiby.com — night run ${stopReason ? 'stopped' : 'finished'}`,
  `queued ${done.queued.length} · merged ${done.merged.length} · skipped ${done.skipped.length} · failed ${done.failed.length}`,
  `waiting in queue: ${queued().length} · archive left: ${left}`,
  ...(stopReason ? [`stopped: ${stopReason}`] : []),
  ...done.failed.slice(0, 5).map((f) => `⚠️ ${f}`),
];
console.log(`\n${lines.join('\n')}`);
// Telegram only when something needs him (his rule 2026-11-07): failed videos or a TikTok block. A normal end, or Claude's
// subscription limit (just run it again later), sends nothing. The result is kept in data/status.json → lastNight.
const st = readJson(`${ROOT}/data/status.json`, {});
saveProgress({ running: false, stopped: stopKind || null, stopReason: stopReason || null });
st.lastNight = { ...readJson(PROGRESS, {}), at: new Date().toISOString() };
writeJson(`${ROOT}/data/status.json`, st);
setStage('idle', { current: null, left, stopped: stopKind || null });
const tiktokBlock = stopKind === 'tiktok', machineStop = stopKind === 'machine';
// machine guard: Telegram ONLY on a full stop, never on slow / pause (his rule 2026-11-08)
if (done.failed.length || tiktokBlock || machineStop) {
  alert(['⚠️ alsuhaiby.com — تشغيل الليل', ...(tiktokBlock ? ['⚠️ تيك توك حدّ الجهاز ووقف التحميل. شغّله بعدين.'] : []), ...(machineStop ? [`⛔ ${stopReason}`] : []), ...done.failed.slice(0, 5).map((f) => `⚠️ ${f}`)].join('\n'));
}
