// prep-burst.js — the prep line runs ONLY in short bursts: the last hour before each 5-hour Claude session window resets
// (owner, 2026-11-11). Between bursts nothing runs at all: no process, no Claude call, zero quota.
//
// Started by the scheduled task «alsuhaiby-prep-supervisor» (hidden launcher scripts/prep-supervisor.vbs) at each burst start.
// Bursts, Kuwait time:  23:40→00:38 · 04:40→05:38 · 09:40→10:38 · 14:40→15:38 · 19:40→20:38   (stop 2 min before each reset)
//   · outside a burst window (e.g. the PC woke up late) → does nothing and exits
//   · inside one → runs night.js (concurrency from config/site.json → nightConcurrency, below-normal priority, --no-telegram)
//     until the burst's stop time; no new video in the last 9 minutes, so a video is not cut at the stop
//   · session limit inside a burst → the burst ends at once; the next scheduled burst continues (never resumes early)
//   · weekly limit → the whole schedule stops (task disabled)
//   · backlog finished → «finished» message, the whole schedule stops (task disabled)
//   · Thursday 2026-11-12 22:00 Kuwait → nothing runs after it (the task also expires and deletes itself then)
//   · a run that ends early for another reason (errors, network, a crash) is started again while ≥ 10 min of the burst remain
// Telegram: ONE message at the end of each burst (written in this burst, how many remain, why it ended) + one at the finish.
// All night.js rules apply: never-wait, no retries, machine guard, whole-file writes, locks, nothing published.
//   node scripts/prep-burst.js            (what the task runs)
//   node scripts/prep-burst.js --check    say whether now is inside a burst, and the next one; runs nothing
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, args, readJson, writeJson, loadLedger } from './lib/common.js';
import { remaining, queued } from './lib/pipeline.js';
import { alert } from './lib/status.js';

const A = args();
const BURSTS = [['23:40', '00:38'], ['04:40', '05:38'], ['09:40', '10:38'], ['14:40', '15:38'], ['19:40', '20:38']];
const DEADLINE = Date.parse('2026-11-12T19:00:00Z'); // Thursday 22:00 Kuwait
const TASK = 'alsuhaiby-prep-supervisor';
const MARGIN = 9; // minutes before the stop when no new video starts
const CONC = Number(readJson(path.join(ROOT, 'config', 'site.json'), {}).nightConcurrency || 3);
const STATE = path.join(ROOT, 'data', 'prep-burst.json');
const LOG = path.join(ROOT, 'data', 'run-burst.log'); // data/run-*.log is not committed
const PID = path.join(os.tmpdir(), 'alsuhaiby-locks', 'prep-burst.pid');
const kt = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Kuwait', weekday: 'short', hour: '2-digit', minute: '2-digit' });
const hm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuwait', hour: '2-digit', minute: '2-digit' });
const log = (m) => { const l = `[${kt(Date.now())}] ${m}`; console.log(l); try { fs.appendFileSync(LOG, l + '\n'); } catch {} };
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const left = () => { const l = loadLedger(); return remaining().filter((v) => l[v.id]?.status !== 'failed').length; };

// Kuwait wall clock (UTC+3, no daylight saving) → epoch ms, for the Kuwait date `dayOffset` days from today
function at(hhmm, dayOffset = 0) {
  const [h, m] = hhmm.split(':').map(Number);
  const k = new Date(Date.now() + 3 * 3600e3);
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + dayOffset, h - 3, m);
}
function windows() { // every burst from yesterday to tomorrow, as {start, stop}
  const out = [];
  for (const d of [-1, 0, 1]) for (const [s, e] of BURSTS) { const start = at(s, d); let stop = at(e, d); if (stop <= start) stop += 24 * 3600e3; out.push({ start, stop }); }
  return out.sort((a, b) => a.start - b.start);
}
const current = (now = Date.now()) => windows().find((w) => now >= w.start && now < w.stop) || null;
const next = (now = Date.now()) => windows().find((w) => w.start > now) || null;
const disableTask = (why) => { const r = spawnSync('schtasks', ['/Change', '/TN', TASK, '/DISABLE'], { encoding: 'utf8', timeout: 30e3 }); log(`schedule stopped (${why}) — task ${r.status === 0 ? 'disabled' : `not disabled: ${String(r.stderr || '').trim()}`}`); };

