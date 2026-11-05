// write.js — writes the article for each topic from Mohammad's own words, then (optionally) the translations.
//   node scripts/write.js                       Arabic for every topic in data/topics.json (default --langs ar)
//   node scripts/write.js --langs ar,en,fr,es,ur   Arabic + the four translations (Arabic is reused if it exists)
//   node scripts/write.js --only <topicKey> [--force]
// Output: <main video file>.write.<lang>.json next to the video. Existing outputs are never paid for twice.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, LANGS, args, videoIndex, cachePath, readJson, writeJson, chat, wordCount } from './lib/common.js';

const A = args();
const langs = String(A.langs || 'ar').split(',').map((s) => s.trim()).filter(Boolean);
for (const l of langs) if (!LANGS.includes(l)) throw new Error(`unknown language ${l}`);
const videos = videoIndex();
const topics = readJson(path.join(ROOT, 'data', 'topics.json'), []).filter((t) => !A.only || t.key === A.only);

const SYSTEMS = 'محرك, قير, مكيف, فرامل, كهرباء, تواير, وقود, تبريد, تعليق وتوجيه, عادات وصيانة';

const AR_RULES = `You write web articles in Arabic for the personal site of محمد الصهيبي, a Kuwaiti car mechanic who owns «كراج الصهيبي» (German cars, since 2022).
Each article turns one of his short TikTok videos into a full page that ranks on Google and gets quoted by AI assistants.

SOURCE OF TRUTH: the transcripts below are his own words. Every cause / sign / step he lists becomes its own section, in his order, and each section starts from what he said.
You MAY expand with correct, well-established technical explanation (why it happens, how to check, what the fix is) so the article is complete,
but EVERY factual statement he did not say must be listed in "additions" (one short Arabic sentence per added fact). Be exhaustive and honest in that list.
Never invent prices, part numbers, brand-specific claims, statistics or personal stories. No prices at all. Use numbers (km, °C, seconds, RPM) only when they are standard and safe, and list them in additions.

VOICE: spoken Kuwaiti dialect that every Gulf reader understands, exactly like he talks in the videos: plain, direct, practical, SHORT sentences (mostly under 20 words), talking to the driver as «انت».
Write like a mechanic explaining to a customer at the garage, not like a writer. No literary or dramatic words (e.g. «محكم»، «جهنمية»، «القلب النابض»، «تترجم»، «صدمات»، «بنعومة فائقة»), no Modern Standard connectors («بالإضافة إلى ذلك»، «وبالتالي»، «حيث إن»، «يُعد»). Prefer: وايد، شوي، يبيلها، تحس، تدوس، يتسكر، عطلان، بدّله، شيّك عليه.
Use «كراج» (never «ورشة»). His words: سيارتك، تدوس بنزين، البلاكات، البخاخات، الكويلات، القير، المكينة، الرديتر، السكّان، التواير... keep the car words he uses.
Forbidden: hashtags, emojis, his on-video CTAs («اضغط على هذي»، «اللي يبي مكان كراجنا»), and AI filler such as «في عالم السيارات»، «لا شك أن»، «في الختام»، «تجدر الإشارة»، «يعتبر»، «دعونا»، «رحلة»، «عزيزي القارئ». No repetition, no padding.

STRUCTURE AND SEO:
- title: a natural search sentence that STARTS WITH THE SYMPTOM the driver feels (not the part name), as people type it, e.g. «سيارتي ترجف لما أدوس بنزين: 4 أسباب». Include the count when he lists items. Max 70 characters.
- summary: exactly two sentences that fully answer the question: the first names the causes/signs he lists in the MAIN video, the second says what to do. This is shown first on the page.
- The count in the title must equal the number of causes/signs he lists in the MAIN video. Points that only appear in the OTHER videos go in ONE extra section titled «أسباب ثانية ذكرها محمد» (or «علامات ثانية…») — never as extra numbered causes.
- Never give maintenance intervals in km or months, prices, or brand-specific facts unless he said them.
- description: meta description, max 155 characters, includes the main search phrase.
- slug: 3–6 Arabic words from the title joined with "-", no digits, no punctuation.
- intro: 1 short paragraph (40–80 words) after the summary, no repetition of the summary.
- sections: one per cause/sign/step he mentioned (+ optionally one «متى توديها الكراج؟» section). heading = short (2–6 words) and specific. body = 120–220 words, plain paragraphs separated by \\n\\n, may contain a short "- " list.
- The whole article (summary + intro + sections) must be 800–1500 Arabic words.
- faq: 3–5 questions written exactly the way people ask in Gulf dialect (as in comments and Google searches); the FIRST sentence of each answer is the direct answer; answers 25–60 words.
- keywords: 3–5 search phrases (mix فصحى and عامية), used naturally in title, summary and FAQ without stuffing.
- system: exactly one of: ${SYSTEMS}.
- brands: car brands explicitly mentioned (usually empty).
- tags: 2–4 short topic tags (e.g. محرك، رجفة، بخاخات، BMW). No "#".

Return ONLY one JSON object:
{"title","slug","summary","description","intro","sections":[{"heading","body","fromVideo":true|false}],"faq":[{"q","a"}],"keywords":[],"system","brands":[],"tags":[],"additions":[]}`;

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
  return [t.main, ...(t.others || [])].map((id, i) => {
    const v = videos.get(id);
    const an = v?.path ? readJson(cachePath(v, 'analysis'), null) : null;
    if (!an) throw new Error(`missing analysis for ${id} — run: node scripts/analyze.js --topics`);
    return `### ${i === 0 ? 'MAIN VIDEO' : 'OTHER VIDEO ON THE SAME TOPIC'} ${id} (${v.views.toLocaleString('en')} views, ${v.date})
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
  if (words < 800 || words > 1600) {
    console.log(`  ${words} words — asking for a ${words < 800 ? 'longer' : 'shorter'} version`);
    messages.push({ role: 'assistant', content: JSON.stringify(a) }, { role: 'user', content: `The article is ${words} words. Rewrite it to 950–1300 words following every rule (keep the additions list exhaustive). Return the full JSON again.` });
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
for (const t of topics) {
  const v = videos.get(t.main);
  if (!v?.path) throw new Error(`no local file for main video ${t.main}`);
  const draft = await writeArabic(t, v);
  // Translations are made from the reviewed Arabic (scripts/review.js) when it exists.
  const ar = readJson(cachePath(v, 'final.ar'), null) || draft;
  if (langs.length > 1 && !ar.reviewed) console.warn(`  ! ${t.key}: translating an unreviewed draft — run review.js first`);
  for (const lang of langs.filter((l) => l !== 'ar')) await translate(t, v, ar, lang);
}
const spend = readJson(path.join(ROOT, 'data', 'spend.json'), { totalUsd: 0 });
console.log(`done. OpenRouter spend so far: $${spend.totalUsd.toFixed(4)}`);
