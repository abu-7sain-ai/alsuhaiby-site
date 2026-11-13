// dedupe-escalations.js — owner 2026-11-13: audit-escalations.json holds the same issue several times (repeated audits of one article).
// One entry per unique issue = same article id + same original sentence (whitespace-insensitive). The newest entry wins.
// The old file is kept next to it (audit-escalations.before-dedupe.json); nothing is deleted. Whole-file write.
//   node scripts/dedupe-escalations.js [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { LIB_DIR, args, readJson, writeJson } from './lib/common.js';
const A = args();
const F = path.join(LIB_DIR, 'audit-escalations.json');
const all = readJson(F, []);
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const map = new Map();
for (const e of [...all].sort((a, b) => String(a.at).localeCompare(String(b.at)))) map.set(`${e.id}|${norm(e.original)}|${e.action}`, e);
const out = [...map.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
const byRisk = {}; out.forEach((e) => { byRisk[e.risk] = (byRisk[e.risk] || 0) + 1; });
console.log(JSON.stringify({ before: all.length, after: out.length, articles: new Set(out.map((e) => e.id)).size, byRisk }));
if (!A.dry) {
  const bak = path.join(LIB_DIR, 'audit-escalations.before-dedupe.json');
  if (!fs.existsSync(bak)) fs.copyFileSync(F, bak);
  writeJson(F, out);
}