if (A.check) {
  const c = current(), n = next();
  console.log(`now ${kt(Date.now())} · ${c ? `INSIDE a burst until ${hm(c.stop)}` : 'outside any burst (nothing runs)'} · next burst ${n ? `${kt(n.start)} → ${hm(n.stop)}` : '-'} · deadline ${kt(DEADLINE)} · concurrency ${CONC} · ${left()} left`);
  process.exit(0);
}

// ---- guards: one burst runner at a time, deadline, burst window ------------------------------------------------------------
fs.mkdirSync(path.dirname(PID), { recursive: true });
{ let other = 0; try { other = Number(fs.readFileSync(PID, 'utf8')); } catch {} if (other && other !== process.pid && alive(other)) process.exit(0); }
if (Date.now() >= DEADLINE) { log('Thursday 22:00 deadline passed — nothing runs'); disableTask('deadline'); process.exit(0); }
const burst = current();
if (!burst) { const n = next(); log(`started outside a burst window — nothing runs (next burst ${n ? kt(n.start) : '-'})`); process.exit(0); }
fs.writeFileSync(PID, String(process.pid));
process.on('exit', () => { try { if (Number(fs.readFileSync(PID, 'utf8')) === process.pid) fs.rmSync(PID); } catch {} });
try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {} // the run it starts inherits below-normal
const stop = Math.min(burst.stop, DEADLINE);
const startLeft = left();
if (!startLeft) { alert('✅ alsuhaiby prep: the whole backlog is finished.'); disableTask('backlog finished'); process.exit(0); }
writeJson(STATE, { phase: 'running', burstStart: new Date(burst.start).toISOString(), stop: new Date(stop).toISOString(), concurrency: CONC, leftAtStart: startLeft, pid: process.pid });
log(`burst ${hm(burst.start)}→${hm(stop)} · concurrency ${CONC} · ${startLeft} left`);

// ---- run night.js until the burst's stop -----------------------------------------------------------------------------------
const runNight = () => new Promise((resolve) => {
  const minutes = Math.max(1, Math.floor((stop - Date.now()) / 60e3));
  const out = fs.openSync(path.join(ROOT, 'data', 'run-auto.log'), 'a');
  const c = spawn(process.execPath, ['scripts/night.js', '--concurrency', String(CONC), `--minutes=${minutes}`, '--margin', String(MARGIN), '--no-telegram'], { cwd: ROOT, stdio: ['ignore', out, out], windowsHide: true });
  c.on('exit', (code) => resolve(code));
});
let written = 0, kind = 'none', why = '', runs = 0;
for (;;) {
  runs++;
  await runNight();
  const r = readJson(path.join(ROOT, 'data', 'run-night.json'), {});
  written += r.written || 0;
  kind = r.running ? 'crash' : r.stopped || 'none'; why = r.stopReason || '';
  log(`run ${runs} ended: ${kind} ${why.slice(0, 120)} · written ${r.written || 0}`);
  if (['time', 'claude-limit', 'machine', 'none'].includes(kind)) break;
  if (stop - Date.now() < 10 * 60e3 || runs >= 3) break; // errors / network / crash: start again only while the burst has time left
}

// ---- end of burst: one message ---------------------------------------------------------------------------------------------
const nowLeft = left();
const weekly = kind === 'claude-limit' && /week/i.test(why);
const reason = kind === 'time' ? 'time' : kind === 'claude-limit' ? (weekly ? 'weekly limit' : 'session limit') : kind === 'none' ? 'backlog finished' : { machine: 'machine guard', network: 'network down', errors: '3 failures in a row', tiktok: 'TikTok block', crash: 'crash' }[kind] || kind;
writeJson(STATE, { phase: 'idle', lastBurst: { start: new Date(burst.start).toISOString(), endedAt: new Date().toISOString(), reason, written, leftAtStart: startLeft, left: nowLeft } });
if (!nowLeft) { alert(`✅ alsuhaiby prep: the whole backlog is finished (last burst wrote ${written}). Queue: ${queued().length}.`); disableTask('backlog finished'); process.exit(0); }
const n = next();
const nextTxt = weekly ? 'Schedule stopped (weekly limit).' : n && n.start < DEADLINE ? `Next burst ${kt(n.start)}.` : 'No more bursts before Thursday 22:00.';
alert(`🌙 alsuhaiby prep burst ${hm(burst.start)}–${hm(Date.now())}: written ${written}, ${nowLeft} remain. Ended: ${reason}. ${nextTxt}`);
if (weekly) disableTask('weekly limit');
log(`burst done: ${reason} · written ${written} · ${nowLeft} left`);
process.exit(0);
