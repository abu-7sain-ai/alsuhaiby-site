# watcher.py — the always-on machine-health guard (his rule 2026-11-08).
# Every 30 s: CPU, free RAM, free disk (C:) → data/machine.json. Long commands (night, write) read that file and obey `level`:
#   ok     → carry on
#   slow   → CPU > 85% for 3 min, or free RAM < 1.5 GB: wait 2 min between videos (the pipeline has no parallel work to halve)
#   pause  → the same pressure still there 3 min later: wait between videos until it clears, then carry on by itself
#   stop   → free disk < 5 GB: finish the current video, stop cleanly with an Arabic message, ONE Telegram ⚠️
#   hot    → overheating signal (his choice 2026-11-08, no admin, nothing installed): Windows gives no real CPU temperature here,
#            so we watch what heat DOES: on mains power, CPU > 50% busy, and the CPU running below its base clock
#            ("% Processor Performance" < 100) or firmware-limited ("% Performance Limit" < 100) for 2 min = it is throttling
#            itself from heat → counts as pressure (slow, then pause). Never a stop. On battery it is ignored (slower on purpose).
# It never shuts down or restarts the machine. One copy only (a second exits at once). Nothing starts it with Windows:
#   pythonw scripts/machine/watcher.py --parent PID   the normal way: runs while process PID lives, then exits (within 2 s).
#       The window «مراقب الجهاز» (meters.pyw) starts one for itself; night.js / write.js start one for the run when none is
#       alive (scripts/lib/machine.js → ensureWatcher), so the guard works with the window closed and stops with the run.
#   python scripts/machine/watcher.py --once      one sample, printed (for a quick check)
import json, os, sys, time, ctypes
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STATUS = os.path.join(ROOT, 'data', 'machine.json')
EVERY = 30  # seconds

LIMITS = {'cpu_pct': 85, 'cpu_secs': 180, 'ram_gb': 1.5, 'pause_after_secs': 180, 'disk_gb': 5,
          'hot_busy_pct': 50, 'hot_perf_pct': 100, 'hot_secs': 120}


def throttling(sample, limits=LIMITS):
    """True when the CPU is busy on mains power but running below base clock or firmware-limited (the heat signal)."""
    if sample.get('plugged') is False or sample.get('perf') is None: return False
    return sample['cpu'] > limits['hot_busy_pct'] and (sample['perf'] < limits['hot_perf_pct'] or (sample.get('perfLimit') or 100) < 100)


def decide(sample, mem, now, limits=LIMITS):
    """Pure rule step. sample = {cpu, ramFreeGB, diskFreeGB}; mem = timers carried between samples (mutated).
    Returns (level, reasons in Arabic)."""
    cpu_high = sample['cpu'] > limits['cpu_pct']
    mem['cpuHighSince'] = (mem.get('cpuHighSince') or now) if cpu_high else None
    cpu_hot = cpu_high and now - mem['cpuHighSince'] >= limits['cpu_secs']
    ram_low = sample['ramFreeGB'] < limits['ram_gb']
    disk_low = sample['diskFreeGB'] < limits['disk_gb']
    hot_now = throttling(sample, limits)
    mem['hotSince'] = (mem.get('hotSince') or now) if hot_now else None
    hot = hot_now and now - mem['hotSince'] >= limits['hot_secs']

    reasons = []
    if disk_low: reasons.append(f"المساحة الفاضية {sample['diskFreeGB']:.1f} جيجا (أقل من {limits['disk_gb']})")
    if cpu_hot: reasons.append(f"المعالج فوق {limits['cpu_pct']}% من {int((now - mem['cpuHighSince']) // 60)} دقايق")
    if hot: reasons.append(f"الجهاز حار ويبطّئ نفسه (السرعة {sample['perf']:.0f}% من الأساسية من {int((now - mem['hotSince']) // 60)} دقايق)")
    if ram_low: reasons.append(f"الذاكرة الفاضية {sample['ramFreeGB']:.1f} جيجا (أقل من {limits['ram_gb']})")

    if disk_low:
        return 'stop', reasons
    if cpu_hot or ram_low or hot:
        mem['pressureSince'] = mem.get('pressureSince') or now
        return ('pause' if now - mem['pressureSince'] >= limits['pause_after_secs'] else 'slow'), reasons
    mem['pressureSince'] = None
    return 'ok', reasons


