# meters.pyw — «عدّادات الجهاز»: a DESKTOP WIDGET (his choice 2026-11-09), updated every 2 s. Not always-on-top: it is pinned
# into the desktop layer itself (on the wallpaper, under the icons, behind every normal window; seen with Win+D).
# Shows CPU, free RAM, free disk, network, heat (overheating signal: busy CPU below its base clock; no real degrees here), the guard's level (from watcher.py → data/machine.json)
# and what the pipeline is doing right now (data/run-stage.json, written by night.js / write.js) + how many are left.
# Two modes, chosen automatically (data/meters-pos.json → mode):
#  'desktop' — a child of the desktop window (Progman), between the wallpaper and the icons. Only where Windows can draw an
#     ordinary (GDI) window there. Icons take the clicks, so Alt + left-drag moves it (the widget polls the mouse).
#  'follow'  — used on THIS PC (Windows 11 build 26300, 2026-11-09): Progman is created with WS_EX_NOREDIRECTIONBITMAP, so an
#     ordinary window inside it is placed and "visible" but never painted (tested: blank). Instead: a normal frameless window,
#     semi-transparent, no taskbar entry, kept UNDER every app window; when the desktop is in front (Win+D, or a click on an
#     empty part of the desktop) it rises so it is seen, and sinks again as soon as an app is used. Plain drag moves it;
#     right-click → «سكّر».
# Position kept in data/meters-pos.json. Close: right-click «سكّر», or desktop shortcut «إيقاف المراقب» (= --stop, writes
# data/meters.stop). Desktop shortcut «مراقب الجهاز» opens it; nothing starts with Windows. If Explorer restarts in 'desktop'
# mode the widget reopens itself.
# It starts its own watcher (watcher.py --parent <this window>), so closing the window stops that watcher. If a night/write run
# already has one, the window just reads it, and starts its own again when that run's watcher ends.
#   pythonw scripts/machine/meters.pyw            open        pythonw scripts/machine/meters.pyw --stop     close
import json, os, sys, time, ctypes, subprocess
from ctypes import wintypes
import tkinter as tk
import psutil

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MACHINE = os.path.join(ROOT, 'data', 'machine.json')
STAGE = os.path.join(ROOT, 'data', 'run-stage.json')
NIGHT = os.path.join(ROOT, 'data', 'run-night.json')
POS = os.path.join(ROOT, 'data', 'meters-pos.json')
STOP = os.path.join(ROOT, 'data', 'meters.stop')
EVERY_MS = 2000
ALPHA = 215  # 0–255: semi-transparent so the wallpaper shows through

# ---- Win32: pin into the desktop layer ------------------------------------------------------------
u32 = ctypes.windll.user32
H = wintypes.HWND
for name, res, args in [('FindWindowW', H, [wintypes.LPCWSTR, wintypes.LPCWSTR]),
                        ('FindWindowExW', H, [H, H, wintypes.LPCWSTR, wintypes.LPCWSTR]),
                        ('SetParent', H, [H, H]), ('GetParent', H, [H]), ('GetAncestor', H, [H, wintypes.UINT]),
                        ('WindowFromPoint', H, [wintypes.POINT]), ('IsWindow', wintypes.BOOL, [H]), ('GetForegroundWindow', H, []),
                        ('GetClassNameW', ctypes.c_int, [H, wintypes.LPWSTR, ctypes.c_int]),
                        ('GetWindowLongPtrW', ctypes.c_ssize_t, [H, ctypes.c_int]),
                        ('SetWindowLongPtrW', ctypes.c_ssize_t, [H, ctypes.c_int, ctypes.c_ssize_t]),
                        ('SetWindowPos', wintypes.BOOL, [H, H, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]),
                        ('SetLayeredWindowAttributes', wintypes.BOOL, [H, wintypes.DWORD, ctypes.c_ubyte, wintypes.DWORD]),
                        ('ScreenToClient', wintypes.BOOL, [H, ctypes.POINTER(wintypes.POINT)]),
                        ('GetWindowRect', wintypes.BOOL, [H, ctypes.POINTER(wintypes.RECT)]),
                        ('SendMessageTimeoutW', ctypes.c_ssize_t, [H, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM, wintypes.UINT, wintypes.UINT, ctypes.POINTER(ctypes.c_size_t)])]:
    f = getattr(u32, name); f.restype, f.argtypes = res, args
