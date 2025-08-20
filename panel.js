// panel.js — unified, streaming-enabled with ACKs + fallbacks

const API = typeof browser !== "undefined" ? browser : chrome;
const log = document.getElementById("log");
const cmd = document.getElementById("cmd");
const currentTabId = API.devtools.inspectedWindow.tabId;

post("sys", `Attached to tab ${currentTabId}. Type "help" for commands.`);

// ---------- UI ----------
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

// ---------- EVAL ----------
async function evalInPage(expr) {
  try {
    const r = await API.devtools.inspectedWindow.eval(expr);
    const payload = Array.isArray(r) ? r[0] : r;
    if (payload && payload.exceptionInfo && payload.exceptionInfo.isException) {
      post("err", `Eval error: ${payload.exceptionInfo.value}`);
      return null;
    }
    return payload?.result ?? payload;
  } catch (e) { post("err", String(e)); return null; }
}

// ---------- NAV / TABS / WINDOWS ----------
function normalizeUrl(raw) {
  let s = (raw || "").trim();
  // strip surrounding quotes if any
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  // allow bare domains (add https)
  if (!/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(s)) s = "https://" + s;
  return s;
}

async function waitUrlMatches(targetUrl, timeoutMs = 4000) {
  const target = new URL(targetUrl);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const cur = await evalInPage("location.href");
    if (typeof cur === "string") {
      try {
        const now = new URL(cur);
        // consider success if hostname matches and path starts with target path
        if (now.hostname === target.hostname &&
            (target.pathname === "/" || now.href.startsWith(target.href))) {
          return true;
        }
      } catch {}
    }
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

// --- helpers for goto (relaxed match, redirect-tolerant) ---
function normUrl(raw) {
  let s = (raw || "").trim();
  if ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'")) s = s.slice(1, -1);
  if (!/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(s)) s = "https://" + s;
  return s;
}
function normHost(h) {
  return (h || "").toLowerCase().replace(/^www\./, "");
}
function sameHostLoose(a, b) {
  const A = normHost(a), B = normHost(b);
  if (!A || !B) return false;
  return A === B || A.endsWith("." + B) || B.endsWith("." + A);
}
function sameUrlLoose(currentHref, targetHref) {
  try {
    const cur = new URL(currentHref), tgt = new URL(targetHref);
    return sameHostLoose(cur.hostname, tgt.hostname);
  } catch { return false; }
}
async function waitUrlMatchesLoose(targetUrl, timeoutMs = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const cur = await evalInPage("location.href");
    if (typeof cur === "string" && sameUrlLoose(cur, targetUrl)) return true;
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

// --- robust goto (no false errors on redirect/alias) ---
async function nav(rawUrl) {
  const url = normUrl(rawUrl);

  // 1) Try in-page navigation
  await evalInPage(`window.location.assign(${JSON.stringify(url)})`);
  if (await waitUrlMatchesLoose(url)) {
    post("sys", `navigated → ${url}`);
    return;
  }

  // 2) Fallback via background (suppress noisy errors if redirect already “equivalent”)
  const r = await API.runtime.sendMessage({ t: "goto", tabId: currentTabId, url });

  // After bg attempt, check again before complaining
  if (await waitUrlMatchesLoose(url)) {
    post("sys", `navigated (bg) → ${url}`);
    return;
  }

  // Only now report; Firefox often returns a generic message; keep it calm
  if (!r?.ok) {
    post("err", `goto: background update failed (${r?.reason || "unknown"})`);
  } else {
    const stayed = await evalInPage("location.href");
    post("err", `goto did not change URL (still at ${stayed || "unknown"})`);
  }
}

async function newTab(url) {
  const r = await API.runtime.sendMessage({ t: "createTab", url, opener: currentTabId });
  return r?.ok ? post("sys", `new tab → ${url}`) : post("err", `newtab failed: ${r?.reason || "unknown"}`);
}

async function listTabs() {
  const r = await API.runtime.sendMessage({ t: "listTabs" });
  if (!r?.ok) return post("err", `listTabs failed: ${r?.reason || "unknown"}`);
  r.tabs.sort((a,b)=>a.index-b.index);
  r.tabs.forEach(t => post("sys", `[${t.index}] id=${t.id}${t.active?" *":""}  ${t.title}  ${t.url}`));
}

async function activateTabBy(spec) {
  const msg = /^\d+$/.test(spec)
    ? { t: "activateByIndex", index: Number(spec) }
    : { t: "activateTab", id: Number(spec) };
  const r = await API.runtime.sendMessage(msg);
  if (!r?.ok) post("err", `activate failed: ${r?.reason || "unknown"}`);
}

async function closeTab(spec) {
  const msg = spec ? { t: "closeTab", id: Number(spec) } : { t: "closeTab", id: currentTabId };
  const r = await API.runtime.sendMessage(msg);
  if (!r?.ok) post("err", `close failed: ${r?.reason || "unknown"}`);
}

async function newWindow(url) {
  const r = await API.runtime.sendMessage({ t: "createWindow", url });
  if (!r?.ok) post("err", `window failed: ${r?.reason || "unknown"}`);
}

// ---------- DOM ----------
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
  const px = parseInt(arg,10);
  if (!Number.isFinite(px)) return post("err","scroll <px>|top|bottom");
  return evalInPage(`window.scrollBy(0, ${px})`);
}

// ---------- BRAIN STREAM ----------
let streamBuf = "", streaming = false;
API.runtime.onMessage.addListener((msg) => {
  if (msg.t !== "brain.stream") return;
  if (msg.event === "start")  { streaming = true; streamBuf = ""; ensureStreamLine().textContent = "⏳ waiting for assistant…"; }
  if (msg.event === "lock")   { ensureStreamLine().textContent = "✍️ assistant is typing…"; }
  if (msg.event === "update") { streaming = true; streamBuf = msg.text || ""; ensureStreamLine().textContent = streamBuf; }
  if (msg.event === "end")    { streaming = false; streamBuf = msg.text || streamBuf; ensureStreamLine().textContent = streamBuf || "(empty reply)"; post("sys","— end of reply —"); }
});

// ---------- BRAIN CMDS ----------
async function brainSet(url) {
  const r = await API.runtime.sendMessage({ t: "brain.set", url });
  post(r?.ok ? "sys" : "err", r?.ok ? `brain set → tab ${r.brainTabId}` : `brain set failed: ${r?.reason || "unknown"}`);
}
async function brainSay(text) {
  const r = await API.runtime.sendMessage({ t: "brain.say", text });
  post(r?.ok ? "sys" : "err", r?.ok ? "brain: sent (streaming…)" : `brain error: ${r?.reason || "?"}`);
}
async function brainWatch(on) {
  const r = await API.runtime.sendMessage({ t: "brain.watch", on });
  post(r?.ok ? "sys" : "err", r?.ok ? (on ? "watch ON" : "watch OFF") : `watch failed: ${r?.reason || "unknown"}`);
}
async function brainGet() {
  const r = await API.runtime.sendMessage({ t: "brain.get" });
  if (r?.ok) post("sys", `brain reply:\n${r.text}`); else post("err", `brain error: ${r?.reason || "?"}`);
}
async function brainStatus() {
  const r = await API.runtime.sendMessage({ t: "brain.status" });
  post(r?.ok ? "sys" : "err", r?.ok ? "brain ready" : "brain not ready");
}

// ---------- ROUTER ----------
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
    const r = await pageClickByText(rest.replace(/^"|"$/g,""), "href");
    if (!r?.ok) return post("err","not found");
    if (r.href) return newTab(r.href);
    return post("err",'no href; try: click "text"');
  }
  if (c === "click")    {
    const q = rest.replace(/^"|"$/g,"");
    const r = await pageClickByText(q, "click");
    return r?.ok ? post("sys", `clicked; href=${r.href || "—"}`) : post("err","not found");
  }
  if (c === "type")     {
    const mm = rest?.match(/^"([^"]+)"\s+([\s\S]+)$/);
    if (!mm) return post("err",'type "selector" text');
    return post("sys", await typeInto(mm[1], mm[2]));
  }
  if (c === "tab") {
    if (!rest) return post("err","tab list|switch N|next|prev|close [id]");
    const [sub,arg] = rest.split(/\s+/,2);
    if (sub==="list")   return listTabs();
    if (sub==="switch") return activateTabBy(arg);
    if (sub==="next")   return (await API.runtime.sendMessage({t:"cycleTab", dir:+1})).ok ? null : post("err","cycle failed");
    if (sub==="prev")   return (await API.runtime.sendMessage({t:"cycleTab", dir:-1})).ok ? null : post("err","cycle failed");
    if (sub==="close")  return closeTab(arg);
    return post("err","tab list|switch N|next|prev|close [id]");
  }
  if (c === "win" && /^new\b/i.test(rest || "")) {
    const url = rest.split(/\s+/,2)[1]; return newWindow(url);
  }
  if (c === "back")     return evalInPage("history.back()");
  if (c === "forward")  return evalInPage("history.forward()");
  if (c === "reload")   return evalInPage("location.reload()");
  if (c === "scroll")   return scrollCmd(rest || "");

  if (c === "brain") {
    if (!rest) return post("err",'brain set <url> | say "text" | watch on|off | get | status');
    const [sub, ...tail] = rest.split(/\s+/);
    if (sub === "set")    return brainSet(tail.join(" "));
    if (sub === "say")    return brainSay(rest.match(/"([\s\S]*)"$/)?.[1] ?? tail.join(" "));
    if (sub === "watch")  return brainWatch(/^on$/i.test(tail[0]));
    if (sub === "get")    return brainGet();
    if (sub === "status") return brainStatus();
    return post("err",'brain set <url> | say "text" | watch on|off | get | status');
  }

  post("err","unknown command");
}

cmd.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && cmd.value.trim()) {
    const line = cmd.value.trim();
    cmd.value = "";
    handle(line);
  }
});
