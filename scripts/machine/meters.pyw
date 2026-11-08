# meters.pyw — «عدّادات الجهاز»: a small always-on-top window in the top-right corner, updated every 2 s.
# Shows CPU, free RAM, free disk, network, heat (overheating signal: busy CPU below its base clock; no real degrees here), the guard's level (from watcher.py → data/machine.json)
# and what the pipeline is doing right now (data/run-stage.json, written by night.js / write.js) + how many are left.
# Drag it with the mouse to move it; right-click → «سكّر». Desktop shortcut «مراقب الجهاز» opens it (nothing starts with Windows).
# It starts its own watcher (watcher.py --parent <this window>), so closing the window stops that watcher. If a night/write run
# already has one, the window just reads it, and starts its own again when that run's watcher ends.
#   pythonw scripts/machine/meters.pyw
import json, os, sys, time, ctypes, subprocess
import tkinter as tk
import psutil

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MACHINE = os.path.join(ROOT, 'data', 'machine.json')
STAGE = os.path.join(ROOT, 'data', 'run-stage.json')
NIGHT = os.path.join(ROOT, 'data', 'run-night.json')
EVERY_MS = 2000

BG, FG, DIM = '#16181d', '#e8e8e8', '#8a8f98'
GREEN, AMBER, RED = '#4cc38a', '#f0b429', '#ef5350'
LEVEL = {'ok': ('تمام', GREEN), 'slow': ('يبطّئ', AMBER), 'pause': ('وقفة مؤقتة', AMBER),
         'stop': ('وقف', RED), 'unknown': ('المراقب مو شغّال', DIM)}
STAGE_AR = {'starting': 'يبدأ', 'downloading': 'يحمّل', 'analyzing': 'يحلّل الفيديو', 'deciding': 'يقرر الموضوع',
            'writing': 'يكتب', 'reviewing': 'يراجع', 'pushing': 'يرفع', 'slow': 'يبطّئ', 'paused': 'وقفة مؤقتة', 'idle': 'واقف'}
SCRIPT_AR = {'night': 'تشغيل الليل', 'write': 'الكتابة'}


def read(p):
    try:
        with open(p, encoding='utf-8') as f: return json.load(f)
    except Exception: return None


WATCHER = os.path.join(ROOT, 'scripts', 'machine', 'watcher.py')
_last_spawn = 0


def ensure_watcher():
    """Start a watcher tied to this window when none is alive (at most once every 20 s)."""
    global _last_spawn
    m = read(MACHINE)
    if m and m.get('pid') and psutil.pid_exists(m['pid']) and time.time() - m.get('atEpoch', 0) < 120: return
    if time.time() - _last_spawn < 20: return
    _last_spawn = time.time()
    exe = os.path.join(os.path.dirname(sys.executable), 'pythonw.exe')
    subprocess.Popen([exe if os.path.exists(exe) else sys.executable, WATCHER, '--parent', str(os.getpid())],
                     creationflags=0x08000000, close_fds=True)  # CREATE_NO_WINDOW


def pipeline():
    s = read(STAGE)
    alive = bool(s and s.get('pid') and psutil.pid_exists(s['pid']) and s.get('stage') != 'idle')
    if alive:
        try: alive = 'node' in psutil.Process(s['pid']).name().lower()
        except Exception: alive = False
    if not alive:
        n = read(NIGHT) or {}
        left = n.get('archiveLeft')
        return 'واقف', DIM, (f'{left}' if left is not None else '—')
    what = STAGE_AR.get(s.get('stage'), s.get('stage', ''))
    who = SCRIPT_AR.get(s.get('script'), '')
    color = AMBER if s.get('stage') in ('slow', 'paused') else GREEN
    return f'{who}: {what}' if who else what, color, f"{s.get('left', '—')}"


