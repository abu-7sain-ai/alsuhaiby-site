// prep-held.js — prepares every «merge-held» video that has no queue/.held-<id>/ folder yet (MP4 → R2, images, merge entry),
// so the daily job can embed it on its live page. Nothing goes live here. Safe to run again: prepared ones are skipped.
//   node scripts/prep-held.js [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, LIB_DIR, args, loadLedger, cachePath, readJson, videoIndex } from './lib/common.js';
import { download, prepareHeldMerge, heldMerges, gitSync, HELD_PREFIX } from './lib/pipeline.js';
import { pageIndex, QUEUE } from './lib/page.js';

const DRY = !!args()['dry-run'];
const have = new Set(heldMerges().map((h) => h.id));
const idx = videoIndex(), pages = pageIndex();
let n = 0;
for (const [id, e] of Object.entries(loadLedger())) {
  if (e.status !== 'merge-held' || have.has(id) || fs.existsSync(path.join(QUEUE, `${HELD_PREFIX}${id}`))) continue;
  const page = pages.find((p) => p.slug === e.page && p.where === 'live');
  const an = readJson(cachePath(id, 'analysis'), null);
  if (!page || !an) { console.log(`  ${id}: ${!page ? `live page ${e.page} not found` : 'no analysis'} — left as it is`); continue; }
  if (DRY) { console.log(`  would prepare ${id} → ${e.page}`); continue; }
  const v = idx.get(id);
  download(v);
  prepareHeldMerge(page, v, an);
  console.log(`  prepared ${id} → ${e.page}`); n++;
}
console.log(`${n} held merge(s) prepared`);
if (n && !DRY) gitSync(ROOT, ['queue', 'data/r2.json', 'scripts/prep-held.js'], `queue: ${n} held merge(s) prepared for the daily job`);
