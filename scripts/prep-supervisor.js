// prep-supervisor.js — keeps the prep line (scripts/night.js) busy until the backlog is done or a deadline, across Claude's
// 5-hour session windows (owner, 2026-11-11: the weekly quota resets Thursday 22:00 Kuwait; unused quota is lost).
//
//   node scripts/prep-supervisor.js [--deadline 2026-11-12T19:00:00Z] [--concurrency 3]
//   node scripts/prep-supervisor.js --ensure     (Task Scheduler, every 10 min) starts a supervisor only if none is alive
//
// Loop: start night.js (below-normal priority, --no-telegram, time limit = the deadline) → when it ends, read why:
//   · session limit  → write the stopping point (data/prep-supervisor.json), ONE Telegram «paused» (how many are left, when it
//                      resumes), wait until the window resets (time read from Claude's message; if none, a tiny probe call every
//                      10 min), then start again — the run's clean start discards the half-done videos, nothing is paid twice
//   · weekly limit   → stop for good, ONE Telegram «weekly limit»
//   · backlog done   → ONE Telegram «finished»
//   · deadline       → stop for good, ONE Telegram (how many are left)
//   · machine guard «stop» (disk full) → stop for good, ONE Telegram ⚠️ (his rule: the machine comes first)
//   · anything else (errors, network down, TikTok, a crash) → start again after 1 min; 3 runs in a row that end within 3 min
//                      → stop, ONE Telegram ⚠️ (something is broken; looping would only burn quota)
// Crash: the state file keeps the phase and the resume time; the scheduled task «alsuhaiby-prep-supervisor» starts a new
// supervisor within 10 min if this one dies, and it continues from the state file. The task ends itself at the deadline.
// Never publishes anything. Never retries a video (night.js rules). Keys are never printed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, args, readJson, writeJson, loadLedger } from './lib/common.js';
import { remaining } from './lib/pipeline.js';
import { alert } from './lib/status.js';

const A = args();
const DEADLINE = Date.parse(A.deadline || '2026-11-12T19:00:00Z'); // Thursday 22:00 Kuwait = weekly reset
const CONC = Number(A.concurrency || 3);
const STATE = path.join(ROOT, 'data', 'prep-supervisor.json');
const LOG = path.join(ROOT, 'data', 'run-supervisor.log'); // data/run-*.log is not committed
const PID = path.join(os.tmpdir(), 'alsuhaiby-locks', 'prep-supervisor.pid');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kt = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Kuwait', weekday: 'short', hour: '2-digit', minute: '2-digit' });
const log = (m) => { const l = `[${kt(Date.now())}] ${m}`; console.log(l); try { fs.appendFileSync(LOG, l + '\n'); } catch {} };
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const state = () => readJson(STATE, {});
const save = (patch) => writeJson(STATE, { ...state(), ...patch, pid: process.pid, updatedAt: new Date().toISOString() });
const left = () => { const l = loadLedger(); return remaining().filter((v) => l[v.id]?.status !== 'failed').length; };

// ---- one supervisor at a time ---------------------------------------------------------------------------------------------
fs.mkdirSync(path.dirname(PID), { recursive: true });
{ let other = 0; try { other = Number(fs.readFileSync(PID, 'utf8')); } catch {}
  if (other && other !== process.pid && alive(other)) { if (!A.ensure) console.log(`a supervisor is already running (pid ${other})`); process.exit(0); } }
if (Date.now() >= DEADLINE) { if (!A.ensure) console.log('deadline passed — nothing to do'); process.exit(0); }
if (['done', 'stopped'].includes(state().phase) && state().deadline === new Date(DEADLINE).toISOString()) { if (!A.ensure) console.log(`supervisor already ${state().phase}: ${state().why}`); process.exit(0); }
fs.writeFileSync(PID, String(process.pid));
process.on('exit', () => { try { if (Number(fs.readFileSync(PID, 'utf8')) === process.pid) fs.rmSync(PID); } catch {} });
try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {} // the runs it starts inherit below-normal
save({ phase: state().phase === 'paused' ? 'paused' : 'starting', deadline: new Date(DEADLINE).toISOString(), concurrency: CONC, startedAt: new Date().toISOString() });
log(`supervisor up (pid ${process.pid}) · deadline ${kt(DEADLINE)} · concurrency ${CONC} · ${left()} left`);

function finish(phase, why, message) {
  save({ phase, why, endedAt: new Date().toISOString(), left: left() });
  log(`${phase}: ${why}`);
  if (message) alert(message);
  process.exit(0);
}

// a night.js already running (started by hand or by an older supervisor): wait for it, never start a second one
function nightRunning() {
  try { const p = Number(fs.readFileSync(path.join(os.tmpdir(), 'alsuhaiby-locks', 'night-run.pid'), 'utf8')); if (alive(p)) return p; } catch {}
  const r = spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'night\\.js' -and $_.CommandLine -notmatch 'dry-run' } | ForEach-Object { $_.ProcessId }"], { encoding: 'utf8', timeout: 30e3 });
  return Number(String(r.stdout || '').trim().split(/\s+/)[0]) || 0;
}

