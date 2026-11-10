// page.js — everything that turns a reviewed article + its video into site files. Shared by build-page.js, night.js and daily.js.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, readJson, writeJson } from './common.js';

export const COVERS = path.join(ROOT, 'public', 'covers');
export const OG = path.join(ROOT, 'public', 'og');
export const QUEUE = path.join(ROOT, 'queue');
export const PAGES_AR = path.join(ROOT, 'content', 'videos', 'ar');

const ff = (a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a]);
export const duration = (p) => Math.round(Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString().trim()));

/** Cover (576px webp), card thumbnail (320px webp) and share image (1200×630 jpg) from the frame at 1.5 s.
 *  dir: where to write (default public/ — a queued page keeps its images in queue/<id>/ until it is published). */
export function images(v, dir = null) {
  const covers = dir || COVERS, og = dir || OG;
  fs.mkdirSync(covers, { recursive: true }); fs.mkdirSync(og, { recursive: true });
  const live = (f) => fs.existsSync(path.join(COVERS, f)) || fs.existsSync(path.join(OG, f));
  const out = (d, f) => path.join(d, f);
  if (!live(`${v.id}.webp`) && !fs.existsSync(out(covers, `${v.id}.webp`))) ff(['-ss', '1.5', '-i', v.path, '-frames:v', '1', '-vf', 'scale=576:-2', '-c:v', 'libwebp', '-quality', '68', out(covers, `${v.id}.webp`)]);
  if (!live(`${v.id}-s.webp`) && !fs.existsSync(out(covers, `${v.id}-s.webp`))) ff(['-ss', '1.5', '-i', v.path, '-frames:v', '1', '-vf', 'scale=320:-2', '-c:v', 'libwebp', '-quality', '62', out(covers, `${v.id}-s.webp`)]);
  if (!live(`${v.id}.jpg`) && !fs.existsSync(out(og, `${v.id}.jpg`))) ff(['-ss', '1.5', '-i', v.path, '-frames:v', '1', '-vf', 'scale=-2:630,pad=1200:630:(ow-iw)/2:0:black', '-q:v', '4', out(og, `${v.id}.jpg`)]);
  return { cover: `/covers/${v.id}.webp`, ogImage: `/og/${v.id}.jpg` };
}

// Mohammad's own MP4s go to Cloudflare R2 (bucket alsuhaiby-media → https://media.alsuhaiby.com/<id>.mp4). MP4s are never committed to git.
// data/r2.json remembers what is already uploaded (id → bytes), so each file is uploaded once.
// Auth: `wrangler login` on his PC; CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in GitHub Actions.
export const R2_MANIFEST = path.join(ROOT, 'data', 'r2.json');
const WRANGLER = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
export function uploadVideo(v, { dryRun = false } = {}) {
  const r2 = readJson(R2_MANIFEST, {});
  const size = fs.statSync(v.path).size;
  if (r2[v.id] || dryRun) return false;
  console.log(`  upload ${v.id}.mp4 to R2 (${(size / 1e6).toFixed(1)} MB)`);
  execFileSync(process.execPath, [WRANGLER, 'r2', 'object', 'put', `alsuhaiby-media/${v.id}.mp4`, '--file', v.path, '--content-type', 'video/mp4', '--cache-control', 'public, max-age=31536000, immutable', '--remote'], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 30e3 }); // his rule: no step may stall more than 30 s
  writeJson(R2_MANIFEST, { ...readJson(R2_MANIFEST, {}), [v.id]: { bytes: size, uploadedAt: new Date().toISOString() } });
  return true;
}

export const yamlStr = (s) => JSON.stringify(String(s ?? ''));
export function frontmatter(o) {
  const lines = ['---'];
  const emit = (k, val, ind = '') => {
    if (Array.isArray(val)) {
      if (!val.length) return lines.push(`${ind}${k}: []`);
      lines.push(`${ind}${k}:`);
      for (const item of val) {
        if (item && typeof item === 'object') {
          const ks = Object.keys(item);
          lines.push(`${ind}  - ${ks[0]}: ${yamlStr(item[ks[0]])}`);
          for (const kk of ks.slice(1)) lines.push(`${ind}    ${kk}: ${typeof item[kk] === 'number' ? item[kk] : yamlStr(item[kk])}`);
        } else lines.push(`${ind}  - ${yamlStr(item)}`);
      }
    } else if (val && typeof val === 'object') {
      lines.push(`${ind}${k}:`);
      for (const [kk, vv] of Object.entries(val)) if (vv !== undefined) emit(kk, vv, ind + '  ');
    } else lines.push(`${ind}${k}: ${typeof val === 'number' ? val : yamlStr(val)}`);
  };
  for (const [k, v] of Object.entries(o)) if (v !== undefined) emit(k, v);
  lines.push('---', '');
  return lines.join('\n');
}

