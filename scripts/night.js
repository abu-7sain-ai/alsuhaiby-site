// night.js — LINE 1 (PREP), on his PC: `npm run night`. Free except Gemini (~$0.01 per video).
// For each archive video (highest views first) that the ledger has not handled yet:
//   1. download with yt-dlp (his PC)              2. Gemini watches it (OpenRouter, cached = never paid twice)
//   3. dedup against live + queued pages + the videos being written right now (Claude)
//      → duplicate of a queued page: embed · duplicate of a LIVE page: held for the daily job · skip: not an article
//   4. new topic: Claude (his subscription) writes the Arabic article (target 1250–1350 words, up to 2 resizes), reviews it
//      twice, strictly; under 1150 after review → one expand pass + fact-check of the added sentences only;
//      still outside 1150–1400 → held in the library (ledger «held-length»), never queued
//   5. MP4 → R2, page → queue/<id>/ (published later by the cloud job, N per day). The prep line publishes NOTHING.
//   6. commit both repos after EVERY video, push the library every video, push the site every 10 videos and at the stop.
//
// Parallel (owner, 2026-11-11): `--concurrency N` (default `nightConcurrency` in config/site.json, else 1) videos at a time.
// Shared files have ONE writer at a time (withLock in lib/common.js): ledger, spend log, run state, queue, each git repo.
// Clean resume: at every start, everything that belongs to an unfinished video is discarded (kept aside in
// %TEMP%\alsuhaiby-discarded\<time>\), except the paid Gemini analysis. Every file is written whole or not at all.
//
//   npm run night                       run until the archive is done (or Claude's limit / TikTok / the machine stops it)
//   npm run night -- --limit 3          stop after 3 videos
//   npm run night -- --ids a,b          only these videos
//   npm run night -- --until 14:30      Kuwait clock: no new video after 14:30 minus --margin (default 4) min; at 14:30 any
//                                       video still running is ended and discarded cleanly (it is redone next run)
//   npm run night -- --minutes=60       time limit from the start (same clean stop)
//   npm run night -- --telegram-at-stop exactly ONE Telegram message when the run stops (written / remaining); nothing before
//   npm run night -- --dry-run          show what it would do (no download, no paid call, no push)
//   Claude subscription limit → stop at once: open calls are ended, no retry, no paid fallback, the stop point goes to
//   data/run-night.json + data/status.json → lastNight. Restart is by hand.
//   Machine guard: before every video each worker obeys scripts/machine/watcher.py (slow → wait · pause → wait · stop → stop).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ROOT, LIB_DIR, args, cachePath, readJson, writeJson, setLedger, loadLedger, DONE, ClaudeLimitError, StopError, SkipError, runFlags, killChildren, killFor, withLock, lockStats } from './lib/common.js';
import { writeArticle, reviewArticle, expandArticle, lengthOk, LIMITS } from './lib/article.js';
import { checkPublishable, publishData } from './lib/publishable.js';
import { download, analyze, decide, mergeInto, prepareHeldMerge, queuePage, remaining, queued, gitSync, RateLimitError } from './lib/pipeline.js';
import { QUEUE } from './lib/page.js';
import { guard, alert } from './lib/status.js';
import { machineGate, MachineStopError, setStage, startStage } from './lib/machine.js';
guard('night');

const A = args();
const DRY = !!A['dry-run'];
const LIMIT = A.limit ? Number(A.limit) : Infinity;
const CLAUDE = 'claude-cli';
const CFG = readJson(`${ROOT}/config/site.json`, {});
const CONC = Math.max(1, Number(A.concurrency ?? CFG.nightConcurrency ?? 1) || 1);
const MAX_MIN = Number(A.minutes ?? CFG.maxMinutes ?? 0) || 0;
const TG_AT_STOP = !!A['telegram-at-stop'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startedAt = new Date();
// hard stop time (epoch ms): --until HH:MM Kuwait clock, or --minutes from the start
let hardStop = Infinity;
if (A.until) {
  const [h, m] = String(A.until).split(':').map(Number);
  const k = new Date(Date.now() + 3 * 3600e3); // Kuwait = UTC+3, no daylight saving
  hardStop = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), h - 3, m);
  if (hardStop <= Date.now()) hardStop += 24 * 3600e3;
}
if (MAX_MIN) hardStop = Math.min(hardStop, startedAt.getTime() + MAX_MIN * 60e3);
const lastStart = hardStop - Number(A.margin ?? 4) * 60e3; // no new video starts after this
const kt = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuwait', hour: '2-digit', minute: '2-digit' });

