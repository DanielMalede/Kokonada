"""Standing structural check for a canvas board. Run after EVERY edit to a .dc.html.

Four times a replacement across nested markup silently restructured a screen while the
measurements still looked fine. Measurements alone cannot catch it — a broken tree still
reports a plausible height. So this runs the structural checks AND writes a screenshot,
because the screenshot is what actually caught it.

    python board.py <Board> [field]            # check + screenshot both themes
    python board.py <Board> --sweep            # ...and every declared enum prop variant
    python board.py --all --sweep              # every board in the canvas

WHY THE SWEEP EXISTS
--------------------
Boards declare their states in `data-props`: Consent alone carries state x platform x open
(2 x 2 x 10). For a long time this probe rendered `theme x 2` and nothing else, so those
states were never once looked at. A review found three defects that existed only because of
that: an unresolved `{{variantTag}}`, blank provider rows, and an iOS Apple button no one
had ever seen. The sweep is the fix.

It is a ONE-AXIS-AT-A-TIME sweep, not a cartesian product. Baseline (every prop at its
declared default), then for each non-theme enum prop each non-default option with every
other prop left at its default — crossed with both themes. Consent is 24 frames that way;
the product would be 80.

THE TWO ENGINES
---------------
`dc` (default) stages a copy of the board next to the real `support.js` and lets the board's
own `renderVals()` run, so props actually resolve. This is the only engine that can render a
variant at all: a prop only reaches the markup through `renderVals()`.

`paint` (--engine=paint) is the legacy path through `paint.build()`, which substitutes a few
hardcoded per-board fixtures and then strips every remaining `<sc-if>` and `{{hole}}`
wholesale. It cannot see a variant, and it can never report an unresolved hole because it
deletes them all before rendering. Kept as an escape hatch for comparison.
"""
import io, os, re, sys, json, html, glob, shutil, subprocess, pathlib, importlib.util

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
# scripts/design/<tool>.py -> repo root. The canvas is tracked at docs/canvas, and the
# probe output is disposable, so it goes to a gitignored dir rather than beside the source.
ROOT = os.path.dirname(os.path.dirname(HERE))
CANVAS = os.environ.get('KOKO_CANVAS') or os.path.join(ROOT, 'docs', 'canvas')
OUT = os.environ.get('KOKO_PROBE_OUT') or os.path.join(ROOT, '.design-probe')
# The dc engine stages board copies here. Its own subdir so it cannot collide with the
# renders paint.py writes into OUT root.
STAGE = os.path.join(OUT, 'staged')
CHROME = os.environ.get('CHROME') or r"C:\Program Files\Google\Chrome\Application\chrome.exe"

# paint.py is only needed by --engine=paint, and importing it copies assets as a side
# effect. Import it lazily so a transient breakage over there cannot take the standing
# check down with it.
_paint = None


def paint_mod():
    global _paint
    if _paint is None:
        spec = importlib.util.spec_from_file_location('paint', os.path.join(HERE, 'paint.py'))
        _paint = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_paint)
    return _paint


VOID = {'br', 'img', 'input', 'hr', 'meta', 'link', 'source', 'path', 'circle', 'rect',
        'line', 'polyline', 'polygon', 'ellipse', 'stop', 'use'}


def tag_balance(markup):
    """Report unclosed / over-closed tags for the container elements that carry layout."""
    counts = {}
    for t in ('div', 'span', 'svg', 'g', 'p', 'h1', 'h2', 'text'):
        counts[t] = (len(re.findall(r'<' + t + r'[\s>]', markup)),
                     len(re.findall(r'</' + t + r'>', markup)))
    return {t: c for t, c in counts.items() if c[0] != c[1]}


def css_balance(src):
    m = re.search(r'<style>(.*?)</style>', src, re.S)
    if not m:
        return None
    css = m.group(1)
    return css.count('{') - css.count('}')


# The chip bar support.js paints for interactive use is position:fixed, so it never reaches
# the probe's measurements — but it does sit in the screenshot, over the board. Hide it in
# the staged copy rather than editing support.js, which is tracked canvas.
CHIPS_OFF = '<style>[data-dc-chips]{display:none!important}</style>'

