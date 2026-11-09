// fetch.js — DOWNLOAD ONLY (desktop shortcut «تنزيل الصهيبي», or `npm run fetch`):
//   for each archive video (highest views first) that is not on R2 yet:  yt-dlp download → MP4 to R2 → record in the private library.
//   ZERO AI: no Claude subscription, no Gemini, no writing, no review, no dedup, no watching. Enforced: ALSUHAIBY_NO_AI=1 makes
//   any chat() call throw (scripts/lib/common.js), and this file imports no AI step.
//   Gentle with TikTok: one at a time, 20 s + random 0–10 s between TikTok downloads; a refusal (429 / 403 / blocked) → back-off
//   1, 2, 4, 8, 16 min (doubling) and the same video again; 5 failures in a row → clean stop with an Arabic message (+ one ⚠️).
//   A video already on disk (old export or an earlier download) is only uploaded: TikTok is not touched, no wait.
//   Resumable: done = in data/r2.json (written right after each upload), so a closed window loses nothing.
//   Machine guard between videos (slow / pause / stop), like night.js.
//     npm run fetch                         until done
//     npm run fetch -- --minutes=60         time limit (the video in progress is finished first)
//     npm run fetch -- --limit 10           stop after 10 videos
//     npm run fetch -- --dry-run            show what it would do
//   Records: library repo fetched.json (id → { at, bytes, from }) · progress data/run-fetch.json · log data/run-fetch.log.
process.env.ALSUHAIBY_NO_AI = '1';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, LIB_DIR, args, readJson, writeJson, loadLedger, videoIndex } from './lib/common.js';
import { download, gitSync, RateLimitError } from './lib/pipeline.js';
import { uploadVideo, R2_MANIFEST } from './lib/page.js';
import { guard, alert } from './lib/status.js';
import { machineGate, MachineStopError, setStage, startStage } from './lib/machine.js';
guard('fetch');

const A = args();
const DRY = !!A['dry-run'];
const LIMIT = A.limit ? Number(A.limit) : Infinity;
const MAX_MIN = Number(A.minutes ?? 0) || 0;
const GAP_MS = Number(process.env.FETCH_GAP_MS || 20e3), JITTER_MS = Number(process.env.FETCH_JITTER_MS || 10e3);
const BACKOFF_MS = Number(process.env.FETCH_BACKOFF_MS || 60e3); // first back-off; doubles each refusal in a row
const MAX_FAILS = 5;
const FETCHED = path.join(LIB_DIR, 'fetched.json');
const PROGRESS = path.join(ROOT, 'data', 'run-fetch.json'), LOG = path.join(ROOT, 'data', 'run-fetch.log');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const k of ['log', 'warn', 'error']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { orig(...a); try { fs.appendFileSync(LOG, a.map(String).join(' ') + '\n'); } catch {} };
}

// to do: not on R2 yet, not judged "skipped" (no page will ever show it), not failed 3 times (waits for a human look)
const r2 = readJson(R2_MANIFEST, {}), ledger = loadLedger(), fetched = readJson(FETCHED, {});
let todo = [...videoIndex().values()].filter((v) => !r2[v.id] && ledger[v.id]?.status !== 'skipped' && (fetched[v.id]?.tries || 0) < 3)
  .sort((a, b) => b.views - a.views);
const total = todo.length;
const onDisk = todo.filter((v) => v.path && fs.existsSync(v.path)).length;
console.log(`fetch: ${total} videos not on R2 yet (${onDisk} already on disk → upload only, ${total - onDisk} from TikTok) · time limit ${MAX_MIN ? `${MAX_MIN} min` : 'none'} · NO AI`);
if (DRY) {
  for (const v of todo.slice(0, Number.isFinite(LIMIT) ? LIMIT : 10)) console.log(`  would fetch ${v.id} · ${v.views.toLocaleString('en')} views · ${v.path ? 'on disk → R2' : 'TikTok → R2'}`);
  console.log('dry run: nothing downloaded, uploaded or pushed.');
  process.exit(0);
}

