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
import fs from 'node:fs';
import { ROOT, LIB_DIR, args, cachePath, readJson, writeJson, setLedger, loadLedger, DONE, ClaudeLimitError } from './lib/common.js';
import { writeArticle, reviewArticle } from './lib/article.js';
import { download, analyze, decide, mergeInto, queuePage, remaining, queued, gitSync, RateLimitError } from './lib/pipeline.js';
import { guard, alert } from './lib/status.js';
guard('night');

const A = args();
const DRY = !!A['dry-run'];
const LIMIT = A.limit ? Number(A.limit) : Infinity;
const CLAUDE = 'claude-cli';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// pages the cloud published since the last night run: record them in the ledger
for (const [id, e] of Object.entries(readJson(`${ROOT}/data/published.json`, {}))) if (loadLedger()[id]?.status !== 'published') setLedger(id, { status: 'published', page: e.slug, line: e.line || 'night → cloud' });

let todo = remaining().sort((a, b) => b.views - a.views);
if (A.ids) { const want = String(A.ids).split(','); todo = todo.filter((v) => want.includes(v.id)); }
const ledger = loadLedger();
todo = todo.filter((v) => (ledger[v.id]?.tries || 0) < 3); // a video that failed 3 times waits for a human look

console.log(`night: ${todo.length} videos to handle · queue ${queued().length} · library ${LIB_DIR}`);
if (DRY) {
  for (const v of todo.slice(0, Number.isFinite(LIMIT) ? LIMIT : 10)) {
    const steps = [v.path ? 'local file' : 'download', fs.existsSync(cachePath(v, 'analysis')) ? 'analysis cached' : 'Gemini analysis (~$0.01)', 'dedup (Claude)', 'write + 2 reviews (Claude) if new', 'R2 + queue + push'];
    console.log(`  would do ${v.id} · ${v.views.toLocaleString('en')} views · ${v.date} · ${steps.join(' → ')}`);
  }
  console.log('dry run: nothing downloaded, paid, written or pushed.');
  process.exit(0);
}

const done = { queued: [], merged: [], skipped: [], failed: [] };
let stopReason = '', backoff = 0;
for (const v of todo) {
  if (done.queued.length + done.merged.length + done.skipped.length + done.failed.length >= LIMIT) break;
  console.log(`\n[${new Date().toLocaleTimeString('en-GB')}] ${v.id} · ${v.views.toLocaleString('en')} views`);
  try {
    const hadFile = !!v.path;
    download(v);
    backoff = 0;
    const an = await analyze(v, { script: 'night' });
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
      const draft = readJson(cachePath(v, 'write.ar'), null) || await writeArticle({ key, id: v.id, an, v, model: CLAUDE, script: 'night' });
      writeJson(cachePath(v, 'write.ar'), draft);
      const { review, final } = await reviewArticle({ key, id: v.id, an, draft, model: CLAUDE, script: 'night' });
      writeJson(cachePath(v, 'review.ar'), review);
      writeJson(cachePath(v, 'final.ar'), final);
      const slug = queuePage(v, final);
      setLedger(v.id, { status: 'queued', page: slug, reason: d.reason, line: 'night', words: final.words, score: review.total });
      done.queued.push(`${slug} (${final.words} words, ${review.total}/60)`); console.log(`  queued: ${slug}`);
    }
    gitSync(LIB_DIR, ['.'], `night: ${v.id} ${loadLedger()[v.id].status}`);
    gitSync(ROOT, ['queue', 'content/videos', 'public/covers', 'public/og', 'data/r2.json', 'data/spend.json'], `night: ${v.id} ${loadLedger()[v.id].status}`);
    if (!hadFile) await sleep(4000 + Math.random() * 4000); // be gentle with TikTok between downloads
  } catch (e) {
    if (e instanceof ClaudeLimitError) { stopReason = e.message; break; }
    if (e instanceof RateLimitError) {
      backoff++;
      console.warn(`  TikTok rate limit (${backoff}/3): ${e.message}`);
      if (backoff >= 3) { stopReason = `TikTok rate-limited this PC 3 times in a row (${e.message}). Stopped; run again later.`; break; }
      await sleep(backoff * 5 * 60e3); // 5, then 10 minutes
      continue;
    }
    const tries = (loadLedger()[v.id]?.tries || 0) + 1;
    setLedger(v.id, { status: 'failed', tries, reason: e.message.slice(0, 300), line: 'night' });
    done.failed.push(`${v.id}: ${e.message.slice(0, 120)}`); console.warn(`  ! ${e.message}`);
    try { gitSync(LIB_DIR, ['.'], `night: ${v.id} failed`); } catch {}
  }
}

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
st.lastNight = { at: new Date().toISOString(), queued: done.queued, merged: done.merged, skipped: done.skipped, failed: done.failed, stopped: stopReason || null, queueWaiting: queued().length, archiveLeft: left };
writeJson(`${ROOT}/data/status.json`, st);
const tiktokBlock = /TikTok rate-limited/.test(stopReason);
if (done.failed.length || tiktokBlock) {
  alert(['⚠️ alsuhaiby.com — تشغيل الليل', ...(tiktokBlock ? ['⚠️ تيك توك حدّ الجهاز ووقف التحميل. شغّله بعدين.'] : []), ...done.failed.slice(0, 5).map((f) => `⚠️ ${f}`)].join('\n'));
}
