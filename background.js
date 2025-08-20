const API = typeof browser !== "undefined" ? browser : chrome;

async function ensureBrainTab(url) {
  const tabs = await API.tabs.query({ url });
  if (tabs.length) {
    const t = tabs[0];
    await API.tabs.update(t.id, { active: true });
    return t.id;
  }
  const t = await API.tabs.create({ url, active: true });
  return t.id;
}

async function sendToBrain(tabId, payload) {
  return new Promise((resolve) => {
    try {
      API.tabs.sendMessage(tabId, payload, (resp) => resolve(resp || { ok: false, reason: "no-response" }));
    } catch (e) {
      resolve({ ok: false, reason: "no-content-script" });
    }
  });
}

API.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    // --- brain control ---
    if (msg?.t === "brain.set") {
      const id = await ensureBrainTab(msg.url);
      await API.storage.local.set({ brainUrl: msg.url, brainTabId: id });
      return sendResponse({ ok: true, brainTabId: id });
    }

    if (msg?.t === "brain.say" || msg?.t === "brain.get" || msg?.t === "brain.status" || msg?.t === "brain.watch") {
      let { brainTabId, brainUrl } = await API.storage.local.get(["brainTabId", "brainUrl"]);
      if (!brainTabId && brainUrl) {
        brainTabId = await ensureBrainTab(brainUrl);
        await API.storage.local.set({ brainTabId });
      }
      if (!brainTabId) return sendResponse({ ok: false, reason: "brain-not-set" });

      const payload = { scope: "brain" };
      if (msg.t === "brain.say")   { payload.cmd = "say";   payload.text = msg.text; }
      if (msg.t === "brain.get")   { payload.cmd = "get"; }
      if (msg.t === "brain.status"){ payload.cmd = "status"; }
      if (msg.t === "brain.watch") { payload.cmd = "watch"; payload.on = !!msg.on; }

      const resp = await sendToBrain(brainTabId, payload);
      return sendResponse(resp);
    }

    // --- stream relay (content → panel) ---
    if (msg?.t === "brain.stream" && msg.from === "brain") {
      API.runtime.sendMessage({ t: "brain.stream", event: msg.event, text: msg.text || "", note: msg.note || "" });
      return sendResponse({ ok: true });   // respond to avoid “went out of scope”
    }

    // If not handled, answer explicitly to avoid warnings
    return sendResponse({ ok: false, reason: "unhandled" });
  })().catch((e) => sendResponse({ ok: false, reason: String(e) }));

  return true; // keep sendResponse alive for async branches
});
