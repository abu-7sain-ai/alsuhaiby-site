// article.js — one video → one reviewed Arabic article. Shared by write.js / review.js (Phase 1b tools),
// night.js (Line 1, his PC: Claude via his subscription) and daily.js (Line 2, cloud: Gemini writes, Sonnet reviews).
import { chat, wordCount } from './common.js';

export const SYSTEMS = 'محرك, قير, مكيف, فرامل, كهرباء, تواير, وقود, تبريد, تعليق وتوجيه, عادات وصيانة';

export const AR_RULES = `You write web articles in Arabic for the personal site of محمد الصهيبي, a Kuwaiti car mechanic who owns «كراج الصهيبي» (German cars, since 2022).
Each article turns one of his short TikTok videos into a full page that ranks on Google and gets quoted by AI assistants.

SOURCE: the transcript below is his own words — the starting point. Every cause / sign / step he lists becomes its own section, in his order, and each section starts from what he said.
Then EXPAND FREELY with correct, well-established general automotive knowledge (why it happens, how the driver can check it, what the fix is, what happens if it is ignored) so the article is long and complete.
Never contradict the video. Never invent prices, part numbers, brand-specific claims, statistics, personal stories or maintenance intervals in km/months. No prices at all.
List in "additions" one short Arabic sentence per main point you added beyond his words (for the review log; not published).

VOICE: spoken Kuwaiti dialect that every Gulf reader understands, exactly like he talks in the videos: plain, direct, practical, SHORT sentences (mostly under 20 words), talking to the driver as «انت».
Write like a mechanic explaining to a customer at the garage, not like a writer. No literary or dramatic words (e.g. «محكم»، «جهنمية»، «القلب النابض»، «تترجم»، «صدمات»، «بنعومة فائقة»), no Modern Standard connectors («بالإضافة إلى ذلك»، «وبالتالي»، «حيث إن»، «يُعد»). Prefer: وايد، شوي، يبيلها، تحس، تدوس، يتسكر، عطلان، بدّله، شيّك عليه.
Use «كراج» (never «ورشة»). His words: سيارتك، تدوس بنزين، البلاكات، البخاخات، الكويلات، القير، المكينة، الرديتر، السكّان، التواير... keep the car words he uses.
Forbidden: hashtags, emojis, his on-video CTAs («اضغط على هذي»، «اللي يبي مكان كراجنا»), and AI filler such as «في عالم السيارات»، «لا شك أن»، «في الختام»، «تجدر الإشارة»، «يعتبر»، «دعونا»، «رحلة»، «عزيزي القارئ». No repetition, no padding.

STRUCTURE AND SEO:
- title: a natural search sentence that STARTS WITH THE SYMPTOM the driver feels (not the part name), as people type it, e.g. «سيارتي ترجف لما أدوس بنزين: 4 أسباب». Include the count when he lists items. Max 70 characters.
- summary: exactly two sentences that fully answer the question: the first names the causes/signs he lists in the video, the second says what to do. This is shown first on the page.
- The count in the title must equal the number of causes/signs he lists in the video.
- Never give maintenance intervals in km or months, prices, or brand-specific facts unless he said them.
- description: meta description, max 155 characters, includes the main search phrase.
- slug: 3–6 Arabic words from the title joined with "-", no digits, no punctuation.
- intro: 1 short paragraph (40–80 words) after the summary, no repetition of the summary.
- sections: one per cause/sign/step he mentioned (+ optionally one «متى توديها الكراج؟» section). heading = short (2–6 words) and specific. body = 130–230 words, plain paragraphs separated by \\n\\n, may contain a short "- " list.
- The whole article (summary + intro + sections) must be 1150–1400 Arabic words.
- faq: 3–5 questions written exactly the way people ask in Gulf dialect (as in comments and Google searches); the FIRST sentence of each answer is the direct answer; answers 25–60 words.
- keywords: 3–5 search phrases (mix فصحى and عامية), used naturally in title, summary and FAQ without stuffing.
- system: exactly one of: ${SYSTEMS}.
- brands: car brands explicitly mentioned (usually empty).
- tags: 2–4 short topic tags (e.g. محرك، رجفة، بخاخات، BMW). No "#".

Return ONLY one JSON object:
{"title","slug","summary","description","intro","sections":[{"heading","body","fromVideo":true|false}],"faq":[{"q","a"}],"keywords":[],"system","brands":[],"tags":[],"additions":[]}`;


