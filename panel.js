// panel.js — unified, streaming-enabled

const API = typeof browser !== "undefined" ? browser : chrome;
const log = document.getElementById("log");
const cmd = document.getElementById("cmd");
const currentTabId = API.devtools.inspectedWindow.tabId;

post("sys", `Attached to tab ${currentTabId}. Type "help" for commands.`);

// ---------- UI helpers ----------
function post(kind, text) {
  const p = document.createElement("p");
  p.className = `msg ${kind}`;
  p.textContent = text;
  log.appendChild(p);
  log.scrollTop = log.scrollHeight;
}

function ensureStreamLine() {
  let el = document.getElementById("stream-line");
  if (!el) {
    el = document.createElement("pre");
    el.id = "stream-line";
    el.className = "msg sys";
    el.style.whiteSpace = "pre-wrap";
    el.textContent = "";
    log.appendChild(el);
  }
  return el;
}

// ---------- eval in inspected page ----------
async function evalInPage(expr) {
  try {
    const r = await API.devtools.inspectedWindow.eval(expr);
    // Normalize Firefox/Chrome return shapes
    const payload = Array.isArray(r) ? r[0] : r;
    if (payload && payload.exceptionInfo && payload.exceptionInfo.isException) {
      post("err", `Eval error: ${payload.exceptionInfo.value}`);
      return null;
    }
    return payload?.result ?? payload;
  } catch (e) {
    post("err", String(e));
    return null;
  }
}

// ---------- navigation / tabs / windows ----------
async function newTab(url) {
  await API.runtime.sendMessage({ t: "createTab", url, opener: currentTabId });
  post("sys", `new tab → ${url}`);
}

async function nav(url) {
  const r = await API.runtime.sendMessage({ t: "goto", tabId: currentTabId, url });
  if (r?.ok) {
    post("sys", `navigated → ${url}`);
    return;
  }
  // Fallback: try in-page navigation (works even if bg was reloaded)
  const js = `location.href = ${JSON.stringify(url)}`;
  const out = await evalInPage(js);
  if (out === null && !(r?.ok)) {
    post("err", `goto failed: ${r?.reason || "unknown"}; eval fallback may also have failed.`);
  } else {
    post("sys", `navigated (fallback) → ${url}`);
  }
}


async function listTabs() {
  const tabs = await API.runtime.sendMessage({ t: "listTabs" });
  tabs.sort((a, b) => a.index - b.index);
  tabs.forEach(t => post("sys", `[${t.index}] id=${t.id}${t.active ? " *" : ""}  ${t.title}  ${t.url}`));
}

async function activateTabBy(spec) {
  const msg = /^\d+$/.test(spec)
    ? { t: "activateByIndex", index: Number(spec) }
    : { t: "activateTab", id: Number(spec) };
  await API.runtime.sendMessage(msg);
}

async function closeTab(spec) {
  const msg = spec
    ? { t: "closeTab", id: Number(spec) }
    : { t: "closeTab", id: currentTabId };
  await API.runtime.sendMessage(msg);
}

async function newWindow(url) {
  await API.runtime.sendMessage({ t: "createWindow", url });
}

