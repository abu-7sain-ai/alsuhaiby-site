// meta.js — two separate passes over every library video, highest views first, into the private library. ZERO AI (both):
//   no Claude, no Gemini; ALSUHAIBY_NO_AI=1 makes any chat() call throw and this file imports no AI step.
//
//   NUMBERS  (`npm run numbers`, desktop shortcut «بيانات الصهيبي»): yt-dlp metadata only (no video, no comments, no Zernio):
//     views, likes, comment count, shares, saves, duration, publish time, caption, hashtags → meta.json[id].stats / .details,
//     each with source 'yt-dlp' and the capture date. ~3 s per call, 1 s + 0–2 s apart. Done = meta.json[id].numbersAt.
//
//   COMMENTS (`npm run comments`, desktop shortcut «تعليقات الصهيبي»): slow background project, runs only when he starts it.
//     Zernio (asked by video id, works for old videos too) → comments/<id>.json; Instagram posts matched to TikTok videos by
//     caption + date get their link, numbers and comments too. Done = meta.json[id].comments.capturedAt.
//     Zernio's real limit for comment reads is 1,800 per hour (measured 2026-11-10; its general docs say 60/min): paced at
//     `zernioCommentsPerHour` (config/site.json, 1700) and `zernioPerMinute` (45); a 429 waits what Zernio asks.
//     Privacy: commenter names, handles, ids and pictures are NEVER written — only text, date, likes, reply flags.
//     His account's replies are kept apart (accountReplies[], account_reply: true, ai_written: true): an employee wrote them
//     with an AI, so they are never a source of his words, only a record of which questions were already answered.
//     TikTok's comment count is higher than what its API returns (replies come back complete, top-level comments do not):
//     expectedCount vs gotCount is kept per video.
//
//   Both: a video that fails is set aside (numbersDeferred / commentsDeferred: reason + date), no retry; 5 different videos
//   failing in a row = stop (+ one ⚠️). Resumable, `--minutes=N`, `--limit N`, `--ids a,b` (redo these), `--dry-run`,
//   machine guard, live window, pushes the library as it goes.
process.env.ALSUHAIBY_NO_AI = '1';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, LIB_DIR, args, readJson, writeJson } from './lib/common.js';
import { gitSync } from './lib/pipeline.js';
import { guard, alert } from './lib/status.js';
import { machineGate, MachineStopError, setStage, startStage } from './lib/machine.js';

const A = args();
const PART = String(A.part || '');
if (!['numbers', 'comments'].includes(PART)) { console.error('usage: node scripts/meta.js --part=numbers | --part=comments'); process.exit(1); }
const NUM = PART === 'numbers';
guard(NUM ? 'numbers' : 'comments');
const DRY = !!A['dry-run'];
const LIMIT = A.limit ? Number(A.limit) : Infinity;
const MAX_MIN = Number(A.minutes ?? 0) || 0;
const IDS = A.ids ? new Set(String(A.ids).split(',').map((s) => s.trim()).filter(Boolean)) : null;
const CFG = readJson(path.join(ROOT, 'config', 'site.json'), {});
const RATE = Number(A.rate ?? CFG.zernioPerMinute ?? 45) || 45;
const HOURLY = Number(A.hourly ?? CFG.zernioCommentsPerHour ?? 1700) || 1700;
const YT_GAP_MS = Number(process.env.META_YT_GAP_MS || 1e3), YT_JITTER_MS = Number(process.env.META_YT_JITTER_MS || 2e3);
const MAX_FAILS = 5, PUSH_EVERY = NUM ? 50 : 10, NOTE_AFTER = 100;
const TT_ACC = '6ad904df848485f37f93284a', IG_ACC = '6ad9041d5efe4d7453bc190c'; // Zernio account ids: @m_alsuhaiby, mohammad_alsuhaiby
const META = path.join(LIB_DIR, 'meta.json'), CDIR = path.join(LIB_DIR, 'comments');
const PROGRESS = path.join(ROOT, 'data', `run-${PART}.json`), LOG = path.join(ROOT, 'data', `run-${PART}.log`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const k of ['log', 'warn', 'error']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { orig(...a); try { fs.appendFileSync(LOG, a.map(String).join(' ') + '\n'); } catch {} };
}

