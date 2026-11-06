// review.js — a skeptical Kuwaiti master mechanic (Claude Sonnet via OpenRouter) checks every Arabic article for ERRORS.
//   node scripts/review.js [--only <topicKey>] [--force] [--pass2-only]
// Pass 1 (verdicts): correct general knowledge is KEEP by default (the article is expanded on purpose). Only sentences that are
//   factually wrong, contradict the video, are filler/repetition, or are not in Kuwaiti dialect get FIX (corrected sentence) or CUT.
// Apply: cuts and fixes are applied by this script (nothing is added).
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
  return [t.main].map((id) => { // one video → one article
    const v = videos.get(id);
    const an = readJson(cachePath(v, 'analysis'), {});
    return `### Video ${id}\nSpoken: ${an.transcript}\nOn screen: ${an.onScreenText || '-'}`;
  }).join('\n\n');
}

const PASS1 = `You are a skeptical Kuwaiti master mechanic with 25 years in a garage that services German and Japanese cars. You review a web article written by an AI from one video of محمد الصهيبي, a Kuwaiti mechanic.
The article starts from his transcript and is EXPANDED ON PURPOSE with general automotive knowledge. That expansion is wanted: correct general knowledge is KEEP by default, even if he did not say it.
The article is split into numbered units (sentences, headings, FAQ questions). Flag ONLY the units that need action:
- FIX: the idea is right but a detail is wrong, exaggerated or too specific, OR the wording is literary / Modern Standard / not natural Kuwaiti-Gulf dialect. Give the corrected sentence in Arabic (same dialect, no new facts).
- CUT: factually WRONG and not fixable in one sentence, CONTRADICTS the video, invented prices / km or month intervals / statistics / brand-specific claims, pure filler or repetition of an earlier sentence, AI phrases («في عالم السيارات»، «لا شك»، «في الختام»...), on-video CTAs.
Do NOT cut a sentence only because it is not in the transcript. Do NOT cut correct explanation to make the article shorter: the article must stay 800–1500 words.
Summary units are the first two lines on the page: they must fully answer the question. Prefer FIX over CUT there.
Also judge the whole article: dialect/tone (Kuwaiti, natural, same tone as the video; uses «كراج» not «ورشة») and whether the first two lines answer the question.
Return ONLY JSON:
{"verdicts":[{"id":"S12","verdict":"FIX|CUT","fixed":"only for FIX","reason":"short English reason"}],"dialect":"short English note","answerFirst":"short English note"}
List only FIX and CUT units. Every unit you do not list is kept as it is.`;

const PASS2 = `You are the same skeptical Kuwaiti master mechanic. Some sentences were removed or corrected in this Arabic article after your error check.
1) Make it read coherently again with MINIMAL wording edits only: fix dangling references («ثانيًا» with no «أولًا», «كما ذكرنا» pointing to removed text, broken transitions).
   If the number in the title or summary does not match the number of cause/sign sections taken from the MAIN video, you MUST edit the title/summary so they match.
   Replace any remaining literary or Modern Standard phrasing with plain spoken Kuwaiti (same meaning).
   You may NOT add any new fact, number, cause or advice, and you may not lengthen the article.
   You may NOT remove or summarise sentences either: the error check is already done, so every remaining sentence stays. Change words, not content. Only return fields you actually changed.
2) Score the FINAL article from 0 to 10 on six dimensions:
   fidelity (every point Mohammad makes in the video is present and central, nothing contradicts him, nothing false remains; correct general explanation is wanted and is not a fidelity problem),
   dialect (Kuwaiti tone of the video), answerFirst (first two lines fully answer the question),
   structure (each cause/sign under its own heading), specificity (concrete, specific details instead of generic talk — but no invented ones), noFluff (no padding, repetition or AI phrases).
Return ONLY JSON:
{"edits":[{"field":"title|summary|intro|description|sections[i].heading|sections[i].body|faq[i].q|faq[i].a","text":"the full new text of that field"}],"scores":{"fidelity":0,"dialect":0,"answerFirst":0,"structure":0,"specificity":0,"noFluff":0},"notes":"one or two English sentences on what still needs a human look, if anything"}`;

