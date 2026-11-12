// prep-burst.js — the prep line runs ONLY in short bursts: the last hour before each 5-hour Claude session window resets
// (owner, 2026-11-11). Between bursts nothing runs at all: no process, no Claude call, zero quota.
//
// SELF-CORRECTING (owner, 2026-11-12): the 5-hour window is anchored to its first use, not to a fixed clock, so a burst is
// never timed from a hard-coded hour. When the scheduled task fires, the runner first reads the REAL reset time from Claude
// itself: one tiny Haiku call in stream-json mode, whose «rate_limit_event» carries the five-hour window's resetsAt (and the
// weekly one). The burst is then  [real reset − 60 min, real reset − 2 min]:
//   · fired early (reset still > 60 min away) → waits quietly in-process (no Claude call) until reset − 60 min, then starts
//   · fired inside that hour → starts at once and stops at reset − 2 min
//   · fewer than 10 minutes left → nothing runs
//   · the window is already used up (status rejected) → nothing runs; the next trigger continues
//   · Claude's reset time can't be read (network, odd output) → falls back to the armed trigger's own window (FALLBACK)
// Armed triggers of the task «alsuhaiby-prep-supervisor» (Kuwait): 11:22, 16:22, 21:00 — they are only "wake-up and check"
// times; the window itself always comes from the real reset.
// Backlog finished (owner, 2026-11-12): the rest of the burst — and the later bursts — run the content audit (scripts/audit.js,
// highest views first); the schedule stops only when the backlog is finished AND every article is audited.
// Stops: session limit inside a burst → the burst ends at once (next trigger continues) · weekly limit → whole schedule
// stops (task disabled) · backlog finished → «finished» message, whole schedule stops (task disabled) · nothing after 21:58
// Thursday 2026-11-12 (the weekly quota resets at 22:00; the task also expires and deletes itself then).
// A run that ends early for another reason (errors, network, a crash) is started again while ≥ 10 min of the burst remain.
// Telegram: ONE message at the end of each burst (written, remaining, why it ended, the real reset it used) + one at the finish.
// All night.js rules apply: never-wait, no retries, machine guard, whole-file writes, locks, nothing published.
//   node scripts/prep-burst.js            (what the task runs)
//   node scripts/prep-burst.js --now      start at once (no waiting for reset − 60 min), still stops at reset − 2 min
//   node scripts/prep-burst.js --check    show the last known reset, the armed fallback windows and what is left; no Claude call
//   node scripts/prep-burst.js --probe    read the real reset from Claude (one tiny Haiku call) and print it; runs nothing
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, LIB_DIR, args, readJson, writeJson, loadLedger } from './lib/common.js';
import { remaining, queued } from './lib/pipeline.js';
import { alert } from './lib/status.js';
import { auditLeft } from './audit.js';
import { HARD_STOP, MIN_BURST, fbCurrent, fbNext, decide, hm } from './lib/burst-window.js';

