// pipeline.js — the steps both lines share: download (yt-dlp) → analyze (Gemini) → dedup decision → merge or queue a page → git sync.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { ROOT, LIB_DIR, DOWNLOAD_DIR, MODEL, readJson, writeJson, cachePath, chat, loadLedger, DONE, videoIndex } from './common.js';
import { images, uploadVideo, pageMarkdown, addOtherVideo, pageIndex, slugify, clean, duration, QUEUE, PAGES_AR } from './page.js';
import { assertPublishable, publishData } from './publishable.js';

export const ANALYZE_PROMPT = `You are watching a short car-repair video by Mohammad Al-Suhaiby (محمد الصهيبي), a Kuwaiti mechanic. Watch it fully, with sound and picture.
Return ONLY a JSON object with these keys, all text in Arabic exactly as spoken (Kuwaiti dialect, do not correct or rephrase his words):
{
  "transcript": "full spoken transcript, word for word",
  "onScreenText": "all text that appears on screen, in order",
  "hook": "the first sentence he says",
  "topic": "one short sentence: what the video is about, starting with the symptom the driver feels",
  "type": "عرض مشكلة | تحذير | سؤال مباشر | أخرى",
  "system": "one of: محرك, قير, مكيف, فرامل, كهرباء, تواير, وقود, تبريد, تعليق وتوجيه, عادات وصيانة",
  "brands": ["car brands he names, empty if none"],
  "items": [{"name": "each cause / sign / step he lists, in his words", "whatHeSaid": "everything he says about it"}],
  "cta": "the call to action he gives (follow, comment, garage location...), empty if none"
}
Never add information he did not say.`;

// ---- 1. download ------------------------------------------------------------------------------
export class RateLimitError extends Error {}
/** Downloads the TikTok video with yt-dlp into DOWNLOAD_DIR/<id>.mp4. Throws RateLimitError when TikTok pushes back. */
export function download(v, { cookiesFrom } = {}) {
  if (v.path && fs.existsSync(v.path)) return v.path;
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const out = path.join(DOWNLOAD_DIR, `${v.id}.mp4`);
  const r = spawnSync('python', ['-m', 'yt_dlp', '-q', '--no-warnings', '--no-progress', ...(cookiesFrom ? ['--cookies-from-browser', cookiesFrom] : []), '-f', 'mp4/best', '-o', out, `https://www.tiktok.com/@m_alsuhaiby/video/${v.id}`], { encoding: 'utf8', timeout: 30e3 }); // his rule: nothing may stall more than 30 s
  if (r.error?.code === 'ETIMEDOUT') { try { fs.rmSync(out, { force: true }); fs.rmSync(out + '.part', { force: true }); } catch {} throw new Error(`download ${v.id}: no answer within 30 s (skipped)`); }
  if (r.status !== 0 || !fs.existsSync(out)) {
    const err = String(r.stderr || r.error || 'yt-dlp failed').trim().split('\n').pop().slice(0, 300);
    if (/429|too many|rate.?limit|blocked|captcha/i.test(err)) throw new RateLimitError(err);
    throw new Error(`download ${v.id}: ${err}`);
  }
  Object.assign(v, { file: path.basename(out), path: out });
  return out;
}