// Coherence edits are wording-only: an edit that shrinks a text field by more than 20% would be an unlogged cut, so it is rejected.
function applyEdits(a, edits = []) {
  const out = structuredClone(a);
  const applied = [], rejected = [];
  for (const e of edits) {
    const m = String(e.field).match(/^(sections|faq)\[(\d+)\]\.(heading|body|q|a)$/);
    const get = () => (m ? out[m[1]]?.[+m[2]]?.[m[3]] : out[e.field]);
    const before = get();
    if (before === undefined || typeof e.text !== 'string') continue;
    const shortField = ['title', 'description'].includes(e.field) || /heading|\.q$/.test(e.field);
    if (!shortField && wordCount(e.text) < 0.8 * wordCount(before)) { rejected.push({ ...e, before, why: 'would shorten the text by more than 20% (unlogged cut)' }); continue; }
    if (m) out[m[1]][+m[2]][m[3]] = e.text; else out[e.field] = e.text;
    applied.push({ ...e, before });
  }
  return { article: out, applied, rejected };
}

const summary = { kept: 0, fixed: 0, cut: 0 };
for (const t of topics) {
  const v = videos.get(t.main);
  const draft = readJson(cachePath(v, 'write.ar'), null);
  if (!draft) { console.warn(`skip ${t.key}: no Arabic draft — run write.js first`); continue; }
  const logFile = cachePath(v, 'review.ar');
  const finalFile = cachePath(v, 'final.ar');
  const pass2Only = A['pass2-only'] && fs.existsSync(logFile);
  if (fs.existsSync(finalFile) && !A.force && !A['pass2-only']) { console.log(`skip ${t.key} (already reviewed)`); continue; }
  console.log(`review ${t.key} (${draft.words} words)${pass2Only ? ' — pass 2 only, reusing saved pass 1 verdicts' : ''}`);

  const units = toUnits(draft);
  const prev = pass2Only ? readJson(logFile, null) : null;
  const p1 = prev
    ? { verdicts: prev.log.map((l) => ({ id: l.id, verdict: l.verdict, fixed: l.verdict === 'FIX' ? l.text : undefined, reason: l.reason })), dialect: prev.dialect, answerFirst: prev.answerFirst }
    : await chat({
      script: 'review', label: `${t.key} pass1`, model: REVIEW_MODEL, temperature: 0, maxTokens: 12000,
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
  const { article: final, applied, rejected } = applyEdits({ ...afterCuts, title: draft.title, description: draft.description }, p2.edits);
  if (rejected.length) console.log(`  rejected ${rejected.length} coherence edit(s) that would have cut text without logging it`);
  const fixedN = log.filter((l) => l.verdict === 'FIX').length, cutN = log.filter((l) => l.verdict === 'CUT').length;
  const counts = { kept: units.length - fixedN - cutN, fixed: fixedN, cut: cutN, units: units.length };
  summary.kept += counts.kept; summary.fixed += counts.fixed; summary.cut += counts.cut;
  const finalWords = words(final);
  writeJson(logFile, {
    topic: t.key, model: REVIEW_MODEL, reviewedAt: new Date().toISOString(), wordsBefore: draft.words, wordsAfter: finalWords, counts,
    dialect: p1.dialect, answerFirst: p1.answerFirst, scores: p2.scores, notes: p2.notes, coherenceEdits: applied, rejectedEdits: rejected, log,
  });
  writeJson(finalFile, { ...draft, ...final, words: finalWords, reviewed: true, reviewModel: REVIEW_MODEL });
  console.log(`  ${draft.words} → ${finalWords} words · kept ${counts.kept} · fixed ${counts.fixed} · cut ${counts.cut} · score ${Object.values(p2.scores || {}).reduce((x, y) => x + y, 0)}/60${finalWords < 800 || finalWords > 1500 ? ' · OUTSIDE 800–1500' : ''}`);
}
console.log(`review totals: kept ${summary.kept}, fixed ${summary.fixed}, cut ${summary.cut}`);