const A = args();
const TASK = 'alsuhaiby-prep-supervisor';
const MARGIN = 9; // minutes before the stop when no new video starts
const CONC = Number(readJson(path.join(ROOT, 'config', 'site.json'), {}).nightConcurrency || 3);
const STATE = path.join(ROOT, 'data', 'prep-burst.json');
const LOG = path.join(ROOT, 'data', 'run-burst.log'); // data/run-*.log is not committed
const PID = path.join(os.tmpdir(), 'alsuhaiby-locks', 'prep-burst.pid');
const kt = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Kuwait', weekday: 'short', hour: '2-digit', minute: '2-digit' });
const log = (m) => { const l = `[${kt(Date.now())}] ${m}`; console.log(l); try { fs.appendFileSync(LOG, l + '\n'); } catch {} };
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const left = () => { const l = loadLedger(); return remaining().filter((v) => l[v.id]?.status !== 'failed').length; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = () => readJson(STATE, {});
const auditTodo = () => auditLeft().length; // articles not audited yet (scripts/audit.js)
const escalations = () => readJson(path.join(LIB_DIR, 'audit-escalations.json'), []).length;
const allDone = (extra = '') => { alert(`✅ alsuhaiby prep: the whole backlog is finished and every article is audited${extra}. Escalations for the owner: ${escalations()}. Schedule stopped.`); disableTask('backlog finished + audit finished'); process.exit(0); };

const disableTask = (why) => { const r = spawnSync('schtasks', ['/Change', '/TN', TASK, '/DISABLE'], { encoding: 'utf8', timeout: 30e3 }); log(`schedule stopped (${why}) — task ${r.status === 0 ? 'disabled' : `not disabled: ${String(r.stderr || '').trim()}`}`); };

// The real reset: a tiny Haiku call in stream-json mode; Claude reports the five-hour (and weekly) window in a rate_limit_event.
// Never waits: 90 s cap, no retry. Returns { ok, fiveReset, fiveUtil, fiveStatus, weekReset, weekUtil, weekStatus } or { ok:false, why }.
function probe() {
  const env = { ...process.env }; delete env.ANTHROPIC_API_KEY;
  const r = spawnSync('claude', ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--no-session-persistence',
    '--setting-sources', 'project', '--tools', '""', '--strict-mcp-config'],
  { input: 'Reply with the word OK.', cwd: os.tmpdir(), env, encoding: 'utf8', shell: true, timeout: 90e3, windowsHide: true });
  let info = null;
  for (const line of String(r.stdout || '').split('\n')) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'rate_limit_event' && j.rate_limit_info) info = j.rate_limit_info; // keep the last one
  }
  if (!info) return { ok: false, why: r.error ? String(r.error.code || r.error.message) : `no rate_limit_event (exit ${r.status})` };
  const w = info.unifiedWindows || {};
  const five = w.five_hour || (info.rateLimitType === 'five_hour' ? info : {});
  const week = w.seven_day || {};
  const ms = (s) => (s ? Number(s) * 1e3 : 0);
  return { ok: !!ms(five.resetsAt), why: ms(five.resetsAt) ? '' : 'no five-hour reset in the event',
    fiveReset: ms(five.resetsAt), fiveUtil: five.utilization, fiveStatus: five.status || info.status,
    weekReset: ms(week.resetsAt), weekUtil: week.utilization, weekStatus: week.status };
}
const probeTxt = (p) => p.ok ? `5-hour window resets ${kt(p.fiveReset)} (${Math.round((p.fiveUtil ?? 0) * 100)}% used, ${p.fiveStatus}) · weekly resets ${p.weekReset ? kt(p.weekReset) : '?'} (${Math.round((p.weekUtil ?? 0) * 100)}% used, ${p.weekStatus || '?'})` : `reset not readable: ${p.why}`;

if (A.check) {
  const s = state(), n = fbNext(), c = fbCurrent();
  console.log(`now ${kt(Date.now())} · last real reset read: ${s.realReset ? `${kt(Date.parse(s.realReset))} (read ${kt(Date.parse(s.realResetReadAt))})` : 'none yet'} · fallback window ${c ? `NOW until ${hm(c.stop)}` : n ? `next ${kt(n.start)} → ${hm(n.stop)}` : '-'} · hard stop ${kt(HARD_STOP)} · concurrency ${CONC} · ${left()} left`);
  process.exit(0);
}
if (A.probe) { console.log(probeTxt(probe())); process.exit(0); }

// ---- guards: one burst runner at a time, deadline -------------------------------------------------------------------------
fs.mkdirSync(path.dirname(PID), { recursive: true });
{ let other = 0; try { other = Number(fs.readFileSync(PID, 'utf8')); } catch {} if (other && other !== process.pid && alive(other)) process.exit(0); }
if (Date.now() >= HARD_STOP) { log('Thursday 21:58 hard stop passed — nothing runs'); disableTask('deadline'); process.exit(0); }
fs.writeFileSync(PID, String(process.pid));
process.on('exit', () => { try { if (Number(fs.readFileSync(PID, 'utf8')) === process.pid) fs.rmSync(PID); } catch {} });
try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {} // the run it starts inherits below-normal
if (!left() && !auditTodo()) allDone();