class Meters:
    def __init__(self):
        r = self.root = tk.Tk()
        r.overrideredirect(True); r.attributes('-topmost', True); r.attributes('-alpha', 0.97); r.configure(bg=BG)
        self.vals = {}
        rows = [('cpu', 'المعالج'), ('ram', 'الذاكرة الفاضية'), ('disk', 'المساحة الفاضية'), ('net', 'الشبكة'),
                ('temp', 'الحرارة'), ('guard', 'حماية الجهاز'), ('job', 'الشغل الحين'), ('left', 'الباقي')]
        for i, (k, label) in enumerate(rows):
            if k == 'guard':
                tk.Frame(r, bg='#2a2d34', height=1).grid(row=2 * i - 1 if i else 0, column=0, columnspan=2, sticky='ew', padx=8, pady=3)
            tk.Label(r, text=label, bg=BG, fg=DIM, font=('Segoe UI', 10), anchor='e').grid(row=2 * i, column=1, sticky='e', padx=(4, 10), pady=1)
            v = tk.Label(r, text='…', bg=BG, fg=FG, font=('Segoe UI Semibold', 10), anchor='w')
            v.grid(row=2 * i, column=0, sticky='w', padx=(10, 4), pady=1)
            self.vals[k] = v
        r.columnconfigure(0, minsize=150); r.columnconfigure(1, minsize=110)
        for w in [r] + list(r.winfo_children()):
            w.bind('<ButtonPress-1>', self.grab); w.bind('<B1-Motion>', self.drag); w.bind('<Button-3>', self.menu)
        self.pop = tk.Menu(r, tearoff=0); self.pop.add_command(label='سكّر', command=r.destroy)
        r.update_idletasks()
        sw = r.winfo_screenwidth()
        r.geometry(f'+{sw - r.winfo_reqwidth() - 12}+12')
        psutil.cpu_percent(interval=None)
        self.net0, self.t0 = psutil.net_io_counters(), time.time()
        self.tick()

    def grab(self, e): self.dx, self.dy = e.x_root - self.root.winfo_x(), e.y_root - self.root.winfo_y()
    def drag(self, e): self.root.geometry(f'+{e.x_root - self.dx}+{e.y_root - self.dy}')
    def menu(self, e): self.pop.tk_popup(e.x_root, e.y_root)

    def set(self, k, text, color=FG): self.vals[k].config(text=text, fg=color)

    def tick(self):
        try:
            ensure_watcher()
            cpu = psutil.cpu_percent(interval=None)
            vm = psutil.virtual_memory(); free = vm.available / 1024**3
            disk = psutil.disk_usage('C:\\').free / 1024**3
            net, t = psutil.net_io_counters(), time.time()
            dt = max(t - self.t0, 0.1)
            down = (net.bytes_recv - self.net0.bytes_recv) / dt / 1024**2
            up = (net.bytes_sent - self.net0.bytes_sent) / dt / 1024**2
            self.net0, self.t0 = net, t
            self.set('cpu', f'{cpu:.0f}%', RED if cpu > 85 else FG)
            self.set('ram', f'{free:.1f} / {vm.total / 1024**3:.0f} GB', RED if free < 1.5 else FG)
            self.set('disk', f'{disk:.0f} GB', RED if disk < 5 else FG)
            self.set('net', f'↓ {down:.1f}   ↑ {up:.1f} MB/s')
            m = read(MACHINE)
            fresh = bool(m and time.time() - m.get('atEpoch', 0) < 120)
            # heat signal (no real temperature on this machine): from the watcher. Arabic only — a number on the same line
            # scrambles the right-to-left order in this window (the CPU speed is in data/machine.json → perf)
            if fresh and m.get('heat'):
                self.set('temp', m['heat'], RED if m.get('heatHot') else DIM if m['heat'] in ('—', 'على البطارية') else GREEN)
            else:
                self.set('temp', '—', DIM)
            lvl = m.get('level') if fresh else 'unknown'
            text, color = LEVEL.get(lvl, LEVEL['unknown'])
            self.set('guard', text, color)
            job, jc, left = pipeline()
            self.set('job', job, jc); self.set('left', left)
        except Exception as e:
            self.set('job', f'خطأ: {e}'[:40], RED)
        self.root.after(EVERY_MS, self.tick)


if __name__ == '__main__':
    ctypes.windll.kernel32.CreateMutexW(None, False, 'Global\\alsuhaiby-meters')
    if ctypes.windll.kernel32.GetLastError() != 183:  # one window only
        try: ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception: pass
        Meters().root.mainloop()
