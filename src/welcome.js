'use strict';
// First-run page: Ruby reads page text, so it only starts after the user agrees
// (Chrome Web Store User Data Policy: prominent disclosure and consent in the extension's own UI).

const $ = (id) => document.getElementById(id);

function showDone() {
  $('consent').hidden = true;
  $('done').hidden = false;
}

chrome.storage.local.get({ consented: false }).then((s) => s.consented && showDone());
$('agree').addEventListener('click', () => chrome.storage.local.set({ consented: true }).then(showDone));

chrome.commands.getAll().then((commands) => {
  for (const c of commands) {
    const kbd = document.querySelector(`kbd[data-command="${c.name}"]`);
    if (kbd) kbd.textContent = c.shortcut || 'not set';
  }
});
