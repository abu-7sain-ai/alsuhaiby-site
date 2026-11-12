// audit.js — content audit of every article that has a page or waits in the queue, highest views first (owner, 2026-11-12).
// Runs in the prep bursts once the backlog is finished (scripts/prep-burst.js), so the quota left before the weekly reset is used.
//
// The owner's three rules, applied without asking him:
//   1. What Mohammad says in the video is the reference: where the article contradicts (or softens) it, the article is corrected.
//   2. A claim he never made is never attributed to him: removed, or reworded as plain general information (not his claim).
//   3. Anything that cannot be verified against the video is removed.
// "Verified" = he says/shows it, or it is the plain why/how behind HIS point with no new fact of its own. New figures, causes,
// steps, advice, warnings, products, stories, brand claims = not verified → removed.
// Per article: audit call (every unit: title, summary, intro, headings, sentences, FAQ) → edits applied → if it changed and fell
// under 1150 words: expand ONLY the verified points (no new claims), the added sentences re-checked with the same audit rules
// (up to 2 passes) → a wording-only coherence pass → page written whole (writeFileAtomic) + library final.ar.json + audit.ar.json
// → commit + push BOTH repos after every article. Accuracy beats length: if it cannot reach 1150 without new claims it stays
// shorter and is listed («short») — it is never padded with unverified text. A page edited by hand (manualEdit) is skipped.
// Escalations (risk «harm» = could physically harm a reader, «reputation» = could damage Mohammad's professional reputation) are
// collected in the library (audit-escalations.json) — the run never stops for them; the fix is applied and the item listed.
// All run rules apply: 15-minute cap per article, no retries, first failure → «deferred» (step + reason), machine guard, locks,
// Claude limit → stop, 10 network errors in a row → stop, 3 other failures in a row → stop, nothing published.
//   node scripts/audit.js [--concurrency 6] [--minutes 56] [--margin 9] [--only id,id] [--limit N] [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, LIB_DIR, args, cachePath, readJson, writeJson, writeFileAtomic, withLock, wordCount, chat, ClaudeLimitError, StopError, SkipError, runFlags, killChildren, killFor } from './lib/common.js';
import { gitSync, queued } from './lib/pipeline.js';
import { PAGES_AR, QUEUE, fmValue, yamlStr, clean } from './lib/page.js';
import { toUnits, fromUnits, splitSentences, words, applyEdits, LIMITS, TARGET } from './lib/article.js';
import { machineGate, MachineStopError } from './lib/machine.js';

const A = args();
const CONC = Number(A.concurrency || readJson(path.join(ROOT, 'config', 'site.json'), {}).nightConcurrency || 3);
const startedAt = Date.now();
const hardStop = A.minutes ? startedAt + Number(A.minutes) * 60e3 : Infinity;
const lastStart = hardStop - Number(A.margin ?? 9) * 60e3;
const CAP_MS = 15 * 60e3;
const AUDIT = path.join(LIB_DIR, 'audit.json'); // id → { status: changed|clean|skipped|deferred, ... }
const ESC = path.join(LIB_DIR, 'audit-escalations.json');
const PROGRESS = path.join(ROOT, 'data', 'run-audit.json');
const MODEL = 'claude-cli';
export const MODE = A.mode || readJson(path.join(ROOT, 'config', 'site.json'), {}).auditMode || 'balanced'; // owner decides; see NOTES «Content audit»
const kt = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuwait', hour: '2-digit', minute: '2-digit' });
const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);

