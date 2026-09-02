/* ---------------------------------------------------------------------------
 * support.js — a repo-local renderer for the .dc.html boards in this directory.
 *
 * READ THIS BEFORE TRUSTING IT.
 *
 * This is NOT the original Design Components runtime. That tool authored these
 * boards and is not in this repository; its full API is not recoverable from
 * what is here. `scripts/design/paint.py` is not a reference implementation
 * either — it hardcodes per-board fixtures (Connect's rows, Genesis's ticks,
 * Pulse's source labels) and strips every remaining <sc-if> wholesale, because
 * it only ever needed to produce a measurable render, not a faithful one.
 *
 * What this file IS: a renderer reconstructed from the 23 committed boards by
 * enumerating every construct they actually use, and nothing else. The complete
 * observed surface is:
 *
 *     <x-dc>                        23 boards
 *     <helmet>                      23 boards   — hoisted into <head>
 *     {{hole}}                      23 boards   — 21 distinct names
 *     <sc-if value="{{flag}}">       4 boards
 *     <sc-for list="{{xs}}" as="row"> 1 board   — Connect, with {{row.*}}
 *     class Component extends DCLogic + renderVals()   23 boards
 *     this.props                    23 boards
 *     this.state                     0 boards   — deliberately unimplemented
 *
 * The `hint-placeholder-val` and `hint-placeholder-count` attributes are editor
 * hints in the original tool. They are ignored here, on purpose: guessing what
 * they did to a render is exactly the approximation this file is meant to avoid.
 *
 * So: the boards open and render correctly under this. Anything a board does
 * NOT already use is unimplemented rather than guessed. If a future board needs
 * a construct that is not in the list above, add it here deliberately — do not
 * assume this file already matches the original tool's behaviour, because there
 * is no way to check that from inside this repository.
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';

  // The base class every board's inline script extends. Boards only ever read
  // this.props and only ever define renderVals(), so that is all this carries.
  window.DCLogic = function DCLogic(props) { this.props = props || {}; };
  window.DCLogic.prototype.renderVals = function () { return {}; };

  function parseProps(scriptEl) {
    var raw = scriptEl.getAttribute('data-props');
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (e) {
      console.error('[support] data-props is not valid JSON', e);
      return {};
    }
  }

  // Prop values resolve as: ?query override → declared default → undefined.
  // The query override is what makes the theme/field chips work.
  function resolveProps(decl) {
    var q = new URLSearchParams(location.search), out = {};
    Object.keys(decl).forEach(function (k) {
      if (k.charAt(0) === '$') return;            // $preview and friends are metadata
      var d = decl[k] || {};
      out[k] = q.has(k) ? q.get(k) : d.default;
    });
    return out;
  }

  function truthy(v) {
    if (v === undefined || v === null) return false;
    if (typeof v === 'string') return v !== '' && v !== 'false';
    if (Array.isArray(v)) return v.length > 0;
    return Boolean(v);
  }

  function fill(str, vals, prefix) {
    return str.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, function (m, key) {
      var k = key;
      if (prefix) {
        if (k.indexOf(prefix + '.') !== 0) return m;   // not ours; a later pass takes it
        k = k.slice(prefix.length + 1);
      }
      var cur = prefix ? vals : vals;
      k.split('.').forEach(function (part) { cur = (cur == null) ? cur : cur[part]; });
      return (cur === undefined || cur === null) ? '' : String(cur);
    });
  }

  // Order is load-bearing: repeat first so {{row.*}} exists, then prune the
  // conditionals, then fill what is left. Doing holes first would substitute
  // into branches that are about to be deleted.
  function expand(html, vals) {
    html = html.replace(
      /<sc-for\s+list="\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}"\s+as="([a-zA-Z0-9_]+)"[^>]*>([\s\S]*?)<\/sc-for>/g,
      function (m, listName, as, tpl) {
        var list = vals[listName];
        if (!Array.isArray(list)) return '';
        return list.map(function (item) { return fill(tpl, item, as); }).join('');
      });

    html = html.replace(
      /<sc-if\s+value="\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}"[^>]*>([\s\S]*?)<\/sc-if>/g,
      function (m, flag, inner) { return truthy(vals[flag]) ? inner : ''; });

    return fill(html, vals, null);
  }

  function chips(decl, props) {
    var keys = Object.keys(decl).filter(function (k) {
      return k.charAt(0) !== '$' && decl[k] && decl[k].editor === 'enum' && decl[k].options;
    });
    if (!keys.length) return;
    var bar = document.createElement('div');
    bar.setAttribute('data-dc-chips', '');
    bar.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:99999;display:flex;gap:10px;' +
      'flex-wrap:wrap;font:500 11px ui-monospace,monospace;background:#fff;color:#14163A;' +
      'border:1px solid rgba(20,22,58,.2);border-radius:10px;padding:7px 9px;box-shadow:0 2px 10px rgba(0,0,0,.12)';
    keys.forEach(function (k) {
      var wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;align-items:center;gap:5px';
      wrap.appendChild(document.createTextNode(k));
      var sel = document.createElement('select');
      sel.style.cssText = 'font:inherit;padding:2px 4px';
      decl[k].options.forEach(function (o) {
        var op = document.createElement('option');
        op.value = o; op.textContent = o;
        if (String(props[k]) === String(o)) op.selected = true;
        sel.appendChild(op);
      });
      sel.addEventListener('change', function () {
        var q = new URLSearchParams(location.search);
        q.set(k, sel.value);
        location.search = q.toString();
      });
      wrap.appendChild(sel);
      bar.appendChild(wrap);
    });
    document.body.appendChild(bar);
  }

  function boot() {
    var root = document.querySelector('x-dc');
    if (!root) return;

    // <helmet> carries the stylesheet links the board needs; it must reach <head>
    // before the body is painted or the first frame renders unstyled.
    var helmet = root.querySelector('helmet');
    if (helmet) {
      Array.prototype.slice.call(helmet.children).forEach(function (n) {
        document.head.appendChild(n);
      });
      helmet.remove();
    }

    var scriptEl = document.querySelector('script[data-dc-script]');
    var decl = scriptEl ? parseProps(scriptEl) : {};
    var props = resolveProps(decl);

    // `class Component extends DCLogic {}` in a classic script creates a LEXICAL
    // global binding, not a property on window — so window.Component is undefined
    // and must never be used to find it. The bare identifier resolves correctly.
    var Ctor = null;
    try { if (typeof Component === 'function') Ctor = Component; } catch (e) { /* not defined */ }

    var vals = props;
    if (Ctor) {
      try {
        vals = new Ctor(props).renderVals() || {};
      } catch (e) {
        console.error('[support] Component.renderVals() threw', e);
      }
    }

    var html = expand(root.innerHTML, vals);
    var host = document.createElement('div');
    host.innerHTML = html;
    root.replaceWith(host);

    var left = host.innerHTML.match(/\{\{[^}]+\}\}|<sc-(if|for)\b/g);
    if (left) console.warn('[support] unresolved after render:', left.slice(0, 8));

    chips(decl, props);
  }

  // The board's own <script data-dc-script> is a classic script that defines
  // Component at parse time, and it sits AFTER </x-dc>, so booting on
  // DOMContentLoaded guarantees the class exists by the time we look for it.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
