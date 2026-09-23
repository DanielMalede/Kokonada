"""Standing structural check for a canvas board. Run after EVERY edit to a .dc.html.

Four times a replacement across nested markup silently restructured a screen while the
measurements still looked fine. Measurements alone cannot catch it — a broken tree still
reports a plausible height. So this runs the structural checks AND writes a screenshot,
because the screenshot is what actually caught it.

    python board.py <Board> [field]        # check + screenshot both themes
"""
import io, os, re, sys, json, subprocess, pathlib, importlib.util

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
# scripts/design/<tool>.py -> repo root. The canvas is tracked at docs/canvas, and the
# probe output is disposable, so it goes to a gitignored dir rather than beside the source.
ROOT = os.path.dirname(os.path.dirname(HERE))
CANVAS = os.environ.get('KOKO_CANVAS') or os.path.join(ROOT, 'docs', 'canvas')
OUT = os.environ.get('KOKO_PROBE_OUT') or os.path.join(ROOT, '.design-probe')
CHROME = os.environ.get('CHROME') or r"C:\Program Files\Google\Chrome\Application\chrome.exe"
_spec = importlib.util.spec_from_file_location('paint', os.path.join(HERE, 'paint.py'))
paint = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(paint)

VOID = {'br', 'img', 'input', 'hr', 'meta', 'link', 'source', 'path', 'circle', 'rect',
        'line', 'polyline', 'polygon', 'ellipse', 'stop', 'use'}


def tag_balance(html):
    """Report unclosed / over-closed tags for the container elements that carry layout."""
    counts = {}
    for t in ('div', 'span', 'svg', 'g', 'p', 'h1', 'h2', 'text'):
        counts[t] = (len(re.findall(r'<' + t + r'[\s>]', html)), len(re.findall(r'</' + t + r'>', html)))
    return {t: c for t, c in counts.items() if c[0] != c[1]}


def css_balance(src):
    m = re.search(r'<style>(.*?)</style>', src, re.S)
    if not m:
        return None
    css = m.group(1)
    return css.count('{') - css.count('}')


PROBE = r"""<script>window.addEventListener('load',function(){setTimeout(function(){
var q=document.querySelector('.qi')||document.querySelector('.doc');
var fb=q.getBoundingClientRect();var out={topLevel:q.children.length,over:[],small:[]};
q.querySelectorAll('*').forEach(function(el){var cs=getComputedStyle(el);
 if(cs.position==='absolute'||cs.position==='fixed')return;
 if(cs.display==='none'||cs.visibility==='hidden')return;
 var clip=false;
 for(var a=el.parentElement;a&&a!==q;a=a.parentElement){var ac=getComputedStyle(a);
  if(ac.overflow!=='visible'||ac.overflowY!=='visible'){clip=true;break;}}
 if(clip)return;
 var r=el.getBoundingClientRect(); if(!r.height)return;
 if(r.bottom>fb.bottom+1||r.right>fb.right+1||r.left<fb.left-1)
   out.over.push(((el.textContent||'').trim().replace(/\s+/g,' ').slice(0,20)||el.tagName)+
     ' +'+Math.round(Math.max(r.bottom-fb.bottom,r.right-fb.right)));});
q.querySelectorAll('[role="button"],[role="switch"],[role="tab"],[role="slider"]').forEach(function(el){
 var r=el.getBoundingClientRect();
 if(r.height&&r.height<44) out.small.push((el.getAttribute('aria-label')||el.tagName)+' h='+Math.round(r.height));});
out.h=q.scrollHeight;
document.title='B'+JSON.stringify(out);},800)});</script>"""


def preview_size(src):
    """A doc board is 1400 wide; screenshotting it at 390 clips most of it away."""
    m = re.search(r'"[$]preview":\{"width":(\d+),"height":(\d+)\}', src)
    return (int(m.group(1)), int(m.group(2))) if m else (390, 844)


def check(board, field=None):
    name = board.replace('.dc.html', '')
    src = io.open(os.path.join(CANVAS, board), encoding='utf-8').read()
    PW, PH = preview_size(src)
    body = src[src.index('<div class="qi"') if '<div class="qi"' in src else src.index('<div class="doc"'):src.index('</x-dc>')]

    print(f'=== {name} ===')
    bal = tag_balance(body)
    print('  tag balance   :', 'BALANCED' if not bal else f'IMBALANCED {bal}')
    cb = css_balance(src)
    print('  css braces    :', 'BALANCED' if cb == 0 else f'IMBALANCED (delta {cb})')

    ok = not bal and cb == 0
    for th in ('light', 'dark'):
        p = paint.build(board, field, th)
        s = io.open(p, encoding='utf-8').read()
        s = re.sub(r'<script>\s*window\.addEventListener.*?</script>', '', s, flags=re.S)
        io.open(p, 'w', encoding='utf-8').write(s.replace('</body>', PROBE + '</body>'))
        u = pathlib.Path(p).as_uri()
        r = subprocess.run([CHROME, '--headless', '--disable-gpu', f'--window-size={PW},{PH}',
                            '--virtual-time-budget=2800', '--dump-dom', u],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        m = re.search(r'<title>B(\{.*?\})</title>', r.stdout, re.S)
        if not m:
            print(f'  {th:5s} render : PROBE FAILED'); ok = False; continue
        d = json.loads(m.group(1))
        flags = []
        if d['over']:
            flags.append(f"overflow {d['over'][:2]}")
        if d['small']:
            flags.append(f"small targets {d['small']}")
        print(f"  {th:5s} render : {d['topLevel']} top-level, h={d['h']}" +
              (('  ⚠ ' + '; '.join(flags)) if flags else '  clean'))
        if flags:
            ok = False
        shot = os.path.join(OUT, f'check-{name}-{th}.png')
        if os.path.exists(shot):
            os.remove(shot)
        subprocess.run([CHROME, '--headless', '--disable-gpu', f'--window-size={PW},{PH}',
                        '--virtual-time-budget=2800', f'--screenshot={shot}', u], capture_output=True)
        print(f'         shot : {"written" if os.path.exists(shot) else "FAILED — screenshot via PowerShell"}')
    print('  ==>', 'PASS' if ok else 'NEEDS ATTENTION')
    return ok


if __name__ == '__main__':
    b = sys.argv[1] if len(sys.argv) > 1 else 'You'
    f = sys.argv[2] if len(sys.argv) > 2 else None
    check(b if b.endswith('.dc.html') else b + '.dc.html', f)