const LOG = `${ROOT}/data/run-night.log`, PROGRESS = `${ROOT}/data/run-night.json`;
for (const k of ['log', 'warn', 'error']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { orig(...a); try { fs.appendFileSync(LOG, a.map(String).join(' ') + '\n'); } catch {} };
}

// ---- clean start: discard everything of unfinished videos (keep only the paid analysis) -------------------------------
const PARTIAL = ['write.ar', 'review.ar', 'final.ar', 'expand.ar', 'dedup'];
const BIN = path.join(os.tmpdir(), 'alsuhaiby-discarded', startedAt.toISOString().replace(/[:.]/g, '-'));
function discard(id, why) {
  const moved = [];
  const keep = (src, name) => { const dst = path.join(BIN, String(id), name); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.cpSync(src, dst, { recursive: true }); fs.rmSync(src, { recursive: true, force: true }); moved.push(name); };
  for (const k of PARTIAL) { const p = cachePath(id, k); if (fs.existsSync(p)) keep(p, `${k}.json`); }
  const vdir = path.dirname(cachePath(id, 'x'));
  if (fs.existsSync(vdir)) for (const f of fs.readdirSync(vdir)) if (f.endsWith('.tmp')) keep(path.join(vdir, f), f);
  const tmpQ = path.join(QUEUE, `.tmp-${id}`);
  if (fs.existsSync(tmpQ)) keep(tmpQ, 'queue-tmp');
  if (fs.existsSync(path.join(QUEUE, String(id))) && loadLedger()[id]?.status !== 'queued') keep(path.join(QUEUE, String(id)), 'queue');
  if (moved.length) console.log(`  discarded ${id} (${why}): ${moved.join(', ')}`);
  return moved.length;
}
function cleanStart() {
  const ledger = loadLedger();
  let n = 0;
  const vids = fs.existsSync(path.join(LIB_DIR, 'videos')) ? fs.readdirSync(path.join(LIB_DIR, 'videos')) : [];
  for (const id of vids) if (!DONE.has(ledger[id]?.status)) n += discard(id, 'unfinished') ? 1 : 0;
  if (fs.existsSync(QUEUE)) for (const d of fs.readdirSync(QUEUE)) if (d.startsWith('.tmp-')) n += discard(d.slice(5), 'half-built page') ? 1 : 0;
  for (const dir of [path.join(ROOT, 'data'), LIB_DIR]) for (const f of fs.readdirSync(dir)) if (/\.\d+\.[a-z0-9]+\.tmp$/.test(f)) { fs.rmSync(path.join(dir, f), { force: true }); n++; }
  console.log(`clean start: ${n} unfinished item(s) discarded${n ? ` (kept aside in ${BIN})` : ''}; paid analyses kept`);
}

// pages the cloud published since the last night run: record them in the ledger
for (const [id, e] of Object.entries(readJson(`${ROOT}/data/published.json`, {}))) if (loadLedger()[id]?.status !== 'published') setLedger(id, { status: 'published', page: e.slug, line: e.line || 'night → cloud' });
if (!DRY) cleanStart();