const startedAt = Date.now();
const kw = (ms) => { const d = new Date(ms + 3 * 3600e3).toISOString(); return `${d.slice(8, 10)}-${d.slice(5, 7)} ${d.slice(11, 16)}`; };
const st = { done: 0, fromTiktok: 0, fromDisk: 0, mb: 0, failed: [], needsLogin: [], refusals: 0 };
let stopKind = '', stopReason = '';
function progress(extra = {}) {
  const hours = Math.max((Date.now() - startedAt) / 3600e3, 1 / 60);
  const left = total - st.done - st.failed.length - st.needsLogin.length;
  const perHour = st.done / hours;
  const eta = perHour > 0 ? Date.now() + (left / perHour) * 3600e3 : null;
  const p = { startedAt: new Date(startedAt).toISOString(), updatedAt: new Date().toISOString(), minutes: Math.round(hours * 60), total, ...st,
    left, perHour: Math.round(perHour * 10) / 10, etaKuwait: eta ? kw(eta) : null, maxMinutes: MAX_MIN || null, running: true, stopped: null, ...extra };
  writeJson(PROGRESS, p);
  return p;
}
function liveLine(p) {
  // the window: one Arabic status block after each video, plus the title bar (English, readable at a glance)
  process.title = `alsuhaiby fetch - ${p.done} done / ${p.left} left / ${p.perHour} per hour${p.etaKuwait ? ` / ETA ${p.etaKuwait} Kuwait` : ''}`;
  console.log(`  ── خلص ${p.done} · باقي ${p.left} · بالساعة ${p.perHour}${p.etaKuwait ? ` · المتوقع ينتهي ${p.etaKuwait} (الكويت)` : ''}`);
}
const push = (msg) => {
  try { gitSync(LIB_DIR, ['fetched.json'], msg); } catch (e) { console.warn(`  ! push (library): ${e.message.slice(0, 200)}`); }
  try { gitSync(ROOT, ['data/r2.json'], msg); } catch (e) { console.warn(`  ! push (site): ${e.message.slice(0, 200)}`); }
};

fs.appendFileSync(LOG, `\n===== fetch run ${new Date(startedAt).toISOString()} =====\n`);
await startStage('fetch', { left: total });
liveLine(progress());
let failStreak = 0, sinceTiktok = null;
for (let i = 0; i < todo.length; i++) {
  const v = todo[i];
  if (st.done + st.failed.length + st.needsLogin.length >= LIMIT) break;
  if (MAX_MIN && Date.now() - startedAt >= MAX_MIN * 60e3) { stopKind = 'time'; stopReason = `time limit reached (${MAX_MIN} min)`; break; }
  try { await machineGate(); } catch (e) {
    if (e instanceof MachineStopError) { stopKind = 'machine'; stopReason = e.message; console.warn(`  ⛔ ${e.message}`); break; }
    throw e;
  }
  const local = !!(v.path && fs.existsSync(v.path));
  if (!local && sinceTiktok !== null) { // be gentle: 20 s + jitter since the last TikTok request
    const wait = GAP_MS + Math.random() * JITTER_MS - (Date.now() - sinceTiktok);
    if (wait > 0) await sleep(wait);
  }
  console.log(`\n[${new Date().toLocaleTimeString('en-GB')}] ${v.id} · ${v.views.toLocaleString('en')} views · ${local ? 'on disk' : 'TikTok'}`);
  try {
    if (!local) { setStage('downloading', { current: v.id, left: total - st.done }); sinceTiktok = Date.now(); download(v); }
    setStage('uploading', { current: v.id });
    uploadVideo(v);
    const bytes = fs.statSync(v.path).size;
    writeJson(FETCHED, { ...readJson(FETCHED, {}), [v.id]: { at: new Date().toISOString(), bytes, from: local ? 'disk' : 'tiktok' } });
    st.done++; st.mb += bytes / 1e6; local ? st.fromDisk++ : st.fromTiktok++;
    failStreak = 0;
    console.log(`  ✓ on R2 (${(bytes / 1e6).toFixed(1)} MB)`);
    if (st.done % 5 === 0) { setStage('pushing'); push(`fetch: ${st.done} videos on R2`); }
  } catch (e) {
    // age-restricted on TikTok ("may not be comfortable… Log in for access"): needs his TikTok login, which we do not use.
    // Not a failure of the run: note it once (never retried) and move on without counting toward the 5-in-a-row stop.
    if (/log in for access|not be comfortable|login required|age.?restrict/i.test(e.message)) {
      const f = readJson(FETCHED, {});
      f[v.id] = { ...(f[v.id] || {}), needsLogin: true, tries: 3, failed: 'age-restricted on TikTok: needs a login', at: new Date().toISOString() };
      writeJson(FETCHED, f);
      st.needsLogin.push(v.id);
      console.warn(`  – needs a TikTok login (age-restricted): skipped for good, not counted as a failure`);
      liveLine(progress());
      continue;
    }
    failStreak++;
    const refused = e instanceof RateLimitError || /403|forbidden/i.test(e.message);
    if (refused) st.refusals++;
    console.warn(`  ! ${refused ? 'TikTok refused' : 'failed'} (${failStreak}/${MAX_FAILS} in a row): ${e.message.slice(0, 200)}`);
    if (failStreak >= MAX_FAILS) {
      stopKind = refused ? 'tiktok' : 'errors';
      stopReason = `${MAX_FAILS} failures in a row; last: ${e.message.slice(0, 150)}`;
      if (!refused) st.failed.push(`${v.id}: ${e.message.slice(0, 120)}`);
      break;
    }
    if (refused) { // exponential back-off, then the SAME video again
      const wait = BACKOFF_MS * 2 ** (failStreak - 1);
      console.warn(`  ⏳ waiting ${Math.round(wait / 60e3)} min before trying again (TikTok back-off)`);
      setStage('paused', { why: 'TikTok back-off' });
      await sleep(wait);
      i--; continue;
    }
    const f = readJson(FETCHED, {}); // not a refusal (deleted / private video...): note it, move on
    f[v.id] = { ...(f[v.id] || {}), failed: e.message.slice(0, 200), tries: (f[v.id]?.tries || 0) + 1, at: new Date().toISOString() };
    writeJson(FETCHED, f);
    st.failed.push(`${v.id}: ${e.message.slice(0, 120)}`);
  }
  liveLine(progress());
}

