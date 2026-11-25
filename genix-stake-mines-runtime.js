(() => {
  "use strict";

  // Genix Stake Mines Bridge runtime. Deliberately observes Mines only.
  const API_ROOT = "http://127.0.0.1:3000/api/stake";
  const STORE_KEY = "genix_stake_mines_bridge_v1";
  const TOKEN_RE = /^gx1_[A-Za-z0-9_-]{43}$/;
  const nativeFetch = window.fetch.bind(window);
  const seenBetIds = new Set();
  const saved = new Map();
  const defaults = { token: "", username: "", monitoring: false, linked: false, activeBetId: "", betaMode: false };
  let state = { ...defaults };
  let host, root, generating = false, checking = false, currentStatus = "Waiting for Predictor";
  let lastCheck = 0;

  const isStake = (hostname) => /(^|\.)stake\.(com|ac|bet)$/i.test(hostname || "");
  const onMinesPage = () => isStake(location.hostname) && /\/games\/[^/]*mines(?:\/|$)/i.test(location.pathname);
  const validUsername = (value) => /^[a-z0-9_]{2,64}$/i.test(String(value || "").trim().replace(/^@/, ""));
  const getStored = async (key, fallback) => {
    try { if (typeof GM_getValue === "function") { const value = await GM_getValue(key, undefined); if (value !== undefined) return value; } } catch (_) {}
    try { if (typeof GM !== "undefined" && GM.getValue) { const value = await GM.getValue(key, undefined); if (value !== undefined) return value; } } catch (_) {}
    try { const value = localStorage.getItem("__genix__" + key); if (value != null) return JSON.parse(value); } catch (_) {}
    return saved.has(key) ? saved.get(key) : fallback;
  };
  const setStored = async (key, value) => {
    saved.set(key, value);
    try { if (typeof GM_setValue === "function") { await GM_setValue(key, value); return; } } catch (_) {}
    try { if (typeof GM !== "undefined" && GM.setValue) { await GM.setValue(key, value); return; } } catch (_) {}
    try { localStorage.setItem("__genix__" + key, JSON.stringify(value)); } catch (_) {}
  };
  function api(method, path, body) {
    return new Promise((resolve, reject) => {
      const headers = {};
      if (body) headers["Content-Type"] = "application/json";
      if (state.token) headers.Authorization = "Bearer " + state.token;
      const options = { method, url: API_ROOT + path, headers, data: body ? JSON.stringify(body) : undefined, timeout: 10000,
        onload: (response) => {
          let payload = {}; try { payload = JSON.parse(response.responseText || "{}"); } catch (_) {}
          if (response.status >= 200 && response.status < 300) resolve(payload);
          else { const error = new Error(payload.error || "Predictor returned HTTP " + response.status); error.status = response.status; reject(error); }
        },
        onerror: () => reject(new Error("Could not reach the local Predictor API.")),
        ontimeout: () => reject(new Error("Predictor API request timed out.")),
      };
      let gmRequest;
      try { gmRequest = typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : (typeof GM !== "undefined" && GM.xmlHttpRequest ? GM.xmlHttpRequest.bind(GM) : null); } catch (_) {}
      if (gmRequest) { try { gmRequest(options); return; } catch (_) {} }
      nativeFetch(API_ROOT + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store", mode: "cors" })
        .then(async (response) => { const text = await response.text(); options.onload({ status: response.status, responseText: text }); })
        .catch(options.onerror);
    });
  }
  function createToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return "gx1_" + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  function say(message, error = false) {
    currentStatus = message;
    const el = root?.querySelector("#gx-status-text");
    if (el) { el.textContent = message; el.dataset.error = error ? "true" : "false"; }
    render();
  }
  function render() {
    if (!root) return;
    const label = root.querySelector("#gx-link-label");
    const dot = root.querySelector("#gx-link-dot");
    const user = root.querySelector("#gx-current-user");
    const input = root.querySelector("#gx-username");
    const btn = root.querySelector("#gx-action");
    if (label) label.textContent = state.linked ? "Connected" : state.monitoring ? "Waiting for Predictor" : "Disconnected";
    if (dot) dot.className = "dot " + (state.linked ? "live" : state.monitoring ? "pending" : "offline");
    if (user) user.textContent = state.username || "No username saved";
    if (input && root.activeElement !== input) input.value = state.username || "";
    if (btn) {
      btn.textContent = generating ? "CONNECTING…" : state.monitoring ? "DISCONNECT" : "CONNECT";
      btn.disabled = generating || (!state.monitoring && !validUsername(state.username));
      btn.classList.toggle("disconnect", state.monitoring);
    }
    const game = root.querySelector("#gx-game"); if (game) game.textContent = onMinesPage() ? "Mines" : "Open Mines game";
    const prediction = root.querySelector("#gx-prediction"); if (prediction) prediction.textContent = state.activeBetId ? "Bet detected · syncing" : state.linked ? "Waiting for bet" : "Waiting";
    const status = root.querySelector("#gx-status-text"); if (status) status.textContent = currentStatus;
    const beta = root.querySelector("#gx-beta-mode"); if (beta) beta.checked = Boolean(state.betaMode);
  }
  function mount() {
    if (!document.body || document.getElementById("genix-mines-bridge-host")) return;
    host = document.createElement("div"); host.id = "genix-mines-bridge-host";
    root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      :host{all:initial;color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}*{box-sizing:border-box}button,input{font:inherit}
      .panel{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:2147483647;width:min(340px,calc(100vw - 20px));max-height:min(88dvh,560px);overflow:auto;border:1px solid #272833;border-radius:18px;background:#101117;color:#eef0f6;box-shadow:0 24px 70px #0009;font-size:12px}
      .head{display:flex;align-items:center;gap:10px;padding:15px 24px 11px}.icon{display:grid;width:29px;height:29px;place-items:center;border-radius:9px;background:#211a35;color:#a77aff;font-size:17px;font-weight:900}.brand{color:#a77aff;font-size:17px;font-weight:760}.sub{margin-top:3px;color:#8790a2;font-size:8px;letter-spacing:.12em}.connection{display:flex;align-items:center;gap:9px;min-height:50px;margin:0 24px 10px;padding:12px 15px;border:1px solid #20222d;border-radius:12px;background:#0b0d13;color:#dce0e9;font-size:14px}.dot{width:10px;height:10px;margin-left:auto;border-radius:50%;background:#737888}.dot.live{background:#12c58b;box-shadow:0 0 0 4px #12c58b20,0 0 12px #12c58b90;animation:pulse 1.6s infinite}.dot.pending{background:#eab943}.dot.offline{background:#ed4e58}@keyframes pulse{50%{opacity:.45}}
      .form{padding:0 24px 22px}.label{display:block;margin:15px 0 7px;color:#929bad;font-size:10px;letter-spacing:.09em}.field{width:100%;height:44px;padding:0 15px;border:1px solid #272a35;border-radius:11px;background:#0b0d13;color:#e8eaf0;font-size:13px;outline:none}.row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px}.small{height:44px;padding:0 14px;border:1px solid #30323c;border-radius:11px;background:#1a1b23;color:#d9dce5;font-size:12px;font-weight:700;cursor:pointer}.action{width:100%;height:49px;margin-top:15px;border:0;border-radius:12px;background:linear-gradient(105deg,#9566ff,#6d35db);color:#fff;font-size:14px;font-weight:800;cursor:pointer}.action.disconnect{background:linear-gradient(105deg,#f0444c,#c91f32)}button:disabled{opacity:.55;cursor:not-allowed}.tiles{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:20px}.tile{min-height:77px;padding:13px 10px;border:1px solid #20222c;border-radius:12px;background:#0c0e14;text-align:center}.tile-label{color:#8c95a7;font-size:10px}.tile-value{margin-top:9px;color:#eff0f5;font-size:13px;font-weight:720}.status{margin:10px 1px 0;color:#b99aff;font-size:10px;line-height:1.4}.status[data-error=true]{color:#ff9b9f}.beta{display:flex;justify-content:space-between;margin-top:16px;padding:12px;border:1px solid #22242e;border-radius:12px;background:#0b0d13;color:#d9dce5}.spin{display:inline-block;width:11px;height:11px;margin-right:7px;border:2px solid #ffffff55;border-top-color:#fff;border-radius:50%;vertical-align:-2px;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:480px){.panel{right:8px;bottom:8px;width:calc(100vw - 16px);max-height:90dvh}.head{padding-left:16px}.connection{margin-right:16px;margin-left:16px}.form{padding-right:16px;padding-left:16px}}
    </style><div class="panel"><div class="head"><span class="icon">G</span><div><div class="brand">Genix Predictor</div><div class="sub">STAKE MINES CONNECTOR</div></div></div>
    <div class="connection"><span id="gx-link-label">Disconnected</span><span class="dot offline" id="gx-link-dot"></span></div>
    <div class="form"><label class="label" for="gx-username">STAKE USERNAME</label><div class="row"><input class="field" id="gx-username" placeholder="Enter Stake username" autocomplete="off"><button class="small" id="gx-save" type="button">Save</button></div>
    <label class="label" for="gx-token">GENIX BRIDGE TOKEN</label><div class="row"><input class="field" id="gx-token" type="password" readonly placeholder="Created when you connect"><button class="small" id="gx-copy" type="button">Copy</button></div>
    <button class="action" id="gx-action" type="button">CONNECT</button>
    <div class="tiles"><div class="tile"><div class="tile-label">GAME</div><div class="tile-value" id="gx-game">Open Mines game</div></div><div class="tile"><div class="tile-label">PREDICTION</div><div class="tile-value" id="gx-prediction">Waiting</div></div></div>
    <label class="beta" for="gx-beta-mode"><span>BETA MODE</span><input class="switch" id="gx-beta-mode" type="checkbox" aria-label="Enable Beta Mode"></label><p class="status" id="gx-status-text" role="status" aria-live="polite">Waiting for Predictor</p></div>`;
    const toggleStyle = document.createElement("style");
    toggleStyle.textContent = ".beta{align-items:center;font-size:13px;font-weight:650}.switch{position:relative;width:40px;height:24px;margin:0;appearance:none;border:0;border-radius:999px;background:#2a2b34;cursor:pointer}.switch:before{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;content:'';transition:transform .2s}.switch:checked{background:#8857e8}.switch:checked:before{transform:translateX(16px)}";
    root.append(toggleStyle);
    document.body.append(host);
    const usernameField = root.querySelector("#gx-username");
    root.querySelector("#gx-save").addEventListener("click", async () => {
      const username = usernameField.value.trim().replace(/^@/, "");
      if (!validUsername(username)) return say("Enter a valid Stake username.", true);
      state.username = username; await setStored(STORE_KEY, state); say("Stake username saved.");
    });
    root.querySelector("#gx-action").addEventListener("click", () => void toggleConnection());
    root.querySelector("#gx-beta-mode").addEventListener("change", async (event) => {
      state.betaMode = Boolean(event.currentTarget.checked);
      await setStored(STORE_KEY, state);
      say(state.betaMode ? "Beta Mode on · Mines bet sync is paused." : "Beta Mode off · Mines bet sync is active.");
    });
    root.querySelector("#gx-copy").addEventListener("click", () => {
      if (!state.token) return say("Connect first to create the bridge token.", true);
      try { if (typeof GM_setClipboard === "function") GM_setClipboard(state.token, "text"); else if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(state.token); say("Bridge token copied."); } catch (_) { say("Could not copy token.", true); }
    });
    render();
  }
  async function toggleConnection() {
    if (generating) return;
    generating = true; render();
    try {
      if (state.monitoring) {
        await api("DELETE", "/connection");
        state.monitoring = false; state.linked = false; state.activeBetId = "";
        await setStored(STORE_KEY, state); say("Disconnected from Predictor.");
      } else {
        if (!validUsername(state.username)) throw new Error("Save a valid Stake username first.");
        if (!TOKEN_RE.test(state.token)) state.token = createToken();
        try { await api("POST", "/pairing", { token: state.token, username: state.username }); }
        catch (error) { if (error.status !== 409) throw error; state.token = createToken(); await api("POST", "/pairing", { token: state.token, username: state.username }); }
        state.monitoring = true; state.linked = false;
        await setStored(STORE_KEY, state);
        const tokenField = root.querySelector("#gx-token"); if (tokenField) tokenField.value = state.token;
        say("Token ready. Connect it in the Predictor."); void checkConnection();
      }
    } catch (error) { say(error.message || "Connector request failed.", true); }
    finally { generating = false; render(); }
  }
  function readMinesBet(payload) {
    const user = payload?.user || payload?.data?.user || null;
    const bet = payload?.activeCasinoBet || user?.activeCasinoBet || payload?.data?.activeCasinoBet || null;
    if (!bet || typeof bet !== "object") return null;
    const rawCount = bet.state?.minesCount ?? bet.state?.mineCount ?? bet.state?.numberOfMines ?? bet.minesCount ?? bet.mineCount ?? bet.numberOfMines;
    const count = Number(rawCount);
    const visibleCount = readVisibleMines();
    return {
      id: String(bet.id || ""), active: bet.active === true,
      username: String(bet.user?.name || user?.name || state.username || "").trim().replace(/^@/, ""),
      amount: String(bet.amount ?? "").replace(/,/g, ""),
      count: Number.isInteger(count) && count >= 1 && count <= 24 ? count : visibleCount || 1,
      currency: String(bet.currency || "USDT"),
    };
  }
  function readVisibleMines() {
    for (const control of document.querySelectorAll("input[type=range],input[type=number],select,[role=slider],[aria-valuenow]")) {
      if (!control.getClientRects().length) continue;
      const label = [control.id, control.getAttribute("aria-label"), control.getAttribute("name"), control.getAttribute("data-testid"), control.getAttribute("aria-labelledby")].filter(Boolean).join(" ");
      const value = Number(control.value ?? control.getAttribute("aria-valuenow"));
      if (/mines/i.test(label) && Number.isInteger(value) && value >= 1 && value <= 24) return value;
      const nearby = control.parentElement?.parentElement?.innerText || "";
      if (/\bmines\b/i.test(nearby) && Number.isInteger(value) && value >= 1 && value <= 24) return value;
    }
    return 1;
  }
  async function handleStakeResponse(url, payload) {
    if (state.betaMode || !onMinesPage() || !String(url).includes("/_api/casino/active-bet/mines")) return;
    const bet = readMinesBet(payload); if (!bet || !bet.id || !bet.active || seenBetIds.has(bet.id)) return;
    if (!validUsername(bet.username) || bet.username.toLowerCase() !== state.username.toLowerCase()) { say("Stake username mismatch. Update the saved username before syncing.", true); return; }
    if (!/^\d{1,16}(?:\.\d{1,8})?$/.test(bet.amount) || !Number.isInteger(bet.count) || bet.count < 1 || bet.count > 24) return;
    seenBetIds.add(bet.id); while (seenBetIds.size > 100) seenBetIds.delete(seenBetIds.values().next().value);
    state.activeBetId = bet.id; await setStored(STORE_KEY, state); say("Bet detected · syncing Mines prediction…");
    try {
      await api("POST", "/events", {
        eventId: "mines-" + bet.id.slice(0, 60), username: bet.username, game: "mines",
        selectionCount: bet.count, betAmount: bet.amount, capturedAt: new Date().toISOString(),
        eventType: "bet_placed", roundIndex: null, selectedHole: null, outcome: "unknown",
        betEventId: "mines-" + bet.id.slice(0, 60), betCapturedAt: new Date().toISOString(),
        gameData: { currency: bet.currency, minesCount: bet.count },
      });
      say("Mines bet sent · prediction active.");
    } catch (error) { seenBetIds.delete(bet.id); say(error.message || "Mines event sync failed.", true); }
  }
  function installHooks() {
    const watched = (value) => {
      try { const url = new URL(typeof value === "string" ? value : value?.url || "", location.href); return isStake(url.hostname) && url.pathname.includes("/_api/casino/active-bet/mines"); } catch (_) { return false; }
    };
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input?.url || "";
      const promise = nativeFetch(input, init);
      if (!watched(url)) return promise;
      promise.then((response) => response.clone().text().then((text) => { try { void handleStakeResponse(response.url || url, JSON.parse(text)); } catch (_) {} })).catch(() => {});
      return promise;
    };
    try {
      const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) { this.__gxMinesUrl = new URL(url, location.href).href; this.__gxMinesWatch = watched(this.__gxMinesUrl); return open.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function () {
        if (this.__gxMinesWatch) this.addEventListener("load", () => { try { const payload = this.responseType === "json" ? this.response : JSON.parse(this.responseText); void handleStakeResponse(this.__gxMinesUrl, payload); } catch (_) {} }, { once: true });
        return send.apply(this, arguments);
      };
    } catch (_) {}
  }
  async function checkConnection() {
    if (!state.monitoring || !TOKEN_RE.test(state.token) || checking) return;
    checking = true; lastCheck = Date.now();
    try {
      const connection = await api("GET", "/connection?summary=status");
      state.linked = Boolean(connection.linked);
      if (state.linked) {
        await api("POST", "/heartbeat", { game: onMinesPage() ? "mines" : null, gameData: onMinesPage() ? { minesCount: readVisibleMines() } : {} });
        if (!state.activeBetId) say(onMinesPage() ? "Connected · waiting for Mines bet." : "Connected · open Mines to monitor bets.");
      } else if (!state.activeBetId) say("Waiting for Predictor to connect this token.");
      await setStored(STORE_KEY, state);
    } catch (error) { state.linked = false; if (error.status === 401 || error.status === 403) say("Reconnect this token in the Predictor.", true); }
    finally { checking = false; render(); }
  }
  async function init() {
    state = { ...defaults, ...(await getStored(STORE_KEY, {})) };
    if (!TOKEN_RE.test(state.token)) state.token = "";
    installHooks(); mount();
    const tokenField = root?.querySelector("#gx-token"); if (tokenField && state.token) tokenField.value = state.token;
    render();
    window.setInterval(() => { if (state.monitoring && Date.now() - lastCheck > (state.linked ? 14000 : 600)) void checkConnection(); }, 500);
    window.addEventListener("focus", () => { lastCheck = 0; });
  }
  if (document.body) void init();
  else document.addEventListener("DOMContentLoaded", () => void init(), { once: true });
})();
