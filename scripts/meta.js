// meta.js — METADATA + COMMENTS ONLY (desktop shortcut «بيانات الصهيبي», or `npm run meta`):
//   for every library video (highest views first) store its numbers, details, platform links and its COMMENTS, in the private
//   library: meta.json (id → numbers/details/links, each with its source and capture date) and comments/<id>.json.
//   ZERO AI: no Claude, no Gemini. Enforced like fetch: ALSUHAIBY_NO_AI=1 makes any chat() call throw; this file imports no AI step.
//   Privacy: commenter names, handles, ids and pictures are NEVER written — only text, date, likes, reply flags.
//   His account's own replies are kept apart (accountReplies[], account_reply: true, ai_written: true): an employee wrote them
//   with an AI, so they are never a source of his words, only a record of which questions were already answered.
//   Sources: comments = Zernio (works for old videos too, asked by video id). Numbers = Zernio analytics for the posts it lists
//   (~last 90 per platform), yt-dlp metadata for the rest; details (duration, publish time, caption) = yt-dlp.
//   Instagram: Zernio's Instagram posts are matched to TikTok videos by caption + date; matched ones get their link, numbers and comments.
//   Pace: Zernio at `zernioPerMinute` (config/site.json, default 45 of the plan's 60/min — the daily cloud job shares the key;
//   raise it when that job is not running, or `--rate=55`); yt-dlp one at a time, 8 s + jitter apart (metadata only, no video).
//   A video that fails is set aside (meta.json deferred, reason + date), no retry; 5 different videos failing in a row = stop.
//   Resumable (a video is done when meta.json says complete), `--minutes=N`, machine guard, live window, push every 10 videos.
//     npm run meta                         all, until done
//     npm run meta -- --minutes=120        time limit (the video in progress is finished first)
//     npm run meta -- --limit 3            stop after 3 videos
//     npm run meta -- --ids a,b            only these (also redoes them)
//     npm run meta -- --dry-run            show the plan, no network
process.env.ALSUHAIBY_NO_AI = '1';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, LIB_DIR, args, readJson, writeJson } from './lib/common.js';
import { gitSync } from './lib/pipeline.js';
import { guard, alert } from './lib/status.js';
import { machineGate, MachineStopError, setStage, startStage } from './lib/machine.js';
guard('meta');

const A = args();
const DRY = !!A['dry-run'];
const LIMIT = A.limit ? Number(A.limit) : Infinity;
const MAX_MIN = Number(A.minutes ?? 0) || 0;
const IDS = A.ids ? new Set(String(A.ids).split(',').map((s) => s.trim()).filter(Boolean)) : null;
const CFG = readJson(path.join(ROOT, 'config', 'site.json'), {});
const RATE = Number(A.rate ?? CFG.zernioPerMinute ?? 45) || 45;
const YT_GAP_MS = Number(process.env.META_YT_GAP_MS || 8e3), YT_JITTER_MS = Number(process.env.META_YT_JITTER_MS || 4e3);
const MAX_FAILS = 5, PUSH_EVERY = 10, NOTE_AFTER = 100;
const TT_ACC = '6ad904df848485f37f93284a', IG_ACC = '6ad9041d5efe4d7453bc190c'; // Zernio account ids: @m_alsuhaiby, mohammad_alsuhaiby
const META = path.join(LIB_DIR, 'meta.json'), CDIR = path.join(LIB_DIR, 'comments');
const PROGRESS = path.join(ROOT, 'data', 'run-meta.json'), LOG = path.join(ROOT, 'data', 'run-meta.log');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const k of ['log', 'warn', 'error']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { orig(...a); try { fs.appendFileSync(LOG, a.map(String).join(' ') + '\n'); } catch {} };
}