let todo = remaining().sort((a, b) => b.views - a.views);
if (A.ids) { const want = String(A.ids).split(','); todo = todo.filter((v) => want.includes(v.id)); }
const ledger0 = loadLedger();
todo = todo.filter((v) => ledger0[v.id]?.status !== 'failed'); // NEVER WAIT (2026-11-11): a video that failed once is never retried automatically
{ const data = publishData(); const blocked = todo.filter((v) => !checkPublishable(v.id, data, { needFile: false }).ok);
  if (blocked.length) console.log(`night: ${blocked.length} video(s) left out — incomplete data, never published: ${blocked.map((v) => v.id).slice(0, 10).join(', ')}${blocked.length > 10 ? ' …' : ''}`);
  todo = todo.filter((v) => !blocked.includes(v)); }

console.log(`night: ${todo.length} videos to handle · concurrency ${CONC} · queue ${queued().length} · library ${LIB_DIR} · stop ${Number.isFinite(hardStop) ? `${kt(hardStop)} Kuwait (last start ${kt(lastStart)})` : 'none'}`);
if (DRY) {
  for (const v of todo.slice(0, Number.isFinite(LIMIT) ? LIMIT : 10)) console.log(`  would do ${v.id} · ${v.views.toLocaleString('en')} views · ${v.date}`);
  console.log('dry run: nothing downloaded, paid, written or pushed.');
  process.exit(0);
}

// ---- run state -----------------------------------------------------------------------------------------------------------
const done = { queued: [], merged: [], skipped: [], held: [], failed: [], discarded: [] }; // failed = «معلّقة» (deferred): { id, step, reason }
const VIDEO_CAP_MS = Number(A['video-cap'] ?? 15) * 60e3; // owner (2026-11-11): 15 minutes per video, then it is set aside
const stepOf = new Map(); // id → the step it is on (for the «معلّقة» list)
const timings = []; // { id, startedAt, minutes, result }
let stopReason = '', stopKind = '', backoff = 0, failStreak = 0, netStreak = 0, started = 0, sitePending = 0;
// owner (2026-11-11): a network error sets only that video aside and does NOT count toward «3 failures in a row»;
// 10 network errors in a row (no success in between) = the network is down → stop the run, Telegram «network down».
const NET_MAX = 10;
const isNetworkError = (e) => /fetch failed|network|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|socket hang up|getaddrinfo|Could not resolve host|unable to access/i.test(`${e?.message || ''} ${e?.cause?.code || ''} ${e?.cause?.message || ''}`);
const finished = () => done.queued.length + done.merged.length + done.skipped.length + done.held.length + done.failed.length;
function saveProgress(extra = {}) {
  withLock('run-state', () => {
    const hours = Math.max((Date.now() - startedAt) / 3600e3, 1 / 60), n = finished();
    writeJson(PROGRESS, {
      startedAt: startedAt.toISOString(), updatedAt: new Date().toISOString(), minutes: Math.round(hours * 60), concurrency: CONC,
      processed: n, written: done.queued.length, merged: done.merged.length, skipped: done.skipped.length, held: done.held.length, failed: done.failed.length, discarded: done.discarded.length,
      perHour: Math.round((n / hours) * 10) / 10, writtenPerHour: Math.round((done.queued.length / hours) * 10) / 10,
      archiveLeft: remaining().length, queueWaiting: queued().length, hardStop: Number.isFinite(hardStop) ? new Date(hardStop).toISOString() : null,
      running: true, stopped: null, locks: lockStats, timings, ...extra, details: done,
    });
  });
}
function stop(kind, reason) {
  if (stopKind) return;
  stopKind = kind; stopReason = reason; runFlags.stopping = true;
  console.warn(`  ⛔ stopping: ${reason}`);
  killChildren(); // end open Claude calls now: no retry, no fallback; their videos are discarded below
}
const timer = Number.isFinite(hardStop) ? setTimeout(() => stop('time', `time limit reached (${kt(hardStop)} Kuwait)`), Math.max(0, hardStop - Date.now())) : null;

// dedup in a parallel run: one decision at a time, and every decision sees the videos being written right now
const inflight = new Map(); // id → { id, topic }
let dedupChain = Promise.resolve();
const dedupLock = (fn) => { const p = dedupChain.then(fn, fn); dedupChain = p.catch(() => {}); return p; };
const deferred = new Map(); // id → times put back because it repeats a video still being written

