// review.js — a skeptical Kuwaiti master mechanic (Claude Sonnet via OpenRouter) checks every Arabic article against the video transcript.
//   node scripts/review.js [--only <topicKey>] [--force]
// Pass 1 (verdicts): every sentence NOT supported by the transcript gets KEEP (confirmed general knowledge), FIX (corrected sentence) or CUT. When in doubt: CUT.
// Apply: cuts and fixes are applied by this script (nothing is added; the article is never padded).
// Pass 2 (coherence + score): wording-only edits so the text still reads well after cuts, plus the six-dimension quality score.
// Output next to the video: <file>.review.ar.json (full log) and <file>.final.ar.json (what build-page.js publishes).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, args, videoIndex, cachePath, readJson, writeJson, chat, wordCount } from './lib/common.js';

const A = args();
const REVIEW_MODEL = process.env.REVIEW_MODEL || 'anthropic/claude-sonnet-5.5';
const videos = videoIndex();
const topics = readJson(path.join(ROOT, 'data', 'topics.json'), []).filter((t) => !A.only || t.key === A.only);

// ---- split the article into numbered units -------------------------------
function splitSentences(text) {
  const out = [];
  for (const para of String(text).split(/\n+/)) {
    const p = para.trim();
    if (!p) continue;
    if (/^[-•]\s/.test(p)) { out.push({ text: p.replace(/^[-•]\s*/, ''), list: true, newPara: true }); continue; }
    const parts = p.match(/[^.!؟?]+[.!؟?]+["»”)]*|[^.!؟?]+$/g) || [p];
    parts.map((s) => s.trim()).filter(Boolean).forEach((s, i) => out.push({ text: s, newPara: i === 0 }));
  }
  return out;
}

function toUnits(a) {
  const units = [];
  const add = (where, s) => units.push({ id: `S${units.length + 1}`, where, ...s });
  splitSentences(a.summary).forEach((s) => add('summary', s));
  splitSentences(a.intro).forEach((s) => add('intro', s));
  a.sections.forEach((sec, i) => {
    add(`section${i}.heading`, { text: sec.heading, newPara: true });
    splitSentences(sec.body).forEach((s) => add(`section${i}.body`, s));
  });
  a.faq.forEach((f, i) => {
    add(`faq${i}.q`, { text: f.q, newPara: true });
    splitSentences(f.a).forEach((s) => add(`faq${i}.a`, s));
  });
  return units;
}

function fromUnits(a, units) {
  const join = (where) => {
    let out = '';
    for (const u of units.filter((x) => x.where === where && !x.cut)) {
      const t = u.text.trim();
      if (!t) continue;
      out += out ? (u.list ? `\n- ${t}` : u.newPara ? `\n\n${t}` : ` ${t}`) : (u.list ? `- ${t}` : t);
    }
    return out.trim();
  };
  const sections = a.sections
    .map((s, i) => ({ heading: units.find((u) => u.where === `section${i}.heading`)?.cut ? '' : units.find((u) => u.where === `section${i}.heading`)?.text, body: join(`section${i}.body`), fromVideo: s.fromVideo }))
    .filter((s) => s.heading && wordCount(s.body) >= 15); // a section with (almost) nothing left is dropped, never padded
  const faq = a.faq
    .map((f, i) => ({ q: units.find((u) => u.where === `faq${i}.q`)?.cut ? '' : units.find((u) => u.where === `faq${i}.q`)?.text, a: join(`faq${i}.a`), firstCut: units.find((u) => u.where === `faq${i}.a`)?.cut }))
    .filter((f) => f.q && f.a && !f.firstCut) // the first sentence must be the direct answer; if it was cut, drop the question
    .map(({ q, a }) => ({ q, a }));
  return { ...a, summary: join('summary'), intro: join('intro'), sections, faq };
}

const words = (a) => wordCount([a.summary, a.intro, ...a.sections.map((s) => `${s.heading} ${s.body}`)].join(' '));

function transcripts(t) {
  return [t.main, ...(t.others || [])].map((id) => {
    const v = videos.get(id);
    const an = readJson(cachePath(v, 'analysis'), {});
    return `### Video ${id}\nSpoken: ${an.transcript}\nOn screen: ${an.onScreenText || '-'}`;
  }).join('\n\n');
}

const PASS1 = `You are a skeptical Kuwaiti master mechanic with 25 years in a garage that services German and Japanese cars. You review a web article written by an AI from the video transcripts of محمد الصهيبي, a Kuwaiti mechanic.
The article is split into numbered units (sentences, headings, FAQ questions). For EACH unit decide:
- SUPPORTED: the transcript says it (paraphrase is fine). Do not list these.
- KEEP: not in the transcript, but it is correct, standard automotive knowledge you would put your name to, with no invented numbers, prices, brand-specific claims or statistics.
- FIX: the idea is useful but the wording is wrong, exaggerated, too specific, or not in natural Kuwaiti/Gulf dialect. Give the corrected sentence in Arabic (same dialect, no new facts).
- CUT: unsupported and not certainly correct, invented numbers or prices, vague filler, repetition, AI-sounding phrases («في عالم السيارات»، «لا شك»، «في الختام»...), on-video CTAs, or anything that contradicts the transcript.
WHEN IN DOUBT: CUT. A shorter, correct article beats a longer, wrong one.
Summary units are the first two lines on the page: they must fully answer the question. Prefer FIX over CUT for summary units, keeping only what the transcript supports.
Also judge the whole article: dialect/tone (Kuwaiti, natural, same tone as the video; uses «كراج» not «ورشة») and whether the first two lines answer the question.
Return ONLY JSON:
{"verdicts":[{"id":"S12","verdict":"KEEP|FIX|CUT","fixed":"only for FIX","reason":"short English reason"}],"dialect":"short English note","answerFirst":"short English note"}
List every unit that is not SUPPORTED. Omit SUPPORTED units.`;

const PASS2 = `You are the same skeptical Kuwaiti master mechanic. Some sentences were removed or corrected in this Arabic article after your fact check.
1) Make it read coherently again with MINIMAL wording edits only: fix dangling references («ثانيًا» with no «أولًا», «كما ذكرنا» pointing to removed text, a count in the title or summary that no longer matches the number of sections, broken transitions).
   You may NOT add any new fact, number, cause or advice, and you may not lengthen the article. Shorter is fine.
2) Score the FINAL article from 0 to 10 on six dimensions:
   fidelity (faithful to what Mohammad said in the video), dialect (Kuwaiti tone of the video), answerFirst (first two lines fully answer the question),
   structure (each cause/sign under its own heading), specificity (concrete, specific details instead of generic talk — but no invented ones), noFluff (no padding, repetition or AI phrases).
Return ONLY JSON:
{"edits":[{"field":"title|summary|intro|description|sections[i].heading|sections[i].body|faq[i].q|faq[i].a","text":"the full new text of that field"}],"scores":{"fidelity":0,"dialect":0,"answerFirst":0,"structure":0,"specificity":0,"noFluff":0},"notes":"one or two English sentences on what still needs a human look, if anything"}`;

function applyEdits(a, edits = []) {
  const out = structuredClone(a);
  for (const e of edits) {
    const m = String(e.field).match(/^(sections|faq)\[(\d+)\]\.(heading|body|q|a)$/);
    if (m) { const arr = out[m[1]]; if (arr?.[+m[2]]) arr[+m[2]][m[3]] = e.text; }
    else if (['title', 'summary', 'intro', 'description'].includes(e.field)) out[e.field] = e.text;
  }
  return out;
}

const summary = { kept: 0, fixed: 0, cut: 0 };
for (const t of topics) {
  const v = videos.get(t.main);
  const draft = readJson(cachePath(v, 'write.ar'), null);
  if (!draft) { console.warn(`skip ${t.key}: no Arabic draft — run write.js first`); continue; }
  const logFile = cachePath(v, 'review.ar');
  const finalFile = cachePath(v, 'final.ar');
  if (fs.existsSync(finalFile) && !A.force) { console.log(`skip ${t.key} (already reviewed)`); continue; }
  console.log(`review ${t.key} (${draft.words} words)`);

  const units = toUnits(draft);
  const p1 = await chat({
    script: 'review', label: `${t.key} pass1`, model: REVIEW_MODEL, temperature: 0, maxTokens: 16000,
    messages: [{ role: 'system', content: PASS1 }, { role: 'user', content: `TRANSCRIPTS\n${transcripts(t)}\n\nTITLE: ${draft.title}\n\nARTICLE UNITS\n${units.map((u) => `${u.id} [${u.where}] ${u.text}`).join('\n')}` }],
  });
  const log = [];
  for (const vd of p1.verdicts || []) {
    const u = units.find((x) => x.id === vd.id);
    if (!u) continue;
    const verdict = String(vd.verdict).toUpperCase();
    if (verdict === 'CUT') u.cut = true;
    if (verdict === 'FIX' && vd.fixed) u.text = vd.fixed;
    log.push({ id: u.id, where: u.where, verdict, text: verdict === 'FIX' ? vd.fixed : u.text, reason: vd.reason });
  }
  const originals = toUnits(draft); // original wording for the log
  for (const l of log) l.original = originals.find((o) => o.id === l.id)?.text;

  const afterCuts = fromUnits(draft, units);
  const p2 = await chat({
    script: 'review', label: `${t.key} pass2`, model: REVIEW_MODEL, temperature: 0, maxTokens: 12000,
    messages: [{ role: 'system', content: PASS2 }, { role: 'user', content: `TRANSCRIPTS\n${transcripts(t)}\n\nARTICLE (JSON)\n${JSON.stringify({ title: draft.title, summary: afterCuts.summary, description: draft.description, intro: afterCuts.intro, sections: afterCuts.sections, faq: afterCuts.faq })}` }],
  });
  const final = applyEdits({ ...afterCuts, title: draft.title, description: draft.description }, p2.edits);
  const counts = { kept: log.filter((l) => l.verdict === 'KEEP').length, fixed: log.filter((l) => l.verdict === 'FIX').length, cut: log.filter((l) => l.verdict === 'CUT').length, supported: units.length - log.length, units: units.length };
  summary.kept += counts.kept; summary.fixed += counts.fixed; summary.cut += counts.cut;
  const finalWords = words(final);
  writeJson(logFile, {
    topic: t.key, model: REVIEW_MODEL, reviewedAt: new Date().toISOString(), wordsBefore: draft.words, wordsAfter: finalWords, counts,
    dialect: p1.dialect, answerFirst: p1.answerFirst, scores: p2.scores, notes: p2.notes, coherenceEdits: p2.edits || [], log,
  });
  writeJson(finalFile, { ...draft, ...final, words: finalWords, reviewed: true, reviewModel: REVIEW_MODEL });
  console.log(`  ${draft.words} → ${finalWords} words · kept ${counts.kept} · fixed ${counts.fixed} · cut ${counts.cut} · score ${Object.values(p2.scores || {}).reduce((x, y) => x + y, 0)}/60${finalWords < 500 ? ' · under 500 words (left short, not padded)' : ''}`);
}
console.log(`review totals: kept ${summary.kept}, fixed ${summary.fixed}, cut ${summary.cut}`);
