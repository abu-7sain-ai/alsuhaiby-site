// analyze.js — what Mohammad says in a video.
//   node scripts/analyze.js --import            reuse the 112 existing Gemini analyses (free, no API call)
//   node scripts/analyze.js --id <tiktokId>     send one video file to Gemini via OpenRouter
//   node scripts/analyze.js --topics            analyze every video in data/topics.json that has no analysis yet
// Output: <video file>.analysis.json next to the video. Existing outputs are never paid for twice.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, OLD_ANALYSES, args, videoIndex, cachePath, readJson, writeJson, chat } from './lib/common.js';
import { guard } from './lib/status.js';
guard('analyze');

const A = args();
const videos = videoIndex();

const PROMPT = `You are watching a short car-repair video by Mohammad Al-Suhaiby (محمد الصهيبي), a Kuwaiti mechanic. Watch it fully, with sound and picture.
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

function importExisting() {
  const text = fs.readFileSync(OLD_ANALYSES, 'utf8');
  let n = 0, skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^- id=(\d+) \| (.+)$/);
    if (!m) continue;
    const v = videos.get(m[1]);
    if (!v?.path) { skipped++; continue; }
    const out = cachePath(v, 'analysis');
    if (fs.existsSync(out)) continue;
    const field = (name) => (m[2].split(' | ').find((p) => p.startsWith(name)) || '').slice(name.length).replace(/^[:=]\s*/, '').trim();
    writeJson(out, {
      id: v.id, source: 'existing (KatibSuhaibi, 112 analyses)', importedAt: new Date().toISOString(),
      hook: field('هوك'), type: field('نوع'), transcript: field('نص منطوق'), onScreenText: field('نص على الشاشة'),
    });
    n++;
  }
  console.log(`imported ${n} existing analyses (${skipped} without a local file)`);
}

async function analyzeOne(id) {
  const v = videos.get(id);
  if (!v?.path || !fs.existsSync(v.path)) throw new Error(`no local file for ${id}`);
  const out = cachePath(v, 'analysis');
  if (fs.existsSync(out) && !A.force) { console.log(`skip ${id} (already analyzed)`); return readJson(out); }
  const size = fs.statSync(v.path).size;
  if (size > 15 * 1024 * 1024) throw new Error(`${v.file} is ${(size / 1048576).toFixed(1)} MB — downscale with ffmpeg first`);
  console.log(`analyze ${id} (${v.file}, ${(size / 1048576).toFixed(1)} MB)`);
  const b64 = fs.readFileSync(v.path).toString('base64');
  const res = await chat({
    script: 'analyze', label: id, temperature: 0.1, maxTokens: 4000,
    messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'video_url', video_url: { url: `data:video/mp4;base64,${b64}` } }] }],
  });
  const data = { id, source: 'gemini', model: 'google/gemini-3.8-flash', analyzedAt: new Date().toISOString(), ...res };
  writeJson(out, data);
  return data;
}

if (A.import) importExisting();
const ids = [];
if (A.id) ids.push(...String(A.id).split(','));
if (A.topics) {
  for (const t of readJson(path.join(ROOT, 'data', 'topics.json'), [])) {
    for (const id of [t.main, ...(t.others || [])]) {
      const v = videos.get(id);
      if (v?.path && !fs.existsSync(cachePath(v, 'analysis'))) ids.push(id);
    }
  }
}
for (const id of ids) await analyzeOne(id);
if (!A.import && !ids.length) console.log('nothing to analyze');
