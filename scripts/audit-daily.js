// audit-daily.js — the steady rhythm of the content audit (owner, 2026-11-12). Run by the Windows task «alsuhaiby-audit-daily».
// Audits 7 articles a day (live pages not yet audited first, then the queue, highest views first) and marks them audited in the
// library audit.json, which is what lets the 02:07 cloud job publish them. Nothing is published here.
//   - marker data/audit-daily.json = { lastDoneDate, lastAccrual, owed }: once today is done, every later start does nothing;
//   - missed days (PC off): +7 owed per missed day, at most 21 in one run (scripts/lib/audit-quota.js);
//   - a run cut short (Claude limit, machine guard) keeps its `owed` and finishes at the next start (the task repeats every 2 h);
//   - Telegram: ONE message when the day is done (audited, remaining, escalations); ONE ⚠️ if the day could not finish; silence otherwise.
// All audit.js rules apply (15-min cap per article, no retries, first failure → «deferred», machine guard, whole-file writes, locks).
//   node scripts/audit-daily.js [--check] [--dry]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, LIB_DIR, args, readJson, writeJson } from './lib/common.js';
import { alert } from './lib/status.js';
import { plan, after, kuwaitDay } from './lib/audit-quota.js';
import { auditLeft } from './audit.js';

const A = args();
const MARKER = path.join(ROOT, 'data', 'audit-daily.json');
const LOG = path.join(ROOT, 'data', 'run-audit-daily.log');
const PID = path.join(os.tmpdir(), 'alsuhaiby-locks', 'audit-daily.pid');
const BURST_PID = path.join(os.tmpdir(), 'alsuhaiby-locks', 'prep-burst.pid');
const CONC = Number(readJson(path.join(ROOT, 'config', 'site.json'), {}).nightConcurrency || 3);
const kt = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Kuwait', hour: '2-digit', minute: '2-digit' });
const log = (m) => { const l = `[${kt(Date.now())}] ${m}`; console.log(l); try { fs.appendFileSync(LOG, l + '\n'); } catch {} };
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const readPid = (f) => { try { return Number(fs.readFileSync(f, 'utf8')); } catch { return 0; } };
const escTotal = () => readJson(path.join(LIB_DIR, 'audit-escalations.json'), []).length;

const today = kuwaitDay();
const START = '2026-11-13'; // owner: the live pages are audited first, in tonight's bursts (16:22 / 21:00); this rhythm starts tomorrow
if (today < START && !A.check) { console.log(`not before ${START}`); process.exit(0); }
const state = readJson(MARKER, {});
const p = plan(state, today);
if (A.check) { console.log(JSON.stringify({ today, state, plan: p, auditable: auditLeft('daily').length, liveLeft: auditLeft('live').length, queueLeft: auditLeft('queue').length }, null, 2)); process.exit(0); }
if (p.skip) { log(`nothing to do: ${p.why}`); process.exit(0); }
if (A.dry) { log(`dry: would audit ${p.owed} (${p.days} day(s) owed), auditable ${auditLeft('daily').length}`); process.exit(0); }

// one instance at a time; never alongside a prep burst (they would share the same Claude window) — the next repeat will try again
fs.mkdirSync(path.dirname(PID), { recursive: true });
{ const o = readPid(PID); if (o && o !== process.pid && alive(o)) process.exit(0); }
if (alive(readPid(BURST_PID))) { log('a prep burst is running — waiting for the next start'); process.exit(0); }
fs.writeFileSync(PID, String(process.pid));
process.on('exit', () => { try { if (readPid(PID) === process.pid) fs.rmSync(PID); } catch {} });
try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}

const startLeft = auditLeft('daily').length;
const escBefore = escTotal();
if (!startLeft) { writeJson(MARKER, after(state, p, 0, 0, today)); log('nothing left to audit — marked done'); process.exit(0); }
const n = Math.min(p.owed, startLeft);
log(`start · owed ${p.owed} (${p.days} day(s)) · auditing ${n} of ${startLeft} · concurrency ${CONC}`);
writeJson(MARKER, { ...state, lastAccrual: p.lastAccrual, owed: p.owed, startedAt: new Date().toISOString() }); // accrual is saved before the run, so a crash never double-counts

const out = fs.openSync(path.join(ROOT, 'data', 'run-audit.log'), 'a');
const code = await new Promise((res) => {
  const c = spawn(process.execPath, ['scripts/audit.js', '--scope', 'daily', '--limit', String(n), '--concurrency', String(CONC), '--minutes=170', '--margin', '9'], { cwd: ROOT, stdio: ['ignore', out, out], windowsHide: true });
  c.on('exit', (x) => res(x)); c.on('error', () => res(-1));
});
const r = readJson(path.join(ROOT, 'data', 'run-audit.json'), {});
const handled = (r.audited || 0) + (r.skipped || 0) + (r.failed || 0); // everything that left the list (a failed one is «deferred», never retried)
const left = auditLeft('daily').length;
const next = after(readJson(MARKER, {}), p, handled, left, today);
writeJson(MARKER, next);
const escNew = escTotal() - escBefore;
log(`run ended (exit ${code}, ${r.stopped || 'none'}) · audited ${r.audited || 0}, changed ${r.changed || 0}, skipped ${r.skipped || 0}, set aside ${r.failed || 0} · owed now ${next.owed} · ${left} left · escalations +${escNew} (${escTotal()})`);
const queueLeft = auditLeft('queue').length, liveLeft = auditLeft('live').length;
if (next.done) alert(`🔍 alsuhaiby audit ${today}: ${r.audited || 0} audited (${r.changed || 0} changed), ${queueLeft + liveLeft} remain (${liveLeft} live, ${queueLeft} queued). Escalations: ${escNew} today, ${escTotal()} in total.`);
else if (state.alertedDate !== today) { writeJson(MARKER, { ...next, alertedDate: today }); alert(`⚠️ alsuhaiby audit ${today}: could not finish (${r.stopped || 'exit ' + code}${r.stopReason ? ': ' + String(r.stopReason).slice(0, 100) : ''}). ${r.audited || 0} audited, ${next.owed} still owed — it will continue at the next start.`); }
process.exit(0);