// ---------- DOM actions ----------
async function pageClickByText(text, mode) {
  const js = `
    (function(q, mode){
      function norm(s){return (s||"").replace(/\\s+/g," ").trim().toLowerCase();}
      function visible(el){ const r=el.getBoundingClientRect(), cs=getComputedStyle(el);
        return r.width>0 && r.height>0 && cs.visibility!=="hidden" && cs.display!=="none"; }
      function firstClickable(el){
        while (el && el!==document.body){
          if (el.matches('a,button,[role="button"],input[type="button"],input[type="submit"],[onclick],*[tabindex]')) return el;
          el = el.parentElement;
        } return null;
      }
      const target = norm(q);

      const cand = Array.from(document.querySelectorAll(
        'a,button,[role="button"],input[type="button"],input[type="submit"],[onclick],*[tabindex]'
      ));

      function textOf(el){
        const lbl = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        const txt = (el.innerText || el.textContent || '');
        return norm([txt,lbl,title].join(' '));
      }

      let best = null;
      for (const el of cand){
        if (!visible(el)) continue;
        const t = textOf(el);
        if (t && (t===target || t.includes(target))) { best = el; break; }
      }
      if (!best){
        const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null);
        while(w.nextNode()){
          const n=w.currentNode; if(!n?.parentElement) continue;
          if (norm(n.textContent).includes(target)){
            const anc=firstClickable(n.parentElement);
            if (anc && visible(anc)){ best=anc; break; }
          }
        }
      }
      if (!best) return {ok:false, reason:'not-found'};
      const a = best.closest('a[href]') || (best.tagName==='A'?best:null);
      const href = a ? (a.href || a.getAttribute('href')) : null;
      if (mode==="href") return {ok:true, href};
      try { best.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); }
      catch(e){ try{ best.click(); }catch(_){} }
      return {ok:true, href};
    })(${JSON.stringify(text)}, ${JSON.stringify(mode)});
  `;
  return await evalInPage(js);
}

async function typeInto(sel, text) {
  const js = `
    (function(sel,val){
      const el = document.querySelector(sel);
      if(!el) throw new Error("selector not found");
      if ("value" in el) {
        el.focus(); el.value = val;
        el.dispatchEvent(new Event("input",{bubbles:true}));
        el.dispatchEvent(new Event("change",{bubbles:true}));
        return "typed";
      }
      if (el.isContentEditable) { el.focus(); el.textContent = val; return "typed CE"; }
      throw new Error("element not editable");
    })(${JSON.stringify(sel)}, ${JSON.stringify(text)});
  `;
  return await evalInPage(js);
}

async function scrollCmd(arg) {
  if (/^top$/i.test(arg)) return evalInPage("window.scrollTo(0,0)");
  if (/^bottom$/i.test(arg)) return evalInPage("window.scrollTo(0,document.body.scrollHeight)");
  const px = parseInt(arg, 10);
  if (!Number.isFinite(px)) return post("err", "scroll <px>|top|bottom");
  return evalInPage(`window.scrollBy(0, ${px})`);
}

// ---------- Brain (ChatGPT tab) ----------
let streamBuf = "";
let streaming = false;

API.runtime.onMessage.addListener((msg) => {
  if (msg.t !== "brain.stream") return;

  if (msg.event === "start") {
    streaming = true; streamBuf = "";
    ensureStreamLine().textContent = "⏳ waiting for assistant…";
  }
  if (msg.event === "lock") {
    ensureStreamLine().textContent = "✍️ assistant is typing…";
  }
  if (msg.event === "update") {
    streaming = true;
    streamBuf = msg.text || "";
    ensureStreamLine().textContent = streamBuf;
  }
  if (msg.event === "end") {
    streaming = false;
    streamBuf = msg.text || streamBuf;
    ensureStreamLine().textContent = streamBuf || "(empty reply)";
    post("sys", "— end of reply —");
  }
});

async function brainSet(url) {
  const r = await API.runtime.sendMessage({ t: "brain.set", url });
  post(r?.ok ? "sys" : "err", r?.ok ? `brain set → tab ${r.brainTabId}` : "brain set failed");
}
async function brainSay(text) {
  // Content script auto-starts watcher before sending
  const r = await API.runtime.sendMessage({ t: "brain.say", text });
  post(r?.ok ? "sys" : "err", r?.ok ? "brain: sent (streaming…)" : `brain error: ${r?.reason || "?"}`);
}
async function brainWatch(on) {
  const r = await API.runtime.sendMessage({ t: "brain.watch", on });
  post(r?.ok ? "sys" : "err", r?.ok ? (on ? "watch ON" : "watch OFF") : "watch failed");
}
async function brainGet() {
  const r = await API.runtime.sendMessage({ t: "brain.get" });
  if (r?.ok) post("sys", `brain reply:\n${r.text}`);
  else post("err", `brain error: ${r?.reason || "?"}`);
}
async function brainStatus() {
  const r = await API.runtime.sendMessage({ t: "brain.status" });
  post(r?.ok ? "sys" : "err", r?.ok ? "brain ready" : "brain not ready");
}

