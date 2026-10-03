'use strict';
// Reader page: annotates text the user pastes, for places Ruby can't reach (PDFs, apps). The text
// only goes to the service worker for analysis and is never stored.

const DEFAULTS = { furigana: false, hoverMode: 'swap', hoverKey: '', size: 60 }; // keep in sync with content.js
const $ = (id) => document.getElementById(id);
let settings = DEFAULTS;

function show(s) {
  settings = s;
  $(s.furigana ? 'mode-furigana' : 'mode-english').checked = true;
  const root = document.documentElement;
  root.toggleAttribute('data-jr-furigana', s.furigana);
  root.toggleAttribute('data-jr-reveal', s.hoverMode === 'reveal');
  root.style.setProperty('--jr-size', s.size / 100);
}

chrome.storage.local.get(DEFAULTS).then(show);
chrome.storage.onChanged.addListener(() => chrome.storage.local.get(DEFAULTS).then(show));
for (const radio of document.getElementsByName('mode')) {
  radio.addEventListener('change', () => chrome.storage.local.set({ furigana: radio.value === 'furigana' }));
}

function rt(text) {
  const el = document.createElement('rt');
  el.dataset.t = text;
  return el;
}

// One line of text as the same markup content.js puts in pages
function paragraph(segs) {
  const p = document.createElement('p');
  for (const s of segs) {
    if (typeof s === 'string') {
      p.append(s);
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
    p.append(r);
  }
  return p;
}

function note(text) {
  const div = document.createElement('div');
  div.className = 'empty';
  div.textContent = text;
  $('result').replaceChildren(div);
}

let seq = 0;
async function update() {
  const text = $('text').value;
  $('count').textContent = text ? `${text.length.toLocaleString()} characters` : '';
  $('clear').disabled = !text;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const id = ++seq;
  if (!lines.length) return note('Annotated text appears here as you type');
  if ($('result').querySelector('.empty')) note('Loading…'); // the dictionary takes a moment the first time
  const res = await chrome.runtime.sendMessage({ texts: lines.map((l) => ['', l, '']) }).catch(() => null);
  if (id !== seq) return; // the text changed while this was being analyzed
  if (!res) return note('Something went wrong. Try reloading this page.');
  $('result').replaceChildren(...res.map(paragraph));
}

function fit() {
  const t = $('text');
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight}px`;
}

let timer = 0;
$('text').addEventListener('input', (e) => {
  fit();
  if (e.isComposing) return; // wait for the IME to finish the word
  clearTimeout(timer);
  timer = setTimeout(update, 150);
});
$('text').addEventListener('compositionend', update);
addEventListener('resize', fit);
$('clear').addEventListener('click', () => {
  $('text').value = '';
  fit();
  update();
  $('text').focus();
});

// Hovering works like on a page
let pointed = null;
function hover(e) {
  const active = settings.hoverMode !== 'off' && (!settings.hoverKey || e[`${settings.hoverKey}Key`]);
  for (const r of $('result').querySelectorAll('ruby.jr')) {
    r.classList.toggle('jr-h', active && r === pointed && settings.hoverMode === 'swap');
    r.classList.toggle('jr-v', active && r === pointed && settings.hoverMode === 'reveal');
  }
}
document.addEventListener('mouseover', (e) => {
  pointed = e.target.closest('#result ruby.jr');
  hover(e);
});
for (const type of ['keydown', 'keyup']) {
  document.addEventListener(type, (e) => {
    // Releasing Alt on its own focuses Chrome's menu (Windows) unless the page handles it
    if (pointed && settings.hoverKey === 'alt' && e.key === 'Alt') e.preventDefault();
    hover(e);
  });
}

update();
