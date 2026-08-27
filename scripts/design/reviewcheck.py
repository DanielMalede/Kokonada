"""Verify a docs/review/NN-*.html file against the method's hard requirements.
Renders it in headless Chrome, measures every frame, and drives every decision
option to prove it changes the assembled frame. Usage: python reviewcheck.py <file>"""
import io, os, re, sys, json, subprocess, pathlib
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.environ.get('KOKO_PROBE_OUT') or os.path.join(ROOT, '.design-probe')
CHROME = os.environ.get('CHROME') or r"C:\Program Files\Google\Chrome\Application\chrome.exe"
os.makedirs(OUT, exist_ok=True)

PROBE = r"""<script>
window.addEventListener('load',function(){setTimeout(function(){
 var R={frames:0,sizes:{},themes:{},overflow:[],chromatic:[],combos:0,dead:[],offline:[],errs:[]};
 try{
  document.querySelectorAll('.ph,.bd').forEach(function(f){
    R.frames++;
    var b=f.getBoundingClientRect();
    var k=Math.round(b.width)+'x'+Math.round(b.height); R.sizes[k]=(R.sizes[k]||0)+1;
    var th=f.getAttribute('data-t')||f.getAttribute('data-theme')||'?'; R.themes[th]=(R.themes[th]||0)+1;
    var fb=f.getBoundingClientRect();
    // Only IN-FLOW content counts. Absolutely-positioned decorative layers are meant to
    // spill and are clipped; scrollHeight cannot tell those apart from real overflow.
    var worst=0, who='';
    f.querySelectorAll('*').forEach(function(el){
      var cs=getComputedStyle(el);
      if(cs.position==='absolute'||cs.position==='fixed')return;
      if(cs.display==='none'||cs.visibility==='hidden')return;
      var r=el.getBoundingClientRect();
      if(r.height===0)return;
      // Content inside a scroll/clip container is scrolled, not overflowing.
      var clipped=false;
      for(var a=el.parentElement; a && a!==f; a=a.parentElement){
        var ac=getComputedStyle(a);
        if(ac.overflow!=='visible'||ac.overflowY!=='visible'){clipped=true;break;}
      }
      if(clipped)return;
      if(r.bottom>fb.bottom+1 && r.bottom-fb.bottom>worst){
        worst=Math.round(r.bottom-fb.bottom);
        who=(el.textContent||'').trim().replace(/\s+/g,' ').slice(0,22)||el.tagName;}
    });
    if(worst>0)
      R.overflow.push((f.getAttribute('data-label')||'frame')+' '+th+' +'+worst+'px "'+who+'"');
  });
  function px(v){
    if(!v)return null;
    var c=v.match(/color\(srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)(?:\s*\/\s*([\d.eE+-]+))?\)/);
    if(c){if(c[4]!==undefined&&parseFloat(c[4])===0)return null;
      return {r:Math.round(parseFloat(c[1])*255),g:Math.round(parseFloat(c[2])*255),b:Math.round(parseFloat(c[3])*255)};}
    var m=v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if(!m)return null;var a=m[4]===undefined?1:parseFloat(m[4]);if(a===0)return null;
    return {r:+m[1],g:+m[2],b:+m[3]};}
  function note(c,p){var ch=Math.max(c.r,c.g,c.b)-Math.min(c.r,c.g,c.b); if(ch<60)return;
    var hx='#'+[c.r,c.g,c.b].map(function(x){return('0'+x.toString(16)).slice(-2)}).join('').toUpperCase();
    if(R.chromatic.indexOf(hx+' '+p)<0)R.chromatic.push(hx+' '+p);}
  var SH={path:1,circle:1,rect:1,line:1,polygon:1,polyline:1,ellipse:1,text:1};
  document.querySelectorAll('.ph *,.bd *').forEach(function(el){
    var cs=getComputedStyle(el);
    if(cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity)===0)return;
    var isS=!!SH[el.tagName.toLowerCase()];
    ['backgroundColor','color','borderTopColor','fill','stroke'].forEach(function(p){
      var c=px(cs[p]); if(!c)return;
      if(p==='fill'&&!isS)return;
      if(p==='stroke'&&(!isS||parseFloat(cs.strokeWidth||'0')===0))return;
      if(p==='borderTopColor'&&!parseFloat(cs.borderTopWidth||'0'))return;
      if(p==='color'&&!(el.childNodes.length&&[].some.call(el.childNodes,function(n){
        return n.nodeType===3&&n.textContent.trim();})))return;
      note(c,p);
    });
    var bg=cs.backgroundImage;
    if(bg&&bg!=='none')(bg.match(/color\(srgb[^)]*\)|rgba?\([^)]*\)/g)||[]).forEach(function(s){
      var c=px(s); if(c)note(c,'gradient');});
  });
  document.querySelectorAll('[src],[href]').forEach(function(el){
    var u=el.getAttribute('src')||el.getAttribute('href')||'';
    if(/^(https?:)?\/\//i.test(u)) R.offline.push(el.tagName+' '+u.slice(0,60));
  });
  var live=document.getElementById('live-light');
  var BASES=(window.__BASES__||['structure']);
  var rows={};
  document.querySelectorAll('input[type=radio]').forEach(function(r){(rows[r.name]=rows[r.name]||[]).push(r);});
  var names=Object.keys(rows);
  var saved={}; names.forEach(function(n){rows[n].forEach(function(r){if(r.checked)saved[n]=r.value;});});
  function pick(n,v){rows[n].forEach(function(r){if(r.value===v){r.checked=true;
    r.dispatchEvent(new Event('change',{bubbles:true}));}});}
  function snap(){return live?live.innerHTML:'';}
  function combos(list){ // cartesian over the base rows present
    var out=[{}]; list.forEach(function(bn){ if(!rows[bn])return;
      var next=[]; out.forEach(function(acc){ rows[bn].forEach(function(r){
        var o={}; for(var k in acc)o[k]=acc[k]; o[bn]=r.value; next.push(o); }); }); out=next; });
    return out; }
  var baseCombos=combos(BASES);
  names.forEach(function(n){
    baseCombos.forEach(function(bc){
      if(BASES.indexOf(n)>=0 && Object.keys(bc).length>1){} // still exercise it
      var tag=[]; for(var k in bc){ if(k!==n){ pick(k,bc[k]); tag.push(bc[k]); } }
      var seen={};
      rows[n].forEach(function(r){
        pick(n,r.value); R.combos++;
        var h=snap();
        var lf=live.firstChild;
        if(lf&&lf.getBoundingClientRect){
          var lb=lf.getBoundingClientRect(), w2=0, who2='';
          lf.querySelectorAll('*').forEach(function(el){
            var cs=getComputedStyle(el);
            if(cs.position==='absolute'||cs.position==='fixed')return;
            if(cs.display==='none'||cs.visibility==='hidden')return;
            var rr=el.getBoundingClientRect();
            if(rr.height===0)return;
            var clip=false;
            for(var an=el.parentElement; an && an!==lf; an=an.parentElement){
              var anc=getComputedStyle(an);
              if(anc.overflow!=='visible'||anc.overflowY!=='visible'){clip=true;break;}
            }
            if(clip)return;
            if(rr.bottom>lb.bottom+1 && rr.bottom-lb.bottom>w2){
              w2=Math.round(rr.bottom-lb.bottom);
              who2=(el.textContent||'').trim().replace(/\s+/g,' ').slice(0,20)||el.tagName;}
          });
          if(w2>0) R.overflow.push('LIVE '+tag.join('/')+'/'+n+'='+r.value+' +'+w2+'px "'+who2+'"');
        }
        for(var k in seen){if(seen[k]===h)R.dead.push((tag.length?tag.join('/')+'/':'')+n+'='+r.value+' == '+k);}
        seen[r.value]=h;
      });
      pick(n,saved[n]);
    });
    for(var k in saved)pick(k,saved[k]);
  });
  R.dead=R.dead.filter(function(v,i,a){return a.indexOf(v)===i;});
  R.overflow=R.overflow.filter(function(v,i,a){return a.indexOf(v)===i;});
 }catch(e){R.errs.push(String(e&&e.message||e));}
 document.title='CHK'+JSON.stringify(R);
},900)});
</script>"""

src = sys.argv[1]
s = io.open(src, encoding='utf-8').read()
p = os.path.join(OUT, 'chk-' + os.path.basename(src))
bases = sys.argv[2] if len(sys.argv) > 2 else 'structure'
inject = '<script>window.__BASES__=' + json.dumps(bases.split(',')) + '</script>'
io.open(p, 'w', encoding='utf-8').write(s.replace('</body>', inject + PROBE + '</body>'))
r = subprocess.run([CHROME, '--headless', '--disable-gpu', '--window-size=1400,2000',
                    '--virtual-time-budget=4000', '--dump-dom', pathlib.Path(p).as_uri()],
                   capture_output=True, text=True, encoding='utf-8', errors='replace')
m = re.search(r'<title>CHK(\{.*?\})</title>', r.stdout, re.S)
if not m:
    print('PROBE DID NOT RUN')
    sys.exit(1)
R=json.loads(m.group(1))
summary={k:(len(v) if isinstance(v,list) else v) for k,v in R.items()}
print(json.dumps(summary, indent=1))
for k in ('overflow','dead','offline','errs'):
    for x in R.get(k,[])[:400]: print(' ',k.upper(),x)