export const clean = (s) => String(s || '').replace(/#\S+/g, '').replace(/[ \t]+\n/g, '\n').trim(); // never print hashtags
export const slugify = (s) => String(s).trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();

/** Arabic page Markdown for one article. */
export function pageMarkdown({ topic, main, w, img, dur, slug, otherVideos = [], updated }) {
  const fm = {
    lang: 'ar', topic, slug, title: clean(w.title), summary: clean(w.summary), description: clean(w.description).slice(0, 160),
    published: main.date, updated, views: main.views, cover: img.cover, ogImage: img.ogImage,
    platforms: { tiktok: `https://www.tiktok.com/@m_alsuhaiby/video/${main.id}` },
    tiktokId: main.id, duration: dur, otherVideos,
    tags: (w.tags || []).map(clean).filter(Boolean).slice(0, 4), system: clean(w.system), brands: (w.brands || []).map(clean).filter(Boolean),
    keywords: (w.keywords || []).map(clean).filter(Boolean).slice(0, 5),
    faq: (w.faq || []).slice(0, 5).map((f) => ({ q: clean(f.q), a: clean(f.a) })),
  };
  const body = [clean(w.intro), ...w.sections.map((s) => `## ${clean(s.heading)}\n\n${clean(s.body)}`)].join('\n\n') + '\n';
  return frontmatter(fm) + body;
}

/** Frontmatter value of a top-level scalar key (our own generated format). */
export function fmValue(txt, key) {
  const head = txt.slice(0, txt.indexOf('\n---', 3));
  const m = head.match(new RegExp(`^${key}: (.*)$`, 'm'));
  if (!m) return undefined;
  try { return JSON.parse(m[1]); } catch { return m[1]; }
}

/** Adds one embedded video to a page's `otherVideos` list. Only the frontmatter list changes; the text
 *  (including a page edited by hand, `manualEdit`) is kept byte for byte. Returns false if it was already there. */
export function addOtherVideo(file, item) {
  const txt = fs.readFileSync(file, 'utf8');
  const end = txt.indexOf('\n---', 3);
  const head = txt.slice(0, end), rest = txt.slice(end);
  if (head.includes(`tiktokId: ${yamlStr(item.tiktokId)}`)) return false;
  const lines = [`  - tiktokId: ${yamlStr(item.tiktokId)}`, `    title: ${yamlStr(item.title)}`, `    views: ${Number(item.views) || 0}`, `    published: ${yamlStr(item.published)}`, `    cover: ${yamlStr(item.cover)}`];
  let out;
  if (/^otherVideos: \[\]$/m.test(head)) out = head.replace(/^otherVideos: \[\]$/m, ['otherVideos:', ...lines].join('\n'));
  else {
    const hl = head.split('\n');
    const i = hl.findIndex((l) => l === 'otherVideos:');
    if (i < 0) throw new Error(`no otherVideos in ${path.basename(file)}`);
    let j = i + 1;
    while (j < hl.length && hl[j].startsWith('  ')) j++;
    hl.splice(j, 0, ...lines);
    out = hl.join('\n');
  }
  fs.writeFileSync(file, out + rest, 'utf8');
  return true;
}

/** Every Arabic page that exists or waits in the queue: for dedup and for merges. */
export function pageIndex() {
  const out = [];
  const read = (file, where, id) => {
    const txt = fs.readFileSync(file, 'utf8');
    out.push({ where, file, id: id || fmValue(txt, 'tiktokId'), slug: fmValue(txt, 'slug'), title: fmValue(txt, 'title'), summary: String(fmValue(txt, 'summary') || '').split(/[.!؟]/)[0], system: fmValue(txt, 'system') });
  };
  if (fs.existsSync(PAGES_AR)) for (const f of fs.readdirSync(PAGES_AR).filter((x) => x.endsWith('.md'))) read(path.join(PAGES_AR, f), 'live');
  if (fs.existsSync(QUEUE)) for (const d of fs.readdirSync(QUEUE)) if (fs.existsSync(path.join(QUEUE, d, 'page.md'))) read(path.join(QUEUE, d, 'page.md'), 'queue', d);
  return out;
}
