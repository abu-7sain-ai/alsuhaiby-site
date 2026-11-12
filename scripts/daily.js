// daily.js — LINE 2 (PUBLISH), GitHub Actions, 02:00 Kuwait every day + the manual button. No PC needed.
//   1. NEW videos on his TikTok (Zernio) → download → Gemini analysis → dedup (Gemini) → Gemini writes, Sonnet reviews → live today
//      (a repeat of an existing topic is embedded on that page). Cost guard: stop paid work if today's spend > $2 or key credit < $3.
//   2. Publish N pages from queue/ (config/site.json → publishPerDay, default 7), highest views first. Published pages leave the
//      queue and are recorded in data/published.json, so nothing is ever published twice.
//   3. astro build check → commit + push (Cloudflare deploys) → IndexNow → wait until the pages answer. Summary → data/status.json (lastDaily).
//   Telegram ONLY for ⚠️: a failure, the cost guard, site down, an empty queue (nothing published). Nothing on success.
//   node scripts/daily.js [--dry-run] [--publish N] [--max-new N]
//   node scripts/daily.js --check     (05:00 Kuwait) if today's run did not happen: ⚠️ + run it now (catch-up)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, LIB_DIR, LIBRARY, args, readJson, writeJson, cachePath, setLedger, loadLedger, kuwaitDay, videoIndex, apiKey } from './lib/common.js';
import { writeArticle, reviewArticle } from './lib/article.js';
import { download, analyze, decide, mergeInto, queuePage, publishQueued, queued, remaining, gitSync, heldMerges, applyHeldMerge } from './lib/pipeline.js';
import { checkPublishable, publishData, numbersComplete, auditData, isAudited } from './lib/publishable.js';
import { alert, recordRun, refreshStatus } from './lib/status.js';

const A = args();
const DRY = !!A['dry-run'];
const SITE = 'https://alsuhaiby.com';
const TIKTOK_ACCOUNT = '6ad904df848485f37f93284a'; // Zernio account id of @m_alsuhaiby
const DAY_LIMIT_USD = 2, CREDIT_MIN_USD = 3;
const STATUS = path.join(ROOT, 'data', 'status.json');
const PUBLISHED = path.join(ROOT, 'data', 'published.json');
const today = kuwaitDay();
const errors = [];
// The private library is checked out with a deploy key. Without it the job still publishes the queue (free);
// new videos then wait for the night run, and the night run records the published status in the ledger.
const HAVE_LIB = fs.existsSync(LIBRARY) && fs.existsSync(path.join(LIB_DIR, '.git'));
const ledgerSet = (id, e) => { if (HAVE_LIB) setLedger(id, e); };
const log = (...a) => console.log(...a);

// ---- --check: missed-schedule guard ---------------------------------------------------------------
if (A.check) {
  const last = readJson(STATUS, {}).lastDaily;
  if (last?.day === today) { log(`today's run happened (${last.at}); nothing to do`); process.exit(0); }
  log('today\'s 02:00 run did not happen — catch-up now');
  if (!DRY) alert(`⚠️ alsuhaiby.com: النشر اليومي (${today} 02:00) ما اشتغل — شغّلت التعويض الحين.`);
}

