// brain.js — resilient composer + streaming (full)

const API = typeof browser !== "undefined" ? browser : chrome;

/** Safe background ping; ignore if bg not ready */
function sendUp(payload) {
  try { API.runtime.sendMessage({ t: "brain.stream", from: "brain", ...payload }, () => void 0); }
  catch (_) {}
}

/* =========================
   FINDERS
   ========================= */
function findComposerRaw(doc = document) {
  // Textarea variants (new + old)
  const ta =
    doc.querySelector('textarea[data-testid="prompt-textarea"]') ||
    doc.querySelector('textarea[placeholder*="ask anything" i]') ||
    doc.querySelector('form textarea') ||
    doc.querySelector('textarea');

  // Contenteditable variants (some builds use CE instead of textarea)
  const ce =
    doc.querySelector('[contenteditable="true"][role="textbox"]') ||
    doc.querySelector('[role="textbox"][contenteditable="true"]') ||
    doc.querySelector('[contenteditable="true"]');

  // Send button variants
  const sendBtn =
    doc.querySelector('button[data-testid="send-button"]') ||
    doc.querySelector('form button[type="submit"]') ||
    doc.querySelector('button[aria-label*="send" i]');

  return { ta, ce, sendBtn, doc };
}

function findComposerDeep() {
  const r = findComposerRaw(document);
  if (r.ta || r.ce) return r;

  // search iframes if present
  for (const f of document.querySelectorAll('iframe')) {
    try {
      const d = f.contentDocument || f.contentWindow?.document;
      if (!d) continue;
      const rr = findComposerRaw(d);
      if (rr.ta || rr.ce) return rr;
    } catch {}
  }
  return { ta: null, ce: null, sendBtn: null, doc: document };
}

async function waitForComposer(timeoutMs = 8000, pollMs = 120) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = findComposerDeep();
    if (r.ta || r.ce) return r;
    await new Promise(r => setTimeout(r, pollMs));
  }
  return findComposerDeep();
}

/* =========================
   INPUT / EVENTS
   ========================= */
function nativeSet(el, text) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype :
    el instanceof HTMLInputElement   ? HTMLInputElement.prototype   :
                                       HTMLElement.prototype;
  const d = Object.getOwnPropertyDescriptor(proto, "value");
  if (d && d.set) d.set.call(el, text); else el.value = text;
}
function emitBeforeInput(el, text) {
  try {
    el.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true, cancelable: true, inputType: "insertText", data: text, composed: true
    }));
  } catch {}
}
function emitInput(el) {
  try { el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true })); }
  catch { el.dispatchEvent(new Event("input", { bubbles: true })); }
}
function pressEnter(target) {
  const ev = t => new KeyboardEvent(t, { key: "Enter", code: "Enter", bubbles: true, cancelable: true });
  target.dispatchEvent(ev("keydown"));
  target.dispatchEvent(ev("keypress"));
  target.dispatchEvent(ev("keyup"));
}

// Write to BOTH models (textarea and CE) to keep UI + draft in sync
function writeToComposer({ ta, ce, doc }, text) {
  if (ta) {
    ta.focus();
    emitBeforeInput(ta, text);
    nativeSet(ta, text);
    emitInput(ta);
  }
  if (ce) {
    ce.focus();
    try {
      const sel = doc.getSelection();
      const rng = doc.createRange();
      rng.selectNodeContents(ce);
      sel.removeAllRanges(); sel.addRange(rng);
      document.execCommand("insertText", false, text);
    } catch { ce.textContent = text; }
    emitBeforeInput(ce, text);
    emitInput(ce);
  }
}

function isEnabled(btn) {
  if (!btn) return false;
  const aria = btn.getAttribute("aria-disabled");
  return !btn.disabled && !(aria && aria !== "false");
}
async function waitReady(target, btn, ms = 1200) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (btn && isEnabled(btn)) return true;
    // Keep re-notifying React
    emitInput(target);
    await new Promise(r => setTimeout(r, 40));
  }
  return false;
}

/* =========================
   TYPE + SEND (robust)
   ========================= */