# `holes` and `sc` are the template-hole check: a frame still carrying a {{hole}} or a live
# <sc-if>/<sc-for> after render did not render. Both are read off a clone with <script> and
# <style> stripped, so the board's own logic source (which quotes hole names) and this probe
# (which quotes the pattern) cannot match themselves.
PROBE = r"""<script>window.addEventListener('load',function(){setTimeout(function(){
var q=document.querySelector('.qi')||document.querySelector('.doc');
if(!q){document.title='B'+JSON.stringify({fail:'no .qi/.doc root'});return;}
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
var c=document.body.cloneNode(true);
[].forEach.call(c.querySelectorAll('script,style'),function(s){s.remove();});
out.holes=(c.innerHTML.match(/\{\{[^{}]{0,80}\}\}/g)||[]).slice(0,6);
out.sc=[].map.call(c.querySelectorAll('sc-if,sc-for'),function(e){return e.tagName.toLowerCase();}).slice(0,6);
// support.js fill() turns a hole renderVals() never supplies into an EMPTY STRING, so a
// missing value can never be caught by scanning the DOM for {{...}} — it ships as a blank
// row instead. The only way to see it is to ask the board's own logic what it supplies and
// diff that against the holes in the source. Component is a lexical global from a classic
// script, reachable by bare identifier from this one; window.Component is undefined.
var vk=[];
try{ if(typeof Component==='function'){
 var se=document.querySelector('script[data-dc-script]');
 var decl=se?JSON.parse(se.getAttribute('data-props')||'{}'):{};
 var qp=new URLSearchParams(location.search),pr={};
 Object.keys(decl).forEach(function(k){if(k.charAt(0)==='$')return;
  pr[k]=qp.has(k)?qp.get(k):(decl[k]||{}).default;});
 vk=Object.keys(new Component(pr).renderVals()||{});
}}catch(e){vk=['<renderVals threw: '+e.message+'>'];}
out.vals=vk;
// The frame signature. It has to cover geometry and paint, not just text: `open` toggles
// display (textContent cannot see that, it reads hidden nodes too) and `field` only moves a
// gradient and a height. A text-only hash called both of those axes dead when both are wired.
var sig=[];
q.querySelectorAll('*').forEach(function(el){var cs=getComputedStyle(el);
 if(cs.display==='none'||cs.visibility==='hidden'){sig.push('-');return;}
 var r=el.getBoundingClientRect();
 sig.push(el.tagName+Math.round(r.x)+','+Math.round(r.y)+','+Math.round(r.width)+','+
  Math.round(r.height)+'|'+cs.backgroundColor+'|'+cs.color+'|'+cs.fill+'|'+cs.transform+'|'+
  cs.backgroundImage.slice(0,80));});
var vis=(q.innerText||'').replace(/\s+/g,' ').trim();
sig.push(vis);
var s=sig.join(';'),hsh=0;
for(var i=0;i<s.length;i++){hsh=((hsh<<5)-hsh+s.charCodeAt(i))|0;}
out.txt=vis.length;out.sig=(hsh>>>0).toString(16);
out.sigs=[];
[0,2100].forEach(function(T){
 // CSS cannot re-seek a RUNNING animation: animation-delay only applies at start,
 // and animation-play-state:paused stops it wherever it already is. Both leave the
 // phase dependent on capture timing, which is the non-determinism being fixed.
 // The Web Animations API can seek: pause every animation and set currentTime.
 document.getAnimations().forEach(function(an){try{an.pause();an.currentTime=T;}catch(e){}});
 document.body.getBoundingClientRect();
 var g=[];
 q.querySelectorAll('*').forEach(function(el){
  var cs=getComputedStyle(el);
  if(cs.display==='none'||cs.visibility==='hidden'){g.push('-');return;}
  var r=el.getBoundingClientRect();
  g.push(el.tagName+Math.round(r.x)+','+Math.round(r.y)+','+Math.round(r.width)+','+
   Math.round(r.height)+'|'+cs.backgroundColor+'|'+cs.color+'|'+cs.fill+'|'+cs.transform+'|'+
   cs.backgroundImage.slice(0,80)+'|'+cs.opacity);});
 g.push(vis);
 var gs=g.join(';'),gh=0;
 for(var k=0;k<gs.length;k++){gh=((gh<<5)-gh+gs.charCodeAt(k))|0;}
 out.sigs.push((gh>>>0).toString(16));});
out.sig=out.sigs.join('/');
document.title='B'+JSON.stringify(out);},800)});</script>"""


