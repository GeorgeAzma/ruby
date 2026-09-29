<p align="center"><img src="store/promo-marquee-1400x560.png" alt="Ruby: English and furigana above every Japanese word"></p>

# Ruby: Inline Translate Japanese

A Chrome extension that puts English translations or furigana right above Japanese words on any
website. It runs entirely on your computer, works offline, and never sends the pages you read anywhere.

<p>
  <img src="store/screenshot-1-translations.png" width="49%" alt="English above every Japanese word">
  <img src="store/screenshot-2-furigana.png" width="49%" alt="Furigana mode">
  <img src="store/screenshot-3-hover.png" width="49%" alt="Hover to swap or reveal">
  <img src="store/screenshot-4-settings.png" width="49%" alt="Settings panel">
</p>

## Features

- English above every word, with grammar handled: 食べませんでした → "not eat", 行かなければならない → "must go"
- Furigana mode, over the kanji only
- Hover to swap between English and furigana, or show annotations only on the word you hover, with an
  optional hold key
- Adjustable text size, light and dark mode
- Works on dynamic pages and web components, and only processes text near the screen

## Install

Chrome Web Store: coming soon.

To run it from source, open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and
choose this folder.

## Shortcuts

| Keys | Action |
| --- | --- |
| Alt+J | Show or hide annotations on the current page |
| Alt+K | Switch between English and furigana |
| Alt+H | Show annotations only on hover |

Change them at `chrome://extensions/shortcuts`.

## Privacy

Ruby reads page text only on your device to show annotations. It makes no network requests, has no
analytics, and stores only your settings. See the [privacy policy](store/privacy-policy.md).

## Development

- `node tools/build-dict.js` rebuilds `dict/jmdict.json` from the latest JMdict. The JMdict licence
  requires regular updates: the **Update dictionary** workflow does this monthly and prepares a store
  update every three months.
- Store listing text and images are in `store/`.

## Support

If Ruby helps you, you can support it on [Ko-fi](https://ko-fi.com/lumiey).

## License

Copyright © 2026 GeorgeAzma. All rights reserved. The source code is published for reference only; no
license is granted to copy, modify, or redistribute it.

Ruby uses [JMdict](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project) (© EDRDG,
CC BY-SA 4.0) and [kuromoji.js](https://github.com/takuyaa/kuromoji.js) (Apache 2.0). Third-party
licenses are in `THIRD_PARTY_NOTICES.md`; `dict/jmdict.json` is distributed under CC BY-SA 4.0.
