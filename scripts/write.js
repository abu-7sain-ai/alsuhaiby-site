// write.js — one video → one long article: Mohammad's transcript is the starting point, expanded with correct general knowledge (800–1500 words). Then (optionally) the translations.
//   node scripts/write.js                       Arabic for every topic in data/topics.json (default --langs ar)
//   node scripts/write.js --langs ar,en,fr,es,ur   Arabic + the four translations (Arabic is reused if it exists)
//   node scripts/write.js --only <topicKey> [--force]
// Output: <main video file>.write.<lang>.json next to the video. Existing outputs are never paid for twice.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, LANGS, args, videoIndex, cachePath, readJson, writeJson, chat, wordCount } from './lib/common.js';
import { guard, alert } from './lib/status.js';
import { machineGate, MachineStopError, setStage, startStage } from './lib/machine.js';
guard('write');

const A = args();
const langs = String(A.langs || 'ar').split(',').map((s) => s.trim()).filter(Boolean);
for (const l of langs) if (!LANGS.includes(l)) throw new Error(`unknown language ${l}`);
const videos = videoIndex();
const topics = readJson(path.join(ROOT, 'data', 'topics.json'), []).filter((t) => !A.only || t.key === A.only);

import { AR_RULES } from './lib/article.js';

const TR_RULES = (lang) => `Translate this Arabic car-repair article into ${{ en: 'English', fr: 'French', es: 'Spanish', ur: 'Urdu (Urdu script)' }[lang]} for native readers searching Google in that language.
Write it as a native car-repair writer would — natural, not literal. Use the car words people in that language actually search for. Keep the meaning, the order of sections and every fact; add nothing.
The author is ${lang === 'ur' ? 'محمد الصہیبی' : 'Mohammad Al-Suhaiby'}, a Kuwaiti mechanic; his garage is «${{ en: 'Al-Suhaiby Garage', fr: 'Garage Al-Suhaiby', es: 'Taller Al-Suhaiby', ur: 'الصہیبی گیراج' }[lang]}».
Title must still start with the symptom the driver feels. slug: 3–6 lowercase words in Latin letters joined with "-" (for Urdu, use an English transliteration slug).
keywords: 3–5 real search phrases in the target language. tags: 2–4 short tags in the target language. system: translate the system name. Keep "brands" as-is.
Return ONLY one JSON object with exactly the same keys as the input except "additions" (omit it).`;

function articleWords(a) {
  return wordCount([a.summary, a.intro, ...a.sections.map((s) => `${s.heading} ${s.body}`)].join(' '));
}

function sourceBlock(t) {
  return [t.main].map((id) => { // one video → one article: only the main video's transcript is the source (other videos stay embedded on the page)
    const v = videos.get(id);
    const an = v?.path ? readJson(cachePath(v, 'analysis'), null) : null;
    if (!an) throw new Error(`missing analysis for ${id} — run: node scripts/analyze.js --topics`);
    return `### VIDEO ${id} (${v.views.toLocaleString('en')} views, ${v.date})
Spoken: ${an.transcript}
On screen: ${an.onScreenText || '-'}${an.items ? `\nItems: ${JSON.stringify(an.items)}` : ''}`;
  }).join('\n\n');
}

async function writeArabic(t, v) {
  const out = cachePath(v, 'write.ar');
  if (fs.existsSync(out) && !A.force) { console.log(`skip ${t.key} ar (exists)`); return readJson(out); }
  console.log(`write ${t.key} ar`);
  const messages = [{ role: 'system', content: AR_RULES }, { role: 'user', content: `Topic: ${t.key}\n\n${sourceBlock(t)}` }];
  let a = await chat({ script: 'write', label: `${t.key} ar`, messages });
  let words = articleWords(a);
  if (words < 1050 || words > 1500) { // the error review trims ~15–30%, so drafts aim high to stay 800–1500 after it
    console.log(`  ${words} words — asking for a ${words < 1050 ? 'longer' : 'shorter'} version`);
    messages.push({ role: 'assistant', content: JSON.stringify(a) }, { role: 'user', content: `The article is ${words} words. Rewrite it to 1150–1400 words following every rule: expand each section with correct general explanation (how to check it, what the fix is), never padding or repeating. Return the full JSON again.` });
    a = await chat({ script: 'write', label: `${t.key} ar (resize)`, messages });
    words = articleWords(a);
  }
  const data = { topic: t.key, lang: 'ar', mainId: t.main, otherIds: t.others || [], words, writtenAt: new Date().toISOString(), model: 'google/gemini-3.8-flash', ...a };
  writeJson(out, data);
  console.log(`  ${words} words, ${a.additions?.length ?? 0} additions`);
  return data;
}

async function translate(t, v, ar, lang) {
  const out = cachePath(v, `write.${lang}`);
  if (fs.existsSync(out) && !A.force) { console.log(`skip ${t.key} ${lang} (exists)`); return; }
  console.log(`translate ${t.key} ${lang}`);
  const { title, slug, summary, description, intro, sections, faq, keywords, system, brands, tags } = ar;
  const src = { title, slug, summary, description, intro, sections, faq, keywords, system, brands, tags };
  const tr = await chat({ script: 'write', label: `${t.key} ${lang}`, messages: [{ role: 'system', content: TR_RULES(lang) }, { role: 'user', content: JSON.stringify(src) }] });
  writeJson(out, { topic: t.key, lang, mainId: t.main, otherIds: t.others || [], translatedFrom: 'ar', writtenAt: new Date().toISOString(), model: 'google/gemini-3.8-flash', ...tr });
}

if (!topics.length) throw new Error('data/topics.json has no topics');
await startStage('write', { left: topics.length });
let topicsLeft = topics.length, machineStopped = false;
for (const t of topics) {
  // machine guard (his rule 2026-11-08): between topics; slow / pause wait here, a full stop ends the run cleanly + ONE Telegram
  try { await machineGate(); } catch (e) {
    if (!(e instanceof MachineStopError)) throw e;
    console.warn(`⛔ ${e.message}`);
    alert(`⚠️ alsuhaiby.com — الكتابة (write)\n⛔ ${e.message}`);
    machineStopped = true;
    break;
  }
  setStage('writing', { current: t.key, left: topicsLeft-- });
  const v = videos.get(t.main);
  if (!v?.path) throw new Error(`no local file for main video ${t.main}`);
  const draft = await writeArabic(t, v);
  // Translations are made from the reviewed Arabic (scripts/review.js) when it exists.
  const ar = readJson(cachePath(v, 'final.ar'), null) || draft;
  if (langs.length > 1 && !ar.reviewed) console.warn(`  ! ${t.key}: translating an unreviewed draft — run review.js first`);
  for (const lang of langs.filter((l) => l !== 'ar')) await translate(t, v, ar, lang);
}
setStage('idle', { current: null, left: machineStopped ? topicsLeft : 0, stopped: machineStopped ? 'machine' : null });
const spend = readJson(path.join(ROOT, 'data', 'spend.json'), { totalUsd: 0 });
console.log(`done. OpenRouter spend so far: $${spend.totalUsd.toFixed(4)}`);