_PREVIEW_H = {}


def preview_size(src, board=None):
    """A doc board is 1400 wide; screenshotting it at 390 clips most of it away.

    This is the height wired to the camera, so it is recorded for the frame guard:
    it must agree with both the rendered height and the canvas.json record.
    """
    blk = re.search(r'"[$]preview"\s*:\s*\{([^}]*)\}', src)
    w = h = None
    if blk:
        mw = re.search(r'"width"\s*:\s*(\d+)', blk.group(1))
        mh = re.search(r'"height"\s*:\s*(\d+)', blk.group(1))
        if mw and mh:
            w, h = int(mw.group(1)), int(mh.group(1))
    if w is None:
        # Key order and whitespace must not silently disable the camera guard: falling
        # back to (390,844) on a doc board would shoot it at phone size and report clean.
        if blk:
            print('  ⚠ $preview present but unparsed — camera falls back to 390x844')
        return (390, 844)
    if board:
        _PREVIEW_H[board] = h
    return (w, h)


def declared_props(src):
    """The board's own data-props enums, minus the $-prefixed metadata."""
    m = re.search(r"data-props='(.*?)'", src, re.S)
    if not m:
        return {}
    try:
        decl = json.loads(html.unescape(m.group(1)))
    except ValueError:
        return {}
    return {k: v for k, v in decl.items()
            if not k.startswith('$') and isinstance(v, dict)
            and v.get('editor') == 'enum' and v.get('options')}


def source_holes(src):
    """Every {{hole}} the markup asks for, minus the ones an <sc-for> row supplies.

    Paired with the `vals` the probe reads off renderVals(), this is what catches a hole
    nobody fills. That case never reaches the DOM as text — support.js substitutes an empty
    string for it — so it presents as a blank row, not as a visible {{hole}}.
    """
    m = re.search(r'</helmet>(.*?)</x-dc>', src, re.S)
    body = m.group(1) if m else src
    aliases = re.findall(r'<sc-for[^>]*\bas="([A-Za-z0-9_]+)"', body)
    # hint-placeholder-val / -count are editor hints from the original tool. support.js
    # ignores them on purpose, so the {{ false }} inside one is not a hole anybody fills;
    # counting it reports a defect against a board that renders correctly.
    body = re.sub(r'\shint-[a-z-]+="[^"]*"', '', body)
    return {h for h in set(re.findall(r'\{\{\s*([A-Za-z0-9_.]+)\s*\}\}', body))
            if not any(h.startswith(a + '.') for a in aliases)}


def row_holes(src):
    """The {{alias.key}} holes an <sc-for> asks of every row, keyed by list name.

    These were exempt from the hole check. Connect is the only <sc-for> board and the
    one where blank provider rows shipped: rename a key on the row objects and every
    row renders empty, no {{...}} reaches the DOM, both variants still differ from each
    other so no dead axis fires, and the sweep reports clean. This is the missing half.
    """
    m = re.search(r'</helmet>(.*?)</x-dc>', src, re.S)
    body = m.group(1) if m else src
    out = {}
    for lst, alias, inner in re.findall(
            r'<sc-for[^>]*\blist="\{\{\s*([A-Za-z0-9_.]+)\s*\}\}"[^>]*\bas="([A-Za-z0-9_]+)"[^>]*>(.*?)</sc-for>',
            body, re.S):
        keys = {h.split('.', 1)[1] for h in
                re.findall(r'\{\{\s*([A-Za-z0-9_.]+)\s*\}\}', inner)
                if h.startswith(alias + '.')}
        if keys:
            out.setdefault(lst, set()).update(keys)
    return out


