// publishable.js — the owner's standing rule (2026-11-10): a video with incomplete data is NEVER published.
//   Complete = BOTH (1) its video file is on R2 (data/r2.json, and has_video_file is not false in the library) AND
//   (2) its interaction numbers are in the library (meta.json stats: likes, comments and saves are numbers; shares and views
//   may be null, TikTok does not always show them). A video marked excludeFromPublishing is never published either.
//   Removal by TikTok is NOT by itself a reason to exclude (7696203758933380372 was removed but has its file and numbers).
//   Used by publishQueued (every page that goes live), queuePage / mergeInto (no page or embed for an incomplete video),
//   daily.js (picks only complete videos for its slots) and night.js (does not spend writing on an incomplete video).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, LIB_DIR, readJson } from './common.js';

export class PublishBlockedError extends Error {}
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
export const numbersComplete = (stats) => !!stats && isNum(stats.likes) && isNum(stats.comments) && isNum(stats.saves);

/** Loads what the check needs. meta = null when the private library is not reachable (then nothing is publishable). */
export function publishData({ libDir = LIB_DIR, root = ROOT } = {}) {
  const f = path.join(libDir, 'meta.json');
  return { meta: fs.existsSync(f) ? readJson(f, {}) : null, r2: readJson(path.join(root, 'data', 'r2.json'), {}) };
}

/** { ok, reasons[] } for one video id. `needFile: false` skips the R2 check (for a step that uploads the file itself). */
export function checkPublishable(id, { meta, r2 }, { needFile = true } = {}) {
  const reasons = [];
  if (!meta) return { ok: false, reasons: ['private library not reachable: interaction numbers cannot be checked'] };
  const m = meta[id];
  if (!m) return { ok: false, reasons: ['no library record: interaction numbers missing'] };
  if (m.excludeFromPublishing) reasons.push(`excluded from publishing: ${m.excludeFromPublishing.reason || 'incomplete data'}`);
  if (m.has_video_file === false) reasons.push('no video file (has_video_file is false)');
  else if (needFile && !r2[id]) reasons.push('video file not on R2');
  if (!numbersComplete(m.stats)) reasons.push('interaction numbers missing');
  return { ok: reasons.length === 0, reasons };
}

/** Throws PublishBlockedError with the reasons when the video may not be published. */
export function assertPublishable(id, data = publishData(), opts) {
  const r = checkPublishable(id, data, opts);
  if (!r.ok) throw new PublishBlockedError(`not published (incomplete data, owner's rule): ${id}: ${r.reasons.join('; ')}`);
  return true;
}
