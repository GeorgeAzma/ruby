'use strict';
// Annotates Japanese words on the page with <ruby>: an English gloss above each word, or furigana
// in furigana mode. Analysis happens in the service worker; this script finds text and renders it.
//
// Each annotated text node T gets a <jp-w> wrapper inserted before it, and T is emptied rather
// than removed. Frameworks that hold a reference to T (React, Vue...) can keep updating or
// removing it; the MutationObserver below keeps the wrapper in sync.

const JP = /[\u3041-\u3096\u30a1-\u30fa\u3400-\u9fff\uf900-\ufaff]/;
const KANA = /[\u3041-\u3096\u30a1-\u30fa]/;
const SKIP = 'script,style,noscript,template,textarea,select,option,ruby,rt,rp,svg,math,code,pre,kbd,samp,jp-w,' +
  '[contenteditable]:not([contenteditable="false"])';
const lang = document.documentElement.lang;

// hoverMode: 'swap' shows the other annotation on hover, 'reveal' hides annotations until hovered, 'off'.
// hoverKey: '', 'shift', 'ctrl' or 'alt'; hover only acts while it is held. size: % of the Japanese text.
const DEFAULTS = { furigana: false, hoverMode: 'swap', hoverKey: '', size: 60 };

let on = false;
let furiganaMode = false;
let hoverMode = DEFAULTS.hoverMode;
let hoverKey = DEFAULTS.hoverKey;
let kanaSeen = /^ja/i.test(lang); // kanji-only text is only annotated on pages that look Japanese
let rendered = false;
let queue = [];

function send(msg) {
  try {
    return chrome.runtime.sendMessage(msg);
  } catch {
    return Promise.reject(); // extension was reloaded; this page's script is orphaned
  }
}

// Only analyze text near the viewport, so long pages stay fast.
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    io.unobserve(e.target);
    for (const n of e.target.childNodes) if (n.nodeType === 3 && !n.jrW && JP.test(n.data)) queue.push(n);
  }
  flush();
}, { rootMargin: '100% 0px' });

// Up to 16 characters of neighbouring inline text, so words split by markup (<b>山田</b>さん)
// are analyzed in context. dir: -1 before, 1 after.
const INLINE = /^(A|ABBR|B|BDI|BDO|CITE|DATA|DEL|DFN|EM|FONT|I|INS|LABEL|MARK|Q|S|SMALL|SPAN|STRONG|SUB|SUP|TIME|U|JP-W)$/;
function context(t, dir) {
  let s = '';
  for (let n = t; n && s.length < 16; ) {
    const sib = dir < 0 ? n.previousSibling : n.nextSibling;
    if (!sib) n = n.parentNode && INLINE.test(n.parentNode.nodeName) ? n.parentNode : null;
    else if (sib.nodeType === 3 || INLINE.test(sib.nodeName)) {
      s = dir < 0 ? sib.textContent + s : s + sib.textContent;
      n = sib;
    } else break;
  }
  return dir < 0 ? s.slice(-16) : s.slice(0, 16);
}

function flush() {
  const nodes = queue.filter((n) => n.parentNode && (KANA.test(n.data) || (kanaSeen && !/^zh/i.test(lang))));
  queue = [];
  for (let i = 0; i < nodes.length; i += 200) {
    const batch = nodes.slice(i, i + 200);
    const texts = batch.map((n) => [context(n, -1), n.data, context(n, 1)]);
    send({ texts }).then((res) => res && batch.forEach((n, k) => render(n, texts[k][1], res[k])), () => {});
  }
}

function rt(text) {
  const el = document.createElement('rt');
  el.dataset.t = text; // shown via CSS ::before, so it never ends up in copied text or textContent
  return el;
}

// segs: plain strings and [word, gloss, furigana] where furigana is [[text, reading], ...] or 0
function render(t, text, segs) {
  if (!on || t.jrW || t.data !== text || !t.parentNode || segs.every((s) => typeof s === 'string')) return;
  const w = document.createElement('jp-w');
  for (const s of segs) {
    if (typeof s === 'string') {
      w.append(s);
      continue;
    }
    const [word, gloss, furi] = s;
    const r = document.createElement('ruby');
    r.className = 'jr';
    if (!furi) r.append(word);
    else {
      for (const [part, reading] of furi) {
        if (!reading) {
          r.append(part);
          continue;
        }
        const f = document.createElement('ruby');
        f.className = 'jf';
        f.append(part, rt(reading));
        r.append(f);
      }
    }
    if (gloss) r.append(rt(gloss));
    w.append(r);
  }
  w.jrT = t;
  w.jrText = text;
  t.jrW = w;
  t.before(w);
  t.data = '';
  rendered = true;
}

// Removes the annotation of text node t; restores its text unless the page already replaced it.
function unwrap(t, restore) {
  const w = t.jrW;
  t.jrW = null;
  w.remove();
  if (restore) t.data = w.jrText;
}

function watch(t) {
  if (!kanaSeen && KANA.test(t.data)) kanaSeen = true;
  io.observe(t.parentNode);
}