// ---- 2. analyze (Gemini watches the video; the only paid call in Line 1) ------------------------
export async function analyze(v, { script = 'analyze' } = {}) {
  const out = cachePath(v, 'analysis');
  if (fs.existsSync(out)) return readJson(out);
  let file = v.path;
  if (fs.statSync(file).size > 15 * 1024 * 1024) { // keep the request small: Gemini only needs to see and hear it
    file = path.join(os.tmpdir(), `${v.id}-small.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', v.path, '-vf', 'scale=-2:720', '-b:v', '900k', '-b:a', '96k', file]);
  }
  const b64 = fs.readFileSync(file).toString('base64');
  const res = await chat({
    script, label: `${v.id} analyze`, temperature: 0.1, maxTokens: 4000,
    messages: [{ role: 'user', content: [{ type: 'text', text: ANALYZE_PROMPT }, { type: 'video_url', video_url: { url: `data:video/mp4;base64,${b64}` } }] }],
  });
  const data = { id: v.id, source: 'gemini', model: MODEL, analyzedAt: new Date().toISOString(), ...res };
  writeJson(out, data);
  return data;
}

// ---- 3. dedup: a new topic, a repeat of a page (live or queued), or not an article at all? ------
const DEDUP = `You keep the topic list of a car-repair website made from the short videos of محمد الصهيبي, a Kuwaiti mechanic. One page per topic (one symptom / question / piece of advice).
You get one new video (his transcript) and the list of pages that already exist or are queued.
Decide:
- "duplicate": the video answers the SAME driver question / symptom as one listed page (same causes or signs, even in other words or a shorter version). Give that page's slug. It will be embedded on that page, not become a new page.
- "new": it answers a question no listed page answers (a different symptom, a different part's failure signs, a different piece of advice).
- "skip": it has no useful car content a driver would search for (greeting, ad, personal clip, garage tour, a joke, only a call to action). Useful buying, driving or maintenance advice (e.g. which cars use less fuel, habits that hurt the car) IS a topic, not a skip.
When unsure between duplicate and new, choose "new" only if a driver would search for it with different words AND get a different answer.
Return ONLY JSON: {"decision":"new|duplicate|skip","slug":"slug of the page, only for duplicate","reason":"one short English sentence"}`;

export async function decide({ v, an, model = MODEL, script = 'dedup' }) {
  const pages = pageIndex();
  const list = pages.map((p) => `- ${p.slug} | ${p.title} | ${p.summary}`).join('\n') || '(no pages yet)';
  const d = await chat({
    script, label: `${v.id} dedup`, model, temperature: 0, maxTokens: 800,
    messages: [{ role: 'system', content: DEDUP }, { role: 'user', content: `NEW VIDEO ${v.id}\nTopic: ${an.topic || an.hook || '-'}\nSpoken: ${an.transcript}\nOn screen: ${an.onScreenText || '-'}\n\nEXISTING PAGES (slug | title | first line)\n${list}` }],
  });
  if (d.decision === 'duplicate' && !pages.some((p) => p.slug === d.slug)) { d.reason = `named an unknown page (${d.slug}); treated as new`; d.decision = 'new'; }
  if (!['new', 'duplicate', 'skip'].includes(d.decision)) d.decision = 'new';
  writeJson(cachePath(v, 'dedup'), { ...d, decidedAt: new Date().toISOString(), comparedWith: pages.length });
  return { ...d, page: pages.find((p) => p.slug === d.slug) };
}

// ---- 4a. merge: embed the video on the existing page -------------------------------------------
export function mergeInto(page, v, an) {
  assertPublishable(v.id, publishData(), { needFile: false }); // owner's rule: no embed for a video with incomplete data (it uploads the file itself)
  const dir = page.where === 'queue' ? path.dirname(page.file) : null;
  const img = images(v, dir);
  uploadVideo(v);
  return addOtherVideo(page.file, { tiktokId: v.id, title: clean(an.hook || an.topic || ''), views: v.views, published: v.date, cover: img.cover });
}

// ---- 4b. new page: reviewed article → queue/<id>/ (page.md + its images), MP4 on R2 -------------
export function uniqueSlug(s) {
  const taken = new Set(pageIndex().map((p) => p.slug));
  let slug = slugify(s), n = 2;
  while (taken.has(slug)) slug = `${slugify(s)}-${n++}`;
  return slug;
}
export function queuePage(v, final, { topic } = {}) {
  assertPublishable(v.id, publishData(), { needFile: false }); // owner's rule: no page for a video with incomplete data (it uploads the file itself)
  const dir = path.join(QUEUE, v.id);
  fs.mkdirSync(dir, { recursive: true });
  const img = images(v, dir);
  uploadVideo(v);
  const slug = uniqueSlug(final.slug || final.title);
  fs.writeFileSync(path.join(dir, 'page.md'), pageMarkdown({ topic: topic || `tk-${v.id}`, main: v, w: final, img, dur: duration(v.path), slug, updated: new Date().toISOString().slice(0, 10) }), 'utf8');
  writeJson(path.join(dir, 'meta.json'), { id: v.id, slug, title: clean(final.title), views: v.views, queuedAt: new Date().toISOString() });
  return slug;
}

/** Moves a queued page live: page.md → content/videos/ar/<slug>.md, its images → public/covers and public/og. */
export function publishQueued(id) {
  assertPublishable(id); // owner's rule: nothing goes live without its file on R2 AND its numbers, even if it is in the queue
  const dir = path.join(QUEUE, id);
  const meta = readJson(path.join(dir, 'meta.json'));
  const dest = path.join(PAGES_AR, `${meta.slug}.md`);
  if (fs.existsSync(dest)) throw new Error(`page ${meta.slug} already exists`);
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.webp')) fs.renameSync(path.join(dir, f), path.join(ROOT, 'public', 'covers', f));
    if (f.endsWith('.jpg')) fs.renameSync(path.join(dir, f), path.join(ROOT, 'public', 'og', f));
  }
  fs.renameSync(path.join(dir, 'page.md'), dest);
  fs.rmSync(dir, { recursive: true, force: true }); // only the emptied queue folder (meta.json); the page now lives in content/
  return meta;
}

export const queued = () => (fs.existsSync(QUEUE) ? fs.readdirSync(QUEUE).filter((d) => fs.existsSync(path.join(QUEUE, d, 'meta.json'))).map((d) => readJson(path.join(QUEUE, d, 'meta.json'))) : []);

/** The true remaining archive: library videos not yet published, queued, merged or skipped. */
export function remaining() {
  const ledger = loadLedger();
  return [...videoIndex().values()].filter((v) => !DONE.has(ledger[v.id]?.status));
}

// ---- 5. git: commit the given paths, rebase on the remote, re-merge the shared JSON logs, push ---
export const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const UNION = {
  'data/r2.json': (a, b) => ({ ...a, ...b }),
  'data/spend.json': (a, b) => {
    const seen = new Set();
    const calls = [...(a.calls || []), ...(b.calls || [])].filter((c) => { const k = `${c.at}|${c.label}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((x, y) => x.at.localeCompare(y.at));
    return { totalUsd: Math.round(calls.reduce((s, c) => s + (c.costUsd || 0), 0) * 1e6) / 1e6, calls };
  },
  'data/published.json': (a, b) => ({ ...a, ...b }),
  'fetched.json': (a, b) => ({ ...a, ...b }),
  'ledger.json': (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) if (!o[k] || (v.at || '') >= (o[k].at || '')) o[k] = v; return o; },
  'library.json': (a, b) => { const m = new Map((a.videos || []).map((v) => [v.id, v])); for (const v of b.videos || []) m.set(v.id, { ...m.get(v.id), ...v }); return { ...a, ...b, videos: [...m.values()] }; },
};
export function gitSync(cwd, paths, message, { push = true } = {}) {
  const mine = {};
  for (const f of Object.keys(UNION)) if (fs.existsSync(path.join(cwd, f))) mine[f] = readJson(path.join(cwd, f));
  const real = paths.filter((x) => fs.existsSync(path.join(cwd, x)) || git(cwd, 'ls-files', '--', x)); // a path that never existed would stop git add
  if (real.length) git(cwd, 'add', '-A', '--', ...real);
  if (!git(cwd, 'diff', '--cached', '--name-only')) return false;
  git(cwd, 'commit', '-q', '-m', message);
  if (!push) return true;
  for (let i = 1; i <= 3; i++) {
    try {
      git(cwd, 'pull', '-q', '--rebase', '--autostash', '-X', 'theirs');
      const fixed = [];
      for (const [f, fn] of Object.entries(UNION)) {
        if (!mine[f]) continue;
        const p = path.join(cwd, f);
        const now = readJson(p, {});
        const merged = fn(now, mine[f]);
        if (JSON.stringify(merged) !== JSON.stringify(now)) { writeJson(p, merged); fixed.push(f); }
      }
      if (fixed.length) { git(cwd, 'add', '--', ...fixed); git(cwd, 'commit', '-q', '-m', 'merge shared logs'); }
      git(cwd, 'push', '-q');
      return true;
    } catch (e) {
      try { git(cwd, 'rebase', '--abort'); } catch {}
      if (i === 3) throw new Error(`git push failed in ${path.basename(cwd)}: ${String(e.stderr || e.message).slice(0, 300)}`);
    }
  }
}
export { LIB_DIR };
