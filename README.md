# RDP Chat Control Extension

A **minimal Firefox/Chromium DevTools extension** that opens a chat-like panel inside DevTools, letting you **control the browser and page with simple commands**.

Built for **long-term MV3 compatibility**:

* **Chromium** uses `background.service_worker`.
* **Firefox** uses `background.scripts` (event page) for temporary installs.

All page interactions are routed through Firefox’s **Remote Debugging Protocol (RDP)** (via `devtools.inspectedWindow.eval`), giving near–full browser control.

---

## ✨ Features

* **Navigation**

  * `goto URL` — navigate current tab.
  * `newtab URL` — open a new tab.
  * `win new URL` — open a new window.
  * `back`, `forward`, `reload`.

* **Tab control**

  * `tab list` — list open tabs.
  * `tab switch N` — activate tab by index.
  * `tab next`, `tab prev` — cycle through tabs.
  * `tab close [id]` — close a tab (default: current).

* **DOM control**

  * `click "text"` — click element by visible text (button, link, label).
  * `open "text"` — open link by visible text in a new tab.
  * `type "selector" text` — type text into an input or contentEditable element.
  * `eval JS` — run arbitrary JavaScript in the page context.

* **Page actions**

  * `scroll 600` — scroll down by 600px.
  * `scroll top` / `scroll bottom`.

---

## 🛠 Installation

### Firefox (Developer Edition / Nightly)

1. Open `about:debugging` → **This Firefox**.
2. Click **Load Temporary Add-on…** → select `manifest.json`.
3. Open DevTools (F12) on any page → find **RDP Chat** panel.

⚠️ Note: Firefox disables `background.service_worker` for temporary add-ons. This repo includes both `background.scripts` (for Firefox dev) and `service_worker` (for Chromium).

### Chromium (Chrome / Edge / Brave)

1. Go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** → select repo folder.
4. Open DevTools → **RDP Chat** panel.

---

## 💬 Example Commands

```txt
eval document.title
goto https://example.org
newtab https://mozilla.org
open "Documentation"
click "Run"
type "input[name=q]" Hello world
tab list
tab switch 3
tab close
scroll bottom
```

---

## 🔍 How it Works

* A **DevTools panel** provides a chat-style UI.
* Commands are parsed and executed:

  * **Browser-level actions** (`tabs.*`, `windows.*`) are handled by the background script.
  * **Page-level actions** (`eval`, `click`, `type`, `scroll`) are executed in the inspected tab via `devtools.inspectedWindow.eval`.
* Firefox pipes these through its **RDP backend**. Chromium uses **CDP**, but both work transparently with the same extension code.

---

## 📦 Repo Structure

```
manifest.json      # Extension manifest (MV3)
background.js      # Background event page / service worker
devtools.html      # DevTools entry
devtools.js        # Creates RDP Chat panel
panel.html         # Chat UI
panel.js           # Command parser + handlers
README.md          # This file
```

---

## 🚀 Roadmap

* [ ] Network logging commands (`net on/off`, `net list`).
* [ ] Element picker for `click`/`open`.
* [ ] Command history (up/down arrows).
* [ ] Scriptable macros.

---

## ⚖️ License

This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute this software, either in source code form or as a compiled binary, for any purpose, commercial or non-commercial, and by any means.

For more information, please refer to [http://unlicense.org/](http://unlicense.org/)