function scan(root) {
  const el = root.nodeType === 1 ? root : root.parentElement;
  if (!el || el.closest(SKIP)) return;
  if (root.nodeType === 3) {
    if (!root.jrW && JP.test(root.data)) watch(root);
    return;
  }
  if (root.nodeType !== 1) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, (n) => {
    if (n.nodeType === 3) return JP.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    return n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
  });
  for (let n; (n = walker.nextNode()); ) watch(n);
}

const mo = new MutationObserver((records) => {
  for (const r of records) {
    if (r.type === 'characterData') {
      const t = r.target;
      if (!t.jrW) scan(t);
      else if (t.data) { // the page changed text we annotated
        unwrap(t, false);
        scan(t);
      }
      continue;
    }
    for (const n of r.removedNodes) if (n.jrW) unwrap(n, true);
    for (const n of r.addedNodes) {
      if (n.nodeName === 'JP-W') continue;
      // Something was inserted between an annotation and its (empty) text node: move it back
      const next = n.nextSibling;
      if (next && next.jrW && next.previousSibling !== next.jrW) next.before(next.jrW);
      scan(n);
    }
  }
});

function setOn(value) {
  on = value;
  if (!document.body) return;
  if (on) {
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    scan(document.body);
  } else {
    mo.disconnect();
    io.disconnect();
    queue = [];
    setHovered(null);
    for (const w of document.querySelectorAll('jp-w')) if (w.jrT && w.jrT.jrW === w) unwrap(w.jrT, true);
  }
}

// Hover: .jr-h swaps a word to its other annotation, .jr-v reveals it in reveal mode.
let hovered = null;
let pointed = null; // word under the mouse, whether or not the hover key is held
function setHovered(r) {
  if (r === hovered) return;
  if (hovered) {
    hovered.classList.remove('jr-h', 'jr-v');
    hovered.style.paddingInline = '';
  }
  hovered = r;
  if (!r) return;
  if (hoverMode === 'reveal') return void r.classList.add('jr-v'); // hidden annotations keep their space
  const width = r.getBoundingClientRect().width;
  r.classList.add('jr-h');
  // Keep the word as wide as before so it doesn't shrink out from under the cursor and flicker
  const shrink = width - r.getBoundingClientRect().width;
  if (shrink > 0) r.style.paddingInline = `${shrink / 2}px`;
}

// e: the mouse or key event, which tells whether the hover key is held
function updateHover(e) {
  let r = hoverMode !== 'off' && (!hoverKey || e[`${hoverKey}Key`]) ? pointed : null;
  // Only swap when there is something to swap to
  if (r && hoverMode === 'swap' && !(furiganaMode ? r.lastElementChild.tagName === 'RT' : r.querySelector('ruby'))) r = null;
  setHovered(r);
}

document.addEventListener('mouseover', (e) => {
  if (!rendered) return;
  pointed = e.target.closest ? e.target.closest('ruby.jr') : null;
  updateHover(e);
});
document.addEventListener('mouseout', (e) => {
  if (e.relatedTarget) return;
  pointed = null;
  setHovered(null);
});
for (const type of ['keydown', 'keyup']) {
  document.addEventListener(type, (e) => {
    if (!pointed || !hoverKey) return;
    // Releasing Alt on its own focuses Chrome's menu (Windows) unless the page handles it
    if (hoverKey === 'alt' && e.key === 'Alt') e.preventDefault();
    updateHover(e);
  });
}
addEventListener('blur', () => setHovered(null));

function applySettings(s) {
  const root = document.documentElement;
  if ('furigana' in s) {
    furiganaMode = s.furigana ?? DEFAULTS.furigana;
    root.toggleAttribute('data-jr-furigana', furiganaMode);
  }
  if ('hoverMode' in s) {
    hoverMode = s.hoverMode ?? DEFAULTS.hoverMode;
    root.toggleAttribute('data-jr-reveal', hoverMode === 'reveal');
  }
  if ('hoverKey' in s) hoverKey = s.hoverKey ?? DEFAULTS.hoverKey;
  if ('size' in s) {
    // content.css defaults to 60%, so pages are only touched for other sizes
    const size = s.size ?? DEFAULTS.size;
    if (size === DEFAULTS.size) root.style.removeProperty('--jr-size');
    else root.style.setProperty('--jr-size', size / 100);
  }
  setHovered(null);
}

// Nothing on the page is read until the user has agreed on the welcome page (welcome.html)
let consented = false;
function start() {
  consented = true;
  setOn(true);
}

chrome.storage.local.get({ ...DEFAULTS, consented: false }, (s) => {
  applySettings(s);
  if (s.consented) start();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const s = {};
  for (const k in changes) s[k] = changes[k].newValue;
  applySettings(s);
  if (s.consented && !consented) start();
});

// On/off is per page (Alt+J or the popup); both get the resulting state back
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg === 'toggle' && consented) setOn(!on);
  if (msg === 'toggle' || msg === 'state') reply(on);
});
