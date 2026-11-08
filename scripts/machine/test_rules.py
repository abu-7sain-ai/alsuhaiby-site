# test_rules.py — the watcher's rules with fake readings (no real machine numbers).  python scripts/machine/test_rules.py
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from watcher import decide

ok = {'cpu': 20, 'ramFreeGB': 8, 'diskFreeGB': 100}
def run(seq, step=30):
    mem, out = {}, []
    for i, s in enumerate(seq): out.append(decide({**ok, **s}, mem, 1000 + i * step)[0])
    return out

checks = [
    ('normal stays ok', run([{}] * 10), ['ok'] * 10),
    # CPU > 85: slow only after 3 min (7th sample: 0..180 s), pause 3 min after that
    ('cpu: slow after 3 min, pause after 6', run([{'cpu': 95}] * 14),
     ['ok'] * 6 + ['slow'] * 6 + ['pause'] * 2),
    ('cpu spike shorter than 3 min never acts', run([{'cpu': 95}] * 5 + [{}] + [{'cpu': 95}] * 5), ['ok'] * 11),
    ('cpu at exactly 85 is not above', run([{'cpu': 85}] * 10), ['ok'] * 10),
    ('ram low: slow at once, pause 3 min later', run([{'ramFreeGB': 1.2}] * 8), ['slow'] * 6 + ['pause'] * 2),
    ('pressure clears → back to ok', run([{'ramFreeGB': 1.2}] * 8 + [{}]), ['slow'] * 6 + ['pause'] * 2 + ['ok']),
    ('disk < 5 GB stops at once', run([{'diskFreeGB': 4.9}]), ['stop']),
    ('disk stop wins over pause', run([{'ramFreeGB': 1, 'diskFreeGB': 3}] * 8), ['stop'] * 8),
    # heat signal: busy (> 50%) on mains power AND below base clock (perf < 100) or firmware-limited, for 2 min (5th sample)
    ('heat: slow after 2 min, pause 3 min later', run([{'cpu': 70, 'perf': 80, 'plugged': True}] * 12),
     ['ok'] * 4 + ['slow'] * 6 + ['pause'] * 2),
    ('heat: firmware limit counts too', run([{'cpu': 70, 'perf': 120, 'perfLimit': 60, 'plugged': True}] * 5), ['ok'] * 4 + ['slow']),
    ('heat: normal turbo (perf > 100) is not heat', run([{'cpu': 100, 'perf': 125, 'perfLimit': 100, 'plugged': True}] * 5), ['ok'] * 5),
    ('heat: an idle CPU below base clock is not heat', run([{'cpu': 20, 'perf': 40, 'plugged': True}] * 8), ['ok'] * 8),
    ('heat: ignored on battery', run([{'cpu': 70, 'perf': 60, 'plugged': False}] * 8), ['ok'] * 8),
    ('heat: no counters → off', run([{'cpu': 70, 'perf': None}] * 8), ['ok'] * 8),
    ('heat: never stops on its own', 'stop' not in run([{'cpu': 99, 'perf': 50, 'plugged': True}] * 40), True),
]
bad = 0
for name, got, want in checks:
    good = got == want; bad += not good
    print(('ok  ' if good else 'FAIL'), name, '' if good else f'\n     got  {got}\n     want {want}')
r = decide({'cpu': 20, 'ramFreeGB': 1.0, 'diskFreeGB': 3.2}, {}, 0)[1]
print('ok  ' if len(r) == 2 and 'جيجا' in r[0] else 'FAIL', 'Arabic reasons:', r); bad += not (len(r) == 2)
sys.exit(1 if bad else 0)