// ---- prompts ---------------------------------------------------------------------------------------------------------------
const RULES = () => `The owner's three rules, applied strictly:
1. What Mohammad says in the video is the reference. Where the article contradicts it — or softens, weakens, reverses or exaggerates his point or his warning — the article is wrong.
2. A claim he never made is never attributed to him (e.g. «محمد يقول/ينصح», «الصهيبي», «بكراجنا شفنا», «من خبرتنا», a first-person garage experience, or presenting it as his advice or his warning).
3. Anything that cannot be verified against the video is removed.
   VERIFIED means: (a) he says it or it is shown/written on screen; or (b) it is the plain, obvious why/how behind a point HE made and adds no new fact of its own.
   NOT VERIFIED: any new number or figure (temperature, speed, minutes, km, percentage, price, quantity); any cause, sign, step, tool, product, part, procedure, advice or warning he did not give; any statistic, personal story, brand/model-specific claim; anything a careful mechanic could dispute.${MODE === 'balanced' ? `
   KEPT AS GENERAL INFORMATION (rule 2): a correct, well-established explanation of HOW or WHY the parts he talks about work or fail, that a careful mechanic would never dispute and that contains none of the NOT VERIFIED items above (no figure, no advice, no step, no warning, no new cause or sign). It stays only if it reads as general information, not as his claim; REWORD it if it is attributed to him.` : ''}
If several videos are given, they are all his own videos on this page: what he says in any of them counts as verified.`;

export const AUDIT_PROMPT = () => `You audit an Arabic web article on the personal site of محمد الصهيبي, a Kuwaiti mechanic («كراج الصهيبي»). An AI wrote it from his short video(s) and expanded it with general knowledge.
${RULES()}
The article is split into numbered units (title, description, summary, intro sentences, section headings, sentences, list items, FAQ questions and answer sentences). Check EVERY unit. List ONLY units that need action:
- CORRECT (rule 1): "text" = the corrected unit in the same spoken Kuwaiti dialect, saying what HE says (no new facts).
- REWORD (rule 2): the content itself is verified, but it is attributed to him wrongly → "text" = the same content as plain general information, clearly not his personal claim (no new facts).
- REMOVE (rule 3, or rule 2 when the content is not verified).
Each listed unit also gets "rule" (1|2|3), "reason" (short English; quote what the video says when relevant) and "risk" about the ORIGINAL unit:
- "harm": ONLY if a reader who follows the original could realistically be injured (burns, fire, loss of control, brake failure) — e.g. it contradicts or weakens HIS safety warning, or gives a dangerous procedure;
- "reputation": ONLY if the original puts a clearly false or self-contradicting statement in his name, or reverses/softens one of his firm claims, so that a mechanic reading it would think less of him;
- "none" for everything else — an extra detail, an unverified but harmless explanation, a style issue, a figure that is merely not his. Most units are "none"; be sparing.
The title cannot be removed: CORRECT it if it is wrong (its number must match the number of points he gives). A heading is removed only if its whole section is unverified.
FAQ: if a question's answer is not verified, REMOVE its answer sentences and the question unit.
Do not touch units that are verified and correctly attributed. Do not rewrite for style.
Return ONLY JSON:
{"verdicts":[{"id":"S12","action":"CORRECT|REWORD|REMOVE","text":"only for CORRECT/REWORD","rule":1,"risk":"none|harm|reputation","reason":"..."}],"note":"one English sentence on the article overall"}`;

const EXPAND_PROMPT = () => `You are the writer of this Arabic article for محمد الصهيبي's site (spoken Kuwaiti dialect, short sentences, «كراج» never «ورشة», talking to the driver as «انت»).
After a strict accuracy audit the article is too short. ADD sentences that expand ONLY what he actually says in the video(s): restate his points more fully, spell out the plain why/how behind HIS points, describe in more words what the driver notices as HE describes it.
${RULES()}
So you may NOT add any new number, cause, sign, step, tool, product, advice, warning, story or claim, and nothing is attributed to him that he did not say.
NEVER repeat or restate an idea that is already in the article (no recaps, no «خلها ببالك», no listing his points again, no "as we said"). If nothing new and verified can be added to a section, add nothing there — a shorter article is better than padding.
Return ONLY JSON: {"additions":[{"section":0,"text":"one or more new Arabic sentences for the END of that section"}]}`;