// ---- split the article into numbered units -------------------------------
export function splitSentences(text) {
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

export function toUnits(a) {
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

export function fromUnits(a, units) {
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

export const words = (a) => wordCount([a.summary, a.intro, ...a.sections.map((s) => `${s.heading} ${s.body}`)].join(' '));

export const PASS1 = `You are a skeptical Kuwaiti master mechanic with 25 years in a garage that services German and Japanese cars. You review a web article written by an AI from one video of محمد الصهيبي, a Kuwaiti mechanic.
The article starts from his transcript and is EXPANDED ON PURPOSE with general automotive knowledge. That expansion is wanted: correct general knowledge is KEEP by default, even if he did not say it.
The article is split into numbered units (sentences, headings, FAQ questions). Check EVERY factual claim in every unit against what a master mechanic knows for certain. Flag ONLY the units that need action:
- FIX: the idea is right but a detail is wrong, exaggerated or too specific, OR the wording is literary / Modern Standard / not natural Kuwaiti-Gulf dialect. Give the corrected sentence in Arabic (same dialect, no new facts).
  A FIX changes ONLY the wrong detail or the wording: it keeps every other correct detail of the sentence and stays about the same length (never under 75% of the original's words). Do not summarise or tighten in a FIX. If most of a sentence is wrong, CUT it instead.
- CUT: factually WRONG and not fixable in one sentence, CONTRADICTS the video, invented prices / km or month intervals / statistics / brand-specific claims, pure filler or repetition of an earlier sentence, AI phrases («في عالم السيارات»، «لا شك»، «في الختام»...), on-video CTAs.
- DOUBT: a factual claim you cannot confirm as correct for most cars (it may be true, but you are not sure). It is removed and logged for a human look; say what is doubtful in the reason.
Do NOT cut a sentence only because it is not in the transcript. Do NOT cut correct explanation to make the article shorter: the article must stay 800–1500 words.
Summary units are the first two lines on the page: they must fully answer the question. Prefer FIX over CUT there.
Also judge the whole article: dialect/tone (Kuwaiti, natural, same tone as the video; uses «كراج» not «ورشة») and whether the first two lines answer the question.
Return ONLY JSON:
{"verdicts":[{"id":"S12","verdict":"FIX|CUT","fixed":"only for FIX","reason":"short English reason"}],"dialect":"short English note","answerFirst":"short English note"}
List only FIX and CUT units. Every unit you do not list is kept as it is.`;

export const PASS2 = `You are the same skeptical Kuwaiti master mechanic. Some sentences were removed or corrected in this Arabic article after your error check.
1) Make it read coherently again with MINIMAL wording edits only: fix dangling references («ثانيًا» with no «أولًا», «كما ذكرنا» pointing to removed text, broken transitions).
   If the number in the title or summary does not match the number of cause/sign sections taken from the MAIN video, you MUST edit the title/summary so they match.
   Replace any remaining literary or Modern Standard phrasing with plain spoken Kuwaiti (same meaning).
   You may NOT add any new fact, number, cause or advice, and you may not lengthen the article.
   You may NOT remove or summarise sentences either: the error check is already done, so every remaining sentence stays. Change words, not content. Only return fields you actually changed.
1b) Read it once more as a strict fact-checker: if a factual error still remains, correct it with a minimal wording edit (never add facts) and name it in notes.
2) Score the FINAL article from 0 to 10 on six dimensions:
   fidelity (every point Mohammad makes in the video is present and central, nothing contradicts him, nothing false remains; correct general explanation is wanted and is not a fidelity problem),
   dialect (Kuwaiti tone of the video), answerFirst (first two lines fully answer the question),
   structure (each cause/sign under its own heading), specificity (concrete, specific details instead of generic talk — but no invented ones), noFluff (no padding, repetition or AI phrases).
Return ONLY JSON:
{"edits":[{"field":"title|summary|intro|description|sections[i].heading|sections[i].body|faq[i].q|faq[i].a","text":"the full new text of that field"}],"scores":{"fidelity":0,"dialect":0,"answerFirst":0,"structure":0,"specificity":0,"noFluff":0},"notes":"one or two English sentences on what still needs a human look, if anything"}`;

// Coherence edits are wording-only: an edit that shrinks a text field by more than 20% would be an unlogged cut, so it is rejected.
export function applyEdits(a, edits = []) {
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


export const REVIEW_MODEL = process.env.REVIEW_MODEL || 'anthropic/claude-sonnet-5.5';
export const WRITE_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-3.8-flash';

export function sourceOf(id, an, v = {}) {
  return `### VIDEO ${id}${v.views ? ` (${Number(v.views).toLocaleString('en')} views, ${v.date})` : ''}
Spoken: ${an.transcript}
On screen: ${an.onScreenText || '-'}${an.items ? `\nItems: ${JSON.stringify(an.items)}` : ''}`;
}

/** Draft (1150–1400 words, one resize retry). model: an OpenRouter model id or 'claude-cli'. */
export async function writeArticle({ key, id, an, v, model = WRITE_MODEL, script = 'write' }) {
  const messages = [{ role: 'system', content: AR_RULES }, { role: 'user', content: `Topic: ${key}\n\n${sourceOf(id, an, v)}` }];
  let a = await chat({ script, label: `${key} write`, model, messages });
  let n = words(a);
  if (n < 1050 || n > 1500) {
    console.log(`  ${n} words — asking for a ${n < 1050 ? 'longer' : 'shorter'} version`);
    messages.push({ role: 'assistant', content: JSON.stringify(a) }, { role: 'user', content: `The article is ${n} words. Rewrite it to 1150–1400 words following every rule: expand each section with correct general explanation (how to check it, what the fix is), never padding or repeating. Return the full JSON again.` });
    a = await chat({ script, label: `${key} write (resize)`, model, messages });
    n = words(a);
  }
  return { topic: key, lang: 'ar', mainId: id, otherIds: [], words: n, writtenAt: new Date().toISOString(), model: model === 'claude-cli' ? 'claude (subscription)' : model, ...a };
}

/** Two strict passes: pass 1 = verdicts on every unit (FIX / CUT / DOUBT, each with a reason), pass 2 = coherence + six scores (+ a last error check). */
export async function reviewArticle({ key, id, an, draft, model = REVIEW_MODEL, script = 'review' }) {
  const src = `TRANSCRIPTS\n### Video ${id}\nSpoken: ${an.transcript}\nOn screen: ${an.onScreenText || '-'}`;
  const units = toUnits(draft);
  const p1 = await chat({
    script, label: `${key} review pass1`, model, temperature: 0, maxTokens: 12000,
    messages: [{ role: 'system', content: PASS1 }, { role: 'user', content: `${src}\n\nTITLE: ${draft.title}\n\nARTICLE UNITS\n${units.map((u) => `${u.id} [${u.where}] ${u.text}`).join('\n')}` }],
  });
  const originals = toUnits(draft);
  const log = [];
  for (const vd of p1.verdicts || []) {
    const u = units.find((x) => x.id === vd.id);
    if (!u) continue;
    let verdict = String(vd.verdict).toUpperCase();
    if (verdict === 'CUT' || verdict === 'DOUBT') u.cut = true; // a claim that cannot be confirmed is removed, never published
    if (verdict === 'FIX' && vd.fixed && u.text.split(/\s+/).length >= 8 && vd.fixed.split(/\s+/).length < 0.6 * u.text.split(/\s+/).length) {
      log.push({ id: u.id, where: u.where, verdict: 'SHRINK-REJECTED', text: vd.fixed, reason: `fix rejected (would shrink the sentence by 40%+): ${vd.reason}`, original: u.text });
      continue;
    }
    if (verdict === 'FIX' && vd.fixed) u.text = vd.fixed;
    log.push({ id: u.id, where: u.where, verdict, text: verdict === 'FIX' ? vd.fixed : u.text, reason: vd.reason, original: originals.find((o) => o.id === u.id)?.text });
  }
  const afterCuts = fromUnits(draft, units);
  const p2 = await chat({
    script, label: `${key} review pass2`, model, temperature: 0, maxTokens: 12000,
    messages: [{ role: 'system', content: PASS2 }, { role: 'user', content: `${src}\n\nARTICLE (JSON)\n${JSON.stringify({ title: draft.title, summary: afterCuts.summary, description: draft.description, intro: afterCuts.intro, sections: afterCuts.sections, faq: afterCuts.faq })}` }],
  });
  const { article, applied, rejected } = applyEdits({ ...afterCuts, title: draft.title, description: draft.description }, p2.edits);
  const n = (v) => log.filter((l) => l.verdict === v).length;
  const counts = { kept: units.length - n('FIX') - n('CUT') - n('DOUBT'), fixed: n('FIX'), cut: n('CUT'), doubtful: n('DOUBT'), shrinkRejected: n('SHRINK-REJECTED'), units: units.length };
  const finalWords = words(article);
  const reviewer = model === 'claude-cli' ? 'claude (subscription)' : model;
  const review = {
    topic: key, model: reviewer, reviewedAt: new Date().toISOString(), wordsBefore: draft.words, wordsAfter: finalWords, counts,
    dialect: p1.dialect, answerFirst: p1.answerFirst, factCheck: p1.factCheck, scores: p2.scores, total: Object.values(p2.scores || {}).reduce((a, b) => a + b, 0),
    notes: p2.notes, coherenceEdits: applied, rejectedEdits: rejected, log,
  };
  const final = { ...draft, ...article, words: finalWords, reviewed: true, reviewModel: reviewer };
  console.log(`  ${draft.words} → ${finalWords} words · fixed ${counts.fixed} · cut ${counts.cut} · doubtful ${counts.doubtful} · score ${review.total}/60`);
  return { review, final };
}