GWL_STYLE, GWL_EXSTYLE = -16, -20
WS_POPUP, WS_CHILD = 0x80000000, 0x40000000
WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_EX_APPWINDOW, WS_EX_NOACTIVATE = 0x80000, 0x80, 0x40000, 0x08000000
SWP_NOSIZE, SWP_NOMOVE, SWP_NOZORDER, SWP_NOACTIVATE, SWP_SHOWWINDOW = 0x1, 0x2, 0x4, 0x10, 0x40
HWND_BOTTOM, HWND_TOPMOST, HWND_NOTOPMOST = H(1), H(-1), H(-2)


def desktop_layer():
    """(parent, insert_after) for the layer between wallpaper and icons, or (None, None)."""
    progman = u32.FindWindowW('Progman', None)
    if not progman: return None, None
    r = ctypes.c_size_t()
    u32.SendMessageTimeoutW(progman, 0x052C, 0, 0, 0, 1000, ctypes.byref(r))  # ask Explorer to create the wallpaper WorkerW
    defview = u32.FindWindowExW(progman, None, 'SHELLDLL_DefView', None)
    if defview:  # 24H2+ layout: Progman -> [icons, WorkerW]; go right under the icons
        return progman, defview
    # older layout: a top-level WorkerW holds the icons; the NEXT top-level WorkerW is the wallpaper layer
    w = None
    while True:
        w = u32.FindWindowExW(None, w, 'WorkerW', None)
        if not w: return None, None
        if u32.FindWindowExW(w, None, 'SHELLDLL_DefView', None):
            wall = u32.FindWindowExW(None, w, 'WorkerW', None)
            return (wall, None) if wall else (None, None)


def desktop_can_draw_gdi():
    """False when Progman has WS_EX_NOREDIRECTIONBITMAP (Windows 11 24H2+ on this PC): only DirectX/DirectComposition content
    is drawn inside it, so a Tk window there stays blank."""
    progman = u32.FindWindowW('Progman', None)
    return bool(progman) and not (u32.GetWindowLongPtrW(progman, GWL_EXSTYLE) & 0x200000)


def to_client(parent, x, y, width=0):
    """Screen top-left → the parent's client coordinates. On Arabic Windows the desktop (Progman) is mirrored right-to-left
    (WS_EX_LAYOUTRTL): a child's x is counted from the RIGHT edge, so the window's position is given by its right side."""
    if parent and u32.GetWindowLongPtrW(parent, GWL_EXSTYLE) & 0x400000:
        x += width
    pt = wintypes.POINT(x, y)
    if parent: u32.ScreenToClient(parent, ctypes.byref(pt))
    return pt.x, pt.y


def win_class(h):
    b = ctypes.create_unicode_buffer(64); u32.GetClassNameW(h, b, 64); return b.value


def load_pos():
    p = read(POS) or {}
    vx, vy = u32.GetSystemMetrics(76), u32.GetSystemMetrics(77)   # virtual screen (all monitors)
    vw, vh = u32.GetSystemMetrics(78), u32.GetSystemMetrics(79)
    if 'x' in p and vx <= p['x'] < vx + vw - 40 and vy <= p['y'] < vy + vh - 40: return p['x'], p['y'], p.get('right')
    return None


def save_pos(x, y, mode, right=None):
    # 'right' too: on the mirrored (Arabic) desktop the widget is anchored by its right edge, and its width settles only after
    # the first readings, so the right edge is what puts it back in exactly the same place
    try:
        with open(POS, 'w', encoding='utf-8') as f: json.dump({'x': x, 'y': y, 'right': right, 'mode': mode}, f)
    except OSError: pass

