// burst-window.js — when a prep burst runs, from the REAL 5-hour reset Claude reports (see scripts/prep-burst.js).
// Pure functions only, so every case is testable (scripts/test-prep-burst.js).
export const FALLBACK = [['11:22', '12:18'], ['16:22', '17:18'], ['21:00', '21:58']]; // = the armed triggers; used only if the reset can't be read
export const LEAD = 60, GAP = 2; // burst = [reset − LEAD, reset − GAP] minutes
export const DEADLINE = Date.parse('2026-11-12T19:00:00Z'); // Thursday 22:00 Kuwait: weekly reset
export const HARD_STOP = DEADLINE - GAP * 60e3; // 21:58
export const MIN_BURST = 10; // minutes; a shorter burst is not worth starting
export const hm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuwait', hour: '2-digit', minute: '2-digit' });

// Kuwait wall clock (UTC+3, no daylight saving) → epoch ms, for the Kuwait date `dayOffset` days from `now`'s date
export function at(hhmm, dayOffset = 0, now = Date.now()) {
  const [h, m] = hhmm.split(':').map(Number);
  const k = new Date(now + 3 * 3600e3);
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + dayOffset, h - 3, m);
}
export function fallbackWindows(now = Date.now()) {
  const out = [];
  for (const d of [-1, 0, 1]) for (const [s, e] of FALLBACK) { const start = at(s, d, now); let stop = at(e, d, now); if (stop <= start) stop += 24 * 3600e3; out.push({ start, stop }); }
  return out.sort((a, b) => a.start - b.start);
}
export const fbCurrent = (now = Date.now()) => fallbackWindows(now).find((w) => now >= w.start && now < w.stop) || null;
export const fbNext = (now = Date.now()) => fallbackWindows(now).find((w) => w.start > now) || null;

// p = probe result { ok, fiveReset, fiveStatus, weekStatus } → { act: run|wait|none|used-up|weekly, burst?, source }
export function decide(p, now, startNow = false) {
  if (now >= HARD_STOP) return { act: 'none', source: 'Thursday 21:58 hard stop passed' };
  if (p.ok && p.weekStatus === 'rejected') return { act: 'weekly', source: 'weekly limit' };
  if (p.ok && p.fiveStatus === 'rejected') return { act: 'used-up', source: `window used up, resets ${hm(p.fiveReset)}` };
  let burst = null, source;
  if (p.ok) { burst = { start: p.fiveReset - LEAD * 60e3, stop: Math.min(p.fiveReset - GAP * 60e3, HARD_STOP) }; source = `real reset ${hm(p.fiveReset)}`; }
  else { const c = fbCurrent(now); burst = c ? { start: c.start, stop: Math.min(c.stop, HARD_STOP) } : null; source = 'armed time (reset not readable)'; }
  if (!burst) return { act: 'none', source: 'reset not readable and outside the armed windows' };
  if (startNow) burst.start = Math.min(burst.start, now);
  if (burst.stop - Math.max(now, burst.start) < MIN_BURST * 60e3) return { act: 'none', burst, source: `${source}; under ${MIN_BURST} min left` };
  return { act: now < burst.start ? 'wait' : 'run', burst, source };
}
