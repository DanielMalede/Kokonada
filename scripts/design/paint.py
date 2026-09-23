"""Enumerate what a board ACTUALLY paints, from computed styles on the rendered DOM.
Never greps source for token names. Usage: python paint.py <Board> [field] [theme]"""
import io, os, re, sys, json, subprocess, glob, shutil
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
# scripts/design/<tool>.py -> repo root. The canvas is tracked at docs/canvas, and the
# probe output is disposable, so it goes to a gitignored dir rather than beside the source.
ROOT = os.path.dirname(os.path.dirname(HERE))
CANVAS = os.environ.get('KOKO_CANVAS') or os.path.join(ROOT, 'docs', 'canvas')
OUT = os.environ.get('KOKO_PROBE_OUT') or os.path.join(ROOT, '.design-probe')
CHROME = os.environ.get('CHROME') or r"C:\Program Files\Google\Chrome\Application\chrome.exe"
os.makedirs(OUT, exist_ok=True)
# the boards read ONE shared token sheet; it must sit beside the rendered copy
shutil.copy(os.path.join(CANVAS, 'tokens.css'), os.path.join(OUT, 'tokens.css'))
# ...and the display face the sheet @font-face's by a RELATIVE url. General Sans is a
# Fontshare cut, not a Google one, so the <helmet> link cannot supply it: without this
# copy the probe silently renders every heading in the Manrope fallback and measures a
# board nobody ships. Copy it or the fix is invisible exactly where it is measured.
shutil.copy(os.path.join(CANVAS, 'GeneralSans-Semibold.otf'), os.path.join(OUT, 'GeneralSans-Semibold.otf'))

# Genesis renders three states off one board; the fixture must supply them or the
# probe silently measures a board with its copy and two of three ticks stripped.
GENESIS_VALS = {
    '{{say}}': 'Sitting with the shape of it.',
    '{{tick2}}': 'var(--accent)',
    '{{tick3}}': 'var(--bartrack)',
    '{{tick3outline}}': '1px solid var(--track)',
}

PULSE_VALS = {'{{sourceLabel}}': 'Garmin', '{{sourceFresh}}': 'synced 4 min ago'}

CONNECT_ROWS = [("Spotify", "Unavailable", "Connecting Spotify isn't available in Kokonada right now."),
                ("YouTube Music", "Not yet available", "Coming once our Google review is complete.")]

PROBE = r"""<script>
window.addEventListener('load',function(){setTimeout(function(){
 var root=document.querySelector('.qi')||document.querySelector('.doc');
 var seen=[];
 function px(v){
   if(!v)return null;
   var c=v.match(/color\(srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)(?:\s*\/\s*([\d.eE+-]+))?\)/);
   if(c){var ca=c[4]===undefined?1:parseFloat(c[4]);if(ca===0)return null;
     return {r:Math.round(parseFloat(c[1])*255),g:Math.round(parseFloat(c[2])*255),
             b:Math.round(parseFloat(c[3])*255),a:ca};}
   var m=v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
   if(!m)return null;var a=m[4]===undefined?1:parseFloat(m[4]);if(a===0)return null;
   return {r:+m[1],g:+m[2],b:+m[3],a:a};}
 function hex(c){return '#'+[c.r,c.g,c.b].map(function(x){return ('0'+x.toString(16)).slice(-2)}).join('').toUpperCase();}
 function chroma(c){return Math.max(c.r,c.g,c.b)-Math.min(c.r,c.g,c.b);}
 function label(el){
   var t=(el.textContent||'').trim().replace(/\s+/g,' ').slice(0,34);
   return el.tagName.toLowerCase()+(t?(' "'+t+'"'):'')+(el.className&&typeof el.className==='string'?(' .'+el.className.split(' ')[0]):'');
 }
 var SHAPES={path:1,circle:1,rect:1,line:1,polygon:1,polyline:1,ellipse:1,text:1};
 var PROPS=['backgroundColor','color','borderTopColor','borderBottomColor','borderLeftColor','borderRightColor','fill','stroke','outlineColor'];
 root.querySelectorAll('*').forEach(function(el){
   var cs=getComputedStyle(el);
   if(cs.display==='none'||cs.visibility==='hidden')return;
   var op=parseFloat(cs.opacity); if(op===0)return;
   var tag=el.tagName.toLowerCase();
   var isShape=!!SHAPES[tag];
   PROPS.forEach(function(p){
     var raw=cs[p]; if(!raw||raw==='none')return;
     var c=px(raw); if(!c)return;
     if(p.indexOf('border')===0){
       var w=parseFloat(cs[p.replace('Color','Width')]||'0'); if(!w)return;
       var st=cs[p.replace('Color','Style')]; if(st==='none'||st==='hidden')return;
     }
     // SVG paint only counts on actual shapes, and stroke only when it is drawn
     if(p==='fill'&&!isShape)return;
     if(p==='stroke'){ if(!isShape)return; if(parseFloat(cs.strokeWidth||'0')===0)return; }
     if(p==='outlineColor'){ if(cs.outlineStyle==='none')return; if(parseFloat(cs.outlineWidth||'0')===0)return; }
     if(p==='color'&&!(el.childNodes.length&&[].some.call(el.childNodes,function(n){return n.nodeType===3&&n.textContent.trim()})))return;
     if(p==='backgroundColor'&&c.a<0.02)return;
     seen.push({prop:p,hex:hex(c),alpha:+c.a.toFixed(3),chroma:chroma(c),el:label(el)});
   });
   // gradients carry colour too
   var bg=cs.backgroundImage;
   if(bg&&bg!=='none'){
     var stops=bg.match(/color\(srgb[^)]*\)|rgba?\([^)]*\)/g)||[];
     stops.forEach(function(s){var c=px(s);if(!c)return;
       seen.push({prop:'gradient',hex:hex(c),alpha:+c.a.toFixed(3),chroma:chroma(c),el:label(el)});});
   }
 });
 document.title='PAINT'+JSON.stringify(seen);
},520)});
</script>"""


