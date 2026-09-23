"""Render every canvas board and record the exact set of colours it paints.
Used to PROVE colour centralisation: snapshot -> mutate one source hue -> snapshot -> diff.
Usage:  python palette.py snap <out.json>
        python palette.py diff <before.json> <after.json>
"""
import io, os, re, sys, json, glob, subprocess, pathlib
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
import importlib.util
_spec = importlib.util.spec_from_file_location('paint', os.path.join(HERE, 'paint.py'))
paint = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(paint)

CANVAS = os.environ.get('KOKO_CANVAS') or os.path.join(ROOT, 'docs', 'canvas')


def snapshot():
    out = {}
    boards = sorted(os.path.basename(p) for p in glob.glob(os.path.join(CANVAS, '*.dc.html')))
    for b in boards:
        out[b] = {}
        for th in ('light', 'dark'):
            try:
                seen = paint.run(paint.build(b, None, th))
            except Exception as e:
                out[b][th] = {'ERROR': str(e)[:80]}
                continue
            agg = {}
            for s in seen:
                agg[s['hex']] = agg.get(s['hex'], 0) + 1
            out[b][th] = agg
        print('  snapped', b, flush=True)
    return out


def diff(before, after, old_hex, new_hex):
    old_hex, new_hex = old_hex.upper(), new_hex.upper()
    moved, stale, changed_other = [], [], []
    for board in sorted(set(before) | set(after)):
        for th in ('light', 'dark'):
            b = before.get(board, {}).get(th, {}) or {}
            a = after.get(board, {}).get(th, {}) or {}
            had_old = old_hex in b
            has_old = old_hex in a
            has_new = new_hex in a
            if had_old and not has_old and has_new:
                moved.append(f"{board} [{th}]  x{b[old_hex]}")
            elif had_old and has_old:
                stale.append(f"{board} [{th}]  {old_hex} still painted x{a[old_hex]}")
            for hx in set(b) | set(a):
                if hx in (old_hex, new_hex):
                    continue
                if b.get(hx, 0) != a.get(hx, 0):
                    changed_other.append(f"{board} [{th}]  {hx} {b.get(hx,0)}->{a.get(hx,0)}")
    return moved, stale, changed_other


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'snap':
        data = snapshot()
        io.open(sys.argv[2], 'w', encoding='utf-8').write(json.dumps(data, indent=0))
        n = sum(1 for b in data for t in data[b] if 'ERROR' not in data[b][t])
        print(f"\nsnapshot written: {len(data)} boards, {n} board/theme renders")
    elif cmd == 'diff':
        before = json.load(io.open(sys.argv[2], encoding='utf-8'))
        after = json.load(io.open(sys.argv[3], encoding='utf-8'))
        moved, stale, other = diff(before, after, sys.argv[4], sys.argv[5])
        print(f"MOVED to the new hue   : {len(moved)} board/theme surfaces")
        for m in moved:
            print('   +', m)
        print(f"\nLEFT BEHIND on the old : {len(stale)}")
        for s in stale:
            print('   !', s)
        print(f"\nUNRELATED colour drift : {len(other)}")
        for o in other[:20]:
            print('   ?', o)
