// test-prep-burst.js — the burst window follows the REAL reset (lib/burst-window.js). No Claude call, nothing runs.
//   node scripts/test-prep-burst.js
import { decide, HARD_STOP } from './lib/burst-window.js';

const K = (hhmm) => Date.parse(`2026-11-12T${hhmm}:00+03:00`); // Thursday, Kuwait
const ok = (reset, extra = {}) => ({ ok: true, fiveReset: K(reset), fiveStatus: 'allowed', weekStatus: 'allowed', ...extra });
const bad = { ok: false, why: 'network' };
let fail = 0;
const t = (name, got, want) => {
  const g = { act: got.act, start: got.burst?.start, stop: got.burst?.stop };
  const pass = g.act === want.act && (want.start === undefined || g.start === K(want.start)) && (want.stop === undefined || g.stop === (want.stop === 'HARD' ? HARD_STOP : K(want.stop)));
  if (!pass) fail++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  → ${got.act} ${got.burst ? `${new Date(g.start).toISOString().slice(11, 16)}Z→${new Date(g.stop).toISOString().slice(11, 16)}Z` : ''} (${got.source})`);
};

t('11:22 trigger, real reset 12:20 → run now until 12:18', decide(ok('12:20'), K('11:22')), { act: 'run', start: '11:20', stop: '12:18' });
t('16:22 trigger, reset moved to 17:50 → wait until 16:50, stop 17:48', decide(ok('17:50'), K('16:22')), { act: 'wait', start: '16:50', stop: '17:48' });
t('16:22 trigger, reset earlier 16:40 → run now until 16:38', decide(ok('16:40'), K('16:22')), { act: 'run', stop: '16:38' });
t('16:22 trigger, reset 16:30 → under 10 min, nothing', decide(ok('16:30'), K('16:22')), { act: 'none' });
t('21:00 trigger, reset 22:10 → wait 21:10, cut at 21:58', decide(ok('22:10'), K('21:00')), { act: 'wait', start: '21:10', stop: 'HARD' });
t('21:00 trigger, reset 21:22 → run now until 21:20', decide(ok('21:22'), K('21:00')), { act: 'run', stop: '21:20' });
t('window used up → skip', decide(ok('12:20', { fiveStatus: 'rejected' }), K('11:22')), { act: 'used-up' });
t('weekly rejected → weekly', decide(ok('12:20', { weekStatus: 'rejected' }), K('11:22')), { act: 'weekly' });
t('reset unreadable at 11:22 → armed window 11:22→12:18', decide(bad, K('11:22')), { act: 'run', start: '11:22', stop: '12:18' });
t('reset unreadable at 13:00 → nothing', decide(bad, K('13:00')), { act: 'none' });
t('--now at 09:10, reset 12:20 → run now until 12:18', decide(ok('12:20'), K('09:10'), true), { act: 'run', stop: '12:18' });
t('after 21:58 → nothing', decide(ok('23:00'), K('21:59')), { act: 'none' });
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
