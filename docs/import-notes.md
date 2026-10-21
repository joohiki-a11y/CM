# Source import — 2026-10-21

Imported from the four RTF attachments supplied in this conversation. Pandoc converted RTF into UTF-8 plain text with wrapping disabled. Source logic has not been edited in this import/review commit.

| Attachment | Repository path |
|---|---|
| code.gs.rtf | apps-script/code.gs |
| index.html.rtf | apps-script/index.html |
| style.html.rtf | apps-script/style.html |
| app.html.rtf | apps-script/app.html |

The pre-existing repository is `joohiki-a11y/CM`. Its older root `Code.gs`, `index.html`, `app.js`, `config.js` and `styles.css` are a different hosting architecture. They are preserved. The attached version serves HTML from Apps Script with `google.script.run`; its index is not a standalone GitHub Pages page. Do not combine both backends into one Apps Script project because their global functions overlap.

The Apps Script manifest and deployment settings were not provided; no manifest or Script ID has been guessed. Keep any local clasp credentials and `.clasp.json` out of commits. Repository commits do not deploy the running company web app.

## Original attachment SHA-256

- `app.html.rtf`: `817261b2d277e7c8139246ea02a101e542e2c8498e6c1052fbcacee9e07428dd`

- `code.gs.rtf`: `57ee20670ba10548302b75fba5f7162c050daf44d213716108a42adb5b2c6a03`

- `index.html.rtf`: `46f6ece00203e621e33e9ab59c58cd4028ae78dad2b8bc73173db2dab841ce4c`

- `style.html.rtf`: `4bac1485288b37122a84b0b1cd7be485f8ca9f1c94d6f8e17189fbcedf21c48a`