setStage('pushing'); push(`fetch: ${st.done} videos on R2 (end of run)`);
setStage('idle', { current: null, left: total - st.done, stopped: stopKind || null });
const p = progress({ running: false, stopped: stopKind || null, stopReason: stopReason || null });
const line = '═'.repeat(44);
const why = {
  time: `وقف لأن الوقت المحدد (${MAX_MIN} دقيقة) خلص — هذا مو خطأ. شغّله مرة ثانية ويكمل.`,
  tiktok: `وقف لأن تيك توك رفض ${MAX_FAILS} مرات ورا بعض — هذا تيك توك يقول «بس». خلّه ساعتين وبعدين شغّله؛ يكمل من وين ما وقف.`,
  errors: `${MAX_FAILS} فيديوهات فشلت ورا بعض — في شي خربان (الإنترنت أو الرفع). شيّك الإنترنت وشغّله مرة ثانية؛ لو تكرر قول لكلود.`,
  machine: `وقف عشان الجهاز: ${stopReason}`,
}[stopKind];
console.log([
  '', line, '   تنزيل الصهيبي — الملخص', line,
  `المدة ${Math.floor(p.minutes / 60)} ساعة و ${p.minutes % 60} دقيقة`,
  `انرفعت: ${p.done}   (من تيك توك ${p.fromTiktok} · كانت على الجهاز ${p.fromDisk})`,
  `بالساعة: ${p.perHour}`,
  `رفض تيك توك: ${p.refusals} مرة`,
  `فشلت: ${p.failed.length}`,
  `تحتاج دخول تيك توك (مقيّدة بالعمر، تخطّيناها): ${p.needsLogin.length}`,
  `باقي: ${p.left} من ${total}`,
  ...(p.etaKuwait && p.left ? [`لو كمّل بنفس السرعة يخلص تقريبًا: ${p.etaKuwait} (توقيت الكويت)`] : []),
  '',
  why || (p.left === 0 ? 'خلص التنزيل كله. 🎉' : 'خلص التشغيل بدون مشاكل.'),
  ...(p.failed.length ? ['', 'الأخطاء:', ...p.failed.slice(0, 5).map((f) => `   - ${f}`)] : []),
  '', 'ما استخدم Claude ولا Gemini أبدًا — تنزيل ورفع بس.',
].join('\n'));
// Telegram only when something needs him (his rule): a stop on refusals / errors / the machine. Nothing on success or a time stop.
if (['tiktok', 'errors', 'machine'].includes(stopKind)) alert(`⚠️ alsuhaiby.com — التنزيل وقف\n${why}`);