def build(board, field=None, theme='light'):
    src = io.open(os.path.join(CANVAS, board), encoding='utf-8').read()
    helmet = re.search(r'<helmet>(.*?)</helmet>', src, re.S).group(1)
    body = re.search(r'</helmet>(.*?)</x-dc>', src, re.S).group(1)
    if board == 'Connect.dc.html':
        body = re.sub(r'<sc-if value="\{\{isIntended\}\}".*?</sc-if>', '', body, flags=re.S)
        m = re.search(r'<sc-for list="\{\{musicRows\}\}".*?>(.*?)</sc-for>', body, re.S)
        if m:
            tpl = m.group(1); rows = ''
            for n, st, w in CONNECT_ROWS:
                rows += re.sub(r'<sc-if.*?</sc-if>', '',
                               tpl.replace('{{row.name}}', n).replace('{{row.status}}', st).replace('{{row.why}}', w), flags=re.S)
            body = body[:m.start()] + rows + body[m.end():]
        for k, v in (('{{title}}', 'Set up your sound.'),
                     ('{{subtitle}}', 'Connect what you have \u2014 or start with just your mood. You can change any of this later.'),
                     ('{{ctaLabel}}', 'Continue with mood only'),
                     ('{{ctaNote}}', 'You can add a wearable later in Profile.')):
            body = body.replace(k, v)
    if board == 'Genesis.dc.html':
        # keep the slow-state note the sc-if guards
        body = re.sub(r'<sc-if value="\{\{isSlow\}\}"[^>]*>(.*?)</sc-if>', lambda mm: mm.group(1), body, flags=re.S)
        for k, v in GENESIS_VALS.items():
            body = body.replace(k, v)
    if board == 'Pulse.dc.html':
        for k, v in PULSE_VALS.items():
            body = body.replace(k, v)
    body = body.replace('{{theme}}', theme)
    if field:
        body = body.replace('{{field}}', field)
    body = re.sub(r'<sc-if.*?</sc-if>', '', body, flags=re.S)
    body = re.sub(r'\{\{[^}]*\}\}', '', body)
    p = os.path.join(OUT, board.replace('.dc.html', '') + '-' + theme + '.html')
    io.open(p, 'w', encoding='utf-8').write(
        '<!doctype html><html><head><meta charset="utf-8">' + helmet + '</head><body style="margin:0">' + body + PROBE + '</body></html>')
    return p


def run(path):
    r = subprocess.run([CHROME, '--headless', '--disable-gpu', '--window-size=390,844',
                        '--virtual-time-budget=2800', '--dump-dom', 'file:///' + path.replace('\\', '/')],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    m = re.search(r'<title>PAINT(\[.*?\])</title>', r.stdout, re.S)
    return json.loads(m.group(1)) if m else []


def report(board, field=None, themes=('light', 'dark')):
    print('=' * 92)
    print(f"PAINTED — {board.replace('.dc.html','')}" + (f"  (field={field})" if field else ''))
    print('=' * 92)
    for th in themes:
        seen = run(build(board, field, th))
        agg = {}
        for s in seen:
            k = (s['hex'], s['chroma'])
            agg.setdefault(k, {'n': 0, 'props': set(), 'els': []})
            agg[k]['n'] += 1
            agg[k]['props'].add(s['prop'])
            if len(agg[k]['els']) < 3 and s['el'] not in agg[k]['els']:
                agg[k]['els'].append(s['el'])
        chromatic = {k: v for k, v in agg.items() if k[1] >= 60}
        print(f"\n  [{th}]  {len(agg)} distinct colours painted, {len(chromatic)} carrying an accent hue (chroma>=60)")
        for (hx, ch), v in sorted(agg.items(), key=lambda kv: -kv[1]['n']):
            tag = 'ACCENT   ' if ch >= 60 else 'neutral  '
            print(f"    {hx}  chroma {ch:3d}  {tag}  x{v['n']:<3d} {'/'.join(sorted(v['props']))[:34]:34s} {v['els'][0][:40]}")
            for e in v['els'][1:]:
                print(f"{'':66s}{e[:40]}")


if __name__ == '__main__':
    b = sys.argv[1] if len(sys.argv) > 1 else 'Onboarding'
    f = sys.argv[2] if len(sys.argv) > 2 else None
    report(b if b.endswith('.dc.html') else b + '.dc.html', f)
