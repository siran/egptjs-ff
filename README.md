# 🧠 Brain Browser Controller

A developer tool that extends DevTools with a **Brain panel** to control ChatGPT and the browser itself.
You can type commands directly into the panel, automate ChatGPT, and receive streaming responses.

---

## ✨ Features

- **ChatGPT integration**
  - Type messages directly into ChatGPT’s input (fixed sync).
  - Auto-clicks the **send button** to submit.
  - Streams assistant replies live back into the Brain panel.
  - Watcher automatically waits for next assistant reply (no manual “get” required).

- **Browser control**
  - `goto <url>` — navigate reliably (fixed false error bug).
  - `click <selector>` — click buttons or links.
  - `say <text>` — type text into ChatGPT input and auto-send.

- **Developer panel**
  - Appears as **RDP Chat** tab inside browser DevTools.
  - Full log of all commands and results.
  - Clean error handling.

---

## 🚀 Installation

1. Clone this repo.
2. Load it as an **unpacked extension** in Chrome/Firefox:
   - Visit `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked**
   - Select this repo folder
3. Open DevTools → **RDP Chat** tab.
4. Issue commands.

---

## 📝 Example Session

```bash
goto "https://chat.openai.com"
brain set https://chat.openai.com/c/xxxx
brain say "Hello, world!"
````

* Message is typed into ChatGPT’s input box.
* The **send button is auto-clicked**.
* Assistant’s reply streams back into the Brain panel.

---

## 🔧 Command Reference

**`goto "<url>"`**
Navigate the current tab to a new URL.

* Example:

  ```
  goto "https://yahoo.com"
  ```

**`click "<selector>"`**
Click an element using a CSS selector.

* Example:

  ```
  click "button.send"
  ```

**`say "<text>"`**
Type into ChatGPT’s input and auto-submit.

* Example:

  ```
  say "again, hi beibi"
  ```

**`brain set <url>`**
Attach Brain watcher to a ChatGPT conversation.

* Example:

  ```
  brain set https://chat.openai.com/c/xxxx
  ```

**`brain say "<text>"`**
Send a message into the active ChatGPT thread (with auto-send + streaming).

* Example:

  ```
  brain say "What is the meaning of life?"
  ```

---

## ⚙️ Development Notes

* Fixed issue where input text only appeared after reload (textarea now updated via `input` event).
* Fixed `goto` error reporting: only errors if navigation really failed.
* Added watcher that auto-streams assistant replies to panel.
* Command history navigation with ↑ and ↓ supported in Brain panel.
* Clean separation of commands in `panel.js`.

---

## 💡 Roadmap

* More robust `click` selectors (auto-detect buttons/inputs).
* Screenshot and DOM capture commands.
* Scripted macros (`brain run script.js`).
* Extend into **agent-like behavior**:

  ```
  agent "solve the mystery of the universe"
  ```

  This would trigger a back-and-forth loop between ChatGPT and Brain until the task is deemed complete.
* Smarter history search (`↑` to recall previous commands, `Ctrl+R` style search).
* Full bi-directional sync with ChatGPT thread state.

---

## ⚖️ License

**UNLICENSE** — Public Domain.
Do whatever you want with it.
