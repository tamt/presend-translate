# PreSend Translate privacy summary

PreSend Translate reads the currently focused editable field only after the user explicitly triggers translation. It does not read incoming messages, scan pages in the background, send messages, or collect analytics.

- Chrome built-in translation keeps field text on the device.
- AI translation sends field text only to the endpoint selected by the user. The extension does not silently switch to another remote provider.
- HTTPS is strongly recommended. If a user explicitly accepts a remote HTTP endpoint, its API key and translated text are unencrypted in transit and may be read or modified by networks between the browser and gateway.
- API keys are stored in local Chrome extension storage. They are not synchronized, injected into web pages, included in exports, or intentionally logged. Local extension storage is not a hardware-backed secret vault.
- Site rules store normalized origins only. The extension does not store per-input fingerprints, field values, placeholders, labels, or surrounding page text.
- Model output is inserted as plain text. The user reviews it and uses the site's normal Send action.

Uninstalling the extension removes its extension storage through Chrome.