// ---- the burst window, from the REAL reset -------------------------------------------------------------------------------
let p = probe();
log(`fired · ${probeTxt(p)}`);
if (p.ok) writeJson(STATE, { ...state(), realReset: new Date(p.fiveReset).toISOString(), realResetReadAt: new Date().toISOString(), fiveUtil: p.fiveUtil, weekUtil: p.weekUtil });
const d = decide(p, Date.now(), !!A.now);
log(`decision: ${d.act}${d.burst ? ` · burst ${hm(d.burst.start)}→${hm(d.burst.stop)}` : ''} (${d.source})`);
if (A.dry) process.exit(0);
if (d.act === 'weekly') { alert(`⛔ alsuhaiby prep: weekly limit reached — schedule stopped. ${left()} remain.`); disableTask('weekly limit'); process.exit(0); }
if (d.act === 'used-up') {
  const n = fbNext();
  alert(`🌙 alsuhaiby prep burst skipped: the 5-hour window is already used up (resets ${hm(p.fiveReset)}). ${left()} remain. ${n && n.start < HARD_STOP ? `Next check ${kt(n.start)}.` : 'No more bursts before Thursday 22:00.'}`);
  process.exit(0);
}
if (d.act === 'none') process.exit(0);
const burst = d.burst, source = d.source;
if (Date.now() < burst.start) { // fired early: wait quietly (no Claude call) until reset − 60 min
  writeJson(STATE, { ...state(), phase: 'waiting', burstStart: new Date(burst.start).toISOString(), stop: new Date(burst.stop).toISOString(), source, pid: process.pid });
  log(`waiting until ${hm(burst.start)} (${source}) — nothing runs before it`);
  while (Date.now() < burst.start) await sleep(Math.min(60e3, burst.start - Date.now()));
}
const stop = burst.stop;
const startLeft = left();
if (!startLeft && !auditTodo()) allDone();
writeJson(STATE, { ...state(), phase: 'running', burstStart: new Date(Date.now()).toISOString(), stop: new Date(stop).toISOString(), source, concurrency: CONC, leftAtStart: startLeft, pid: process.pid });
log(`burst ${hm(Date.now())}→${hm(stop)} (${source}) · concurrency ${CONC} · ${startLeft} left${startLeft ? '' : ` · audit: ${auditTodo()} articles left`}`);
const startedAt = Date.now();

// ---- run night.js until the burst's stop -----------------------------------------------------------------------------------
const runNight = () => new Promise((resolve) => {
  const minutes = Math.max(1, Math.floor((stop - Date.now()) / 60e3));
  const out = fs.openSync(path.join(ROOT, 'data', 'run-auto.log'), 'a');
  const c = spawn(process.execPath, ['scripts/night.js', '--concurrency', String(CONC), `--minutes=${minutes}`, '--margin', String(MARGIN), '--no-telegram'], { cwd: ROOT, stdio: ['ignore', out, out], windowsHide: true });
  c.on('exit', (code) => resolve(code));
});
let written = 0, kind = 'none', why = '', runs = 0;
if (startLeft) for (;;) {
  runs++;
  await runNight();
  const r = readJson(path.join(ROOT, 'data', 'run-night.json'), {});
  written += r.written || 0;
  kind = r.running ? 'crash' : r.stopped || 'none'; why = r.stopReason || '';
  log(`run ${runs} ended: ${kind} ${why.slice(0, 120)} · written ${r.written || 0}`);
  if (['time', 'claude-limit', 'machine', 'none'].includes(kind)) break;
  if (stop - Date.now() < MIN_BURST * 60e3 || runs >= 3) break; // errors / network / crash: start again only while the burst has time left
}

