// migrate-library.js — one time (Phase 3): copies the per-video caches that sat next to the MP4s, and the 721-video list,
// into the private library repo, and seeds the dedup ledger from the 20 pages already live. Originals are left where they are.
//   node scripts/migrate-library.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, LIB_DIR, readJson, writeJson, videoIndex, cachePath, LEDGER } from './lib/common.js';
import { pageIndex } from './lib/page.js';

const OLD_LIBRARY = path.join(os.homedir(), 'Desktop', 'KatibSuhaibi', 'data', 'outputs', '_library.json');
if (!fs.existsSync(path.join(LIB_DIR, 'library.json'))) fs.copyFileSync(OLD_LIBRARY, path.join(LIB_DIR, 'library.json'));
const videos = videoIndex();
let copied = 0;
for (const v of videos.values()) {
  if (!v.path) continue;
  for (const kind of ['analysis', 'write.ar', 'review.ar', 'final.ar', 'write.en', 'write.fr', 'write.es', 'write.ur']) {
    const old = `${v.path}.${kind}.json`;
    const dest = cachePath(v, kind);
    if (fs.existsSync(old) && !fs.existsSync(dest)) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(old, dest); copied++; }
  }
}
const ledger = readJson(LEDGER, {});
const pages = pageIndex();
let seeded = 0;
for (const t of readJson(path.join(ROOT, 'data', 'topics.json'), [])) {
  const page = pages.find((p) => p.id === t.main);
  const slug = page?.slug;
  if (!ledger[t.main]) { ledger[t.main] = { status: 'published', page: slug, line: 'phase1', at: new Date().toISOString() }; seeded++; }
  for (const id of t.others || []) if (!ledger[id]) { ledger[id] = { status: 'merged', page: slug, line: 'phase1', reason: 'embedded on the Phase 1 page', at: new Date().toISOString() }; seeded++; }
}
writeJson(LEDGER, ledger);
console.log(`library: ${videos.size} videos · copied ${copied} cache files · ledger +${seeded} (${Object.keys(ledger).length} total)`);
