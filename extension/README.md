# Tute's browser extension (source)

Don't load this folder in the browser. Tute builds the real extension from it,
adding the icon and `config.js` (how to reach Tute on this PC, with its token):

1. In Tute: Settings → Connections → Browser → **Set up…**
2. It opens `%LOCALAPPDATA%\Tute\extension`. Load *that* folder:
   `edge://extensions` (or `chrome://extensions`) → Developer mode → **Load unpacked**.

After changing the files here, press Set up again, then reload the extension.