// ---------- Command router ----------
async function handle(line) {
  post("me", line);
  const m = line.match(/^\s*(\S+)(?:\s+([\s\S]+))?$/);
  if (!m) return;
  const c = m[1].toLowerCase();
  const rest = m[2];

  if (c === "help") {
    return post("sys",
      'eval … | goto URL | newtab URL | open "text" | click "text" | type "selector" text | tab list|switch N|next|prev|close [id] | win new [url] | back|forward|reload | scroll N|top|bottom | brain set <url> | brain say "text" | brain watch on|off | brain get | brain status'
    );
  }

  if (c === "eval")     return post("sys", `→ ${JSON.stringify(await evalInPage(rest))}`);
  if (c === "goto")     return nav(rest);
  if (c === "newtab")   return newTab(rest);
  if (c === "open")     {
    const r = await pageClickByText(rest.replace(/^"|"$/g, ""), "href");
    if (!r?.ok) return post("err", "not found");
    if (r.href) return newTab(r.href);
    return post("err", 'no href; try: click "text"');
  }
  if (c === "click")    {
    const q = rest.replace(/^"|"$/g, "");
    const r = await pageClickByText(q, "click");
    return r?.ok ? post("sys", `clicked; href=${r.href || "—"}`) : post("err", "not found");
  }
  if (c === "type")     {
    const mm = rest?.match(/^"([^"]+)"\s+([\s\S]+)$/);
    if (!mm) return post("err", 'type "selector" text');
    return post("sys", await typeInto(mm[1], mm[2]));
  }
  if (c === "tab") {
    if (!rest) return post("err", "tab list|switch N|next|prev|close [id]");
    const [sub, arg] = rest.split(/\s+/, 2);
    if (sub === "list")   return listTabs();
    if (sub === "switch") return activateTabBy(arg);
    if (sub === "next")   return API.runtime.sendMessage({ t: "cycleTab", dir: +1 });
    if (sub === "prev")   return API.runtime.sendMessage({ t: "cycleTab", dir: -1 });
    if (sub === "close")  return closeTab(arg);
    return post("err", "tab list|switch N|next|prev|close [id]");
  }
  if (c === "win" && /^new\b/i.test(rest || "")) {
    const url = rest.split(/\s+/, 2)[1];
    return newWindow(url);
  }
  if (c === "back")     return evalInPage("history.back()");
  if (c === "forward")  return evalInPage("history.forward()");
  if (c === "reload")   return evalInPage("location.reload()");
  if (c === "scroll")   return scrollCmd(rest || "");

  // Brain commands
  if (c === "brain") {
    if (!rest) return post("err", 'brain set <url> | say "text" | watch on|off | get | status');
    const [sub, ...tail] = rest.split(/\s+/);
    if (sub === "set")    return brainSet(tail.join(" "));
    if (sub === "say")    return brainSay(rest.match(/"([\s\S]*)"$/)?.[1] ?? tail.join(" "));
    if (sub === "watch")  return brainWatch(/^on$/i.test(tail[0]));
    if (sub === "get")    return brainGet();
    if (sub === "status") return brainStatus();
    return post("err", 'brain set <url> | say "text" | watch on|off | get | status');
  }

  post("err", "unknown command");
}

// Single key handler
cmd.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && cmd.value.trim()) {
    const line = cmd.value.trim();
    cmd.value = "";
    handle(line);
  }
});
