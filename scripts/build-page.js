// build-page.js — turns write.js output into the site's Markdown files (one per topic per language),
// extracts cover + share images with ffmpeg, and writes data/review.json for the /review/ page.
//   node scripts/build-page.js
// Pages that disappear are moved to content/_archive/ (never deleted).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, LANGS, videoIndex, cachePath, readJson, writeJson, wordCount } from './lib/common.js';

const videos = videoIndex();
const topics = readJson(path.join(ROOT, 'data', 'topics.json'), []);
const scores = readJson(path.join(ROOT, 'data', 'scores.json'), {});
const today = new Date().toISOString().slice(0, 10);
const COVERS = path.join(ROOT, 'public', 'covers');
const OG = path.join(ROOT, 'public', 'og');
fs.mkdirSync(COVERS, { recursive: true });
fs.mkdirSync(OG, { recursive: true });

const ff = (a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a]);
const duration = (p) => Math.round(Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString().trim()));

function images(v) {
  const cover = path.join(COVERS, `${v.id}.webp`);
  const og = path.join(OG, `${v.id}.jpg`);
  // Frame at 1.5 s: past the first black frames, usually Mohammad on screen with the title text.
  if (!fs.existsSync(cover)) ff(['-ss', '1.5', '-i', v.path, '-frames:v', '1', '-vf', 'scale=576:-2', '-c:v', 'libwebp', '-quality', '68', cover]);
  const thumb = path.join(COVERS, `${v.id}-s.webp`); // small version for cards
  if (!fs.existsSync(thumb)) ff(['-ss', '1.5', '-i', v.path, '-frames:v', '1', '-vf', 'scale=320:-2', '-c:v', 'libwebp', '-quality', '62', thumb]);
  if (!fs.existsSync(og)) ff(['-ss', '1.5', '-i', v.path, '-frames:v', '1', '-vf', 'scale=-2:630,pad=1200:630:(ow-iw)/2:0:black', '-q:v', '4', og]);
  return { cover: `/covers/${v.id}.webp`, ogImage: `/og/${v.id}.jpg` };
}

const yamlStr = (s) => JSON.stringify(String(s ?? ''));
function frontmatter(o) {
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

const clean = (s) => String(s || '').replace(/#\S+/g, '').replace(/[ \t]+\n/g, '\n').trim(); // never print hashtags
const slugify = (s) => String(s).trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();

// Pages Mohammad corrected by hand on /review/ («تعديل») carry `manualEdit:` in their frontmatter and are never overwritten
// (run with --overwrite-edits to replace them anyway; the edited version is in content/_history/ either way).
const OVERWRITE_EDITS = process.argv.includes('--overwrite-edits');
function manualEditedFile(lang, topicKey) {
  const dir = path.join(ROOT, 'content', 'videos', lang);
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const txt = fs.readFileSync(path.join(dir, f), 'utf8'); const head = txt.slice(0, txt.indexOf('---', 3)); // frontmatter only
    if (head.includes(`topic: ${JSON.stringify(topicKey)}`) && /^manualEdit:/m.test(head)) return path.join(dir, f);
  }
  return null;
}

const generated = new Set();
const review = [];
for (const t of topics) {
  const main = videos.get(t.main);
  if (!main?.path) { console.warn(`skip ${t.key}: no file for ${t.main}`); continue; }
  const img = images(main);
  const dur = duration(main.path);
  const others = (t.others || []).map((id) => videos.get(id)).filter((v) => v?.path);
  for (const lang of LANGS) {
    // Arabic: publish the reviewed version (review.js) when it exists; translations are made from it.
    const w = (lang === 'ar' && readJson(cachePath(main, 'final.ar'), null)) || readJson(cachePath(main, `write.${lang}`), null);
    if (!w) continue;
    const otherVideos = others.map((v) => {
      const an = readJson(cachePath(v, 'analysis'), {});
      return { tiktokId: v.id, title: clean(an.hook || an.topic || w.title), views: v.views, published: v.date, cover: images(v).cover };
    });
    const edited = !OVERWRITE_EDITS && manualEditedFile(lang, t.key);
    if (edited) { generated.add(path.normalize(edited)); console.log(`keep ${lang}/${path.basename(edited)} (edited by hand)`); }
    const slug = edited ? path.basename(edited, '.md') : slugify(w.slug || w.title);
    const fm = {
      lang, topic: t.key, slug, title: clean(w.title), summary: clean(w.summary), description: clean(w.description).slice(0, 160),
      published: main.date, updated: today, views: main.views, cover: img.cover, ogImage: img.ogImage,
      platforms: { tiktok: `https://www.tiktok.com/@m_alsuhaiby/video/${main.id}`, instagram: t.instagram, youtube: t.youtube },
      tiktokId: main.id, duration: dur, otherVideos,
      tags: (w.tags || []).map(clean).filter(Boolean).slice(0, 4), system: clean(w.system), brands: (w.brands || []).map(clean).filter(Boolean),
      keywords: (w.keywords || []).map(clean).filter(Boolean).slice(0, 5),
      faq: (w.faq || []).slice(0, 5).map((f) => ({ q: clean(f.q), a: clean(f.a) })),
    };
    const body = [clean(w.intro), ...w.sections.map((s) => `## ${clean(s.heading)}\n\n${clean(s.body)}`)].join('\n\n') + '\n';
    const file = path.join(ROOT, 'content', 'videos', lang, `${slug}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!edited) fs.writeFileSync(file, frontmatter(fm) + body, 'utf8');
    generated.add(path.normalize(file));
    if (lang === 'ar') {
      const rv = readJson(cachePath(main, 'review.ar'), null);
      const sc = rv?.scores || scores[t.key]?.scores;
      review.push({
        topic: t.key, slug, title: fm.title, words: wordCount(`${fm.summary} ${body}`), wordsBefore: rv?.wordsBefore, mainId: main.id, otherIds: others.map((v) => v.id), views: main.views,
        scores: sc, total: sc ? Object.values(sc).reduce((a, b) => a + b, 0) : undefined, notes: rv?.notes || scores[t.key]?.notes,
        dialect: rv?.dialect, answerFirst: rv?.answerFirst, counts: rv?.counts,
        additions: w.additions || [], // what the writer added beyond Mohammad's words (kept unless the reviewer flagged it)
        fixes: rv ? rv.log.filter((l) => l.verdict === 'FIX').map((l) => ({ from: l.original, to: l.text, reason: l.reason })) : [],
        cuts: rv ? rv.log.filter((l) => l.verdict === 'CUT').map((l) => ({ text: l.original, reason: l.reason })) : [],
      });
    }
  }
}

// Move pages that are no longer generated to content/_archive/ (constitution: deleted pages go to an archive, never erased).
for (const lang of LANGS) {
  const dir = path.join(ROOT, 'content', 'videos', lang);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    const p = path.normalize(path.join(dir, f));
    if (f.endsWith('.md') && !generated.has(p)) {
      const dest = path.join(ROOT, 'content', '_archive', lang, `${today}-${f}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(p, dest);
      console.log(`archived ${lang}/${f}`);
    }
  }
}

// Default share image = the most viewed video.
const top = topics.map((t) => videos.get(t.main)).filter((v) => v?.path).sort((a, b) => b.views - a.views)[0];
if (top) fs.copyFileSync(path.join(OG, `${top.id}.jpg`), path.join(ROOT, 'public', 'og-default.jpg'));

review.sort((a, b) => b.views - a.views);
writeJson(path.join(ROOT, 'data', 'review.json'), review);
console.log(`built ${generated.size} page files (${review.length} Arabic)`);
