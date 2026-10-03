# Chrome Web Store listing

Everything to paste into the developer dashboard. Images are in this folder.

## Store listing tab

**Title** (from manifest.json): Ruby: Inline Translate Japanese

**Summary** (manifest.json `description`, max 132 characters):
English translations or furigana right above every Japanese word, on any website. Private and fully offline.

**Category:** Education
**Language:** English

**Description:**

```
Ruby puts English right above Japanese, word by word, on any website.

Reading Japanese online? Ruby adds a short English translation above every Japanese word, right in the page, the same way furigana sits above kanji. No copying and pasting, no switching tabs. Just read.

WHAT IT DOES
• English above every word, with grammar understood: 食べませんでした shows "not eat", 行かなければならない shows "must go", 読んでください shows "please read".
• Furigana mode: switch to readings above the kanji with Alt+K.
• Hover to swap: hover a word to see its furigana, or its English in furigana mode.
• Reveal mode: hide all annotations and show only the word you hover. Great for practice. Toggle it with Alt+H.
• Optional hold key: make hovering work only while Shift, Ctrl or Alt is held.
• Reader: paste Japanese from PDFs, apps or anywhere else and see it annotated the same way.
• Adjustable text size, dark mode, and a clean settings panel.
• Turn it off on any site with Alt+J or from the popup; Ruby remembers.

FAST AND PRIVATE
Everything runs on your computer. Ruby has its Japanese dictionary built in, so it works offline, needs no account, and never sends the pages you read anywhere. Only text near your screen is processed, so even long pages stay fast.

KEYBOARD SHORTCUTS
Alt+J: turn Ruby on or off for this site
Alt+K: switch between English and furigana
Alt+H: reveal mode (annotations only on hover)
Open the Reader: not set by default
Change them any time at chrome://extensions/shortcuts

GOOD TO KNOW
Translations come from a dictionary: each word gets its most likely meaning in context, so Ruby is a reading aid rather than a full sentence translator. Names are shown in romaji.

SUPPORT RUBY
Ruby is free, with no ads or tracking. If it helps you, you can support it at ko-fi.com/lumiey

CREDITS
Dictionary: JMdict, © Electronic Dictionary Research and Development Group, used under CC BY-SA 4.0.
Word splitting: kuromoji.js (Apache 2.0) with mecab-ipadic.
```

**Images** (upload in this order):

| Field | File |
| --- | --- |
| Screenshot 1 | screenshot-1-translations.png |
| Screenshot 2 | screenshot-2-furigana.png |
| Screenshot 3 | screenshot-3-hover.png |
| Screenshot 4 | screenshot-4-settings.png |
| Screenshot 5 | screenshot-5-grammar.png |
| Small promo tile (required) | promo-small-440x280.png |
| Marquee promo tile (optional) | promo-marquee-1400x560.png |

The store icon is taken from the package (icons/128.png).

## Privacy tab

**Single purpose:**
Shows English translations or furigana above Japanese words on the web pages the user reads.

**Permission justification, storage:**
Saves the user's display settings (English or furigana, hover behavior, hold key, text size), the sites where they turned Ruby off, and whether they have agreed to the welcome page disclosure, on their device.

**Host permission justification:**

```
Ruby shows English translations or furigana above Japanese words on the pages the user reads. To do this, its content script must read the page's text and insert annotations next to the words. Japanese text can appear on any website (news, blogs, shops, social media, Wikipedia), so the content script needs to run on all sites; it only acts on pages that contain Japanese.

All processing happens locally: the dictionary and word splitter are bundled with the extension. Page content is never stored, logged, or sent anywhere, and the extension makes no network requests. The only data saved is the user's display settings, in chrome.storage.

A narrower permission such as activeTab would not work, because it would require the user to click the extension on every page, while Ruby is meant to annotate Japanese automatically as they browse. Users can turn it off on any site with Alt+J or from the popup.
```

**Remote code:** No, I am not using remote code.

**Data usage:** tick **Website content** only. Page text is read and processed on the device to show the annotations; Google counts on-device processing as handling user data. Leave every other type unchecked, then tick all three certifications (no selling or transfer to third parties, no use unrelated to the single purpose, no use for creditworthiness or lending).

**Privacy policy URL:** the Gist of `privacy-policy.md`.

Ruby also shows the required in-product disclosure: on install, `src/welcome.html` explains the data handling and Ruby does nothing until the user clicks "Agree and start".

## Account (Account tab of the dashboard)

- Verify the contact email and turn on 2-Step Verification.
- Declare **trader or non-trader** status (EU requirement). A personal, non-commercial project is usually non-trader; a business is a trader, and its contact details are verified and shown.

## Editing the images

`assets.html` holds all seven designs; open it with `#shot1` to `#shot5`, `#tile` or `#marquee` to see
one. Annotations in it were generated by the extension itself, so change headlines freely but keep the
Japanese as is. To render an image again (PowerShell, from this folder):

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --headless=new --hide-scrollbars --blink-settings=preferredColorScheme=1 --window-size=1280,800 --virtual-time-budget=8000 --screenshot="$PWD\screenshot-1-translations.png" "file:///$($PWD -replace '\\','/')/assets.html#shot1"
```

Use `--window-size=440,280` for `#tile` and `--window-size=1400,560` for `#marquee`.