// ---- Zernio key (comments only): read from .env at run time, never printed or written anywhere else ----------
function zernioKey() {
  if (process.env.ZERNIO_API_KEY) return process.env.ZERNIO_API_KEY;
  const f = path.join(ROOT, '.env');
  if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*ZERNIO_API_KEY\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^['"]|['"]$/g, '');
  }
  return '';
}
const KEY = DRY || NUM ? '' : zernioKey();
if (!DRY && !NUM && !KEY) { console.error('ZERNIO_API_KEY is missing in .env'); process.exit(1); }
const hide = (s) => (KEY ? String(s).replaceAll(KEY, '[secret]') : String(s));

// ---- Zernio calls: ≤ RATE per minute and ≤ HOURLY per hour (sliding windows); 429 → wait what Zernio asks --------
const recent = [];
let zCalls = 0;
async function zget(p, q = {}) {
  for (let attempt = 1; ; attempt++) {
    const now = Date.now();
    while (recent.length && now - recent[0] > 3600e3) recent.shift();
    const lastMin = recent.filter((t) => now - t < 60e3);
    if (lastMin.length >= RATE) { await sleep(60e3 - (now - lastMin[0]) + 50); attempt--; continue; }
    if (recent.length >= HOURLY) {
      const wait = 3600e3 - (now - recent[0]) + 1e3;
      setStage('paused', { why: 'Zernio hourly limit' });
      console.log(`  ⏳ Zernio hourly limit (${HOURLY}/h): waiting ${Math.round(wait / 60e3)} min`);
      await sleep(wait); setStage('working'); attempt--; continue;
    }
    recent.push(Date.now()); zCalls++;
    const u = new URL('https://zernio.com/api' + p);
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    let r;
    try { r = await fetch(u, { headers: { Authorization: `Bearer ${KEY}` } }); } catch (e) {
      if (attempt >= 4) throw new Error(`Zernio network: ${hide(e.message).slice(0, 150)}`);
      await sleep(15e3 * attempt); continue;
    }
    if (r.status === 429) {
      const wait = ((Number(r.headers.get('retry-after')) || 60) + 2) * 1e3;
      setStage('paused', { why: 'Zernio asks to wait' });
      console.warn(`  ⏳ Zernio asks to wait ${Math.round(wait / 60e3) || 1} min`);
      await sleep(wait); setStage('working'); attempt--; continue;
    }
    if (r.status >= 500 && attempt < 4) { await sleep(10e3 * attempt); continue; }
    const t = await r.text();
    if (!r.ok) throw new Error(`Zernio ${r.status}: ${hide(t).slice(0, 300)}`);
    return JSON.parse(t);
  }
}

// ---- comments of one post: top-level pages + the replies of every comment that has any -------------
// Replies are fetched per comment (commentId): those carry the real reply dates (nested ones can carry the fetch time).
const clean = (c, parentId) => ({ id: c.id, text: c.message || '', at: c.createdTime || null, likes: c.likeCount || 0, isReply: !!parentId, ...(parentId ? { parentId } : { replyCount: c.replyCount || 0 }) });
async function thread(postId, acc) {
  const comments = [], accountReplies = [], seen = new Set();
  const add = (c, parentId) => {
    if (!c?.id || seen.has(c.id)) return; seen.add(c.id);
    const x = clean(c, parentId);
    if (c.from?.isOwner) accountReplies.push({ ...x, account_reply: true, ai_written: true }); else comments.push(x);
  };
  let cursor = null, n = 0;
  const tops = [];
  do {
    const j = await zget(`/v1/inbox/comments/${encodeURIComponent(postId)}`, { accountId: acc, limit: 100, cursor });
    for (const c of j.comments || []) { add(c, null); tops.push(c); }
    cursor = j.pagination?.hasMore ? j.pagination.cursor : null;
  } while (cursor && ++n < 2000);
  for (const c of tops) {
    if (!(c.replyCount > 0)) continue;
    let rc = null, m = 0;
    do {
      const j = await zget(`/v1/inbox/comments/${encodeURIComponent(postId)}`, { accountId: acc, commentId: c.id, limit: 100, cursor: rc });
      for (const x of j.comments || []) if (x.id !== c.id) add(x, c.id);
      rc = j.pagination?.hasMore ? j.pagination.cursor : null;
    } while (rc && ++m < 200);
  }
  return { comments, accountReplies };
}