BG, FG, DIM = '#16181d', '#e8e8e8', '#8a8f98'
GREEN, AMBER, RED = '#4cc38a', '#f0b429', '#ef5350'
LEVEL = {'ok': ('تمام', GREEN), 'slow': ('يبطّئ', AMBER), 'pause': ('وقفة مؤقتة', AMBER),
         'stop': ('وقف', RED), 'unknown': ('المراقب مو شغّال', DIM)}
STAGE_AR = {'starting': 'يبدأ', 'downloading': 'يحمّل', 'analyzing': 'يحلّل الفيديو', 'deciding': 'يقرر الموضوع',
            'writing': 'يكتب', 'reviewing': 'يراجع', 'uploading': 'يرفع الفيديو', 'pushing': 'يحفظ', 'working': 'يجمع البيانات', 'slow': 'يبطّئ', 'paused': 'وقفة مؤقتة', 'idle': 'واقف'}
SCRIPT_AR = {'night': 'تشغيل الليل', 'write': 'الكتابة', 'fetch': 'التنزيل', 'meta': 'البيانات'}


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


LIB_DIR = os.environ.get('LIB_DIR') or os.path.join(os.path.expanduser('~'), 'Desktop', 'alsuhaiby-library')
LIVE_FILES = [os.path.join(LIB_DIR, 'library.json'), os.path.join(ROOT, 'data', 'r2.json'),
              os.path.join(LIB_DIR, 'fetched.json'), os.path.join(LIB_DIR, 'ledger.json')]
_live = {'key': None, 'left': None}


def live_left():
    """Videos still to fetch, counted live the same way fetch.js does: library − on R2 − needs a TikTok login − given up
    (3 tries) − deferred − judged 'skipped'. Re-read only when one of the files changes (fetch.js writes r2.json after every upload)."""
    try:
        key = tuple(os.path.getmtime(p) if os.path.exists(p) else 0 for p in LIVE_FILES)
        if key != _live['key']:
            lib, r2, fetched, ledger = (read(p) or {} for p in LIVE_FILES)
            n = 0
            for v in lib.get('videos', []):
                i = v.get('id'); f = fetched.get(i) or {}
                if i in r2 or f.get('deferred') or f.get('needsLogin') or (f.get('tries') or 0) >= 3 or (ledger.get(i) or {}).get('status') == 'skipped': continue
                n += 1
            _live.update(key=key, left=n)
        return _live['left']
    except Exception:
        return None


def pipeline():
    s = read(STAGE)
    alive = bool(s and s.get('pid') and psutil.pid_exists(s['pid']) and s.get('stage') != 'idle')
    if alive:
        try: alive = 'node' in psutil.Process(s['pid']).name().lower()
        except Exception: alive = False
    # «الباقي» = videos not on R2 yet, live from the files (not the old night-run number); a night/write run shows its own count
    left = live_left()
    if not alive or s.get('script') == 'fetch':
        left_txt = f'{left}' if left is not None else '—'
        if not alive: return 'واقف', DIM, left_txt
    else:
        left_txt = f"{s.get('left', '—')}"
    what = STAGE_AR.get(s.get('stage'), s.get('stage', ''))
    who = SCRIPT_AR.get(s.get('script'), '')
    color = AMBER if s.get('stage') in ('slow', 'paused') else GREEN
    return f'{who}: {what}' if who else what, color, left_txt