const COHERE_PROMPT = `A strict accuracy audit removed or corrected some sentences of this Arabic article. Make it read coherently again with MINIMAL wording edits only:
fix dangling references («ثانيًا» with no «أولًا», «كما ذكرنا» pointing to removed text, broken transitions); if the number in the title or summary no longer matches the number of sections that give his points, edit the title/summary so it matches.
You may NOT add any fact, number, cause, step, advice or claim, may NOT attribute anything to Mohammad, and may NOT remove or summarise sentences. Change words, not content. Return only fields you changed.
Return ONLY JSON: {"edits":[{"field":"title|summary|intro|description|sections[i].heading|sections[i].body|faq[i].q|faq[i].a","text":"the full new text of that field"}]}`;

// ---- pages -----------------------------------------------------------------------------------------------------------------
export function articleList() {
  const out = [];
  if (fs.existsSync(PAGES_AR)) for (const f of fs.readdirSync(PAGES_AR).filter((x) => x.endsWith('.md'))) {
    const file = path.join(PAGES_AR, f), txt = fs.readFileSync(file, 'utf8');
    out.push({ id: String(fmValue(txt, 'tiktokId')), file, where: 'live', views: Number(fmValue(txt, 'views')) || 0, slug: path.basename(f, '.md'), title: fmValue(txt, 'title') });
  }
  for (const q of queued()) out.push({ id: String(q.id), file: path.join(QUEUE, q.id, 'page.md'), where: 'queue', views: Number(q.views) || 0, slug: q.slug, title: q.title });
  return out.filter((a) => fs.existsSync(a.file)).sort((a, b) => b.views - a.views);
}