class Perf:
    """Windows performance counters through PDH (built in, no admin): CPU speed vs base clock and the firmware limit."""
    NAMES = {'perf': r'\Processor Information(_Total)\% Processor Performance',
             'perfLimit': r'\Processor Information(_Total)\% Performance Limit'}

    def __init__(self):
        from ctypes import wintypes
        class FMT(ctypes.Structure): _fields_ = [('s', wintypes.DWORD), ('p', wintypes.DWORD), ('v', ctypes.c_double)]
        self.FMT, self.pdh, self.q, self.c = FMT, ctypes.windll.pdh, ctypes.c_void_p(), {}
        self.pdh.PdhOpenQueryW(None, None, ctypes.byref(self.q))
        for k, n in self.NAMES.items():
            h = ctypes.c_void_p()
            if self.pdh.PdhAddEnglishCounterW(self.q, n, None, ctypes.byref(h)) == 0: self.c[k] = h
        self.pdh.PdhCollectQueryData(self.q)  # prime: rates need two collections

    def read(self):
        out = {}
        if self.pdh.PdhCollectQueryData(self.q) != 0: return out
        for k, h in self.c.items():
            f = self.FMT()
            if self.pdh.PdhGetFormattedCounterValue(h, 0x200, None, ctypes.byref(f)) == 0: out[k] = round(f.v)
        return out


def sample_now(psutil, perf=None):
    vm = psutil.virtual_memory()
    du = psutil.disk_usage('C:\\')
    b = psutil.sensors_battery()
    s = {'cpu': round(psutil.cpu_percent(interval=None), 1),
         'ramFreeGB': round(vm.available / 1024**3, 2), 'ramTotalGB': round(vm.total / 1024**3, 1),
         'diskFreeGB': round(du.free / 1024**3, 1), 'plugged': (b.power_plugged if b else True), 'perf': None, 'perfLimit': None}
    if perf:
        try: s.update(perf.read())
        except Exception: pass
    return s


def write_status(data):
    os.makedirs(os.path.dirname(STATUS), exist_ok=True)
    tmp = STATUS + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STATUS)  # readers never see a half-written file


def main():
    import psutil
    once = '--once' in sys.argv
    parent = int(sys.argv[sys.argv.index('--parent') + 1]) if '--parent' in sys.argv else None
    if not once:  # one watcher only
        ctypes.windll.kernel32.CreateMutexW(None, False, 'Global\\alsuhaiby-machine-watcher')
        if ctypes.windll.kernel32.GetLastError() == 183: return
    psutil.cpu_percent(interval=None)  # prime: the next call averages over the time since this one
    try: perf = Perf()
    except Exception: perf = None  # no counters → the heat signal is simply off
    mem, started = {}, datetime.now(timezone.utc).isoformat()
    first = True
    while True:
        # first sample after 2 s (a run waiting on it starts quickly), then every 30 s; the owner is checked every 2 s
        for _ in range(1 if (once or first) else EVERY // 2):
            if parent and not psutil.pid_exists(parent): return
            time.sleep(2)
        first = False
        now = time.time()
        s = sample_now(psutil, perf)
        level, reasons = decide(s, mem, now)
        heat = ('—' if s['perf'] is None else 'على البطارية' if s['plugged'] is False
                else 'حار ويبطّئ نفسه' if throttling(s) else 'طبيعي')
        data = {**s, 'temp': None, 'heat': heat, 'heatHot': throttling(s), 'level': level, 'reasons': reasons,
                'at': datetime.now(timezone.utc).isoformat(), 'atEpoch': now, 'every': EVERY, 'pid': os.getpid(),
                'watcherStarted': started, 'owner': parent, 'limits': LIMITS}
        try: write_status(data)
        except OSError: pass  # a locked file never kills the watcher; the next sample tries again
        if once:
            print(json.dumps(data, ensure_ascii=False, indent=1)); return


if __name__ == '__main__':
    main()
