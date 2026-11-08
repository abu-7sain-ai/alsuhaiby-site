// machine.js — long commands obey the always-on watcher (scripts/machine/watcher.py → data/machine.json).
//   await machineGate()   call BETWEEN items (videos, topics). ok → returns at once · slow → waits 2 min · pause → waits until
//                         the pressure clears (checks every 30 s) · stop → throws MachineStopError (finish nothing new, stop cleanly).
//   ensureWatcher()       the run samples on its own: if no watcher is alive (window «مراقب الجهاز» closed, or never opened) it
//                         starts one tied to THIS process (watcher.py --parent <pid>), so it stops when the run ends. Called at the
//                         run's start (startStage) and before every gate check (the window may be closed mid-run).
//   The watcher missing or stale (no sample for 2 min) = carry on, with one Arabic warning: the guard never blocks work by itself.
//   setStage(stage, extra) the window («عدّادات الجهاز») shows what the pipeline is doing: data/run-stage.json (not committed).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, readJson, writeJson } from './common.js';

export const MACHINE_FILE = process.env.MACHINE_FILE || path.join(ROOT, 'data', 'machine.json');
const STAGE_FILE = path.join(ROOT, 'data', 'run-stage.json');
const STALE_MS = 120e3;
const SLOW_MS = Number(process.env.MACHINE_SLOW_MS || 120e3);
const PAUSE_CHECK_MS = Number(process.env.MACHINE_PAUSE_CHECK_MS || 30e3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class MachineStopError extends Error {}

export function readMachine() {
  let h = null;
  try { h = readJson(MACHINE_FILE, null); } catch {} // a file caught mid-swap reads as "no sample"; the next check sees it
  if (!h || !h.atEpoch || Date.now() - h.atEpoch * 1000 > STALE_MS) return { level: 'unknown', reasons: [] };
  return h;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const WATCHER = path.join(ROOT, 'scripts', 'machine', 'watcher.py');
export async function ensureWatcher() {
  if (process.platform !== 'win32' || process.env.MACHINE_FILE) return false; // cloud runs and tests: no watcher
  let h = null;
  try { h = readJson(MACHINE_FILE, null); } catch {}
  if (h?.pid && alive(h.pid) && Date.now() - h.atEpoch * 1000 < STALE_MS) return false; // one is running (window or another run)
  try {
    spawn(process.env.PYTHONW || 'pythonw', [WATCHER, '--parent', String(process.pid)], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch { return false; }
  for (let i = 0; i < 10; i++) { // first sample comes after ~2 s
    await sleep(1000);
    try { const n = readJson(MACHINE_FILE, null); if (n && Date.now() - n.atEpoch * 1000 < 5000) return true; } catch {}
  }
  return false;
}

let warnedMissing = false;
export async function machineGate({ log = console.log } = {}) {
  let pausedAt = 0;
  await ensureWatcher();
  for (;;) {
    const h = readMachine();
    const why = (h.reasons || []).join(' · ');
    if (h.level === 'stop') throw new MachineStopError(`وقفت عشان الجهاز: ${why}. فضّ مساحة وشغّله مرة ثانية؛ يكمل من وين ما وقف.`);
    if (h.level === 'pause') {
      if (!pausedAt) { pausedAt = Date.now(); log(`  ⏸ الجهاز مضغوط (${why}) — وقفة مؤقتة لين يرتاح…`); setStage('paused', { why }); }
      await sleep(PAUSE_CHECK_MS);
      continue;
    }
    if (pausedAt) log(`  ▶ الجهاز ارتاح بعد ${Math.round((Date.now() - pausedAt) / 60e3)} دقيقة — نكمل.`);
    if (h.level === 'slow') {
      log(`  🐢 الجهاز تعبان (${why}) — أبطّئ: انتظار ${Math.round(SLOW_MS / 60e3)} دقيقة قبل اللي بعده.`);
      setStage('slow', { why });
      await sleep(SLOW_MS);
      // after the slow wait, look again: it may have turned into pause or stop
      const again = readMachine().level;
      if (again === 'pause' || again === 'stop') continue;
    }
    if (h.level === 'unknown' && !warnedMissing) { warnedMissing = true; log('  ! مراقب الجهاز مو شغّال (data/machine.json قديم أو مو موجود) — أكمل بدون حماية.'); }
    return h.level;
  }
}

// stage: downloading · analyzing · deciding · writing · reviewing · pushing · slow · paused · idle
export function setStage(stage, extra = {}) {
  try { writeJson(STAGE_FILE, { ...readJson(STAGE_FILE, {}), stage, pid: process.pid, at: new Date().toISOString(), ...extra }); } catch {}
}
export async function startStage(script, extra = {}) {
  await ensureWatcher();
  try { writeJson(STAGE_FILE, { script, stage: 'starting', pid: process.pid, startedAt: new Date().toISOString(), at: new Date().toISOString(), ...extra }); } catch {}
}
