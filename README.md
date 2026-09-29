# Ruby: Inline Translate Japanese

A Chrome extension (Manifest V3) that shows English translations or furigana above Japanese words on
any website. Everything runs locally: text is split into words with kuromoji and glossed from JMdict.

## Layout

| Path | What it is |
| --- | --- |
| `manifest.json` | Extension manifest |
| `src/background.js` | Service worker: tokenizes text and picks glosses; loads the dictionaries on demand |
| `src/content.js`, `src/content.css` | Finds Japanese on pages and renders the `<ruby>` annotations |
| `src/popup.*` | Settings popup |
| `src/welcome.*` | First-run page: data disclosure and consent (required by the Chrome Web Store) |
| `lib/kuromoji.js`, `dict/*.dat.gz` | kuromoji tokenizer and its IPADIC dictionary |
| `dict/jmdict.json` | English glosses, generated from JMdict by `tools/build-dict.js` |
| `store/` | Store listing text, images, and privacy policy (not part of the extension package) |

## Try it

Open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose this folder.

## Updating the dictionary

The JMdict licence requires the data to be updated regularly. Rebuild it before every release and at
least every three months:

```bash
node tools/build-dict.js
```

This downloads the latest JMdict, regenerates `dict/jmdict.json` and records the JMdict version in
`THIRD_PARTY_NOTICES.md`.

## Releasing

1. Raise `"version"` in `manifest.json`.
2. Update the dictionary (above).
3. Build the package (PowerShell):
   ```powershell
   & "$env:SystemRoot\System32\tar.exe" -a -c -f ruby.zip manifest.json src lib dict icons THIRD_PARTY_NOTICES.md
   ```
4. Upload `ruby.zip` in the Chrome Web Store developer dashboard. Listing text, image order and the
   Privacy tab answers are in `store/listing.md`.

## Licenses

Third-party data and software, and their licenses, are listed in `THIRD_PARTY_NOTICES.md`.