// when does the session window reset? Claude's message usually carries it ("…|1762873200" or "resets 7:40pm"); else unknown
function resetFrom(msg = '') {
  const ep = msg.match(/\|(\d{10})\b/); if (ep) return Number(ep[1]) * 1000;
  const m = msg.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (m) {
    let h = Number(m[1]) % 12; if (/pm/i.test(m[3] || '')) h += 12; if (!m[3] && Number(m[1]) >= 12) h = Number(m[1]);
    const k = new Date(Date.now() + 3 * 3600e3);
    let t = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), h - 3, Number(m[2] || 0));
    while (t < Date.now() - 60e3) t += 24 * 3600e3;
    return t;
  }
  return 0;
}
// a tiny Claude call (Haiku, a few tokens) to see whether the subscription answers again
function probe() {
  const env = { ...process.env }; delete env.ANTHROPIC_API_KEY;
  const r = spawnSync('claude', ['-p', '--output-format', 'json', '--model', 'haiku', '--no-session-persistence', '--setting-sources', 'project', '--tools', '""', '--strict-mcp-config'],
    { input: 'Reply with the word OK.', cwd: os.tmpdir(), env, encoding: 'utf8', shell: true, timeout: 120e3, windowsHide: true });
  let j = null; try { j = JSON.parse(r.stdout); } catch {}
  if (j && !j.is_error) return { ok: true };
  const msg = String(j?.result || r.stderr || r.stdout || r.error || '');
  return { ok: false, weekly: /week/i.test(msg), limited: /limit|usage|quota|429/i.test(msg), msg: msg.slice(0, 200) };
}
async function waitForWindow(resumeAt) {
  if (resumeAt) { log(`waiting for the session window: resume at ${kt(resumeAt)}`); while (Date.now() < resumeAt + 60e3) { if (Date.now() >= DEADLINE) return 'deadline'; await sleep(Math.min(60e3, resumeAt + 60e3 - Date.now())); } }
  for (;;) { // confirm with a probe; if the reset time was unknown or early, try again every 10 minutes
    if (Date.now() >= DEADLINE) return 'deadline';
    const p = probe();
    if (p.ok) return 'ok';
    if (p.weekly) return 'weekly';
    log(`still limited (${p.msg.slice(0, 100)}) — next check in 10 min`);
    await sleep(10 * 60e3);
  }
}
const runNight = (minutes) => new Promise((resolve) => {
  const c = spawn(process.execPath, ['scripts/night.js', '--concurrency', String(CONC), `--minutes=${minutes}`, '--no-telegram'], { cwd: ROOT, stdio: ['ignore', fs.openSync(path.join(ROOT, 'data', 'run-auto.log'), 'a'), fs.openSync(path.join(ROOT, 'data', 'run-auto.log'), 'a')], windowsHide: true });
  save({ phase: 'running', runPid: c.pid, runStartedAt: new Date().toISOString() });
  c.on('exit', (code) => resolve(code));
});

// ---- main loop ------------------------------------------------------------------------------------------------------------
let quick = 0;
for (;;) {
  if (Date.now() >= DEADLINE) finish('stopped', 'deadline reached', `🌙 alsuhaiby prep: stopped — Thursday 22:00 deadline reached. ${left()} left.`);
  const s0 = state();
  if (s0.phase === 'paused') { // after a crash during a pause, keep the same resume time
    const w = await waitForWindow(s0.resumeAt || 0);
    if (w === 'weekly') finish('stopped', 'weekly limit', `⛔ alsuhaiby prep: stopped — weekly limit reached. ${left()} left.`);
    if (w === 'deadline') continue;
    save({ phase: 'resuming', resumedAt: new Date().toISOString() }); log('session window is open again — resuming');
  }
  const busy = nightRunning();
  if (busy) { save({ phase: 'waiting-for-run', runPid: busy }); log(`a prep run is already going (pid ${busy}) — waiting for it to end`); while (alive(busy)) await sleep(30e3); }
  else {
    if (!left()) finish('done', 'backlog finished', '✅ alsuhaiby prep: the whole backlog is finished.');
    const t0 = Date.now();
    log(`starting a prep run · ${left()} left`);
    const code = await runNight(Math.max(1, Math.floor((DEADLINE - Date.now()) / 60e3)));
    quick = Date.now() - t0 < 3 * 60e3 ? quick + 1 : 0;
    log(`prep run ended (exit ${code}, ${Math.round((Date.now() - t0) / 60e3)} min)`);
  }
  const r = readJson(path.join(ROOT, 'data', 'run-night.json'), {});
  const kind = r.running ? 'crash' : r.stopped || 'none', why = r.stopReason || '';
  if (kind === 'claude-limit') {
    if (/week/i.test(why)) finish('stopped', 'weekly limit', `⛔ alsuhaiby prep: stopped — weekly limit reached. ${left()} left.`);
    const resumeAt = resetFrom(why);
    save({ phase: 'paused', why: 'session limit', resumeAt: resumeAt || null, pausedAt: new Date().toISOString(), stoppingPoint: { left: left(), lastRun: r.stoppedAt } });
    alert(`⏸ alsuhaiby prep: paused — session limit. ${left()} left. Resumes ${resumeAt ? `about ${kt(resumeAt)}` : 'when the window resets (checked every 10 min)'} Kuwait.`);
    quick = 0; continue;
  }
  if (kind === 'machine') finish('stopped', `machine guard: ${why}`, `⚠️ alsuhaiby prep: stopped by the machine guard — ${why.slice(0, 150)}. ${left()} left.`);
  if (kind === 'none' && !left()) finish('done', 'backlog finished', '✅ alsuhaiby prep: the whole backlog is finished.');
  if (kind === 'time' && Date.now() >= DEADLINE - 5 * 60e3) continue; // the deadline check at the top ends it
  if (quick >= 3) finish('stopped', `3 runs in a row ended within 3 min (last: ${kind} ${why.slice(0, 100)})`, `⚠️ alsuhaiby prep: stopped — runs keep ending at once (${kind}: ${why.slice(0, 120)}). ${left()} left.`);
  log(`run ended by «${kind}» ${why.slice(0, 120)} — starting again in 1 min`);
  await sleep(60e3);
}