function pushSite(msg, force = false) {
  sitePending++;
  const push = force || sitePending >= 10;
  gitSync(ROOT, ['queue', 'content/videos', 'public/covers', 'public/og', 'data/r2.json', 'data/spend.json'], msg, { push });
  if (push) sitePending = 0;
}

async function handle(v) {
  const alive = () => { if (runFlags.aborted.has(v.id)) throw new SkipError('15-minute cap reached', stepOf.get(v.id)); if (runFlags.stopping) throw new StopError('stopping'); };
  const at = (stage) => { alive(); stepOf.set(v.id, stage); setStage(stage, { current: [...inflight.keys(), v.id].join(','), left: todo.length }); };
  const t0 = Date.now();
  console.log(`\n[${new Date().toLocaleTimeString('en-GB')}] ${v.id} · ${v.views.toLocaleString('en')} views`);
  const hadFile = !!v.path;
  at('downloading');
  download(v);
  backoff = 0;
  at('analyzing');
  const an = await analyze(v, { script: 'night' });
  at('deciding');
  const d = await dedupLock(async () => {
    const others = [...inflight.values()].filter((x) => x.id !== v.id);
    const r = await decide({ v, an, model: CLAUDE, script: 'night', inflight: others });
    if (r.decision === 'new') inflight.set(v.id, { id: v.id, topic: an.topic || an.hook || '' });
    return r;
  });
  let result;
  if (d.decision === 'duplicate' && d.page?.where === 'inflight') {
    // repeats a video another worker is writing right now: put it back; it is decided again once that page is queued
    const n = (deferred.get(v.id) || 0) + 1; deferred.set(v.id, n);
    console.log(`  repeats ${d.page.id}, still being written — put back (${n})`);
    if (n <= 3) { todo.push(v); return 'deferred'; }
    d.decision = 'new'; inflight.set(v.id, { id: v.id, topic: an.topic || '' });
  }
  alive();
  if (d.decision === 'skip') {
    setLedger(v.id, { status: 'skipped', reason: d.reason, line: 'night' });
    done.skipped.push(v.id); console.log(`  skip: ${d.reason}`); result = 'skipped';
  } else if (d.decision === 'duplicate' && d.page.where !== 'queue') {
    // owner (2026-11-11): the prep line publishes NOTHING; a repeat of a LIVE page is held and embedded by the daily job
    prepareHeldMerge(d.page, v, an);
    setLedger(v.id, { status: 'merge-held', page: d.page.slug, reason: d.reason, line: 'night' });
    done.merged.push(`${v.id} → ${d.page.slug} (held: live page)`); console.log(`  duplicate of LIVE page ${d.page.slug} — held for the daily job: ${d.reason}`); result = 'merge-held';
  } else if (d.decision === 'duplicate') {
    withLock('queue', () => mergeInto(d.page, v, an));
    setLedger(v.id, { status: 'merged', page: d.page.slug, reason: d.reason, line: 'night' });
    done.merged.push(`${v.id} → ${d.page.slug}`); console.log(`  merged into queued page ${d.page.slug}: ${d.reason}`); result = 'merged';
  } else {
    const key = `tk-${v.id}`;
    at('writing');
    const draft = await writeArticle({ key, id: v.id, an, v, model: CLAUDE, script: 'night' });
    writeJson(cachePath(v, 'write.ar'), draft);
    at('reviewing');
    const { review, final: reviewed } = await reviewArticle({ key, id: v.id, an, draft, model: CLAUDE, script: 'night' });
    const { final, expand } = await expandArticle({ key, id: v.id, an, final: reviewed, model: CLAUDE, script: 'night' });
    if (expand) { review.expand = expand; review.wordsAfter = final.words; }
    alive();
    writeJson(cachePath(v, 'review.ar'), review);
    writeJson(cachePath(v, 'final.ar'), final);
    if (!lengthOk(final.words)) {
      setLedger(v.id, { status: 'held-length', words: final.words, reason: `final ${final.words} words, outside ${LIMITS.join('–')} after every pass`, line: 'night', score: review.total });
      done.held.push(`${v.id} (${final.words} words)`); console.log(`  held: ${final.words} words, outside ${LIMITS.join('–')}`); result = 'held-length';
    } else {
      const slug = queuePage(v, final);
      setLedger(v.id, { status: 'queued', page: slug, reason: d.reason, line: 'night', words: final.words, score: review.total });
      done.queued.push(`${slug} (${final.words} words, ${review.total}/60)`); console.log(`  queued: ${slug} (${final.words} words)`); result = 'queued';
    }
  }
  at('pushing');
  const st = loadLedger()[v.id].status;
  gitSync(LIB_DIR, ['.'], `night: ${v.id} ${st}`); // library: commit + push every video
  pushSite(`night: ${v.id} ${st}`);                 // site: commit every video, push every 10
  timings.push({ id: v.id, startedAt: new Date(t0).toISOString(), minutes: Math.round((Date.now() - t0) / 6e3) / 10, result });
  saveProgress();
  if (!hadFile) await sleep(4000 + Math.random() * 4000); // be gentle with TikTok between downloads
  return result;
}

