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
import { guard } from './lib/status.js';
guard('review');

const A = args();
const REVIEW_MODEL = process.env.REVIEW_MODEL || 'anthropic/claude-sonnet-5.5';
const videos = videoIndex();
const topics = readJson(path.join(ROOT, 'data', 'topics.json'), []).filter((t) => !A.only || t.key === A.only);

import { toUnits, fromUnits, applyEdits, PASS1, PASS2 } from './lib/article.js';
const words = (a) => wordCount([a.summary, a.intro, ...a.sections.map((s) => `${s.heading} ${s.body}`)].join(' '));

function transcripts(t) {
  const v = videos.get(t.main);
  const an = readJson(cachePath(v, 'analysis'), {});
  return `### Video ${t.main}
Spoken: ${an.transcript}
On screen: ${an.onScreenText || '-'}`;
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
    if (verdict === 'CUT' || verdict === 'DOUBT') u.cut = true;
    if (verdict === 'FIX' && vd.fixed && u.text.split(/\s+/).length >= 8 && vd.fixed.split(/\s+/).length < 0.6 * u.text.split(/\s+/).length) {
      // a "fix" that drops 40%+ of a sentence is a hidden cut: keep the original and log it for a human look
      log.push({ id: u.id, where: u.where, verdict: 'SHRINK-REJECTED', text: vd.fixed, reason: `fix rejected (would shrink the sentence by 40%+): ${vd.reason}` });
      continue;
    }
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
  const counts = { kept: units.length - fixedN - cutN, fixed: fixedN, cut: cutN, shrinkRejected: log.filter((l) => l.verdict === 'SHRINK-REJECTED').length, units: units.length };
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