// ---- backlog finished → the rest of the burst audits the articles (owner, 2026-11-12) ------------------------------------
const runAudit = () => new Promise((resolve) => {
  const minutes = Math.max(1, Math.floor((stop - Date.now()) / 60e3));
  const out = fs.openSync(path.join(ROOT, 'data', 'run-audit.log'), 'a');
  const c = spawn(process.execPath, ['scripts/audit.js', '--concurrency', String(CONC), `--minutes=${minutes}`, '--margin', String(MARGIN)], { cwd: ROOT, stdio: ['ignore', out, out], windowsHide: true });
  c.on('exit', (code) => resolve(code));
});
const audit = { ran: false, audited: 0, changed: 0, escalations: 0 };
const escAtStart = escalations();
if (!left() && !['claude-limit', 'machine'].includes(kind) && stop - Date.now() >= MIN_BURST * 60e3 && auditTodo()) {
  audit.ran = true;
  for (let ar = 1; ar <= 3; ar++) {
    log(`audit run ${ar}: ${auditTodo()} articles left`);
    await runAudit();
    const r = readJson(path.join(ROOT, 'data', 'run-audit.json'), {});
    audit.audited += r.audited || 0; audit.changed += r.changed || 0; audit.escalations = escalations() - escAtStart;
    kind = r.running ? 'crash' : r.stopped || 'none'; why = r.stopReason || '';
    log(`audit run ${ar} ended: ${kind} ${why.slice(0, 120)} · audited ${r.audited || 0}, changed ${r.changed || 0}`);
    if (['time', 'claude-limit', 'machine', 'none'].includes(kind)) break;
    if (stop - Date.now() < MIN_BURST * 60e3) break;
  }
}

// ---- end of burst: one message ---------------------------------------------------------------------------------------------
const nowLeft = left();
const weekly = kind === 'claude-limit' && /week/i.test(why);
const reason = kind === 'time' ? 'time' : kind === 'claude-limit' ? (weekly ? 'weekly limit' : 'session limit') : kind === 'none' ? (audit.ran ? 'audit finished' : 'backlog finished') : { machine: 'machine guard', network: 'network down', errors: '3 failures in a row', tiktok: 'TikTok block', crash: 'crash' }[kind] || kind;
writeJson(STATE, { ...state(), phase: 'idle', lastBurst: { start: new Date(startedAt).toISOString(), endedAt: new Date().toISOString(), source, reason, written, leftAtStart: startLeft, left: nowLeft, audit } });
if (!nowLeft && !auditTodo()) allDone(` (last burst: written ${written}, audited ${audit.audited}, changed ${audit.changed}; queue ${queued().length})`);
const n = fbNext();
const nextTxt = weekly ? 'Schedule stopped (weekly limit).' : n && n.start < HARD_STOP ? `Next check ${kt(n.start)} (burst timed from the real reset).` : 'No more bursts before Thursday 22:00.';
const auditTxt = audit.ran || !nowLeft ? ` Backlog finished.${audit.ran ? ` Audit: ${audit.audited} audited, ${audit.changed} changed, ${auditTodo()} left. Escalations: ${audit.escalations} this burst, ${escalations()} in total.` : ''}` : '';
alert(`🌙 alsuhaiby prep burst ${hm(startedAt)}–${hm(Date.now())} (${source}): written ${written}, ${nowLeft} remain.${auditTxt} Ended: ${reason}. ${nextTxt}`);
if (weekly) disableTask('weekly limit');
log(`burst done: ${reason} · written ${written} · ${nowLeft} left${audit.ran ? ` · audit ${audit.audited} audited, ${audit.changed} changed, ${auditTodo()} left, escalations +${audit.escalations} (${escalations()} total)` : ''}`);
process.exit(0);
