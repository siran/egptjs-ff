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
      API.tabs.sendMessage(tabId, payload, (resp) =>
        resolve(resp || { ok: false, reason: "no-response" })
      );
    } catch (e) {
      resolve({ ok: false, reason: "no-content-script" });
    }
  });
}

API.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    // ---------- NAV / TABS / WINDOWS ----------
    if (msg?.t === "goto") {
      try { await API.tabs.update(msg.tabId, { url: msg.url }); return sendResponse({ ok: true }); }
      catch (e) { return sendResponse({ ok: false, reason: String(e) }); }
    }

    if (msg?.t === "createTab") {
      try {
        const props = msg.url ? { url: msg.url } : {};
        if (Number.isInteger(msg.opener)) props.openerTabId = msg.opener;
        await API.tabs.create(props);
        return sendResponse({ ok: true });
      } catch (e) { return sendResponse({ ok: false, reason: String(e) }); }
    }

    if (msg?.t === "listTabs") {
      try {
        const win = await API.windows.getCurrent({ populate: true });
        const tabs = (win.tabs || []).map(t => ({
          id: t.id, index: t.index, active: t.active, title: t.title || "", url: t.url || ""
        }));
        return sendResponse({ ok: true, tabs });
      } catch (e) { return sendResponse({ ok: false, reason: String(e) }); }
    }

    if (msg?.t === "activateTab") {
      try { await API.tabs.update(msg.id, { active: true }); return sendResponse({ ok: true }); }
      catch (e) { return sendResponse({ ok: false, reason: String(e) }); }
    }

    if (msg?.t === "activateByIndex") {
      try {
        const win = await API.windows.getCurrent({ populate: true });
        const tab = (win.tabs || []).find(t => t.index === msg.index);
        if (!tab) return sendResponse({ ok: false, reason: "index-not-found" });
        await API.tabs.update(tab.id, { active: true });
        return sendResponse({ ok: true });
      } catch (e) { return sendResponse({ ok: false, reason: String(e) }); }
    }

    if (msg?.t === "cycleTab") {
      try {
        const win = await API.windows.getCurrent({ populate: true });
        const tabs = (win.tabs || []).sort((a,b)=>a.index-b.index);
        const cur = tabs.findIndex(t => t.active);
        if (cur < 0) return sendResponse({ ok: false, reason: "no-active-tab" });
        const next = (cur + (msg.dir > 0 ? 1 : -1) + tabs.length) % tabs.length;
        await API.tabs.update(tabs[next].id, { active: true });
        return sendResponse({ ok: true });
      } catch (e) { return sendResponse({ ok: false, reason: String(e) }); }
    }

    if (msg?.t === "closeTab") {
      try { await API.tabs.remove(msg.id); return sendResponse({ ok: true }); }
      catch (e) { return sendResponse({ ok: false, reason: String(e) }); }
    }

    if (msg?.t === "createWindow") {
      try {
        const props = msg.url ? { url: msg.url } : {};
        await API.windows.create(props);
        return sendResponse({ ok: true });
      } catch (e) { return sendResponse({ ok: false, reason: String(e) }); }
    }

    // ---------- BRAIN CONTROL ----------
    if (msg?.t === "brain.set") {
      try {
        const id = await ensureBrainTab(msg.url);
        await API.storage.local.set({ brainUrl: msg.url, brainTabId: id });
        return sendResponse({ ok: true, brainTabId: id });
      } catch (e) { return sendResponse({ ok: false, reason: String(e) }); }
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

    // ---------- STREAM RELAY ----------
    if (msg?.t === "brain.stream" && msg.from === "brain") {
      API.runtime.sendMessage({ t: "brain.stream", event: msg.event, text: msg.text || "", note: msg.note || "" });
      return sendResponse({ ok: true });
    }

    // Unhandled
    return sendResponse({ ok: false, reason: "unhandled" });
  })().catch(e => sendResponse({ ok: false, reason: String(e) }));

  return true; // keep sendResponse alive
});
