// test-gate.js — machineGate() against a FAKE data file (never the real one), with short waits.  node scripts/machine/test-gate.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const FAKE = path.join(os.tmpdir(), `machine-fake-${process.pid}.json`);
Object.assign(process.env, { MACHINE_FILE: FAKE, MACHINE_SLOW_MS: '200', MACHINE_PAUSE_CHECK_MS: '100' });
const { machineGate, MachineStopError } = await import('../lib/machine.js');
const put = (level, ageS = 0) => fs.writeFileSync(FAKE, JSON.stringify({ level, reasons: ['سبب تجربة'], atEpoch: Date.now() / 1000 - ageS }));
const logs = []; const log = (s) => logs.push(s);
let bad = 0; const check = (name, good, extra = '') => { bad += !good; console.log(good ? 'ok  ' : 'FAIL', name, good ? '' : extra); };

put('ok'); let t = Date.now(); check('ok returns at once', (await machineGate({ log })) === 'ok' && Date.now() - t < 100);
put('slow'); t = Date.now(); await machineGate({ log }); check('slow waits (2 min in real life)', Date.now() - t >= 190 && logs.some((l) => l.includes('أبطّئ')));
put('pause'); t = Date.now(); setTimeout(() => put('ok'), 450);
await machineGate({ log }); check('pause waits until the PC recovers, then carries on', Date.now() - t >= 400 && logs.some((l) => l.includes('ارتاح')));
put('stop'); try { await machineGate({ log }); check('stop throws', false); } catch (e) { check('stop throws MachineStopError with Arabic text', e instanceof MachineStopError && e.message.includes('وقفت'), e.message); }
put('pause'); setTimeout(() => put('stop'), 250);
try { await machineGate({ log }); check('pause → stop', false); } catch (e) { check('a pause that turns into stop stops', e instanceof MachineStopError); }
put('stop', 600); check('stale file (watcher dead) never blocks', (await machineGate({ log })) === 'unknown' && logs.some((l) => l.includes('مو شغّال')));
fs.unlinkSync(FAKE); check('missing file never blocks', (await machineGate({ log })) === 'unknown');
process.exit(bad ? 1 : 0);