async function worker(w) {
  while (!stopKind) {
    if (started >= LIMIT) return;
    if (Date.now() >= lastStart) { if (Date.now() < hardStop) console.log(`  worker ${w}: no new video after ${kt(lastStart)}`); return; }
    try {
      await Promise.race([machineGate(), new Promise((_, rej) => setTimeout(() => rej(new StopError('time')), Math.max(0, hardStop - Date.now())))]);
    } catch (e) {
      if (e instanceof MachineStopError) { stop('machine', e.message); return; }
      if (e instanceof StopError) return;
      throw e;
    }
    if (stopKind || Date.now() >= lastStart) return;
    const v = todo.shift();
    if (!v) return;
    started++;
    try {
      // the 15-minute cap: the video's Claude calls are ended, its files set aside, and the worker takes the next video
      let capTimer;
      const job = handle(v);
      job.catch(() => {}); // after the cap, the cut-off job only ends with an error; nothing waits for it
      await Promise.race([job, new Promise((_, rej) => { capTimer = setTimeout(() => { runFlags.aborted.add(v.id); killFor(v.id); rej(new SkipError(`over ${VIDEO_CAP_MS / 60e3} minutes (something stalled)`, stepOf.get(v.id))); }, VIDEO_CAP_MS); })]).finally(() => clearTimeout(capTimer));
      failStreak = 0; netStreak = 0;
    } catch (e) {
      inflight.delete(v.id);
      if (e instanceof ClaudeLimitError) { stop('claude-limit', e.message); discard(v.id, 'stopped mid-video'); done.discarded.push(v.id); continue; }
      if (e instanceof StopError || runFlags.stopping) { discard(v.id, 'stopped mid-video'); done.discarded.push(v.id); continue; } // ledger untouched: redone next run
      if (e instanceof RateLimitError) { backoff++; if (backoff >= 3) stop('tiktok', `TikTok rate-limited this PC 3 times in a row (${e.message}). Stopped; run again later.`); }
      // NEVER WAIT: the first failure or stall sets the video aside («معلّقة»), no retry; the step and reason are kept for a human
      const step = e.step || stepOf.get(v.id) || 'unknown';
      const net = !(e instanceof SkipError) && isNetworkError(e);
      discard(v.id, 'set aside');
      setLedger(v.id, { status: 'deferred', step, reason: e.message.slice(0, 300), line: 'night', deferredAt: new Date().toISOString(), ...(net ? { network: true } : {}) });
      done.failed.push({ id: v.id, step, reason: e.message.slice(0, 160) }); console.warn(`  – معلّقة: ${v.id} at «${step}»: ${e.message}`);
      try { gitSync(LIB_DIR, ['.'], `night: ${v.id} failed`); } catch {}
      saveProgress();
      if (net) { if (++netStreak >= NET_MAX) stop('network', `${NET_MAX} network errors in a row; last: ${e.message.slice(0, 150)}`); }
      else if (!(e instanceof SkipError) && (netStreak = 0, ++failStreak >= 3)) stop('errors', `3 videos failed in a row; last error: ${e.message.slice(0, 150)}`);
    } finally {
      inflight.delete(v.id); stepOf.delete(v.id);
    }
  }
}