// ---- yt-dlp metadata (no video, no comments) ---------------------------------------------------------
let lastYt = 0;
async function ytMeta(id) {
  const wait = YT_GAP_MS + Math.random() * YT_JITTER_MS - (Date.now() - lastYt);
  if (lastYt && wait > 0) await sleep(wait);
  lastYt = Date.now();
  const r = spawnSync('python', ['-m', 'yt_dlp', '-q', '--no-warnings', '--skip-download', '-J', `https://www.tiktok.com/@m_alsuhaiby/video/${id}`], { encoding: 'utf8', timeout: 120e3, maxBuffer: 64e6 });
  if (r.status !== 0 || !r.stdout) throw new Error(String(r.stderr || r.error || 'yt-dlp failed').trim().split('\n').pop().slice(0, 200));
  return JSON.parse(r.stdout);
}
const hashtags = (s) => [...new Set((String(s || '').match(/#[\p{L}\p{N}_]+/gu) || []).map((h) => h.slice(1)))];

// ---- Instagram ↔ TikTok match by caption + date -------------------------------------------------------
const norm = (s) => String(s || '').replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim().toLowerCase();
const grams = (s) => { const t = norm(s).replace(/ /g, ''); const g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };
const sim = (a, b) => { const X = grams(a), Y = grams(b); if (!X.size || !Y.size) return 0; let n = 0; for (const x of X) if (Y.has(x)) n++; return n / (X.size + Y.size - n); };
async function instagramPosts() {
  const posts = new Map(); // igId → { id, at, caption, url, stats }
  let page = 1, pages = 1;
  do {
    const j = await zget('/v1/analytics', { accountId: IG_ACC, platform: 'instagram', source: 'external', limit: 100, page, sortBy: 'date', order: 'desc' });
    pages = j.pagination?.pages || 1;
    for (const p of j.posts || []) {
      const pl = (p.platforms || []).find((x) => x.platform === 'instagram') || {};
      const id = pl.platformPostId || p._id; const a = p.analytics || {};
      posts.set(id, { id, at: p.publishedAt, caption: p.content || '', url: pl.platformPostUrl || null,
        stats: { views: a.views ?? null, likes: a.likes ?? null, comments: a.comments ?? null, shares: a.shares ?? null, saves: a.saves ?? null } });
    }
  } while (++page <= pages && page < 20);
  let cursor = null, n = 0; // inbox list: permalink + the full caption
  do {
    const j = await zget('/v1/inbox/comments', { platform: 'instagram', accountId: IG_ACC, limit: 100, cursor });
    for (const p of j.data || []) {
      const o = posts.get(p.id) || { id: p.id, at: p.createdTime, caption: '', url: null, stats: {} };
      o.url = p.permalink || o.url; if (!o.caption) o.caption = p.content || '';
      o.stats = { ...o.stats, likes: o.stats.likes ?? p.likeCount ?? null, comments: o.stats.comments ?? p.commentCount ?? null };
      posts.set(p.id, o);
    }
    cursor = j.pagination?.hasMore ? j.pagination.nextCursor : null;
  } while (cursor && ++n < 50);
  return [...posts.values()];
}
function matchInstagram(ig, videos) {
  const out = new Map(), used = new Set(), cands = [];
  for (const p of ig) {
    if (!p.at || !norm(p.caption)) continue; // no caption = no safe match
    for (const v of videos) {
      const days = Math.abs(new Date(p.at) - new Date(v.date + 'T12:00:00Z')) / 864e5;
      if (days > 4) continue;
      const s = sim(p.caption, v.cap);
      if (s >= 0.3) cands.push({ p, v, s, days });
    }
  }
  cands.sort((a, b) => b.s - a.s || a.days - b.days);
  for (const c of cands) {
    if (used.has(c.p.id) || out.has(c.v.id)) continue;
    used.add(c.p.id); out.set(c.v.id, { ig: c.p, score: Math.round(c.s * 100) / 100, days: Math.round(c.days * 10) / 10 });
  }
  return out;
}

// ---- state: older combined-run records get the new markers (13+3 videos captured on 2026-11-10) -------------
let meta = readJson(META, {});
let migrated = 0;
for (const x of Object.values(meta)) {
  if (x.complete && x.comments && !x.comments.capturedAt) { x.comments.capturedAt = x.capturedAt; migrated++; }
  if (x.deferred && !x.commentsDeferred && /comments/i.test(x.deferred.reason || '')) { x.commentsDeferred = x.deferred; delete x.deferred; migrated++; }
}
if (migrated && !DRY) writeJson(META, meta);
const saveMeta = (id, fn) => { meta = readJson(META, {}); meta[id] = fn(meta[id] || {}); writeJson(META, meta); };
const isDone = (x) => (NUM ? !!x?.numbersAt : !!x?.comments?.capturedAt);
const isDeferred = (x) => (NUM ? !!x?.numbersDeferred : !!x?.commentsDeferred);

const lib = readJson(path.join(LIB_DIR, 'library.json'), { videos: [] }).videos;
const todo = lib.filter((v) => (IDS ? IDS.has(v.id) : !isDone(meta[v.id]) && !isDeferred(meta[v.id]))).sort((a, b) => (b.views || 0) - (a.views || 0));
const total = todo.length;
const viewsLeftAll = todo.reduce((s, v) => s + (v.views || 0), 0);
console.log(NUM
  ? `numbers: ${total} of ${lib.length} videos to do (highest views first) · yt-dlp only, no Zernio · time limit ${MAX_MIN ? `${MAX_MIN} min` : 'none'} · NO AI`
  : `comments: ${total} of ${lib.length} videos to do (highest views first) · Zernio ≤ ${RATE}/min and ≤ ${HOURLY}/h · time limit ${MAX_MIN ? `${MAX_MIN} min` : 'none'} · NO AI`);
if (DRY) {
  for (const v of todo.slice(0, Number.isFinite(LIMIT) ? LIMIT : 10)) console.log(`  would do ${v.id} · ${(v.views || 0).toLocaleString('en')} views`);
  console.log('dry run: no network, nothing written.');
  process.exit(0);
}
fs.mkdirSync(CDIR, { recursive: true });

const startedAt = Date.now();
const kw = (ms) => { const d = new Date(ms + 3 * 3600e3).toISOString(); return `${d.slice(8, 10)}-${d.slice(5, 7)} ${d.slice(11, 16)}`; };
const st = { done: 0, comments: 0, accountReplies: 0, igMatched: 0, igComments: 0, expectedDone: 0, viewsDone: 0, deferred: [] };
let stopKind = '', stopReason = '';
function estimate() {
  const left = total - st.done - st.deferred.length;
  if (NUM) { const per = st.done ? (Date.now() - startedAt) / st.done : null; return { left, eta: per ? Date.now() + per * left : null }; }
  // comments: remaining ≈ comments still to fetch (views left × comments-per-view seen so far) + a fixed cost per video
  const ratio = st.viewsDone ? (st.comments + st.accountReplies) / st.viewsDone : 0.0005;
  const viewsLeft = viewsLeftAll - st.viewsDone - st.deferred.reduce((s, d) => s + (d.views || 0), 0);
  const commentsLeft = Math.round(viewsLeft * ratio);
  const K = 15;
  const unitsDone = st.comments + st.accountReplies + st.igComments + K * st.done;
  const ms = unitsDone ? ((Date.now() - startedAt) / unitsDone) * (commentsLeft + K * left) : null;
  return { left, commentsLeft, totalComments: st.comments + st.accountReplies + commentsLeft, eta: ms !== null ? Date.now() + ms : null };
}
function progress(extra = {}) {
  const e = estimate(); const hours = Math.max((Date.now() - startedAt) / 3600e3, 1 / 60);
  const p = { part: PART, startedAt: new Date(startedAt).toISOString(), updatedAt: new Date().toISOString(), minutes: Math.round(hours * 60), total, ...st,
    left: e.left, perHour: Math.round((st.done / hours) * 10) / 10, ...(NUM ? {} : { zernioCalls: zCalls, estTotalComments: e.totalComments }),
    etaKuwait: e.eta ? kw(e.eta) : null, maxMinutes: MAX_MIN || null, running: true, stopped: null, ...extra };
  writeJson(PROGRESS, p);
  return p;
}
function liveLine(p) {
  process.title = `alsuhaiby ${PART} - ${p.done} done / ${p.left} left${NUM ? '' : ` / ${p.comments} comments`}${p.etaKuwait ? ` / ETA ${p.etaKuwait} Kuwait` : ''}`;
  console.log(`  ── خلص ${p.done} · باقي ${p.left}${NUM ? '' : ` · تعليقات ${p.comments.toLocaleString('en')}`} · بالساعة ${p.perHour} فيديو${p.etaKuwait ? ` · المتوقع ينتهي ${p.etaKuwait} (الكويت)` : ''}`);
}
const push = (msg) => { try { gitSync(LIB_DIR, ['meta.json', 'comments'], msg); } catch (e) { console.warn(`  ! push (library): ${hide(e.message).slice(0, 200)}`); } };

fs.appendFileSync(LOG, `\n===== ${PART} run ${new Date(startedAt).toISOString()} =====\n`);
await startStage(PART, { left: total });

let igMatch = new Map();
if (!NUM) {
  try { const ig = await instagramPosts(); igMatch = matchInstagram(ig, lib); console.log(`Zernio: Instagram ${ig.length} posts, ${igMatch.size} matched to TikTok videos`); }
  catch (e) { console.warn(`  ! Instagram list: ${hide(e.message).slice(0, 150)} (Instagram skipped this run)`); }
}
liveLine(progress());

async function doNumbers(v) {
  const y = await ytMeta(v.id); const now = new Date().toISOString();
  const caption = y.description ?? v.cap ?? '';
  saveMeta(v.id, (x) => {
    delete x.numbersDeferred;
    return { ...x, numbersAt: now,
      links: { ...(x.links || {}), tiktok: `https://www.tiktok.com/@m_alsuhaiby/video/${v.id}` },
      stats: { views: y.view_count ?? null, likes: y.like_count ?? null, comments: y.comment_count ?? null, shares: y.repost_count ?? null, saves: y.save_count ?? null, source: 'yt-dlp', capturedAt: now },
      details: { publishedAt: y.timestamp ? new Date(y.timestamp * 1e3).toISOString() : null, date: v.date, duration: y.duration ?? null, caption, hashtags: hashtags(caption), source: 'yt-dlp', capturedAt: now } };
  });
  st.viewsDone += v.views || 0;
  console.log(`  ✓ ${(y.view_count ?? 0).toLocaleString('en')} views · ${(y.like_count ?? 0).toLocaleString('en')} likes · ${y.comment_count ?? '?'} comments · ${y.repost_count ?? '?'} shares · ${y.save_count ?? '?'} saves · ${y.duration ?? '?'} s`);
}
async function doComments(v) {
  const tt = await thread(v.id, TT_ACC);
  const expected = meta[v.id]?.stats?.comments ?? null;
  const rec = { tiktok: { source: 'zernio', capturedAt: new Date().toISOString(), expectedCount: expected, gotCount: tt.comments.length + tt.accountReplies.length, comments: tt.comments, accountReplies: tt.accountReplies } };
  let instagram = null; const m = igMatch.get(v.id);
  if (m) {
    const ig = await thread(m.ig.id, IG_ACC);
    rec.instagram = { source: 'zernio', postId: m.ig.id, capturedAt: new Date().toISOString(), expectedCount: m.ig.stats.comments ?? null, gotCount: ig.comments.length + ig.accountReplies.length, comments: ig.comments, accountReplies: ig.accountReplies };
    instagram = { postId: m.ig.id, url: m.ig.url, publishedAt: m.ig.at, match: { by: 'caption+date', score: m.score, days: m.days }, stats: { ...m.ig.stats, source: 'zernio', capturedAt: new Date().toISOString() } };
    st.igMatched++; st.igComments += rec.instagram.gotCount;
  }
  writeJson(path.join(CDIR, `${v.id}.json`), { id: v.id, capturedAt: new Date().toISOString(), note: 'No commenter names or handles are stored. accountReplies were written by an employee with an AI (ai_written): never his own words.', ...rec });
  const now = new Date().toISOString();
  saveMeta(v.id, (x) => {
    delete x.commentsDeferred;
    return { ...x, links: { ...(x.links || {}), tiktok: `https://www.tiktok.com/@m_alsuhaiby/video/${v.id}`, ...(instagram?.url ? { instagram: instagram.url } : {}) },
      ...(instagram ? { instagram } : {}),
      comments: { capturedAt: now, tiktok: rec.tiktok.gotCount, tiktokExpected: expected, ...(rec.instagram ? { instagram: rec.instagram.gotCount } : {}), file: `comments/${v.id}.json` } };
  });
  st.comments += tt.comments.length; st.accountReplies += tt.accountReplies.length; st.viewsDone += v.views || 0;
  console.log(`  ✓ ${tt.comments.length} comments + ${tt.accountReplies.length} account replies${expected != null ? ` (TikTok says ${expected})` : ''}${m ? ` · Instagram ${rec.instagram.gotCount}` : ''}`);
}

let failStreak = 0, noted = false;
for (const v of todo) {
  if (st.done + st.deferred.length >= LIMIT) break;
  if (MAX_MIN && Date.now() - startedAt >= MAX_MIN * 60e3) { stopKind = 'time'; stopReason = `time limit reached (${MAX_MIN} min)`; break; }
  try { await machineGate(); } catch (e) {
    if (e instanceof MachineStopError) { stopKind = 'machine'; stopReason = e.message; console.warn(`  ⛔ ${e.message}`); break; }
    throw e;
  }
  console.log(`\n[${new Date().toLocaleTimeString('en-GB')}] ${v.id} · ${(v.views || 0).toLocaleString('en')} views`);
  setStage('working', { current: v.id, left: total - st.done - st.deferred.length });
  try {
    await (NUM ? doNumbers(v) : doComments(v));
    st.done++; failStreak = 0;
    if (st.done % PUSH_EVERY === 0) { setStage('pushing'); push(`${PART}: ${st.done} videos`); }
  } catch (e) {
    // set aside on the first failure (his rule): no retry; 5 DIFFERENT videos in a row = the service or the network is down → stop
    const reason = hide(e.message || String(e)).replace(/\s+/g, ' ').slice(0, 300);
    const field = NUM ? 'numbersDeferred' : 'commentsDeferred';
    saveMeta(v.id, (x) => ({ ...x, [field]: { reason, at: new Date().toISOString() } }));
    st.deferred.push({ id: v.id, views: v.views || 0, reason: reason.slice(0, 160) });
    failStreak++;
    console.warn(`  – set aside (${failStreak}/${MAX_FAILS} different videos in a row): ${reason.slice(0, 200)}`);
    if (failStreak >= MAX_FAILS) {
      const last = st.deferred.slice(-MAX_FAILS);
      for (const d of last) saveMeta(d.id, (x) => { delete x[field]; return x; });
      st.deferred = st.deferred.slice(0, -MAX_FAILS);
      stopKind = 'errors'; stopReason = `${MAX_FAILS} different videos failed in a row; last: ${reason.slice(0, 150)}`;
      break;
    }
  }
  const p = progress(); liveLine(p);
  if (!NUM && !noted && st.done >= NOTE_AFTER) {
    noted = true; const e = estimate();
    console.log(`\n  📝 بعد ${st.done} فيديو: الإجمالي المتوقع للتعليقات تقريبًا ${e.totalComments.toLocaleString('en')} · باقي تقريبًا ${e.commentsLeft.toLocaleString('en')} تعليق في ${e.left} فيديو · المتوقع ينتهي ${e.eta ? kw(e.eta) : '—'} (الكويت). مكمّل.\n`);
  }
}

setStage('pushing'); push(`${PART}: ${st.done} videos (end of run)`);
setStage('idle', { current: null, left: total - st.done - st.deferred.length, stopped: stopKind || null });
const p = progress({ running: false, stopped: stopKind || null, stopReason: stopReason || null });
const line = '═'.repeat(44);
const why = {
  time: `وقف لأن الوقت المحدد (${MAX_MIN} دقيقة) خلص — هذا مو خطأ. شغّله مرة ثانية ويكمل.`,
  errors: `${MAX_FAILS} فيديوهات مختلفة فشلت ورا بعض — في شي خربان (${NUM ? 'تيك توك' : 'Zernio'} أو الإنترنت). شغّله بعدين؛ لو تكرر قول لكلود.`,
  machine: `وقف عشان الجهاز: ${stopReason}`,
}[stopKind];
console.log([
  '', line, NUM ? '   بيانات الصهيبي (الأرقام) — الملخص' : '   تعليقات الصهيبي — الملخص', line,
  `المدة ${Math.floor(p.minutes / 60)} ساعة و ${p.minutes % 60} دقيقة`,
  `خلصت: ${p.done} فيديو`,
  ...(NUM ? [] : [
    `تعليقات الناس: ${p.comments.toLocaleString('en')}   · ردود الحساب (مكتوبة بالذكاء، للتسجيل بس): ${p.accountReplies.toLocaleString('en')}`,
    `انستقرام: ${p.igMatched} فيديو مربوط · ${p.igComments.toLocaleString('en')} تعليق`]),
  `انحطّت على جنب: ${p.deferred.length}`,
  `باقي: ${p.left} من ${total}`,
  ...(p.etaKuwait && p.left ? [`لو كمّل بنفس السرعة يخلص تقريبًا: ${p.etaKuwait} (توقيت الكويت)`] : []),
  '',
  why || (p.left === 0 ? 'خلص كله. 🎉' : 'خلص التشغيل بدون مشاكل.'),
  ...(p.deferred.length ? ['', 'اللي انحطّت على جنب:', ...p.deferred.map((d) => `   - ${d.id} — ${d.reason}`)] : []),
  '', NUM ? 'ما استخدم Claude ولا Gemini ولا Zernio — أرقام من yt-dlp بس.' : 'ما استخدم Claude ولا Gemini أبدًا — تعليقات بس، بدون أسماء الناس.',
].join('\n'));
if (['errors', 'machine'].includes(stopKind)) alert(`⚠️ alsuhaiby.com — ${NUM ? 'الأرقام' : 'التعليقات'} وقفت\n${why}`);
