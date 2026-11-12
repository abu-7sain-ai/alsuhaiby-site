// audit-queue-night.js — one-off (owner, 2026-11-12): audit the WHOLE queue tonight, highest views first, concurrency 6.
// Runs scripts/audit.js --scope queue until: the queue is finished, OR 21:58 Kuwait, OR the weekly limit. A 5-hour SESSION limit does not
// end it: it sleeps (no Claude calls) until the reset Claude reported and continues. Any other stop (machine guard, network, 3 failures) ends it.
// One Telegram at the stop. Nothing is published. All audit.js rules apply (never-wait, no retries, machine guard, locks, push per article).
//   node scripts/audit-queue-night.js [--until 2026-11-12T18:58:00Z]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, LIB_DIR, args, readJson } from './lib/common.js';
import { alert } from './lib/status.js';
import { auditLeft } from './audit.js';

const A = args();
const UNTIL = Date.parse(A.until || '2026-11-12T18:58:00Z'); // 21:58 Kuwait
const CONC = Number(readJson(path.join(ROOT, 'config', 'site.json'), {}).nightConcurrency || 6);
const LOG = path.join(ROOT, 'data', 'run-audit-queue-night.log');
const kt = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Kuwait', hour: '2-digit', minute: '2-digit' });
const log = (m) => { const l = `[${kt(Date.now())}] ${m}`; console.log(l); try { fs.appendFileSync(LOG, l + '\n'); } catch {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = () => readJson(path.join(LIB_DIR, 'audit-escalations.json'), []).length;
const tot = { audited: 0, changed: 0 }, esc0 = esc(), start0 = auditLeft('queue').length;
let why = '';

// "resets 12:20pm (Asia/Riyadh)" → epoch ms of the next such time (Riyadh = Kuwait = UTC+3)
function resetFrom(text) {
  const m = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(text || ''); if (!m) return 0;
  let h = Number(m[1]) % 12 + (m[3].toLowerCase() === 'pm' ? 12 : 0); const mi = Number(m[2] || 0);
  const k = new Date(Date.now() + 3 * 3600e3); let t = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), h, mi) - 3 * 3600e3;
  if (t <= Date.now()) t += 864e5; return t;
}

log(`start · ${start0} queued articles to audit · until ${kt(UNTIL)} · concurrency ${CONC}`);
for (let run = 1; run <= 12; run++) {
  if (!auditLeft('queue').length) { why = 'queue finished'; break; }
  const mins = Math.floor((UNTIL - Date.now()) / 60e3);
  if (mins < 12) { why = '21:58 reached'; break; }
  log(`run ${run} · ${auditLeft('queue').length} left · ${mins} min to the deadline`);
  const out = fs.openSync(path.join(ROOT, 'data', 'run-audit.log'), 'a');
  await new Promise((res) => { const c = spawn(process.execPath, ['scripts/audit.js', '--scope', 'queue', '--concurrency', String(CONC), `--minutes=${mins}`, '--margin', '9'], { cwd: ROOT, stdio: ['ignore', out, out], windowsHide: true }); c.on('exit', res); c.on('error', res); });
  const r = readJson(path.join(ROOT, 'data', 'run-audit.json'), {});
  tot.audited += r.audited || 0; tot.changed += r.changed || 0;
  log(`run ${run} ended: ${r.stopped} · audited ${r.audited}, changed ${r.changed}, set aside ${r.failed} · ${auditLeft('queue').length} left`);
  if (r.stopped === 'none') { why = auditLeft('queue').length ? '21:58 reached' : 'queue finished'; break; }
  if (r.stopped === 'time') { why = '21:58 reached'; break; }
  if (r.stopped === 'claude-limit') {
    if (/week/i.test(r.stopReason || '')) { why = 'weekly limit reached'; break; }
    const t = resetFrom(r.stopReason) || Date.now() + 30 * 60e3;
    if (t + 12 * 60e3 >= UNTIL) { why = `session limit; resets ${kt(t)}, too late before 21:58`; break; }
    log(`session limit — sleeping until ${kt(t + 60e3)} (no Claude calls)`);
    await sleep(t + 60e3 - Date.now()); continue;
  }
  why = `${r.stopped}: ${String(r.stopReason || '').slice(0, 120)}`; break;
}
const left = auditLeft('queue').length;
log(`END: ${why} · audited ${tot.audited}, changed ${tot.changed}, ${left} remain, escalations +${esc() - esc0} (${esc()} total)`);
alert(`🔍 alsuhaiby queue audit stopped (${why}): ${tot.audited} audited, ${tot.changed} changed, ${left} remain. Escalations: +${esc() - esc0} tonight, ${esc()} in total. The daily 7-a-day task stays armed.`);
process.exit(0);
