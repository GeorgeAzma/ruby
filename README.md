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
| `tools/publish.js`, `.github/workflows/` | Automatic dictionary updates and store publishing |

## Try it

Open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose this folder.

## Updating the dictionary

The JMdict licence requires the data to be updated regularly. To rebuild it by hand:

```bash
node tools/build-dict.js
```

This downloads the latest JMdict, regenerates `dict/jmdict.json` and records the JMdict version in
`THIRD_PARTY_NOTICES.md`.

**Automatic updates.** The `Update dictionary` GitHub Action does this every three months (and on
demand from the Actions tab): it rebuilds the dictionary, raises the version, commits, and publishes
the update to the Chrome Web Store with `tools/publish.js`. One-time setup, after the first version is
live in the store:

1. In the [Google Cloud Console](https://console.cloud.google.com), create a project, enable the
   **Chrome Web Store API**, create a **service account**, and download a JSON key for it.
2. In the Chrome Web Store developer dashboard, open **Account** and add the service account's email.
3. In the GitHub repository, go to **Settings > Secrets and variables > Actions** and add:
   - `CWS_SERVICE_ACCOUNT_KEY`: the contents of the JSON key file
   - `CWS_PUBLISHER_ID`: from the dashboard's **Publisher > Settings**
   - `CWS_EXTENSION_ID`: the extension's ID from its store page or the dashboard
4. Run the action once from the **Actions** tab to check it works.

If a run fails, GitHub emails you, so a broken update doesn't go unnoticed.

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
