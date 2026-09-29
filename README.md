# Ruby: Inline Translate Japanese

A Chrome extension that shows English translations or furigana above Japanese words on any website.
Everything runs locally: text is split into words with kuromoji and glossed from JMdict, and nothing
is sent anywhere.

## Features

- A short English gloss above every Japanese word, with grammar handled (食べませんでした → "not eat",
  行かなければならない → "must go")
- Furigana mode, over the kanji only
- Hover to swap between English and furigana, or reveal annotations only on the hovered word, with an
  optional hold key
- Adjustable text size, keyboard shortcuts (Alt+J, Alt+K, Alt+H), light and dark mode
- Works with dynamic pages, and only processes text near the screen, so long pages stay fast

## Layout

| Path | What it is |
| --- | --- |
| `manifest.json` | Extension manifest (Manifest V3) |
| `src/background.js` | Service worker: tokenizes text and picks glosses; loads the dictionaries on demand |
| `src/content.js`, `src/content.css` | Finds Japanese on pages and renders the `<ruby>` annotations |
| `src/popup.*` | Settings popup |
| `src/welcome.*` | First-run page: data disclosure and consent (required by the Chrome Web Store) |
| `lib/kuromoji.js`, `dict/*.dat.gz` | kuromoji tokenizer and its IPADIC dictionary |
| `dict/jmdict.json` | English glosses, generated from JMdict by `tools/build-dict.js` |
| `tools/publish.js`, `.github/workflows/` | Dictionary updates and store publishing |
| `store/` | Store listing text, images and privacy policy (not part of the extension package) |

## Try it

Open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose this folder.

## Dictionary updates

The JMdict licence requires the data to be updated regularly. To rebuild it by hand:

```bash
node tools/build-dict.js
```

This downloads the latest JMdict, regenerates `dict/jmdict.json` and records the JMdict version in
`THIRD_PARTY_NOTICES.md`.

The **Update dictionary** GitHub Action does this every three months, and on demand from the Actions
tab. It rebuilds the dictionary, raises the version, commits, and builds `ruby.zip`. Then:

- **By default** it attaches `ruby.zip` to a GitHub release and opens an issue that notifies you.
  Upload the file in the Chrome Web Store dashboard (Package > Upload new package) and submit it.
- **Optionally** it publishes by itself. After the first version is live in the store:
  1. In the [Google Cloud Console](https://console.cloud.google.com), create a project, enable the
     **Chrome Web Store API**, create a **service account**, and download a JSON key for it.
  2. In the Chrome Web Store developer dashboard, open **Account** and add the service account's email.
  3. In this repository, go to **Settings > Secrets and variables > Actions** and add
     `CWS_SERVICE_ACCOUNT_KEY` (the JSON key's contents), `CWS_PUBLISHER_ID` (dashboard >
     **Publisher > Settings**) and `CWS_EXTENSION_ID` (the extension's ID).

If a run fails, GitHub emails you.

## Releasing by hand

1. Raise `"version"` in `manifest.json`.
2. Rebuild the dictionary (above).
3. Build the package (PowerShell):
   ```powershell
   & "$env:SystemRoot\System32\tar.exe" -a -c -f ruby.zip manifest.json src lib dict icons THIRD_PARTY_NOTICES.md
   ```
4. Upload `ruby.zip` in the Chrome Web Store developer dashboard. Listing text, image order and the
   Privacy tab answers are in `store/listing.md`.

## Support

If Ruby helps you, you can support it on [Ko-fi](https://ko-fi.com/lumiey).

## License

Copyright © 2026 GeorgeAzma. All rights reserved. The source code is published for reference only; no
license is granted to copy, modify, or redistribute it.

Third-party data and software keep their own licenses, listed in `THIRD_PARTY_NOTICES.md`. In
particular, `dict/jmdict.json` is derived from JMdict and distributed under CC BY-SA 4.0.
