// hold-short.js — one-off (2026-11-11): takes queued articles under 1150 words OUT of the queue so the 02:07 job cannot
// publish them, and sends them back to the prep line to be rewritten under the length rules. Nothing is lost: the old page
// folder and the old drafts are copied to %TEMP%\alsuhaiby-held\<id>\ first (and stay in git history).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ROOT, LIB_DIR, loadLedger, setLedger, cachePath } from './lib/common.js';
import { gitSync } from './lib/pipeline.js';
const MIN = 1150, BACKUP = path.join(os.tmpdir(), 'alsuhaiby-held');
const held = [];
for (const [id, e] of Object.entries(loadLedger())) {
  if (e.status !== 'queued' || !(e.words < MIN)) continue;
  const dir = path.join(ROOT, 'queue', id), bk = path.join(BACKUP, id);
  fs.mkdirSync(bk, { recursive: true });
  if (fs.existsSync(dir)) { fs.cpSync(dir, path.join(bk, 'queue'), { recursive: true }); fs.rmSync(dir, { recursive: true }); }
  for (const k of ['write.ar', 'review.ar', 'final.ar']) { const p = cachePath(id, k); if (fs.existsSync(p)) { fs.copyFileSync(p, path.join(bk, `${k}.json`)); fs.rmSync(p); } }
  setLedger(id, { status: 'rewrite', reason: `held: ${e.words} words (< ${MIN}); rewrite under the length rules`, line: 'hold-short', page: null });
  held.push(`${id} (${e.words} words, ${e.page})`);
}
console.log(`held ${held.length}:\n  ${held.join('\n  ')}\nbackup: ${BACKUP}`);
if (held.length) {
  gitSync(LIB_DIR, ['.'], `hold ${held.length} short articles for rewrite`);
  gitSync(ROOT, ['queue', 'scripts/hold-short.js'], `queue: hold ${held.length} articles under ${MIN} words (rewrite before publishing)`);
}