class Meters:
    def __init__(self):
        r = self.root = tk.Tk()
        r.overrideredirect(True); r.configure(bg=BG)  # frameless, no title bar; NOT topmost
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
        # fixed size: measured once with the longest texts, so the widget never changes width (a width change would shift it
        # on the mirrored Arabic desktop, and it would not reopen in exactly the same place)
        longest = {'cpu': '100%', 'ram': '99.9 / 99 GB', 'disk': '9999 GB', 'net': '↓ 999.9   ↑ 999.9 MB/s',
                   'temp': 'حار ويبطّئ نفسه', 'guard': 'المراقب مو شغّال', 'job': 'تشغيل الليل: يحلّل الفيديو', 'left': '9999'}
        for k, t in longest.items(): self.vals[k].config(text=t)
        r.update_idletasks()
        r.geometry(f'{r.winfo_reqwidth() + 8}x{r.winfo_reqheight()}')
        r.grid_propagate(False)
        for k in longest: self.vals[k].config(text='…')
        r.update_idletasks()
        saved = load_pos()
        w = r.winfo_reqwidth() + 8
        if saved and saved[2]: pos = (saved[2] - w, saved[1])
        elif saved: pos = saved[:2]
        else: pos = (r.winfo_screenwidth() - w - 24, 24)
        r.geometry(f'+{pos[0]}+{pos[1]}')
        r.update()
        self.hwnd = H(int(r.wm_frame(), 16))
        self.target = pos
        self.mode = self.pin(*pos)
        if self.mode == 'desktop': r.after(300, self.place)
        w = self.rect().right - self.rect().left
        save_pos(pos[0], pos[1], self.mode, pos[0] + w)
        self.dragging = None
        psutil.cpu_percent(interval=None)
        self.net0, self.t0 = psutil.net_io_counters(), time.time()
        self.tick()
        if self.mode == 'desktop': self.watch_mouse()

    def pin(self, x, y):
        """'desktop' (inside the desktop layer) when Windows can draw it there; otherwise 'follow' (see the header)."""
        h = self.hwnd
        ex = u32.GetWindowLongPtrW(h, GWL_EXSTYLE)
        ex = (ex | WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) & ~WS_EX_APPWINDOW  # no taskbar entry, never takes focus
        parent, after = desktop_layer() if desktop_can_draw_gdi() else (None, None)
        if parent:
            st = u32.GetWindowLongPtrW(h, GWL_STYLE)
            u32.SetWindowLongPtrW(h, GWL_STYLE, (st & ~WS_POPUP) | WS_CHILD)
            u32.SetWindowLongPtrW(h, GWL_EXSTYLE, ex)
            if u32.SetParent(h, parent) and u32.GetParent(h) == parent:
                self.parent = parent
                self.target = (x, y)
                self.place(after)
                u32.SetLayeredWindowAttributes(h, 0, ALPHA, 2)
                return 'desktop'
            u32.SetWindowLongPtrW(h, GWL_STYLE, st)  # undo, fall back
        self.parent = None
        u32.SetWindowLongPtrW(h, GWL_EXSTYLE, ex & ~WS_EX_NOACTIVATE)  # a normal top-level: clicks and drag work directly
        u32.SetLayeredWindowAttributes(h, 0, ALPHA, 2)
        u32.SetWindowPos(h, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_SHOWWINDOW)
        self.raised = False
        r = self.root
        for w in [r] + list(r.winfo_children()):
            w.bind('<ButtonPress-1>', self.grab); w.bind('<B1-Motion>', self.drag)
            w.bind('<ButtonRelease-1>', self.drop); w.bind('<Button-3>', self.menu)
        self.pop = tk.Menu(r, tearoff=0); self.pop.add_command(label='سكّر', command=lambda: os._exit(0))
        r.after(250, self.follow)
        return 'follow'

    # ---- 'follow' mode -----------------------------------------------------------------------------
    def follow(self):
        """Rise while the desktop is in front (Win+D / desktop clicked), sink under every app window otherwise."""
        try:
            fg = u32.GetForegroundWindow()
            pid = wintypes.DWORD()
            if fg: u32.GetWindowThreadProcessId(fg, ctypes.byref(pid))
            # our own windows count as "desktop in front" too: the right-click menu takes focus, and the widget must not
            # sink behind the desktop while its menu is open
            on_desktop = bool(fg) and (pid.value == os.getpid() or win_class(fg) in ('Progman', 'WorkerW'))
            if on_desktop and not self.raised:
                u32.SetWindowPos(self.hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_SHOWWINDOW)
                self.raised = True
            elif not on_desktop and self.raised:
                u32.SetWindowPos(self.hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE)
                u32.SetWindowPos(self.hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE)
                self.raised = False
            elif not on_desktop:  # stay under everything (another window may have been sent behind it)
                u32.SetWindowPos(self.hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE)
        except Exception:
            pass
        self.root.after(250, self.follow)

    def grab(self, e): self.dx, self.dy = e.x_root - self.root.winfo_x(), e.y_root - self.root.winfo_y()
    def drag(self, e): self.root.geometry(f'+{e.x_root - self.dx}+{e.y_root - self.dy}')
    def drop(self, e):
        rc = self.rect(); save_pos(rc.left, rc.top, self.mode, rc.right)
    def menu(self, e): self.pop.tk_popup(e.x_root, e.y_root)

    def place(self, after=None):
        """Move to self.target (screen top-left) with Windows calls only: Tk's own positioning comes out mirrored on the
        right-to-left desktop, so Tk is never asked to position the pinned widget."""
        rc = self.rect()
        cx, cy = to_client(self.parent, *self.target, rc.right - rc.left)
        flags = SWP_NOSIZE | SWP_NOACTIVATE | (SWP_SHOWWINDOW if after else SWP_NOZORDER)
        u32.SetWindowPos(self.hwnd, after, cx, cy, 0, 0, flags)

    def rect(self):
        rc = wintypes.RECT(); u32.GetWindowRect(self.hwnd, ctypes.byref(rc)); return rc

    def watch_mouse(self):
        """Alt + left-drag moves the widget (the desktop icon layer takes normal clicks, so the widget polls the mouse)."""
        try:
            alt = u32.GetAsyncKeyState(0x12) & 0x8000
            left = u32.GetAsyncKeyState(0x01) & 0x8000
            pt = wintypes.POINT(); u32.GetCursorPos(ctypes.byref(pt))
            if self.dragging is None and alt and left:
                rc = self.rect()
                # only when the pointer is over the widget AND over the desktop (not over an app window covering it)
                top = u32.GetAncestor(u32.WindowFromPoint(pt), 2)
                over_desktop = top == self.hwnd or (top and win_class(top) in ('Progman', 'WorkerW'))
                if rc.left <= pt.x < rc.right and rc.top <= pt.y < rc.bottom and over_desktop:
                    self.dragging = (pt.x - rc.left, pt.y - rc.top)
            elif self.dragging is not None and left:
                self.target = (pt.x - self.dragging[0], pt.y - self.dragging[1])
                self.place()
            elif self.dragging is not None:
                self.dragging = None
                rc = self.rect(); save_pos(rc.left, rc.top, self.mode, rc.right)
        except Exception:
            self.dragging = None
        self.root.after(30, self.watch_mouse)

    def health(self):
        """Stop file -> close. Desktop rebuilt (Explorer restarted) -> reopen a fresh widget."""
        if os.path.exists(STOP):
            try: os.remove(STOP)
            except OSError: pass
            os._exit(0)  # the watcher this window started sees its owner gone and stops too
        if self.mode == 'desktop' and (not u32.IsWindow(self.hwnd) or not u32.IsWindow(self.parent) or u32.GetParent(self.hwnd) != self.parent):
            ctypes.windll.kernel32.CloseHandle(MUTEX)
            time.sleep(3)  # let Explorer finish rebuilding the desktop
            subprocess.Popen([sys.executable, os.path.abspath(__file__)], creationflags=0x08000000, close_fds=True)
            os._exit(0)

    def set(self, k, text, color=FG): self.vals[k].config(text=text, fg=color)

    def tick(self):
        self.health()
        if self.mode == 'desktop' and self.dragging is None:  # anything moved it (Tk, Explorer)? put it back
            rc = self.rect()
            if (rc.left, rc.top) != tuple(self.target): self.place()
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
    if '--stop' in sys.argv:  # desktop shortcut «إيقاف المراقب»
        open(STOP, 'w').close()
        sys.exit(0)
    ctypes.windll.kernel32.CreateMutexW.restype = wintypes.HANDLE
    MUTEX = ctypes.windll.kernel32.CreateMutexW(None, False, 'Global\\alsuhaiby-meters')
    if ctypes.windll.kernel32.GetLastError() != 183:  # one widget only
        try: os.remove(STOP)  # an old stop request must not close a fresh start
        except OSError: pass
        try: ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception: pass
        Meters().root.mainloop()
