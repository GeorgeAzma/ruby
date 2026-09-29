'use strict';
// Settings popup. Settings live in chrome.storage and apply to all tabs; on/off is per page and
// is asked from the active tab's content script.

const DEFAULTS = { furigana: false, hoverMode: 'swap', hoverKey: '', size: 60 }; // keep in sync with content.js
const MAC = /Mac/.test(navigator.platform);
const KEY_NAMES = { shift: 'Shift', ctrl: 'Ctrl', alt: MAC ? 'Option' : 'Alt' };
const $ = (id) => document.getElementById(id);
if (MAC) document.querySelector('label[for="key-alt"]').textContent = 'Opt';
let settings = DEFAULTS;

function caption(s) {
  const text = {
    off: 'Annotations are always shown',
    swap: `Hover a word to see its ${s.furigana ? 'English' : 'furigana'}`,
    reveal: `${s.furigana ? 'Furigana' : 'English'} appears only on the word you hover`,
  }[s.hoverMode];
  return s.hoverKey && s.hoverMode !== 'off' ? `${text} while holding ${KEY_NAMES[s.hoverKey]}` : text;
}

function show(s) {
  settings = s;
  $(s.furigana ? 'mode-furigana' : 'mode-english').checked = true;
  $(`hover-${s.hoverMode}`).checked = true;
  $(`key-${s.hoverKey || 'none'}`).checked = true;
  $('hover-caption').textContent = caption(s);
  $('hover-key-row').classList.toggle('disabled', s.hoverMode === 'off');
  $('size').value = s.size;
  $('size').style.setProperty('--p', `${((s.size - 40) / 60) * 100}%`); // filled part of the track
  $('size-value').value = `${s.size}%`;
  // The preview uses content.css, so it looks and behaves like annotated pages
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
for (const radio of document.getElementsByName('hover')) {
  radio.addEventListener('change', () => chrome.storage.local.set({ hoverMode: radio.value }));
}
for (const radio of document.getElementsByName('hover-key')) {
  radio.addEventListener('change', () => chrome.storage.local.set({ hoverKey: radio.value }));
}
$('size').addEventListener('input', (e) => chrome.storage.local.set({ size: Number(e.target.value) }));

// Hovering the preview works like on a page, so each hover mode can be tried here
let pointed = null;
function hoverPreview(e) {
  const active = settings.hoverMode !== 'off' && (!settings.hoverKey || e[`${settings.hoverKey}Key`]);
  for (const r of document.querySelectorAll('.preview ruby.jr')) {
    r.classList.toggle('jr-h', active && r === pointed && settings.hoverMode === 'swap');
    r.classList.toggle('jr-v', active && r === pointed && settings.hoverMode === 'reveal');
  }
}
document.addEventListener('mouseover', (e) => {
  pointed = e.target.closest('.preview ruby.jr');
  hoverPreview(e);
});
for (const type of ['keydown', 'keyup']) document.addEventListener(type, hoverPreview);

// Until the user agrees on the welcome page, offer to finish setup instead of the page switch
chrome.storage.local.get({ consented: false }).then((s) => {
  $('setup').hidden = s.consented;
  $('hero').hidden = !s.consented;
});
$('setup-button').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome.html') }));

chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  try {
    $('on').checked = await chrome.tabs.sendMessage(tab.id, 'state');
    $('on').addEventListener('change', async () => {
      $('on').checked = await chrome.tabs.sendMessage(tab.id, 'toggle');
    });
  } catch {
    // No content script: browser pages, the Web Store, or tabs opened before installing
    $('on').disabled = true;
    $('hero').classList.add('unavailable');
    $('unavailable').hidden = false;
  }
});

// Show the current shortcut keys, which the user may have changed
chrome.commands.getAll().then((commands) => {
  for (const c of commands) {
    const kbd = document.querySelector(`kbd[data-command="${c.name}"]`);
    if (kbd) kbd.textContent = c.shortcut;
  }
});
$('shortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
