# watcher.py — the always-on machine-health guard (his rule 2026-11-08).
# Every 30 s: CPU, free RAM, free disk (C:) → data/machine.json. Long commands (night, write) read that file and obey `level`:
#   ok     → carry on
#   slow   → CPU > 85% for 3 min, or free RAM < 1.5 GB: wait 2 min between videos (the pipeline has no parallel work to halve)
#   pause  → the same pressure still there 3 min later: wait between videos until it clears, then carry on by itself
#   stop   → free disk < 5 GB: finish the current video, stop cleanly with an Arabic message, ONE Telegram ⚠️
# Temperature is OFF: Windows gives no real CPU temperature without a sensor tool, and he chose not to install one for now.
# It never shuts down or restarts the machine. Run hidden: pythonw scripts/machine/watcher.py  (one copy only; a second exits).
#   python scripts/machine/watcher.py --once      one sample, printed (for a quick check)
import json, os, sys, time, ctypes
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STATUS = os.path.join(ROOT, 'data', 'machine.json')
EVERY = 30  # seconds

LIMITS = {'cpu_pct': 85, 'cpu_secs': 180, 'ram_gb': 1.5, 'pause_after_secs': 180, 'disk_gb': 5}


def decide(sample, mem, now, limits=LIMITS):
    """Pure rule step. sample = {cpu, ramFreeGB, diskFreeGB}; mem = timers carried between samples (mutated).
    Returns (level, reasons in Arabic)."""
    cpu_high = sample['cpu'] > limits['cpu_pct']
    mem['cpuHighSince'] = (mem.get('cpuHighSince') or now) if cpu_high else None
    cpu_hot = cpu_high and now - mem['cpuHighSince'] >= limits['cpu_secs']
    ram_low = sample['ramFreeGB'] < limits['ram_gb']
    disk_low = sample['diskFreeGB'] < limits['disk_gb']

    reasons = []
    if disk_low: reasons.append(f"المساحة الفاضية {sample['diskFreeGB']:.1f} جيجا (أقل من {limits['disk_gb']})")
    if cpu_hot: reasons.append(f"المعالج فوق {limits['cpu_pct']}% من {int((now - mem['cpuHighSince']) // 60)} دقايق")
    if ram_low: reasons.append(f"الذاكرة الفاضية {sample['ramFreeGB']:.1f} جيجا (أقل من {limits['ram_gb']})")

    if disk_low:
        return 'stop', reasons
    if cpu_hot or ram_low:
        mem['pressureSince'] = mem.get('pressureSince') or now
        return ('pause' if now - mem['pressureSince'] >= limits['pause_after_secs'] else 'slow'), reasons
    mem['pressureSince'] = None
    return 'ok', reasons


def sample_now(psutil):
    vm = psutil.virtual_memory()
    du = psutil.disk_usage('C:\\')
    return {'cpu': round(psutil.cpu_percent(interval=None), 1),
            'ramFreeGB': round(vm.available / 1024**3, 2), 'ramTotalGB': round(vm.total / 1024**3, 1),
            'diskFreeGB': round(du.free / 1024**3, 1)}


def write_status(data):
    os.makedirs(os.path.dirname(STATUS), exist_ok=True)
    tmp = STATUS + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STATUS)  # readers never see a half-written file


def main():
    import psutil
    once = '--once' in sys.argv
    if not once:  # one watcher only
        ctypes.windll.kernel32.CreateMutexW(None, False, 'Global\\alsuhaiby-machine-watcher')
        if ctypes.windll.kernel32.GetLastError() == 183: return
    psutil.cpu_percent(interval=None)  # prime: the next call averages over the time since this one
    mem, started = {}, datetime.now(timezone.utc).isoformat()
    while True:
        time.sleep(2 if once else EVERY)
        now = time.time()
        s = sample_now(psutil)
        level, reasons = decide(s, mem, now)
        data = {**s, 'temp': None, 'tempNote': 'الحرارة مو مفعّلة (تحتاج برنامج حساسات)', 'level': level, 'reasons': reasons,
                'at': datetime.now(timezone.utc).isoformat(), 'atEpoch': now, 'every': EVERY, 'pid': os.getpid(),
                'watcherStarted': started, 'limits': LIMITS}
        try: write_status(data)
        except OSError: pass  # a locked file never kills the watcher; the next sample tries again
        if once:
            print(json.dumps(data, ensure_ascii=False, indent=1)); return


if __name__ == '__main__':
    main()