export function parsePage(txt) {
  const end = txt.indexOf('\n---\n', 3);
  const head = txt.slice(0, end), body = txt.slice(end + 5);
  const faq = [];
  const hl = head.split('\n'), fi = hl.findIndex((l) => l === 'faq:');
  if (fi >= 0) for (let j = fi + 1; j < hl.length && hl[j].startsWith('  '); j++) {
    let m = hl[j].match(/^ {2}- q: (.*)$/); if (m) { faq.push({ q: JSON.parse(m[1]), a: '' }); continue; }
    m = hl[j].match(/^ {4}a: (.*)$/); if (m && faq.length) faq[faq.length - 1].a = JSON.parse(m[1]);
  }
  const parts = body.split(/^## /m);
  const intro = parts[0].trim();
  const sections = parts.slice(1).map((p) => { const nl = p.indexOf('\n'); return { heading: p.slice(0, nl < 0 ? undefined : nl).trim(), body: nl < 0 ? '' : p.slice(nl + 1).trim() }; });
  return { head, a: { title: fmValue(txt, 'title'), summary: fmValue(txt, 'summary'), description: fmValue(txt, 'description'), intro, sections, faq } };
}

export function renderPage(head, a) {
  let h = head;
  const setLine = (k, v) => { const re = new RegExp(`^${k}: .*$`, 'm'); h = re.test(h) ? h.replace(re, () => `${k}: ${yamlStr(v)}`) : h; };
  setLine('title', clean(a.title)); setLine('summary', clean(a.summary)); setLine('description', clean(a.description).slice(0, 160)); setLine('updated', today());
  const hl = h.split('\n');
  let fi = hl.findIndex((l) => l === 'faq:' || l === 'faq: []');
  const faqLines = a.faq.length ? ['faq:', ...a.faq.slice(0, 5).flatMap((f) => [`  - q: ${yamlStr(clean(f.q))}`, `    a: ${yamlStr(clean(f.a))}`])] : ['faq: []'];
  if (fi >= 0) { let j = fi + 1; while (j < hl.length && hl[j].startsWith('  ')) j++; hl.splice(fi, j - fi, ...faqLines); } else hl.push(...faqLines);
  const body = [clean(a.intro), ...a.sections.map((s) => `## ${clean(s.heading)}\n\n${clean(s.body)}`)].join('\n\n') + '\n';
  return `${hl.join('\n')}\n---\n${body}`;
}

function sources(item, txt) {
  const ids = [item.id, ...[...txt.slice(0, txt.indexOf('\n---\n', 3)).matchAll(/^ {2}- tiktokId: "(\d+)"/gm)].map((m) => m[1])];
  const out = [];
  for (const id of [...new Set(ids)]) {
    const an = readJson(cachePath(id, 'analysis'), null);
    if (an?.transcript) out.push(`### VIDEO ${id}${id === item.id ? ' (main video of this page)' : ' (also embedded on this page)'}\nSpoken: ${an.transcript}\nOn screen: ${an.onScreenText || '-'}${an.items ? `\nItems: ${JSON.stringify(an.items)}` : ''}`);
  }
  return { text: out.join('\n\n'), mainOk: !!readJson(cachePath(item.id, 'analysis'), null)?.transcript };
}

// ---- one article -----------------------------------------------------------------------------------------------------------
async function auditOne(item, step) {
  const txt = fs.readFileSync(item.file, 'utf8');
  if (/^manualEdit:/m.test(txt.slice(0, txt.indexOf('\n---\n', 3)))) return { status: 'skipped', reason: 'edited by hand (manualEdit) — never overwritten' };
  const src = sources(item, txt);
  if (!src.mainOk) return { status: 'skipped', reason: 'no saved analysis/transcript for the main video — cannot be checked' };
  const { head, a } = parsePage(txt);
  const wordsBefore = words(a);
  const L = (s) => `${item.id} ${s}`; // the id in every label: the 15-minute cap ends this article's calls only

  // 1) audit every unit
  step('audit');
  const units = [{ id: 'T', where: 'title', text: a.title }, { id: 'D', where: 'description', text: a.description }, ...toUnits(a)];
  const r = await chat({ script: 'audit', label: L('audit'), model: MODEL, temperature: 0,
    messages: [{ role: 'system', content: AUDIT_PROMPT() }, { role: 'user', content: `VIDEO TRANSCRIPTS (the reference)\n${src.text}\n\nARTICLE UNITS\n${units.map((u) => `${u.id} [${u.where}] ${u.text}`).join('\n')}` }] });
  const log = [];
  for (const vd of r.verdicts || []) {
    const u = units.find((x) => x.id === vd.id); if (!u) continue;
    const action = String(vd.action || '').toUpperCase();
    const original = u.text;
    if (action === 'REMOVE') { if (u.where === 'title') continue; u.cut = true; }
    else if ((action === 'CORRECT' || action === 'REWORD') && typeof vd.text === 'string' && vd.text.trim()) u.text = vd.text.trim();
    else continue;
    log.push({ id: u.id, where: u.where, action, rule: vd.rule, risk: vd.risk || 'none', reason: vd.reason, original, now: u.cut ? null : u.text });
  }
  if (!log.length) return { status: 'clean', wordsBefore, wordsAfter: wordsBefore, note: r.note, log };

  let out = fromUnits(a, units.filter((u) => u.id !== 'T' && u.id !== 'D'));
  out.title = units[0].text;
  out.description = units[1].cut ? splitSentences(out.summary)[0]?.text?.slice(0, 155) || a.description : units[1].text;

  // 2) coherence (wording only; a shrink over 20% is rejected by applyEdits)
  step('coherence');
  const co = await chat({ script: 'audit', label: L('coherence'), model: MODEL, temperature: 0,
    messages: [{ role: 'system', content: COHERE_PROMPT }, { role: 'user', content: `ARTICLE (JSON)\n${JSON.stringify({ title: out.title, summary: out.summary, description: out.description, intro: out.intro, sections: out.sections.map(({ heading, body }) => ({ heading, body })), faq: out.faq })}` }] });
  const ce = applyEdits(out, co.edits || []); out = ce.article;

  // 3) under 1150 after the edit → expand the verified points only (≤ 2 passes), every added sentence re-audited
  const expands = [];
  for (let pass = 1; pass <= 2 && words(out) < LIMITS[0] && out.sections.length; pass++) {
    step(`expand ${pass}`);
    const before = words(out), need = TARGET[0] + 25 - before;
    const ex = await chat({ script: 'audit', label: L(`expand ${pass}`), model: MODEL, temperature: 0.3,
      messages: [{ role: 'system', content: EXPAND_PROMPT() }, { role: 'user', content: `VIDEO TRANSCRIPTS (the only source)\n${src.text}\n\nThe article is ${before} words; add about ${need} words, spread over the sections.\n\nSECTIONS (index | heading | body)\n${out.sections.map((x, i) => `${i} | ${x.heading} | ${x.body}`).join('\n')}` }] });
    const added = [];
    for (const ad of ex.additions || []) if (out.sections[ad.section] && typeof ad.text === 'string') splitSentences(ad.text).forEach((s) => added.push({ id: `A${added.length + 1}`, where: `section${+ad.section}.body`, section: +ad.section, text: s.text }));
    if (!added.length) break;
    step(`expand ${pass} check`);
    const chk = await chat({ script: 'audit', label: L(`expand ${pass} check`), model: MODEL, temperature: 0,
      messages: [{ role: 'system', content: AUDIT_PROMPT() }, { role: 'user', content: `VIDEO TRANSCRIPTS (the reference)\n${src.text}\n\nTHE ARTICLE AS IT IS (context only)\n${out.sections.map((x) => `## ${x.heading}\n${x.body}`).join('\n\n')}\n\nARTICLE UNITS (only these NEW sentences are checked; also REMOVE, rule 3, any that repeats or restates an idea already in the article)\n${added.map((u) => `${u.id} [${u.where}] ${u.text}`).join('\n')}` }] });
    for (const vd of chk.verdicts || []) {
      const u = added.find((x) => x.id === vd.id); if (!u) continue;
      const action = String(vd.action || '').toUpperCase();
      if (action === 'REMOVE') u.cut = true; else if (typeof vd.text === 'string' && vd.text.trim()) u.text = vd.text.trim();
    }
    const keep = added.filter((u) => !u.cut);
    // never over 1400: drop added sentences from the end until it fits
    const next = structuredClone(out);
    const bySec = new Map(); for (const u of keep) bySec.set(u.section, [...(bySec.get(u.section) || []), u]);
    for (const [i, us] of bySec) next.sections[i].body = `${next.sections[i].body}\n\n${us.map((u) => u.text).join(' ')}`;
    while (words(next) > LIMITS[1] && keep.length) { keep.pop(); const nb = new Map(); for (const u of keep) nb.set(u.section, [...(nb.get(u.section) || []), u]); for (let i = 0; i < next.sections.length; i++) next.sections[i].body = out.sections[i].body + (nb.get(i) ? `\n\n${nb.get(i).map((u) => u.text).join(' ')}` : ''); }
    out = next;
    expands.push({ pass, before, after: words(out), added: added.length, kept: keep.length });
  }
  const wordsAfter = words(out);

  // 4) write: the page (whole file), the library article + audit log
  step('write');
  writeFileAtomic(item.file, renderPage(head, out));
  const finalPath = cachePath(item.id, 'final.ar');
  const fin = readJson(finalPath, null);
  if (fin) writeJson(finalPath, { ...fin, title: out.title, summary: out.summary, description: out.description, intro: out.intro, sections: out.sections, faq: out.faq, words: wordsAfter, auditedAt: new Date().toISOString() });
  const status = 'changed';
  const lengthNote = wordsAfter < LIMITS[0] ? 'short' : wordsAfter > LIMITS[1] ? 'long' : 'ok';
  writeJson(cachePath(item.id, 'audit.ar'), { id: item.id, mode: MODE, slug: item.slug, where: item.where, auditedAt: new Date().toISOString(), wordsBefore, wordsAfter, length: lengthNote, note: r.note, log, coherenceEdits: ce.applied, rejectedEdits: ce.rejected, expands });
  return { status, wordsBefore, wordsAfter, length: lengthNote, note: r.note, log };
}

// ---- the run ---------------------------------------------------------------------------------------------------------------
const auditLedger = () => readJson(AUDIT, {});
const setAudit = (id, entry) => withLock('audit', () => { const l = auditLedger(); l[id] = { ...entry, at: new Date().toISOString() }; writeJson(AUDIT, l); });
export const auditLeft = () => { const l = auditLedger(); return articleList().filter((a) => !l[a.id]); };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'scripts', 'audit.js')) {
  let todo = auditLeft();
  if (A.only) { const want = new Set(String(A.only).split(',')); todo = articleList().filter((a) => want.has(a.id)); }
  if (A.limit) todo = todo.slice(0, Number(A.limit));
  if (A.dry) { console.log(`${todo.length} to audit (highest views first):`); todo.slice(0, 15).forEach((a) => console.log(`  ${a.views}\t${a.where}\t${a.id}\t${a.title}`)); process.exit(0); }
  const done = { changed: [], clean: [], skipped: [], failed: [], short: [] };
  let stopKind = '', stopReason = '', failStreak = 0, netStreak = 0;
  const isNet = (e) => /fetch failed|network|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ENETUNREACH|socket hang up|getaddrinfo|Could not resolve host|unable to access/i.test(`${e?.message || ''}`);
  const save = (extra = {}) => withLock('run-state', () => writeJson(PROGRESS, { startedAt: new Date(startedAt).toISOString(), updatedAt: new Date().toISOString(), concurrency: CONC, audited: done.changed.length + done.clean.length, changed: done.changed.length, clean: done.clean.length, skipped: done.skipped.length, failed: done.failed.length, short: done.short, left: auditLeft().length, running: true, stopped: null, ...extra, details: done }));
  const stop = (kind, reason) => { if (stopKind) return; stopKind = kind; stopReason = reason; runFlags.stopping = true; console.warn(`  ⛔ stopping: ${reason}`); killChildren(); };
  const timer = Number.isFinite(hardStop) ? setTimeout(() => stop('time', `time limit reached (${kt(hardStop)} Kuwait)`), Math.max(0, hardStop - Date.now())) : null;
  const addEscalations = (item, log) => {
    const esc = log.filter((x) => x.risk === 'harm' || x.risk === 'reputation');
    if (!esc.length) return;
    withLock('audit-esc', () => { const all = readJson(ESC, []); for (const x of esc) all.push({ id: item.id, slug: item.slug, title: item.title, where: item.where, url: item.where === 'live' ? `https://alsuhaiby.com/${item.slug}/` : null, risk: x.risk, rule: x.rule, action: x.action, original: x.original, now: x.now, reason: x.reason, at: new Date().toISOString() }); writeJson(ESC, all); });
  };
  async function worker(w) {
    while (!stopKind) {
      if (Date.now() >= lastStart) return;
      try { await (Number.isFinite(hardStop) ? Promise.race([machineGate(), new Promise((_, rej) => setTimeout(() => rej(new StopError('time')), Math.max(0, hardStop - Date.now())))]) : machineGate()); }
      catch (e) { if (e instanceof MachineStopError) { stop('machine', e.message); return; } if (e instanceof StopError) return; throw e; }
      if (stopKind || Date.now() >= lastStart) return;
      const item = todo.shift(); if (!item) return;
      let cur = 'start';
      console.log(`[w${w}] ${item.id} (${item.views} views, ${item.where}) ${item.title}`);
      try {
        let capTimer;
        const job = auditOne(item, (s) => { cur = s; }); job.catch(() => {});
        const res = await Promise.race([job, new Promise((_, rej) => { capTimer = setTimeout(() => { runFlags.aborted.add(item.id); killFor(item.id); rej(new SkipError('over 15 minutes (something stalled)', cur)); }, CAP_MS); })]).finally(() => clearTimeout(capTimer));
        if (runFlags.stopping) throw new StopError('stopped');
        setAudit(item.id, { status: res.status, mode: MODE, slug: item.slug, where: item.where, views: item.views, wordsBefore: res.wordsBefore, wordsAfter: res.wordsAfter, length: res.length, changes: res.log?.length || 0, reason: res.reason });
        if (res.status === 'changed') addEscalations(item, res.log);
        done[res.status].push({ id: item.id, slug: item.slug, changes: res.log?.length || 0, words: `${res.wordsBefore}→${res.wordsAfter}` });
        if (res.length === 'short') done.short.push(item.id);
        // commit + push both repos after every article (never half-edited: the page was written whole before this)
        gitSync(LIB_DIR, ['.'], `audit: ${item.id} ${res.status}`);
        if (res.status === 'changed') gitSync(ROOT, [path.relative(ROOT, item.file).replace(/\\/g, '/')], `audit: ${item.slug} (${res.log.length} changes)`, { push: true });
        console.log(`  ✓ ${item.id} ${res.status}${res.log ? ` · ${res.log.length} changes · ${res.wordsBefore}→${res.wordsAfter} words` : ''}`);
        failStreak = 0; netStreak = 0;
      } catch (e) {
        if (e instanceof ClaudeLimitError) { stop('claude-limit', e.message); continue; }
        if (e instanceof StopError || runFlags.stopping) continue; // nothing was written (the page is written whole at the end only)
        const net = !(e instanceof SkipError) && isNet(e);
        setAudit(item.id, { status: 'deferred', step: e.step || cur, reason: String(e.message).slice(0, 300), slug: item.slug, where: item.where, views: item.views, ...(net ? { network: true } : {}) });
        done.failed.push({ id: item.id, step: e.step || cur, reason: String(e.message).slice(0, 160) });
        console.warn(`  – معلّقة: ${item.id} at «${e.step || cur}»: ${e.message}`);
        try { gitSync(LIB_DIR, ['.'], `audit: ${item.id} deferred`); } catch {}
        if (net) { if (++netStreak >= 10) stop('network', `10 network errors in a row; last: ${String(e.message).slice(0, 150)}`); }
        else if (!(e instanceof SkipError) && (netStreak = 0, ++failStreak >= 3)) stop('errors', `3 articles failed in a row; last: ${String(e.message).slice(0, 150)}`);
      }
      save();
    }
  }
  save();
  await Promise.all(Array.from({ length: Math.min(CONC, todo.length) }, (_, i) => new Promise((r) => setTimeout(r, i * 5000)).then(() => worker(i + 1))));
  if (timer) clearTimeout(timer);
  if (!stopKind && Number.isFinite(hardStop) && Date.now() >= lastStart && todo.length) { stopKind = 'time'; stopReason = `time limit (${kt(hardStop)} Kuwait)`; }
  try { gitSync(LIB_DIR, ['.'], 'audit: end of run'); } catch (e) { console.warn(`  ! final push (library): ${e.message}`); }
  try { gitSync(ROOT, ['content/videos', 'queue'], 'audit: end of run', { push: true }); } catch (e) { console.warn(`  ! final push (site): ${e.message}`); }
  save({ running: false, stopped: stopKind || 'none', stopReason, stoppedAt: new Date().toISOString() });
  console.log(`audit: changed ${done.changed.length} · clean ${done.clean.length} · skipped ${done.skipped.length} · set aside ${done.failed.length} · ${auditLeft().length} left${stopKind ? ` · stopped: ${stopReason}` : ''}`);
  process.exit(0);
}