def sweep_axes(decl, themes=('light', 'dark'), overrides=None):
    """One axis at a time, crossed with theme.

    Baseline is every prop at its declared default. Then, for each NON-theme enum prop,
    each non-default option with every other prop left at its default. Deliberately not the
    cartesian product: Consent would be 2*2*10*2 = 80 frames, and 76 of them would differ
    from a frame already rendered only in ways two other frames already showed separately.

    Returns [(theme, label, props)]; label is '' for the baseline.
    """
    base = {k: v.get('default', v['options'][0]) for k, v in decl.items()}
    base.update(overrides or {})
    combos = [('', dict(base))]
    for k, v in decl.items():
        if k == 'theme':
            continue
        for opt in v['options']:
            if str(opt) == str(base.get(k)):
                continue
            props = dict(base)
            props[k] = opt
            combos.append((f'{k}={opt}', props))
    return [(th, lbl, dict(p, theme=th)) for th in themes for lbl, p in combos]


def stage(board):
    """Copy the board next to a copy of the real support.js, with the probe injected.

    The board loads ./support.js and ./tokens.css relatively, and tokens.css @font-face's
    the display cut by a relative url, so all three have to land in the same directory or
    the probe measures a board rendered in the fallback face. docs/canvas is tracked and
    must not be written into, hence a staged copy rather than an in-place edit.
    """
    os.makedirs(STAGE, exist_ok=True)
    for asset in ('support.js', 'tokens.css', 'GeneralSans-Semibold.otf'):
        a = os.path.join(CANVAS, asset)
        if os.path.exists(a):
            shutil.copy(a, os.path.join(STAGE, asset))
    src = io.open(os.path.join(CANVAS, board), encoding='utf-8').read()
    p = os.path.join(STAGE, board.replace('.dc.html', '.probe.html'))
    io.open(p, 'w', encoding='utf-8').write(src.replace('</body>', CHIPS_OFF + PROBE + '</body>'))
    return p


def _url(path, props=None):
    u = pathlib.Path(path).as_uri()
    if props:
        u += '?' + '&'.join(f'{k}={v}' for k, v in sorted(props.items()))
    return u