// ---- money ----------------------------------------------------------------------------------------
// Only the cloud pipeline's own spend today (calls logged with script 'daily'). Manual work (write / review / analyze)
// and the night run on his PC are not counted: they are not what this guard protects against.
const spentToday = () => (readJson(path.join(ROOT, 'data', 'spend.json'), { calls: [] }).calls || []).filter((c) => c.script === 'daily' && kuwaitDay(new Date(c.at)) === today).reduce((a, c) => a + (c.costUsd || 0), 0);
async function credit() {
  try {
    const k = (await (await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${apiKey()}` } })).json()).data || {};
    return k.limit_remaining ?? null;
  } catch { return null; }
}
let guardTripped = '';
async function moneyOk() {
  if (guardTripped) return false;
  const s = spentToday(), c = await credit();
  if (s > DAY_LIMIT_USD) guardTripped = `today's spend $${s.toFixed(2)} is over $${DAY_LIMIT_USD}`;
  else if (c != null && c < CREDIT_MIN_USD) guardTripped = `key credit $${c.toFixed(2)} is under $${CREDIT_MIN_USD}`;
  return !guardTripped;
}

// ---- 1. new videos (Zernio) -------------------------------------------------------------------------
async function newVideos() {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) { errors.push('ZERNIO_API_KEY missing: new videos not checked'); return []; }
  const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const r = await fetch(`https://zernio.com/api/v1/analytics?accountId=${TIKTOK_ACCOUNT}&platform=tiktok&source=external&fromDate=${from}&limit=50&sortBy=date&order=desc`, { headers: { Authorization: `Bearer ${key}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { errors.push(`Zernio ${r.status}: ${String(j.error || '').replaceAll(key, '[secret]').slice(0, 120)}`); return []; }
  const lib = readJson(LIBRARY, { videos: [] });
  const known = new Set(lib.videos.map((v) => v.id));
  const ledger = loadLedger();
  const posts = (j.posts || j.data || []).map((p) => ({
    id: String(p.platformPostId || p.externalPostId || '').match(/\d{15,}/)?.[0] || String(p.platformPostUrl || '').match(/video\/(\d+)/)?.[1],
    date: String(p.publishedAt || p.createdAt || '').slice(0, 10),
    views: Math.round(p.analytics?.views ?? p.views ?? 0),
    cap: String(p.content || '').slice(0, 300),
    // numbers from Zernio (owner's rule: no page without them); recorded in the library before anything is written
    stats: p.analytics ? { views: p.analytics.views ?? null, likes: p.analytics.likes ?? null, comments: p.analytics.comments ?? null, shares: p.analytics.shares ?? null, saves: p.analytics.saves ?? null } : null,
  })).filter((p) => p.id && !known.has(p.id) && !ledger[p.id]);
  return posts;
}

async function handleNew(p, maxNew) {
  // add to the shared library first, so the night run knows it even if the cloud cannot finish it
  const lib = readJson(LIBRARY, { videos: [] });
  if (!lib.videos.some((v) => v.id === p.id)) { lib.videos.push({ id: p.id, date: p.date, views: p.views, cap: p.cap }); writeJson(LIBRARY, lib); }
  // record its numbers (owner's rule: a video without numbers is never published) — before any paid step
  const META = path.join(LIB_DIR, 'meta.json');
  if (p.stats && numbersComplete(p.stats)) {
    const meta = readJson(META, {}); const now = new Date().toISOString();
    meta[p.id] = { ...(meta[p.id] || {}), numbersAt: now, stats: { ...p.stats, source: 'zernio', capturedAt: now }, links: { ...(meta[p.id]?.links || {}), tiktok: `https://www.tiktok.com/@m_alsuhaiby/video/${p.id}` } };
    writeJson(META, meta);
  }
  const pre = checkPublishable(p.id, publishData(), { needFile: false });
  if (!pre.ok) { errors.push(`new video ${p.id}: not handled — ${pre.reasons.join('; ')}`); return null; }
  const v = videoIndex().get(p.id);
  try { download(v); } catch (e) {
    setLedger(p.id, { status: 'failed', tries: 0, reason: `cloud download: ${e.message.slice(0, 200)}`, line: 'cloud' });
    errors.push(`new video ${p.id}: download failed in the cloud — the night run will take it`);
    return null;
  }
  if (!(await moneyOk())) return null;
  const an = await analyze(v, { script: 'daily' });
  const d = await decide({ v, an, script: 'daily' });
  if (d.decision === 'skip') { setLedger(v.id, { status: 'skipped', reason: d.reason, line: 'cloud' }); return { kind: 'skipped', id: v.id }; }
  if (d.decision === 'duplicate') {
    mergeInto(d.page, v, an);
    setLedger(v.id, { status: 'merged', page: d.page.slug, reason: d.reason, line: 'cloud' });
    return { kind: 'merged', id: v.id, slug: d.page.slug };
  }
  if (!(await moneyOk())) return null;
  const key = `tk-${v.id}`;
  const draft = readJson(cachePath(v, 'write.ar'), null) || await writeArticle({ key, id: v.id, an, v, script: 'daily' });
  writeJson(cachePath(v, 'write.ar'), draft);
  if (!(await moneyOk())) return null;
  const { review, final } = await reviewArticle({ key, id: v.id, an, draft, script: 'daily' });
  writeJson(cachePath(v, 'review.ar'), review);
  writeJson(cachePath(v, 'final.ar'), final);
  const slug = queuePage(v, final);
  // owner's rule (2026-11-12): nothing goes live unaudited. The cloud cannot audit (the audit runs on the PC), so the new page waits in the queue.
  setLedger(v.id, { status: 'queued', page: slug, reason: d.reason, line: 'cloud', words: final.words, score: review.total });
  return { kind: 'queued', id: v.id, slug };
}

// ---- main -------------------------------------------------------------------------------------------
const N = Number(A.publish ?? readJson(path.join(ROOT, 'config', 'site.json'), {}).publishPerDay ?? 7);
const MAX_NEW = Number(A['max-new'] ?? 5);
const result = { published: [], newPublished: [], merged: [], skipped: [], newQueued: [] };
let notAudited = 0, auditReady = 0;
try {
  // 1. new videos
  let fresh = [];
  if (!HAVE_LIB) errors.push('private library not reachable: new videos not handled today (the night run will take them)');
  else try { fresh = await newVideos(); } catch (e) { errors.push(`Zernio: ${e.message.slice(0, 150)}`); }
  log(`new videos on TikTok not handled yet: ${fresh.length}`);
  for (const p of fresh.slice(0, MAX_NEW)) {
    if (DRY) { log(`  would handle new video ${p.id} (${p.date}, ${p.views} views): download → Gemini → dedup → write + Sonnet review → live`); continue; }
    if (!(await moneyOk())) break;
    try {
      const r = await handleNew(p);
      if (r?.kind === 'published') result.newPublished.push(r);
      if (r?.kind === 'queued') result.newQueued.push(r);
      if (r?.kind === 'merged') result.merged.push(r);
      if (r?.kind === 'skipped') result.skipped.push(r);
    } catch (e) { errors.push(`new video ${p.id}: ${e.message.slice(0, 150)}`); }
  }
  if (fresh.length > MAX_NEW) log(`  ${fresh.length - MAX_NEW} more new videos wait for tomorrow`);

  // 2. publish N from the queue
  const pub = readJson(PUBLISHED, {});
  const q = queued().sort((a, b) => b.views - a.views);
  for (const m of q.filter((m) => pub[m.id])) { log(`  ${m.id} was already published — removed from the queue`); if (!DRY) fs.rmSync(path.join(ROOT, 'queue', m.id), { recursive: true, force: true }); }
  // owner's rule: only videos with BOTH their file on R2 and their numbers; an incomplete one stays out (and does not take a slot)
  const data = publishData();
  // owner's rule (2026-11-12): only AUDITED articles (library audit.json: changed|clean) are published; the rest stay frozen in the queue
  const audit = auditData();
  const complete = q.filter((m) => !pub[m.id]).filter((m) => {
    const c = checkPublishable(m.id, data);
    if (!c.ok) log(`  ${m.id} not published (incomplete data): ${c.reasons.join('; ')}`);
    return c.ok;
  });
  const ready = complete.filter((m) => isAudited(m.id, audit));
  notAudited = complete.length - ready.length; auditReady = ready.length;
  log(`  audit gate: ${ready.length} audited and ready · ${notAudited} skipped (not audited yet)${audit ? '' : ' · audit list not reachable: nothing is published'}`);
  const take = ready.slice(0, N);
  for (const m of take) {
    if (DRY) { log(`  would publish ${m.slug} (${m.views} views)`); continue; }
    try {
      const meta = publishQueued(m.id);
      pub[m.id] = { slug: meta.slug, at: new Date().toISOString() };
      ledgerSet(m.id, { status: 'published', page: meta.slug, line: 'night → cloud' });
      result.published.push(meta);
    } catch (e) { errors.push(`publish ${m.slug}: ${e.message.slice(0, 150)}`); }
  }
  // 2b. held duplicates (owner, 2026-11-11): videos that repeat a LIVE page were prepared on the PC (queue/.held-<id>/);
  //     publishing embeds them on that page now. Incomplete data (no R2 file or no numbers) → stays held, not embedded.
  const hostAudited = (slug) => { try { const t = fs.readFileSync(path.join(ROOT, 'content', 'videos', 'ar', slug + '.md'), 'utf8'); const id = (t.match(/^tiktokId:\s*"?(\d+)/m) || [])[1]; return isAudited(id, audit); } catch { return false; } };
  let heldWaiting = 0;
  for (const h of heldMerges()) {
    // owner's rule (2026-11-12): a live page changes only after it has been audited (the embed adds a video the audit has not covered)
    if (!hostAudited(h.page)) { heldWaiting++; continue; }
    if (DRY) { log(`  would embed held ${h.id} on ${h.page}`); continue; }
    try {
      applyHeldMerge(h);
      ledgerSet(h.id, { status: 'merged', page: h.page, line: 'night → cloud (held merge)' });
      result.merged.push({ id: h.id, slug: h.page });
    } catch (e) { errors.push(`held merge ${h.id} → ${h.page}: ${e.message.slice(0, 150)}`); }
  }
  if (heldWaiting) log(`  ${heldWaiting} held merge(s) wait: their live page is not audited yet`);
  for (const r of result.newPublished) pub[r.id] = { slug: r.slug, at: new Date().toISOString(), line: 'cloud' };
  if (!DRY) writeJson(PUBLISHED, pub);

  // 3. build check, push, IndexNow, live check
  const all = [...result.newPublished, ...result.published];
  const urls = all.map((m) => `${SITE}/${encodeURI(m.slug)}/`);
  if (!DRY && (all.length || result.merged.length || result.newQueued.length)) {
    execFileSync('npm', ['run', 'build', '--silent'], { cwd: ROOT, stdio: 'inherit', shell: true }); // throws (and nothing is pushed) if a page breaks the site
    HAVE_LIB && gitSync(LIB_DIR, ['.'], `daily ${today}: ${all.length} published, ${result.merged.length} merged`);
    s_status(); await refreshStatus();
    gitSync(ROOT, ['queue', 'content/videos', 'public/covers', 'public/og', 'data'], `daily ${today}: publish ${all.length} page(s)`);
    try {
      const key = fs.readFileSync(path.join(ROOT, 'data', 'indexnow-key.txt'), 'utf8').trim();
      const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ host: 'alsuhaiby.com', key, keyLocation: `${SITE}/${key}.txt`, urlList: urls }) });
      log(`IndexNow: HTTP ${r.status}`);
    } catch (e) { errors.push(`IndexNow: ${e.message}`); }
    // wait for Cloudflare to deploy (usually < 1 min): up to 6 minutes
    for (let i = 0; i < 24 && urls.length; i++) {
      const codes = await Promise.all(urls.map((u) => fetch(u, { method: 'HEAD' }).then((r) => r.status).catch(() => 0)));
      if (codes.every((c) => c === 200)) break;
      if (i === 23) errors.push(`not live after 6 min: ${urls.filter((_, k) => codes[k] !== 200).length} page(s)`);
      await new Promise((r) => setTimeout(r, 15000));
    }
  } else if (!DRY) { s_status(); await refreshStatus(); HAVE_LIB && gitSync(LIB_DIR, ['.'], `daily ${today}: library`); gitSync(ROOT, ['data'], `daily ${today}: nothing to publish`); }

  // 4. Telegram ONLY when something needs him or broke (his rule 2026-11-07). Silence = all fine.
  //    The day's summary lives in data/status.json → lastDaily (ask Claude for it any time).
  const st = await refreshStatus();
  const warn = [
    ...(guardTripped ? [`حارس التكلفة وقف الشغل المدفوع: ${guardTripped}`] : []),
    ...(st.siteHealth && !st.siteHealth.up ? ['الموقع ما يرد!'] : []),
    ...(!take.length && !result.newPublished.length ? [notAudited ? `ما انتشر شي اليوم: ${notAudited} مقال بالطابور ينتظر التدقيق (ولا واحد مدقَّق جاهز).` : 'الطابور فاضي — ما انتشر شي اليوم. شغّل npm run night على الجهاز.'] : []),
    ...errors,
  ];
  log(`\npublished ${all.length}: ${all.map((m) => m.slug).join(', ') || '-'} · merged ${result.merged.length} · queue ${queued().length} · archive left ${HAVE_LIB ? remaining().length : '?'} · today $${spentToday().toFixed(2)} · credit ${st.keyCreditLeftUsd?.usd ?? '?'}`);
  if (warn.length) log(`would warn: ${warn.join(' | ')}`);
  if (DRY) log('\ndry run: nothing paid, moved, pushed or sent.');
  else {
    recordRun('daily', true);
    if (warn.length) alert([`⚠️ alsuhaiby.com — ${today}`, ...warn.map((w) => `⚠️ ${w}`)].join('\n'));
  }
} catch (e) {
  console.error(e);
  if (!DRY) {
    recordRun('daily', false, e.message);
    // the workflow skips its own ⚠️ when this one was sent
    if (alert(`⚠️ alsuhaiby.com: فشل النشر اليومي (${today})\n${String(e.message).slice(0, 300)}`) && process.env.RUNNER_TEMP) fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'alerted'), '1');
  }
  process.exit(1);
}

function s_status() {
  const s = readJson(STATUS, {});
  const all = [...result.newPublished, ...result.published];
  s.lastDaily = {
    day: today, at: new Date().toISOString(),
    published: all.map((m) => ({ title: m.title, url: `${SITE}/${encodeURI(m.slug)}/` })), merged: result.merged.map((m) => `${m.id} → ${m.slug}`),
    queueLeft: queued().length, queueNotAudited: notAudited, newQueued: result.newQueued.length, archiveLeft: HAVE_LIB ? remaining().length : null, costTodayUsd: Math.round(spentToday() * 1000) / 1000,
    costGuard: guardTripped || null, errors,
  };
  writeJson(STATUS, s);
}