// ---- Zernio key: read from .env at run time, never printed or written anywhere else ----------------
function zernioKey() {
  if (process.env.ZERNIO_API_KEY) return process.env.ZERNIO_API_KEY;
  const f = path.join(ROOT, '.env');
  if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*ZERNIO_API_KEY\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^['"]|['"]$/g, '');
  }
  return '';
}
const KEY = DRY ? '' : zernioKey();
if (!DRY && !KEY) { console.error('ZERNIO_API_KEY is missing in .env'); process.exit(1); }
const hide = (s) => (KEY ? String(s).replaceAll(KEY, '[secret]') : String(s));

// ---- Zernio calls at RATE per minute (sliding window); 429 → wait Retry-After; 5xx → short waits ------
const recent = [];
let zCalls = 0;
async function zget(p, q = {}) {
  for (let attempt = 1; ; attempt++) {
    const now = Date.now();
    while (recent.length && now - recent[0] > 60e3) recent.shift();
    if (recent.length >= RATE) { await sleep(60e3 - (now - recent[0]) + 50); continue; }
    recent.push(Date.now()); zCalls++;
    const u = new URL('https://zernio.com/api' + p);
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    let r;
    try { r = await fetch(u, { headers: { Authorization: `Bearer ${KEY}` } }); } catch (e) {
      if (attempt >= 4) throw new Error(`Zernio network: ${hide(e.message).slice(0, 150)}`);
      await sleep(15e3 * attempt); continue;
    }
    if (r.status === 429) { const wait = (Number(r.headers.get('retry-after')) || 30) * 1e3; console.warn(`  ⏳ Zernio asks to wait ${Math.round(wait / 1e3)} s`); await sleep(wait); attempt--; continue; }
    if (r.status >= 500 && attempt < 4) { await sleep(10e3 * attempt); continue; }
    const t = await r.text();
    if (!r.ok) throw new Error(`Zernio ${r.status}: ${hide(t).slice(0, 150)}`);
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
  let cursor = null, guardPages = 0;
  const tops = [];
  do {
    const j = await zget(`/v1/inbox/comments/${encodeURIComponent(postId)}`, { accountId: acc, limit: 100, cursor });
    for (const c of j.comments || []) { add(c, null); tops.push(c); }
    cursor = j.pagination?.hasMore ? j.pagination.cursor : null;
  } while (cursor && ++guardPages < 2000);
  for (const c of tops) {
    if (!(c.replyCount > 0)) continue;
    let rc = null, n = 0;
    do {
      const j = await zget(`/v1/inbox/comments/${encodeURIComponent(postId)}`, { accountId: acc, commentId: c.id, limit: 100, cursor: rc });
      for (const x of j.comments || []) if (x.id !== c.id) add(x, c.id);
      rc = j.pagination?.hasMore ? j.pagination.cursor : null;
    } while (rc && ++n < 200);
  }
  return { comments, accountReplies };
}

// ---- yt-dlp metadata (no video download, no comments) ---------------------------------------------
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
const isoDay = (t) => (t ? new Date(t * 1e3).toISOString() : null);

// ---- Instagram ↔ TikTok match by caption + date -------------------------------------------------------
const norm = (s) => String(s || '').replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim().toLowerCase();
const grams = (s) => { const t = norm(s).replace(/ /g, ''); const g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };
const sim = (a, b) => { const A = grams(a), B = grams(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n); };
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
  const out = new Map(); // tiktokId → { ig, score, days }
  const used = new Set();
  const cands = [];
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

// ---- the list ----------------------------------------------------------------------------------------
const lib = readJson(path.join(LIB_DIR, 'library.json'), { videos: [] }).videos;
let meta = readJson(META, {});
let todo = lib.filter((v) => (IDS ? IDS.has(v.id) : !meta[v.id]?.complete && !meta[v.id]?.deferred)).sort((a, b) => (b.views || 0) - (a.views || 0));
const total = todo.length;
const viewsLeftAll = todo.reduce((s, v) => s + (v.views || 0), 0);
console.log(`meta: ${total} of ${lib.length} videos to do (highest views first) · Zernio ${RATE}/min · time limit ${MAX_MIN ? `${MAX_MIN} min` : 'none'} · NO AI`);
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
  // remaining work ≈ comments still to fetch (views left × comments-per-view seen so far) + a fixed cost per video
  const ratio = st.viewsDone ? st.expectedDone / st.viewsDone : 0.0008;
  const viewsLeft = viewsLeftAll - st.viewsDone - st.deferred.reduce((s, d) => s + (d.views || 0), 0);
  const commentsLeft = Math.round(viewsLeft * ratio);
  const left = total - st.done - st.deferred.length;
  const K = 15; // one video's fixed cost ≈ 15 comments' worth (yt-dlp gap + first page)
  const unitsDone = st.comments + st.accountReplies + st.igComments + K * st.done;
  const ms = unitsDone ? ((Date.now() - startedAt) / unitsDone) * (commentsLeft + K * left) : null;
  return { left, commentsLeft, totalComments: st.expectedDone + commentsLeft, eta: ms !== null ? Date.now() + ms : null };
}
function progress(extra = {}) {
  const e = estimate(); const hours = Math.max((Date.now() - startedAt) / 3600e3, 1 / 60);
  const p = { startedAt: new Date(startedAt).toISOString(), updatedAt: new Date().toISOString(), minutes: Math.round(hours * 60), total, ...st,
    left: e.left, perHour: Math.round((st.done / hours) * 10) / 10, zernioCalls: zCalls, rate: RATE, estTotalComments: e.totalComments,
    etaKuwait: e.eta ? kw(e.eta) : null, maxMinutes: MAX_MIN || null, running: true, stopped: null, ...extra };
  writeJson(PROGRESS, p);
  return p;
}
function liveLine(p) {
  process.title = `alsuhaiby meta - ${p.done} done / ${p.left} left / ${p.comments} comments${p.etaKuwait ? ` / ETA ${p.etaKuwait} Kuwait` : ''}`;
  console.log(`  ── خلص ${p.done} · باقي ${p.left} · تعليقات ${p.comments.toLocaleString('en')} · بالساعة ${p.perHour} فيديو${p.etaKuwait ? ` · المتوقع ينتهي ${p.etaKuwait} (الكويت)` : ''}`);
}
const push = (msg) => { try { gitSync(LIB_DIR, ['meta.json', 'comments'], msg); } catch (e) { console.warn(`  ! push (library): ${hide(e.message).slice(0, 200)}`); } };
const saveMeta = (id, rec) => { meta = readJson(META, {}); meta[id] = rec; writeJson(META, meta); };

