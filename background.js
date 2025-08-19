const API = typeof browser !== "undefined" ? browser : chrome;

API.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.t === "goto") {
      await API.tabs.update(msg.tabId, { url: msg.url });
    }

    if (msg.t === "createTab") {
      const props = msg.url ? { url: msg.url } : {};
      if (Number.isInteger(msg.opener)) props.openerTabId = msg.opener;
      await API.tabs.create(props);
    }

    if (msg.t === "listTabs") {
      const win = await API.windows.getCurrent({ populate: true });
      const tabs = (win.tabs || []).map(t => ({
        id: t.id, index: t.index, active: t.active, title: t.title || "", url: t.url || ""
      }));
      return sendResponse(tabs);
    }

    if (msg.t === "activateTab") {
      await API.tabs.update(msg.id, { active: true });
    }

    if (msg.t === "activateByIndex") {
      const win = await API.windows.getCurrent({ populate: true });
      const tab = (win.tabs || []).find(t => t.index === msg.index);
      if (tab) await API.tabs.update(tab.id, { active: true });
    }

    if (msg.t === "cycleTab") {
      const win = await API.windows.getCurrent({ populate: true });
      const tabs = (win.tabs || []).sort((a,b)=>a.index-b.index);
      const cur = tabs.findIndex(t => t.active);
      if (cur >= 0) {
        const next = (cur + (msg.dir>0?1:-1) + tabs.length) % tabs.length;
        await API.tabs.update(tabs[next].id, { active: true });
      }
    }

    if (msg.t === "closeTab") {
      await API.tabs.remove(msg.id);
    }

    if (msg.t === "createWindow") {
      const props = {};
      if (msg.url) props.url = msg.url;
      await API.windows.create(props);
    }
  })();

  // MV3 service worker requires returning true for async sendResponse
  return true;
});