def _dump(url, PW, PH):
    r = subprocess.run([CHROME, '--headless', '--disable-gpu', f'--window-size={PW},{PH}',
                        '--virtual-time-budget=2800', '--dump-dom', url],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    m = re.search(r'<title>B(\{.*?\})</title>', r.stdout, re.S)
    if not m:
        return None
    try:
        # dump-dom escapes & and < inside the title text; a hole string can carry either.
        return json.loads(html.unescape(m.group(1)))
    except ValueError:
        return None


def _shot(url, PW, PH, path):
    if os.path.exists(path):
        os.remove(path)
    subprocess.run([CHROME, '--headless', '--disable-gpu', f'--window-size={PW},{PH}',
                    '--virtual-time-budget=2800', f'--screenshot={path}', url],
                   capture_output=True)
    return os.path.exists(path)


def _report_frame(th, label, d, shot_ok, holes=frozenset()):
    """Print one frame's line. Returns True when the frame is clean."""
    tag = th + (' ' + label if label else '')
    if d is None:
        print(f'  {tag:26s} : PROBE FAILED')
        return False
    if d.get('fail'):
        print(f"  {tag:26s} : PROBE FAILED — {d['fail']}")
        return False
    flags = []
    # A surviving hole or sc-* tag means the frame did not render. This is the class that
    # put an unresolved {{variantTag}} on a board nobody had looked at, so it is named
    # first and in caps: it must not read as one more measurement nit.
    if d.get('holes'):
        flags.append('UNRESOLVED TEMPLATE ' + ' '.join(d['holes']))
    if d.get('sc'):
        flags.append('UNEXPANDED ' + ' '.join('<%s>' % t for t in d['sc']))
    vals = d.get('vals')
    if vals and str(vals[0]).startswith('<renderVals threw'):
        flags.append('RENDERVALS THREW ' + vals[0])
    elif vals:
        # `not vals` means no reachable Component — true for every --engine=paint render,
        # which builds from the markup between </helmet> and </x-dc> and so never carries
        # the board's script. Treating that as "supplies nothing" would flag every hole.
        missing = sorted(holes - set(vals))
        if missing:
            flags.append('UNSUPPLIED ' + ' '.join('{{%s}}' % h for h in missing) +
                         ' — renderVals() never provides it; renders blank')
    if d['over']:
        flags.append(f"overflow {d['over'][:2]}")
    if d['small']:
        flags.append(f"small targets {d['small']}")
    # A board that outgrows its canvas.json record is a board the host may CLIP.
    # Found live: Flow rendered 3644 against a declared 1180, so three of the five
    # transitions it exists to specify sat below the cut — and ALL SIX multi-height
    # boards understated themselves, because nothing ever compared the two numbers.
    # The sweep asserted every screen frame was h=844 and never once checked a
    # board's declared frame against its own content.
    # THREE numbers must agree, not two. `$preview` is the one wired to the CAMERA
    # (preview_size() sets the Chrome window from it), and five of the six stale
    # canvas.json records were exact mirrors of it — so an earlier pass corrected the
    # mirror, left the original, and every screenshot of those boards stayed 2-37%
    # short. Field's bottom 585px had never been inside a capture.
    rec = _record_h(_CUR_BOARD)
    prev = _PREVIEW_H.get(_CUR_BOARD)
    for label, val in (('ARTBOARD RECORD', rec), ('$preview', prev)):
        if val is not None and abs(val - d['h']) > 1:
            flags.append(f"{label} {val} != rendered {d['h']} — "
                         f"{'canvas.json may clip this board' if label.startswith('ARTBOARD') else 'the screenshot is cut short'}")
    print(f"  {tag:26s} : {d['topLevel']} top-level, h={d['h']}, "
          f"{d.get('txt', 0)}ch/{d.get('sig', '-')}" +
          (('  ⚠ ' + '; '.join(flags)) if flags else '  clean') +
          ('' if shot_ok else '   [SHOT FAILED]'))
    # A screenshot that never wrote must not report PASS: the README's whole
    # thesis is that the screenshot is what catches a silent restructure.
    return not flags and shot_ok


_REC_H = None
_CUR_BOARD = ''


def _record_h(board):
    """The height canvas.json declares for this board, or None if unrecorded.

    Read once and cached. A missing or unparseable manifest must NOT fail a render:
    canvas.json was in fact unparseable at HEAD (unescaped quotes inside a string
    value), which is precisely why nothing had ever compared these two numbers.
    """
    global _REC_H
    if _REC_H is None:
        _REC_H = {}
        try:
            with io.open(os.path.join(CANVAS, 'canvas.json'), encoding='utf-8') as fh:
                for a in json.load(fh).get('artboards', []):
                    _REC_H[a.get('file', '')] = a.get('h')
        except Exception as e:
            # A guard that disables itself in silence is the defect it exists to catch.
            # canvas.json WAS unparseable at HEAD, which is why nothing had ever compared
            # these numbers -- so this path is not hypothetical.
            print('  ⚠ manifest unreadable (%s) — ARTBOARD RECORD arm disabled' % e)
    nm = board if board.endswith('.dc.html') else board + '.dc.html'
    return _REC_H.get(nm)


def check(board, field=None, sweep=False, engine='dc', themes=('light', 'dark')):
    name = board.replace('.dc.html', '')
    global _CUR_BOARD
    _CUR_BOARD = board
    src = io.open(os.path.join(CANVAS, board), encoding='utf-8').read()
    PW, PH = preview_size(src, board)
    body = src[src.index('<div class="qi"') if '<div class="qi"' in src
               else src.index('<div class="doc"'):src.index('</x-dc>')]

    print(f'=== {name} ===')
    bal = tag_balance(body)
    print('  tag balance   :', 'BALANCED' if not bal else f'IMBALANCED {bal}')
    cb = css_balance(src)
    print('  css braces    :', 'BALANCED' if cb == 0 else f'IMBALANCED (delta {cb})')
    ok = not bal and cb == 0

    if engine == 'paint':
        # Legacy path. It cannot render a variant — paint.build() ignores every prop but
        # theme/field — so a sweep here would silently emit N identical frames.
        if sweep:
            print('  NOTE          : --engine=paint cannot render variants; baseline only.')
        for th in themes:
            p = paint_mod().build(board, field, th)
            s = io.open(p, encoding='utf-8').read()
            s = re.sub(r'<script>\s*window\.addEventListener.*?</script>', '', s, flags=re.S)
            io.open(p, 'w', encoding='utf-8').write(s.replace('</body>', PROBE + '</body>'))
            u = _url(p)
            d = _dump(u, PW, PH)
            shot = os.path.join(OUT, f'check-{name}-{th}.png')
            ok = _report_frame(th, '', d, _shot(u, PW, PH, shot)) and ok
        print('  ==>', 'PASS' if ok else 'NEEDS ATTENTION')
        return ok

    decl = declared_props(src)
    overrides = {'field': field} if field and 'field' in decl else {}
    frames = sweep_axes(decl, themes, overrides) if decl else \
        [(th, '', {'theme': th}) for th in themes]
    if not sweep:
        # Default invocation: baseline only, both themes — the same two frames, under the
        # same two screenshot names, that this printed before the sweep existed.
        frames = [f for f in frames if f[1] == '']

    os.makedirs(OUT, exist_ok=True)
    staged = stage(board)

    holes = source_holes(src)

    def render(th, label, props):
        """Render one frame, report it, shoot it. Returns the probe dict."""
        nonlocal ok
        u = _url(staged, props)
        d = _dump(u, PW, PH)
        shot = os.path.join(OUT, f'check-{name}-{th}{"-" + label if label else ""}.png')
        ok = _report_frame(th, label, d, _shot(u, PW, PH, shot), holes) and ok
        return d

    results = [(th, label, props, render(th, label, props)) for th, label, props in frames]
    # Axes the escalation proves are wired despite colliding with the baseline at the
    # other props' defaults. Their collision is expected and must not read as a defect.
    proven_wired = set()
    n = len(results)

    if sweep and decl:
        base_sig = {th: d.get('sig') for th, lbl, p, d in results if not lbl and d}
        by_label = {(th, lbl): d for th, lbl, p, d in results if lbl and d}
        axes = sorted({lbl.split('=', 1)[0] for th, lbl in by_label})

        # The single most revealing option of each axis — the one that paints the most
        # visible text. Reused below so escalation stays O(axes) instead of the product.
        revealing = {}
        for (th, lbl), d in by_label.items():
            ax, opt = lbl.split('=', 1)
            if d.get('txt', 0) > revealing.get(ax, ('', -1))[1]:
                revealing[ax] = (opt, d.get('txt', 0))

        # An axis where EVERY option reproduces the baseline exactly is suspect: either the
        # prop is not wired up, or its effect is occluded at the other props' defaults.
        # Consent's `platform` is the second case — it only rewrites copy inside .secbody,
        # which is display:none until `open` is non-default. A one-axis sweep alone would
        # call that dead and be wrong, so suspects get a bounded second pass rather than a
        # verdict: pair the suspect axis with each OTHER axis's most revealing option.
        for ax in axes:
            opts = [(th, lbl, d) for (th, lbl), d in by_label.items() if lbl.startswith(ax + '=')]
            if not opts or any(d.get('sig') != base_sig.get(th) for th, lbl, d in opts):
                continue
            partners = [(a, revealing[a][0]) for a in axes if a != ax and a in revealing]
            if not partners:
                print(f'  ⚠ DEAD AXIS   : {ax} — every option renders identically to the baseline')
                ok = False
                continue
            print(f'  escalating    : {ax} has no visible effect at the other props\' defaults')
            woke = []
            for p_ax, p_opt in partners:
                for th, lbl, _ in opts:
                    opt = lbl.split('=', 1)[1]
                    props = dict(next(p for t, l, p, d in results if t == th and l == lbl))
                    props[p_ax] = p_opt
                    lab = f'{lbl}+{p_ax}={p_opt}'
                    d = render(th, lab, props)
                    n += 1
                    ref = by_label.get((th, f'{p_ax}={p_opt}'))
                    if d and ref and d.get('sig') != ref.get('sig'):
                        woke.append(lab)
            if woke:
                # Only NOW is the axis proven wired. Its collision with the baseline at the
                # other props' defaults is therefore expected, and must not also be
                # reported as a duplicate — the tool would contradict its own output.
                proven_wired.add(ax)
                print(f'  ==> {ax} is wired; it differentiates under ' +
                      ', '.join(sorted({w.split("+", 1)[1] for w in woke})))
            else:
                print(f'  ⚠ DEAD AXIS   : {ax} — no pairing changed the render')
                ok = False

    if sweep:
        # THE ASSERTION THE TOOL WAS MISSING. It computed a sig per frame, printed it,
        # and never compared two. An option rendering identically to another -- or to
        # the baseline -- passed clean, which is worse than no sweep: it manufactures
        # coverage and everyone stops looking.
        #
        # Escalation frames (label contains '+') are excluded: they are deliberate
        # negative controls and are EXPECTED to collide with the axis frame they probe.
        for th in themes:
            seen = {}
            for (t2, lbl2, _pr, d2) in results:
                if t2 != th or not d2 or '+' in lbl2:
                    continue
                if lbl2.split('=', 1)[0] in proven_wired:
                    continue
                sig = d2.get('sig')
                if sig is None:
                    continue
                if sig in seen:
                    a2 = seen[sig] or '(baseline)'
                    b2 = lbl2 or '(baseline)'
                    print(f'  \u26a0 DUPLICATE   : {th} {a2} == {b2} '
                          f'\u2014 same render under two names')
                    ok = False
                else:
                    seen[sig] = lbl2
        # A label identical across light and dark means the theme collapsed for that
        # state. `theme` is never swept as an axis, so nothing else can see this.
        by_lbl = {}
        for (t2, lbl2, _pr, d2) in results:
            if d2 and d2.get('sig') is not None:
                by_lbl.setdefault(lbl2, {})[t2] = d2['sig']
        for lbl2, m2 in by_lbl.items():
            if len(m2) > 1 and len(set(m2.values())) == 1:
                print(f'  \u26a0 THEME DEAD  : {lbl2 or "(baseline)"} '
                      f'renders identically in light and dark')
                ok = False
        print(f'  frames        : {n}')
    print('  ==>', 'PASS' if ok else 'NEEDS ATTENTION')
    return ok


if __name__ == '__main__':
    args = sys.argv[1:]
    sweep = '--sweep' in args
    strict = '--strict' in args
    do_all = '--all' in args
    engine = 'dc'
    for a in args:
        if a.startswith('--engine='):
            engine = a.split('=', 1)[1]
    pos = [a for a in args if not a.startswith('--')]

    if do_all:
        boards = sorted(os.path.basename(p) for p in glob.glob(os.path.join(CANVAS, '*.dc.html')))
        results = {b.replace('.dc.html', ''): check(b, None, sweep, engine) for b in boards}
        bad = [k for k, v in results.items() if not v]
        print('\n' + '=' * 60)
        print(f'{len(results) - len(bad)}/{len(results)} boards clean' +
              (f' — NEEDS ATTENTION: {", ".join(bad)}' if bad else ''))
        sys.exit(1 if (bad and strict) else 0)

    b = pos[0] if pos else 'You'
    f = pos[1] if len(pos) > 1 else None
    good = check(b if b.endswith('.dc.html') else b + '.dc.html', f, sweep, engine)
    # Exit code stays 0 by default: callers of the pre-existing invocation never saw a
    # non-zero exit and some may chain on it. --strict opts into CI semantics.
    sys.exit(0 if good or not strict else 1)