fs.appendFileSync(LOG, `\n===== meta run ${new Date(startedAt).toISOString()} =====\n`);
await startStage('meta', { left: total });

// Zernio's own lists, once per run: TikTok numbers for the posts it tracks, and the Instagram posts to match
const zTiktok = new Map();
try {
  let page = 1, pages = 1;
  do {
    const j = await zget('/v1/analytics', { accountId: TT_ACC, platform: 'tiktok', source: 'external', limit: 100, page, sortBy: 'date', order: 'desc' });
    pages = j.pagination?.pages || 1;
    for (const p of j.posts || []) {
      const pl = (p.platforms || []).find((x) => x.platform === 'tiktok') || {}; const a = p.analytics || {};
      const id = pl.platformPostId || (String(p.platformPostUrl || pl.platformPostUrl || '').match(/video\/(\d+)/) || [])[1];
      if (id) zTiktok.set(String(id), { views: a.views ?? null, likes: a.likes ?? null, comments: a.comments ?? null, shares: a.shares ?? null, saves: a.saves ?? null });
    }
  } while (++page <= pages && page < 20);
} catch (e) { console.warn(`  ! Zernio TikTok numbers: ${hide(e.message).slice(0, 150)} (yt-dlp numbers will be used)`); }
let igMatch = new Map(), igCount = 0;
try { const ig = await instagramPosts(); igCount = ig.length; igMatch = matchInstagram(ig, lib); }
catch (e) { console.warn(`  ! Instagram list: ${hide(e.message).slice(0, 150)} (Instagram skipped this run)`); }
console.log(`Zernio: TikTok numbers for ${zTiktok.size} posts · Instagram ${igCount} posts, ${igMatch.size} matched to TikTok videos`);
liveLine(progress());

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
  const now = new Date().toISOString();
  try {
    // 1. details + numbers (yt-dlp); a yt-dlp failure alone does not set the video aside — Zernio may still have it
    let y = null, ytErr = null;
    try { y = await ytMeta(v.id); } catch (e) { ytErr = e.message; console.warn(`  ! yt-dlp: ${ytErr.slice(0, 150)}`); }
    const z = zTiktok.get(v.id);
    const ytStats = y ? { views: y.view_count ?? null, likes: y.like_count ?? null, comments: y.comment_count ?? null, shares: y.repost_count ?? null, saves: y.save_count ?? null } : null;
    const stats = z ? { ...z, source: 'zernio', capturedAt: now } : ytStats ? { ...ytStats, source: 'yt-dlp', capturedAt: now } : null;
    const caption = y?.description ?? v.cap ?? '';
    const details = { publishedAt: y ? isoDay(y.timestamp) : null, date: v.date, duration: y?.duration ?? null, caption, hashtags: hashtags(caption),
      source: y ? 'yt-dlp' : 'library', capturedAt: now, ...(ytErr ? { ytError: ytErr.slice(0, 200) } : {}) };
    // 2. TikTok comments (Zernio)
    const tt = await thread(v.id, TT_ACC);
    const expected = stats?.comments ?? null;
    const rec = { tiktok: { source: 'zernio', capturedAt: new Date().toISOString(), expectedCount: expected, gotCount: tt.comments.length + tt.accountReplies.length, comments: tt.comments, accountReplies: tt.accountReplies } };
    const links = { tiktok: `https://www.tiktok.com/@m_alsuhaiby/video/${v.id}` };
    // 3. Instagram, when matched
    let instagram = null;
    const m = igMatch.get(v.id);
    if (m) {
      const ig = await thread(m.ig.id, IG_ACC);
      rec.instagram = { source: 'zernio', postId: m.ig.id, capturedAt: new Date().toISOString(), expectedCount: m.ig.stats.comments ?? null, gotCount: ig.comments.length + ig.accountReplies.length, comments: ig.comments, accountReplies: ig.accountReplies };
      if (m.ig.url) links.instagram = m.ig.url;
      instagram = { postId: m.ig.id, url: m.ig.url, publishedAt: m.ig.at, match: { by: 'caption+date', score: m.score, days: m.days }, stats: { ...m.ig.stats, source: 'zernio', capturedAt: now } };
      st.igMatched++; st.igComments += ig.comments.length + ig.accountReplies.length;
    }
    writeJson(path.join(CDIR, `${v.id}.json`), { id: v.id, capturedAt: new Date().toISOString(), note: 'No commenter names or handles are stored. accountReplies were written by an employee with an AI (ai_written): never his own words.', ...rec });
    saveMeta(v.id, { complete: true, capturedAt: new Date().toISOString(), links, stats, ...(ytStats && z ? { ytdlpStats: { ...ytStats, capturedAt: now } } : {}), details,
      ...(instagram ? { instagram } : {}), comments: { tiktok: rec.tiktok.gotCount, ...(rec.instagram ? { instagram: rec.instagram.gotCount } : {}), file: `comments/${v.id}.json` } });
    st.done++; st.comments += tt.comments.length; st.accountReplies += tt.accountReplies.length;
    st.expectedDone += expected || 0; st.viewsDone += v.views || 0;
    failStreak = 0;
    console.log(`  ✓ ${tt.comments.length} comments + ${tt.accountReplies.length} account replies${expected != null ? ` (TikTok says ${expected})` : ''}${m ? ` · Instagram ${rec.instagram.gotCount}` : ''} · numbers from ${stats?.source || 'none'}`);
    if (st.done % PUSH_EVERY === 0) { setStage('pushing'); push(`meta: ${st.done} videos with numbers + comments`); }
  } catch (e) {
    // set aside on the first failure (his rule): no retry; 5 DIFFERENT videos in a row = Zernio or the network is down → stop
    const reason = hide(e.message || String(e)).replace(/\s+/g, ' ').slice(0, 200);
    saveMeta(v.id, { ...(readJson(META, {})[v.id] || {}), deferred: { reason, at: new Date().toISOString() } });
    st.deferred.push({ id: v.id, views: v.views || 0, reason: reason.slice(0, 120) });
    failStreak++;
    console.warn(`  – set aside (${failStreak}/${MAX_FAILS} different videos in a row): ${reason.slice(0, 160)}`);
    if (failStreak >= MAX_FAILS) {
      const last = st.deferred.slice(-MAX_FAILS); const g = readJson(META, {});
      for (const d of last) if (g[d.id]) delete g[d.id].deferred;
      writeJson(META, g); st.deferred = st.deferred.slice(0, -MAX_FAILS);
      stopKind = 'errors'; stopReason = `${MAX_FAILS} different videos failed in a row; last: ${reason.slice(0, 150)}`;
      break;
    }
  }
  const p = progress(); liveLine(p);
  if (!noted && st.done >= NOTE_AFTER) {
    noted = true; const e = estimate();
    console.log(`\n  📝 بعد ${st.done} فيديو: الإجمالي المتوقع للتعليقات تقريبًا ${e.totalComments.toLocaleString('en')} · باقي تقريبًا ${e.commentsLeft.toLocaleString('en')} تعليق في ${e.left} فيديو · المتوقع ينتهي ${e.eta ? kw(e.eta) : '—'} (الكويت). مكمّل.\n`);
  }
}

