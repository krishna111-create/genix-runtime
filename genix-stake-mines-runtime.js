(() => {
  "use strict";

  // Mines-only Stake bridge. No other Stake games are inspected or synced.
  const API_ROOT = "http://127.0.0.1:3000/api/stake";
  const STORE_KEY = "genix_stake_mines_bridge_v1";
  const TOKEN_RE = /^gx1_[A-Za-z0-9_-]{43}$/;
  const nativeFetch = window.fetch.bind(window);
  const defaults = { token: "", username: "", monitoring: false, linked: false, activeBetId: "", activeBet: null, analyzing: false, collapsed: false };
  const saved = new Map(), seenBets = new Set();
  let state = { ...defaults }, host, root, generating = false, checking = false, scanning = false, currentStatus = "Waiting for Predictor", lastCheck = 0;

  const isStake = (hostName) => /(^|\.)stake\.(com|ac|bet)$/i.test(hostName || "");
  const onMinesPage = () => isStake(location.hostname) && /\/games\/[^/]*mines(?:\/|$)/i.test(location.pathname);
  const validUsername = (value) => /^[a-z0-9_]{2,64}$/i.test(String(value || "").trim().replace(/^@/, ""));
  const isVisible = (el) => Boolean(el?.getClientRects?.().length && getComputedStyle(el).visibility !== "hidden");

  async function getStored(key, fallback) {
    try { if (typeof GM_getValue === "function") { const value = await GM_getValue(key, undefined); if (value !== undefined) return value; } } catch (_) {}
    try { if (typeof GM !== "undefined" && GM.getValue) { const value = await GM.getValue(key, undefined); if (value !== undefined) return value; } } catch (_) {}
    try { const value = localStorage.getItem("__genix__" + key); if (value != null) return JSON.parse(value); } catch (_) {}
    return saved.has(key) ? saved.get(key) : fallback;
  }
  async function setStored(key, value) {
    saved.set(key, value);
    try { if (typeof GM_setValue === "function") { await GM_setValue(key, value); return; } } catch (_) {}
    try { if (typeof GM !== "undefined" && GM.setValue) { await GM.setValue(key, value); return; } } catch (_) {}
    try { localStorage.setItem("__genix__" + key, JSON.stringify(value)); } catch (_) {}
  }
  function api(method, path, body) {
    return new Promise((resolve, reject) => {
      const headers = {}; if (body) headers["Content-Type"] = "application/json"; if (state.token) headers.Authorization = "Bearer " + state.token;
      const done = (response) => {
        let data = {}; try { data = JSON.parse(response.responseText || "{}"); } catch (_) {}
        if (response.status >= 200 && response.status < 300) resolve(data);
        else { const error = new Error(data.error || "Predictor returned HTTP " + response.status); error.status = response.status; reject(error); }
      };
      const options = { method, url: API_ROOT + path, headers, data: body ? JSON.stringify(body) : undefined, timeout: 10000, onload: done,
        onerror: () => reject(new Error("Could not reach the local Predictor API.")), ontimeout: () => reject(new Error("Predictor API request timed out.")) };
      let gmRequest; try { gmRequest = typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : (typeof GM !== "undefined" && GM.xmlHttpRequest ? GM.xmlHttpRequest.bind(GM) : null); } catch (_) {}
      if (gmRequest) { try { gmRequest(options); return; } catch (_) {} }
      nativeFetch(API_ROOT + path, { method, headers, body: options.data, cache: "no-store", mode: "cors" })
        .then(async (res) => done({ status: res.status, responseText: await res.text() }))
        .catch(options.onerror);
    });
  }
  function createToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return "gx1_" + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  function say(message, isError = false) {
    currentStatus = message;
    const el = root?.querySelector("#gx-status-text");
    if (el) { el.textContent = message; el.dataset.error = String(isError); }
    render();
  }
  function render() {
    if (!root) return;
    const linkedLabel = root.querySelector("#gx-link-label"), dot = root.querySelector("#gx-link-dot");
    if (linkedLabel) linkedLabel.textContent = state.linked ? "Connected" : state.monitoring ? "Waiting for Predictor" : "Disconnected";
    if (dot) dot.className = "dot " + (state.linked ? "live" : state.monitoring ? "pending" : "offline");
    const input = root.querySelector("#gx-username"); if (input && root.activeElement !== input) input.value = state.username || "";
    const button = root.querySelector("#gx-action");
    if (button) { button.textContent = generating ? "CONNECTING…" : state.monitoring ? "DISCONNECT" : "CONNECT"; button.disabled = generating || (!state.monitoring && !validUsername(state.username)); button.classList.toggle("disconnect", state.monitoring); }
    const game = root.querySelector("#gx-game"); if (game) game.textContent = onMinesPage() ? "Mines" : "Open Mines game";
    const prediction = root.querySelector("#gx-prediction"); if (prediction) prediction.innerHTML = state.analyzing ? '<span class="spin" aria-hidden="true"></span>Analyzing' : state.activeBetId ? "Prediction active" : state.linked ? "Waiting for bet" : "Waiting";
    const status = root.querySelector("#gx-status-text"); if (status) status.textContent = currentStatus;
    if (host) host.classList.toggle("collapsed", Boolean(state.collapsed));
  }
  function mount() {
    if (!document.body || document.getElementById("genix-mines-bridge-host")) return;
    host = document.createElement("div"); host.id = "genix-mines-bridge-host"; root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      :host{all:initial;color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}*{box-sizing:border-box}button,input{font:inherit}
      .panel{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:2147483647;width:min(330px,calc(100vw - 20px));max-height:min(72dvh,470px);display:flex;flex-direction:column;overflow:hidden;border:1px solid #272833;border-radius:15px;background:#101117;color:#eef0f6;box-shadow:0 24px 70px #0009;font-size:12px}.body{min-height:0;overflow:auto;scrollbar-width:none}.body::-webkit-scrollbar{display:none}
      .head{display:flex;align-items:center;gap:9px;padding:10px 14px 8px}.icon{display:grid;width:26px;height:26px;place-items:center;border-radius:8px;background:#211a35;color:#a77aff;font-size:15px;font-weight:900}.brand{color:#a77aff;font-size:14px;font-weight:760}.sub{margin-top:2px;color:#8790a2;font-size:7px;letter-spacing:.12em}.minimize{display:grid;width:27px;height:27px;margin-left:auto;place-items:center;border:1px solid #30323c;border-radius:8px;background:#1a1b23;color:#e5e6ef;font-size:17px;cursor:pointer}.connection{display:flex;align-items:center;gap:8px;min-height:37px;margin:0 14px 5px;padding:8px 11px;border:1px solid #20222d;border-radius:9px;background:#0b0d13;color:#dce0e9;font-size:12px}.dot{width:8px;height:8px;margin-left:auto;border-radius:50%;background:#737888}.dot.live{background:#12c58b;box-shadow:0 0 0 3px #12c58b20,0 0 10px #12c58b90;animation:pulse 1.6s infinite}.dot.pending{background:#eab943}.dot.offline{background:#ed4e58}@keyframes pulse{50%{opacity:.45}}
      .form{padding:0 14px 12px}.label{display:block;margin:8px 0 4px;color:#929bad;font-size:8px;letter-spacing:.09em}.field{width:100%;height:34px;padding:0 10px;border:1px solid #272a35;border-radius:8px;background:#0b0d13;color:#e8eaf0;font-size:11px;outline:none}.row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px}.small{height:34px;padding:0 10px;border:1px solid #30323c;border-radius:8px;background:#1a1b23;color:#d9dce5;font-size:10px;font-weight:700;cursor:pointer}.action{width:100%;height:40px;margin-top:9px;border:0;border-radius:9px;background:linear-gradient(105deg,#9566ff,#6d35db);color:#fff;font-size:12px;font-weight:800;cursor:pointer}.action.disconnect{background:linear-gradient(105deg,#f0444c,#c91f32)}button:disabled{opacity:.55;cursor:not-allowed}.tiles{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px}.tile{min-height:56px;padding:8px;border:1px solid #20222c;border-radius:9px;background:#0c0e14;text-align:center}.tile-label{color:#8c95a7;font-size:8px}.tile-value{margin-top:5px;color:#eff0f5;font-size:10px;font-weight:720}.status{margin:7px 1px 0;color:#b99aff;font-size:9px;line-height:1.35}.status[data-error=true]{color:#ff9b9f}.spin{display:inline-block;width:10px;height:10px;margin-right:5px;border:2px solid #ffffff55;border-top-color:#fff;border-radius:50%;vertical-align:-2px;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.fab{position:fixed;right:16px;bottom:16px;z-index:2147483647;display:none;width:42px;height:42px;border:1px solid #9a6dff;border-radius:13px;background:linear-gradient(140deg,#9566ff,#6d35db);color:#fff;font-size:16px;font-weight:900;cursor:pointer}:host(.collapsed) .panel{display:none}:host(.collapsed) .fab{display:block}@media(max-width:480px){.panel{right:8px;bottom:8px;width:calc(100vw - 16px);max-height:min(78dvh,470px)}.fab{right:8px;bottom:8px}}
    </style>
    <div class="panel"><div class="head"><span class="icon">G</span><div><div class="brand">Genix Predictor</div><div class="sub">STAKE MINES CONNECTOR</div></div><button class="minimize" id="gx-minimize" type="button" aria-label="Minimize connector">−</button></div>
    <div class="connection"><span id="gx-link-label">Disconnected</span><span class="dot offline" id="gx-link-dot"></span></div>
    <div class="body"><div class="form"><label class="label" for="gx-username">STAKE USERNAME</label><div class="row"><input class="field" id="gx-username" placeholder="Enter Stake username" autocomplete="off"><button class="small" id="gx-save" type="button">Save</button></div>
    <label class="label" for="gx-token">GENIX BRIDGE TOKEN</label><div class="row"><input class="field" id="gx-token" type="password" readonly placeholder="Created when you connect"><button class="small" id="gx-copy" type="button">Copy</button></div>
    <button class="action" id="gx-action" type="button">CONNECT</button>
    <div class="tiles"><div class="tile"><div class="tile-label">GAME</div><div class="tile-value" id="gx-game">Open Mines game</div></div><div class="tile"><div class="tile-label">PREDICTION</div><div class="tile-value" id="gx-prediction">Waiting</div></div></div>
    <p class="status" id="gx-status-text" role="status" aria-live="polite">Waiting for Predictor</p></div></div><button class="fab" id="gx-open" type="button" aria-label="Open connector">G</button>`;
    document.body.append(host);
    root.querySelector("#gx-save").addEventListener("click", async () => {
      const username = root.querySelector("#gx-username").value.trim().replace(/^@/, "");
      if (!validUsername(username)) return say("Enter a valid Stake username.", true);
      state.username = username; await setStored(STORE_KEY, state); say("Stake username saved.");
    });
    root.querySelector("#gx-action").addEventListener("click", () => void toggleConnection());
    root.querySelector("#gx-minimize").addEventListener("click", () => { state.collapsed = true; render(); });
    root.querySelector("#gx-open").addEventListener("click", () => { state.collapsed = false; render(); });
    root.querySelector("#gx-copy").addEventListener("click", () => {
      if (!state.token) return say("Connect first to create the bridge token.", true);
      try { if (typeof GM_setClipboard === "function") GM_setClipboard(state.token, "text"); else if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(state.token); say("Bridge token copied."); } catch (_) { say("Could not copy token.", true); }
    });
    render();
  }
  async function toggleConnection() {
    if (generating) return; generating = true; render();
    try {
      if (state.monitoring) {
        await api("DELETE", "/connection"); state.monitoring = false; state.linked = false; state.activeBetId = ""; state.activeBet = null;
        await setStored(STORE_KEY, state); say("Disconnected from Predictor.");
      } else {
        if (!validUsername(state.username)) throw new Error("Save a valid Stake username first.");
        if (!TOKEN_RE.test(state.token)) state.token = createToken();
        try { await api("POST", "/pairing", { token: state.token, username: state.username }); }
        catch (error) { if (error.status !== 409) throw error; state.token = createToken(); await api("POST", "/pairing", { token: state.token, username: state.username }); }
        state.monitoring = true; state.linked = false; await setStored(STORE_KEY, state);
        const tokenField = root.querySelector("#gx-token"); if (tokenField) tokenField.value = state.token;
        say("Token ready. Connect it in the Predictor."); void checkConnection();
      }
    } catch (error) { say(error.message || "Connector request failed.", true); }
    finally { generating = false; render(); }
  }
  function readVisibleMines() {
    const controls = [...document.querySelectorAll("input[type=range],input[type=number],select,[role=slider],[aria-valuenow]")].filter(isVisible);
    for (const control of controls) {
      const value = Number(control.value ?? control.getAttribute("aria-valuenow"));
      const attrs = [control.id, control.getAttribute("aria-label"), control.getAttribute("name"), control.getAttribute("data-testid"), control.getAttribute("aria-labelledby")].filter(Boolean).join(" ");
      const context = (control.parentElement?.parentElement?.innerText || "").slice(0, 120);
      if ((/mines/i.test(attrs) || /\bmines\b/i.test(context) || control.type === "range") && Number.isInteger(value) && value >= 1 && value <= 24) return value;
    }
    return 1;
  }
  function readVisibleAmount() {
    const candidates = [...document.querySelectorAll("input:not([type=range]):not([type=hidden]):not([type=checkbox]):not([type=radio])")].filter(isVisible);
    for (const input of candidates) {
      const context = `${input.getAttribute("aria-label") || ""} ${input.getAttribute("name") || ""} ${input.id || ""} ${input.parentElement?.parentElement?.innerText || ""}`;
      if (/bet amount/i.test(context)) {
        const amount = String(input.value || "").replace(/[^\d.]/g, ""); if (/^\d{1,16}(?:\.\d{1,8})?$/.test(amount)) return amount;
      }
    }
    return "0";
  }
  function readStakeBet(payload) {
    const user = payload?.user || payload?.data?.user || null;
    const bet = payload?.activeCasinoBet || user?.activeCasinoBet || payload?.data?.activeCasinoBet || null;
    if (!bet || typeof bet !== "object") return null;
    const raw = bet.state?.minesCount ?? bet.state?.mineCount ?? bet.state?.numberOfMines ?? bet.minesCount ?? bet.mineCount ?? bet.numberOfMines;
    const count = Number(raw);
    return { id: String(bet.id || ""), active: bet.active === true, username: String(bet.user?.name || user?.name || state.username || "").trim().replace(/^@/, ""), amount: String(bet.amount ?? "").replace(/,/g, ""), count: Number.isInteger(count) && count >= 1 && count <= 24 ? count : readVisibleMines(), currency: String(bet.currency || "USDT") };
  }
  async function sendMinesBet(bet) {
    if (!state.monitoring || !state.linked || state.activeBetId || seenBets.has(bet.id)) return;
    if (!validUsername(bet.username) || bet.username.toLowerCase() !== state.username.toLowerCase()) { say("Stake username mismatch. Update the saved username before syncing.", true); return; }
    const amount = String(bet.amount || "0").replace(/,/g, "");
    if (!/^\d{1,16}(?:\.\d{1,8})?$/.test(amount) || !Number.isInteger(bet.count) || bet.count < 1 || bet.count > 24) return;
    seenBets.add(bet.id); while (seenBets.size > 100) seenBets.delete(seenBets.values().next().value);
    const eventId = "mines-" + crypto.randomUUID();
    const capturedAt = new Date().toISOString();
    state.activeBetId = bet.id; state.analyzing = true; state.activeBet = { id: bet.id, eventId, capturedAt, username: bet.username, amount, count: bet.count, currency: bet.currency, source: bet.source || "api" };
    await setStored(STORE_KEY, state); say("Bet detected · analyzing Mines prediction…");
    try {
      await api("POST", "/events", { eventId, username: bet.username, game: "mines", selectionCount: bet.count, betAmount: amount, capturedAt, eventType: "bet_placed", roundIndex: null, selectedHole: null, outcome: "unknown", betEventId: eventId, betCapturedAt: capturedAt, gameData: { currency: bet.currency, minesCount: bet.count } });
      state.analyzing = false; await setStored(STORE_KEY, state); say("Mines bet detected · prediction active.");
    } catch (error) { state.activeBetId = ""; state.activeBet = null; state.analyzing = false; seenBets.delete(bet.id); await setStored(STORE_KEY, state); say(error.message || "Mines event sync failed.", true); }
  }
  async function handleStakeResponse(url, payload) {
    if (!onMinesPage() || !String(url).toLowerCase().includes("/_api/casino/active-bet/mines")) return;
    const bet = readStakeBet(payload); if (!bet || !bet.id) return;
    if (bet.active) { bet.source = "api"; await sendMinesBet(bet); }
    else if (state.activeBet?.id === bet.id) await finishMinesBet("round_end");
  }
  async function finishMinesBet(eventType) {
    const active = state.activeBet;
    if (!active) return;
    try {
      const capturedAt = new Date().toISOString();
      await api("POST", "/events", { eventId: "end-" + crypto.randomUUID(), username: active.username, game: "mines", selectionCount: active.count, betAmount: active.amount, capturedAt, eventType, roundIndex: null, selectedHole: null, outcome: "unknown", betEventId: active.eventId, betCapturedAt: active.capturedAt, gameData: { currency: active.currency, minesCount: active.count } });
    } catch (error) { say(error.message || "Could not sync the Mines round ending.", true); return; }
    state.activeBetId = ""; state.activeBet = null; state.analyzing = false;
    await setStored(STORE_KEY, state); say("Previous Mines bet ended · waiting for the next bet.");
  }
  function installHooks() {
    const watched = (value) => { try { const url = new URL(typeof value === "string" ? value : value?.url || "", location.href); return isStake(url.hostname) && url.pathname.toLowerCase().includes("/_api/casino/active-bet/mines"); } catch (_) { return false; } };
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input?.url || ""; const promise = nativeFetch(input, init);
      if (!watched(url)) return promise;
      promise.then((response) => response.clone().text().then((text) => { try { void handleStakeResponse(response.url || url, JSON.parse(text)); } catch (_) {} })).catch(() => {});
      return promise;
    };
    try {
      const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) { this.__gxMinesUrl = new URL(url, location.href).href; this.__gxMinesWatch = watched(this.__gxMinesUrl); return open.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function () { if (this.__gxMinesWatch) this.addEventListener("load", () => { try { const data = this.responseType === "json" ? this.response : JSON.parse(this.responseText); void handleStakeResponse(this.__gxMinesUrl, data); } catch (_) {} }, { once: true }); return send.apply(this, arguments); };
    } catch (_) {}
  }
  async function scanVisibleMinesBet() {
    if (scanning || !onMinesPage() || !state.monitoring || !state.linked) return;
    scanning = true;
    try {
      const buttons = [...document.querySelectorAll("button,[role=button],input[type=button],input[type=submit]")].filter(isVisible);
      const cashout = buttons.find((el) => /cash\s*out|cashout/i.test([el.innerText, el.value, el.getAttribute("aria-label"), el.title].filter(Boolean).join(" ")));
      const active = Boolean(cashout && !cashout.disabled && cashout.getAttribute("aria-disabled") !== "true" && getComputedStyle(cashout).pointerEvents !== "none");
      if (!active) {
        if (state.activeBet?.source === "screen" && Date.now() - Number(state.activeBet.detectedAt || 0) > 1200) await finishMinesBet("round_end");
        return;
      }
      if (state.activeBetId) return;
      const bet = { id: "visible-" + crypto.randomUUID(), active: true, username: state.username, amount: readVisibleAmount(), count: readVisibleMines(), currency: "USDT", source: "screen" };
      bet.detectedAt = Date.now();
      await sendMinesBet(bet);
    } finally { scanning = false; }
  }
  async function checkConnection() {
    if (!state.monitoring || !TOKEN_RE.test(state.token) || checking) return;
    checking = true; lastCheck = Date.now();
    try {
      const connection = await api("GET", "/connection?summary=status"); state.linked = Boolean(connection.linked);
      if (state.linked) {
        await api("POST", "/heartbeat", { game: onMinesPage() ? "mines" : null, gameData: onMinesPage() ? { minesCount: readVisibleMines() } : {} });
        if (!state.activeBetId) say(onMinesPage() ? "Connected · waiting for Mines bet." : "Connected · open Mines to monitor bets.");
      } else if (!state.activeBetId) say("Waiting for Predictor to connect this token.");
      await setStored(STORE_KEY, state);
    } catch (error) { state.linked = false; if (error.status === 401 || error.status === 403) say("Reconnect this token in the Predictor.", true); }
    finally { checking = false; render(); }
  }
  async function init() {
    state = { ...defaults, ...(await getStored(STORE_KEY, {})) }; if (!TOKEN_RE.test(state.token)) state.token = "";
    installHooks(); mount();
    const tokenField = root?.querySelector("#gx-token"); if (tokenField && state.token) tokenField.value = state.token;
    render();
    window.setInterval(() => { if (state.monitoring && Date.now() - lastCheck > (state.linked ? 14000 : 600)) void checkConnection(); void scanVisibleMinesBet(); }, 400);
    window.addEventListener("focus", () => { lastCheck = 0; });
  }
  if (document.body) void init(); else document.addEventListener("DOMContentLoaded", () => void init(), { once: true });
})();
