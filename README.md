# PreSend Translate

PreSend Translate is a Chrome Manifest V3 extension that translates text in the focused input before the user sends it. It never submits the page's form or sends a message.

## Project files

- `references/`: reference images and other source material supplied for the project.
- `extension/`: loadable Chrome extension package and all runtime source.
- `extension/manifest.json`, `extension/background.js`, `extension/content.js`: extension runtime.
- `extension/popup.html`, `extension/options.html`, `extension/ui.css`: current-site controls and full settings UI.
- `extension/rules.js`, `extension/providers.js`: rule precedence and OpenAI-compatible AI translation adapter.
- `extension/tests/`: dependency-free unit checks.

## Run locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select the `extension` folder inside this project.
4. Focus a text field on a normal `http` or `https` page. A small `译` button appears inside its upper-right corner; click it to translate that field.
5. Keyboard translation is optional and has no assumed default. Assign one from the browser's extension-shortcuts page if desired.
5. Open the extension settings to add and test an AI service if Chrome built-in translation is unavailable.

Run the following commands from `extension/`:

```powershell
npm test
npm run check
```

The first command runs rule and provider unit tests. The second runs JavaScript syntax checks plus the unit tests.