async function injectAndSend(text) {
  const comp = await waitForComposer();
  const { ta, ce, sendBtn, doc } = comp;
  if (!ta && !ce) return { ok: false, reason: "composer-not-found" };
  const target = ta || ce;

  // Phase 1: update both models
  writeToComposer(comp, text);

  // Phase 2: allow paint (React commit) before sending
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

  // Phase 3: send (click if enabled; else form submit; else Enter)
  const ready = await waitReady(target, sendBtn, 1500);
  await sendNow(target, ready ? sendBtn : null);
  return { ok: true };
}

function pointerClick(el) {
  const mk = (type) => new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 });
  el.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, buttons: 1 }));
  el.dispatchEvent(mk("mousedown"));
  el.dispatchEvent(mk("mouseup"));
  el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, buttons: 1 }));
  el.click(); // final safety
}

function nearestFormFrom(el) {
  return el?.closest?.("form") || document.querySelector("form");
}

async function sendNow(target, sendBtn) {
  // 1) prefer explicit send button if enabled
  if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute("aria-disabled") !== "true") {
    try { pointerClick(sendBtn); return true; } catch {}
  }
  // 2) submit the form (works even when button logic changes)
  const form = nearestFormFrom(sendBtn || target);
  if (form) {
    try { form.requestSubmit ? form.requestSubmit() : form.submit(); return true; } catch {}
  }
  // 3) keyboard fallback
  pressEnter(target);
  return true;
}

/* =========================
   ASSISTANT WATCH
   ========================= */
let replyObserver = null, streamTimer = null, endDebounce = null;
let watching = false, baselineCount = 0, targetNode = null, lastSent = "";

function assistantNodes() {
  const nodes = [
    ...document.querySelectorAll('[data-message-author-role="assistant"]'),
    ...document.querySelectorAll('[data-testid="conversation-turn"][data-role="assistant"]'),
    ...document.querySelectorAll('article:has([data-testid="assistant-avatar"])'),
    ...document.querySelectorAll('.assistant, [data-role="assistant"]')
  ];
  return Array.from(new Set(nodes));
}
function visibleText(node) {
  const c = node.cloneNode(true);
  c.querySelectorAll('button, nav, menu, textarea, input, [contenteditable="false"]').forEach(n => n.remove());
  return (c.innerText || c.textContent || "").trim();
}
function stopWatch() {
  watching = false;
  targetNode = null;
  lastSent = "";
  if (replyObserver) { replyObserver.disconnect(); replyObserver = null; }
  if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
  if (endDebounce) { clearTimeout(endDebounce); endDebounce = null; }
}
function finishIfStable() {
  if (!targetNode) return;
  const txt = visibleText(targetNode);
  sendUp({ event: "end", text: txt || "" });
  stopWatch();
}
function startNextReplyWatch() {
  stopWatch();
  baselineCount = assistantNodes().length;
  watching = true;
  sendUp({ event: "start" });

  replyObserver = new MutationObserver(() => {
    if (!watching) return;
    const nodes = assistantNodes();
    if (nodes.length <= baselineCount) return;

    if (!targetNode) {
      targetNode = nodes[nodes.length - 1];
      sendUp({ event: "lock" });

      streamTimer = setInterval(() => {
        if (!targetNode) return;
        const txt = visibleText(targetNode);
        if (txt !== lastSent) {
          lastSent = txt;
          sendUp({ event: "update", text: txt });
        }
      }, 150);
    }

    clearTimeout(endDebounce);
    endDebounce = setTimeout(finishIfStable, 1000);
  });

  replyObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
}

/* =========================
   BRIDGE
   ========================= */
API.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (!msg || msg.scope !== "brain") return;

    if (msg.cmd === "say") {
      startNextReplyWatch();                 // start before sending
      const res = await injectAndSend(msg.text || "");
      return sendResponse(res);
    }
    if (msg.cmd === "get") {
      const nodes = assistantNodes();
      const last = nodes[nodes.length - 1];
      const t = last ? visibleText(last) : "";
      return sendResponse({ ok: !!t, text: t });
    }
    if (msg.cmd === "status") {
      const { ta, ce } = await waitForComposer(1000);
      return sendResponse({ ok: !!(ta || ce) });
    }
    if (msg.cmd === "watch") {
      if (msg.on) startNextReplyWatch(); else stopWatch();
      return sendResponse({ ok: true });
    }
  })().catch(() => sendResponse && sendResponse({ ok: false }));
  return true; // async
});