fs.appendFileSync(LOG, `\n===== night run ${startedAt.toISOString()} · concurrency ${CONC} =====\n`);
saveProgress();
await startStage('night', { left: todo.length });
await Promise.all(Array.from({ length: CONC }, (_, i) => sleep(i * 15000).then(() => worker(i + 1)))); // staggered start
if (timer) clearTimeout(timer);
if (!stopKind && Number.isFinite(hardStop) && Date.now() >= lastStart) { stopKind = 'time'; stopReason = `time limit (${kt(hardStop)} Kuwait)`; }

// final commit + push of both repos (the site may have up to 9 unpushed commits)
try { gitSync(LIB_DIR, ['.'], 'night: end of run'); } catch (e) { console.warn(`  ! final push (library): ${e.message}`); }
try { gitSync(ROOT, ['queue', 'content/videos', 'public/covers', 'public/og', 'data/r2.json', 'data/spend.json'], 'night: end of run', { push: true }); } catch (e) { console.warn(`  ! final push (site): ${e.message}`); }
// owner (2026-11-11): the stop message names the reason plainly: session limit · weekly limit · time (or what else stopped it)
function reasonLabel() {
  if (stopKind === 'claude-limit') return /week/i.test(stopReason) ? 'weekly limit' : 'session limit';
  if (stopKind === 'time') return 'time';
  if (!stopKind) return 'backlog finished';
  return { machine: 'machine guard', tiktok: 'TikTok block', errors: '3 failures in a row', network: 'network down' }[stopKind] || stopKind;
}
const left = remaining().length;
const lines = [
  `🌙 alsuhaiby.com — prep run ${stopReason ? 'stopped' : 'finished'} (${CONC} at a time)`,
  `written ${done.queued.length} · merged/held merges ${done.merged.length} · skipped ${done.skipped.length} · held (length) ${done.held.length} · معلّقة ${done.failed.length} · discarded mid-video ${done.discarded.length}`,
  `remaining in the archive: ${left} · waiting in queue: ${queued().length}`,
  `stop reason: ${reasonLabel()}`,
  ...(stopReason ? [`detail: ${stopReason.slice(0, 200)}`] : []),
  ...(done.failed.length ? ['معلّقة (الرقم · الخطوة · السبب):', ...done.failed.slice(0, 10).map((f) => `⚠️ ${f.id} · ${f.step} · ${f.reason.slice(0, 80)}`)] : []),
];
console.log(`\n${lines.join('\n')}`);
const st = readJson(`${ROOT}/data/status.json`, {});
saveProgress({ running: false, stopped: stopKind || null, stopReason: stopReason || null, stoppedAt: new Date().toISOString() });
st.lastNight = { ...readJson(PROGRESS, {}), at: new Date().toISOString() };
writeJson(`${ROOT}/data/status.json`, st);
setStage('idle', { current: null, left, stopped: stopKind || null });
if (TG_AT_STOP) alert(lines.join('\n')); // owner (2026-11-11): silence while running, ONE message at the stop
else if (done.failed.length || stopKind === 'tiktok' || stopKind === 'machine') {
  alert(['⚠️ alsuhaiby.com — تشغيل الليل', ...(stopKind === 'tiktok' ? ['⚠️ تيك توك حدّ الجهاز ووقف التحميل. شغّله بعدين.'] : []), ...(stopKind === 'machine' ? [`⛔ ${stopReason}`] : []), ...done.failed.slice(0, 5).map((f) => `⚠️ ${f.id} · ${f.step} · ${f.reason.slice(0, 80)}`)].join('\n'));
}
process.exit(0);