setStage('pushing'); push(`meta: ${st.done} videos with numbers + comments (end of run)`);
setStage('idle', { current: null, left: total - st.done - st.deferred.length, stopped: stopKind || null });
const p = progress({ running: false, stopped: stopKind || null, stopReason: stopReason || null });
const line = '═'.repeat(44);
const why = {
  time: `وقف لأن الوقت المحدد (${MAX_MIN} دقيقة) خلص — هذا مو خطأ. شغّله مرة ثانية ويكمل.`,
  errors: `${MAX_FAILS} فيديوهات مختلفة فشلت ورا بعض — في شي خربان (Zernio أو الإنترنت). شغّله بعدين؛ لو تكرر قول لكلود.`,
  machine: `وقف عشان الجهاز: ${stopReason}`,
}[stopKind];
console.log([
  '', line, '   بيانات الصهيبي — الملخص', line,
  `المدة ${Math.floor(p.minutes / 60)} ساعة و ${p.minutes % 60} دقيقة`,
  `خلصت: ${p.done} فيديو`,
  `تعليقات الناس: ${p.comments.toLocaleString('en')}   · ردود الحساب (مكتوبة بالذكاء، للتسجيل بس): ${p.accountReplies.toLocaleString('en')}`,
  `انستقرام: ${p.igMatched} فيديو مربوط · ${p.igComments.toLocaleString('en')} تعليق`,
  `انحطّت على جنب: ${p.deferred.length}`,
  `باقي: ${p.left} من ${total}`,
  ...(p.etaKuwait && p.left ? [`لو كمّل بنفس السرعة يخلص تقريبًا: ${p.etaKuwait} (توقيت الكويت)`] : []),
  '',
  why || (p.left === 0 ? 'خلصت البيانات كلها. 🎉' : 'خلص التشغيل بدون مشاكل.'),
  ...(p.deferred.length ? ['', 'اللي انحطّت على جنب:', ...p.deferred.map((d) => `   - ${d.id} — ${d.reason}`)] : []),
  '', 'ما استخدم Claude ولا Gemini أبدًا — أرقام وتعليقات بس، بدون أسماء الناس.',
].join('\n'));
if (['errors', 'machine'].includes(stopKind)) alert(`⚠️ alsuhaiby.com — البيانات وقفت\n${why}`);
