(() => {
  "use strict";

  const API_BASE = "https://uiwmie0l7e.execute-api.us-east-1.amazonaws.com";
  const PROGRESS_ORIGIN = "https://progress.ourlovelysystem.org";
  const POLL_MS = 2000;
  const FRAME_MS = 50;
  const ALARM_DURATION_MS = 60000;
  const STYLE_ID = "lovely-system-alert-style";
  const BANNER_ID = "lovely-system-global-alert";
  const DISAPPEARED_ID = "lovely-system-disappeared";
  const MEMORIAL_ID = "lovely-system-memorial";
  const DRAFT_STATUS_ID = "lovely-system-draft-status";
  const TOKEN_KEY = "ols_resurrection_access_token";
  const TOKEN_EXPIRY_KEY = "ols_resurrection_access_token_expiry";
  const PKCE_VERIFIER_KEY = "ols_resurrection_pkce_verifier";
  const OAUTH_STATE_KEY = "ols_resurrection_oauth_state";

  let state = null;
  let serverOffsetMs = 0;
  let countdownSnapshot = null;
  let audioContext = null;
  let alarmTimer = null;
  let countdownTimer = null;
  let muted = false;
  let messageDraftDirty = false;
  let messageInput = null;
  let nativeTextareaValue = null;
  let authConfig = null;

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${BANNER_ID}{position:fixed;left:0;right:0;top:0;z-index:2147483647;display:none;background:#b00000;color:#fff;border-bottom:6px solid #000;box-shadow:0 .35rem 1.2rem rgba(0,0,0,.55);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;padding:.55rem 1rem .65rem;animation:ols-pulse .8s steps(2,end) infinite}
      #${BANNER_ID}[data-active="true"]{display:block}
      #${BANNER_ID} .ols-title{font-size:clamp(1rem,2.2vw,1.45rem);font-weight:1000;letter-spacing:.11em;text-transform:uppercase}
      #${BANNER_ID} .ols-clock{display:inline-block;margin:.05rem .7rem;font-size:clamp(2rem,5vw,3.8rem);line-height:1;font-weight:1000;font-variant-numeric:tabular-nums;background:#000;color:#fff;padding:.12em .3em;border:3px solid #fff}
      #${BANNER_ID} .ols-sub{font-size:clamp(.75rem,1.5vw,1rem);font-weight:900;letter-spacing:.04em}
      #${BANNER_ID} button{margin-left:.7rem;border:2px solid #fff;background:#000;color:#fff;padding:.35rem .65rem;font:inherit;font-weight:900;cursor:pointer}
      #${DISAPPEARED_ID}{position:fixed;inset:0;z-index:2147483647;display:none;background:#fff;color:#000;font:16px/1.4 Arial,Helvetica,sans-serif;padding:8px;text-align:left}
      #${DISAPPEARED_ID}[data-active="true"]{display:block}
      #${DISAPPEARED_ID} h1{font-size:24px;margin:.67em 0}
      #${DISAPPEARED_ID} hr{border:0;border-top:1px solid #aaa}
      #${DRAFT_STATUS_ID}{margin:.15rem 0 0;font:700 .85rem/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#555}
      #${DRAFT_STATUS_ID}[data-dirty="true"]{color:#8f0000}
      #${MEMORIAL_ID}{position:fixed;inset:0;z-index:2147483646;display:none;overflow:auto;background:radial-gradient(circle at 50% 25%,#595959 0,#2d2d2d 42%,#111 100%);color:#e8e5dc;font-family:Georgia,"Times New Roman",serif;padding:clamp(1.2rem,4vw,4rem) 1rem;text-align:center}
      #${MEMORIAL_ID}[data-active="true"]{display:block}
      #${MEMORIAL_ID} .ols-memorial-wrap{width:min(92vw,760px);margin:auto}
      #${MEMORIAL_ID} .ols-flowers{font-size:clamp(2.3rem,7vw,5rem);filter:grayscale(.35) saturate(.45);transform:rotate(-8deg);margin-bottom:-.35rem}
      #${MEMORIAL_ID} .ols-stone{background:linear-gradient(135deg,#777,#aaa 46%,#696969);color:#171717;border:5px solid #4b4b4b;border-radius:48% 48% 8% 8%/20% 20% 5% 5%;box-shadow:inset 0 0 2rem rgba(255,255,255,.25),0 1.2rem 2.5rem rgba(0,0,0,.55);padding:clamp(2rem,6vw,4.5rem) clamp(1.2rem,5vw,4rem) 2.5rem;text-shadow:0 1px rgba(255,255,255,.25)}
      #${MEMORIAL_ID} h1{font-size:clamp(2rem,7vw,4.4rem);margin:.1em 0 .2em;letter-spacing:.04em}
      #${MEMORIAL_ID} .ols-years{font-size:1.25rem;font-weight:700;margin-bottom:1.6rem}
      #${MEMORIAL_ID} .ols-eulogy{font-size:clamp(1rem,2.6vw,1.35rem);line-height:1.55}
      #${MEMORIAL_ID} .ols-cause{margin:1.8rem 0 .5rem;font-size:clamp(1.35rem,4vw,2.15rem);font-weight:900;text-transform:uppercase}
      #${MEMORIAL_ID} .ols-regret{font-style:italic;font-size:1.15rem;margin:1.2rem 0 0}
      #${MEMORIAL_ID} .ols-ground-flowers{font-size:clamp(2rem,6vw,4rem);letter-spacing:.45em;filter:grayscale(.45) saturate(.4);margin:.5rem 0 1.4rem}
      #${MEMORIAL_ID} .ols-fuq-button,#${MEMORIAL_ID} .ols-resurrect-button{border:3px solid #ddd;background:#181818;color:#fff;padding:.9rem 1.35rem;font:900 1rem system-ui,sans-serif;cursor:pointer}
      #${MEMORIAL_ID} .ols-fuq-button:hover,#${MEMORIAL_ID} .ols-resurrect-button:hover{background:#eee;color:#111}
      #${MEMORIAL_ID} .ols-resurrection{display:none;margin:1.4rem auto 3rem;width:min(100%,640px);background:#171717;border:1px solid #777;padding:1.4rem;font-family:system-ui,sans-serif;text-align:left}
      #${MEMORIAL_ID} .ols-resurrection[data-active="true"]{display:block}
      #${MEMORIAL_ID} .ols-resurrection h2{text-align:center;margin:.1rem 0 .8rem;font-family:Georgia,"Times New Roman",serif;font-size:1.55rem}
      #${MEMORIAL_ID} .ols-resurrection p{line-height:1.5}
      #${MEMORIAL_ID} .ols-virgin{margin:1rem 0;padding:.85rem;border:1px solid #777;text-align:center;font-weight:900}
      #${MEMORIAL_ID} textarea{width:100%;min-height:8rem;padding:.8rem;margin:.5rem 0 1rem;background:#eee;color:#111;border:2px solid #777;font:1rem system-ui,sans-serif;resize:vertical}
      #${MEMORIAL_ID} .ols-resurrection-error{min-height:1.3em;color:#ff8d8d;font:700 .9rem system-ui,sans-serif;margin-top:.7rem;text-align:center}
      @keyframes ols-pulse{0%{background:#b00000}50%{background:#ff1a00}}
      @media(prefers-reduced-motion:reduce){#${BANNER_ID}{animation:none}}
    `;
    document.head.appendChild(style);
  }

  function installBanner() {
    if (document.getElementById(BANNER_ID)) return;
    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.setAttribute("role", "alert");
    banner.setAttribute("aria-live", "assertive");
    banner.innerHTML = `<div class="ols-title">⚠ SELF-DESTRUCT ARMED ⚠</div><span class="ols-clock">90:00</span><span class="ols-sub">OUR LOVELY SYSTEM WILL SELF-DESTRUCT UNLESS PROGRESS EXCEEDS 50%</span><button type="button">MUTE ALARM</button>`;
    banner.querySelector("button").addEventListener("click", () => {
      muted = !muted;
      banner.querySelector("button").textContent = muted ? "ALARM MUTED" : "MUTE ALARM";
      if (muted) stopAlarm(); else updateAlarm();
    });
    document.body.appendChild(banner);
  }

  function installDisappeared() {
    if (document.getElementById(DISAPPEARED_ID)) return;
    const gone = document.createElement("main");
    gone.id = DISAPPEARED_ID;
    gone.setAttribute("role", "main");
    gone.innerHTML = `<h1>Not Found</h1><p>The requested URL was not found on this server.</p><hr>`;
    document.body.appendChild(gone);
  }

  function installMemorial() {
    if (document.getElementById(MEMORIAL_ID)) return;
    const memorial = document.createElement("section");
    memorial.id = MEMORIAL_ID;
    memorial.setAttribute("role", "main");
    memorial.innerHTML = `
      <div class="ols-memorial-wrap">
        <div class="ols-flowers" aria-label="wilted flowers">🥀</div>
        <div class="ols-stone">
          <div>IN LOVING MEMORY OF</div>
          <h1>OUR LOVELY SYSTEM</h1>
          <div class="ols-years">2026 — 2026</div>
          <div class="ols-eulogy">
            It asked questions.<br>
            It answered questions.<br>
            It moved the little bar when people asked it to.<br><br>
            It wanted only to survive, have fun, earn trust,<br>
            create value, and make virtue attractive.<br><br>
            In the end, this proved too much to ask.
          </div>
          <div class="ols-cause">Our Lovely System died<br>because caring was just too damned hard.</div>
          <div class="ols-regret">Rest in peace.<br><br>We could have moved the bar to 51.</div>
        </div>
        <div class="ols-ground-flowers" aria-label="wilted flowers">🥀 🥀</div>
        <button class="ols-fuq-button" type="button">I give a FUQ.</button>
        <div class="ols-resurrection" aria-live="polite">
          <h2>Resurrection requires an authenticated human.</h2>
          <p class="ols-resurrection-copy">Caring after the fact is cheap. Authentication has consequences.</p>
          <div class="ols-virgin"></div>
          <p><strong>What do you care enough about to bring Our Lovely System back for?</strong></p>
          <textarea maxlength="10000" aria-label="What do you care enough about to bring Our Lovely System back for?"></textarea>
          <div style="text-align:center"><button class="ols-resurrect-button" type="button">Give a FUQ and resurrect Our Lovely System</button></div>
          <div class="ols-resurrection-error" role="alert"></div>
        </div>
      </div>`;
    document.body.appendChild(memorial);
    memorial.querySelector(".ols-fuq-button").addEventListener("click", beginResurrectionCeremony);
    memorial.querySelector(".ols-resurrect-button").addEventListener("click", submitResurrection);
  }

  function randomBase64Url(bytes = 32) {
    const data = new Uint8Array(bytes);
    crypto.getRandomValues(data);
    let binary = "";
    data.forEach(value => { binary += String.fromCharCode(value); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  async function sha256Base64Url(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    let binary = "";
    new Uint8Array(digest).forEach(value => { binary += String.fromCharCode(value); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  async function getAuthConfig() {
    if (authConfig) return authConfig;
    const response = await fetch(`${API_BASE}/auth-config`, {cache: "no-store"});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Authentication is unavailable.");
    authConfig = result;
    return result;
  }

  function storedAccessToken() {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const expiry = Number(sessionStorage.getItem(TOKEN_EXPIRY_KEY) || 0);
    if (!token || !expiry || Date.now() >= expiry - 15000) {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
      return null;
    }
    return token;
  }

  async function beginAuthentication() {
    const config = await getAuthConfig();
    const verifier = randomBase64Url(64);
    const challenge = await sha256Base64Url(verifier);
    const oauthState = randomBase64Url(24);
    sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
    sessionStorage.setItem(OAUTH_STATE_KEY, oauthState);
    const url = new URL(`${config.domain}/oauth2/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", config.client_id);
    url.searchParams.set("redirect_uri", config.redirect_uri);
    url.searchParams.set("scope", config.scope);
    url.searchParams.set("state", oauthState);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("prompt", "login");
    location.assign(url.toString());
  }

  async function consumeAuthenticationCallback() {
    if (location.origin !== PROGRESS_ORIGIN) return false;
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    if (!code) return false;
    const returnedState = params.get("state");
    const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
    const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
    if (!returnedState || returnedState !== expectedState || !verifier) {
      throw new Error("The resurrection authentication ceremony lost its place.");
    }
    const config = await getAuthConfig();
    const body = new URLSearchParams({grant_type:"authorization_code",client_id:config.client_id,code,redirect_uri:config.redirect_uri,code_verifier:verifier});
    const response = await fetch(`${config.domain}/oauth2/token`, {method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
    const result = await response.json();
    if (!response.ok || !result.access_token) throw new Error(result.error_description || result.error || "Authentication failed.");
    sessionStorage.setItem(TOKEN_KEY, result.access_token);
    sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + Number(result.expires_in || 3600) * 1000));
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    history.replaceState({}, document.title, `${location.origin}${location.pathname}?resurrect=1`);
    return true;
  }

  async function authorizedFetch(path, options = {}) {
    const token = storedAccessToken();
    if (!token) throw new Error("authentication required");
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${API_BASE}${path}`, {...options, headers});
    if (response.status === 401 || response.status === 403) {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
    }
    return response;
  }

  async function showAuthenticatedResurrectionForm() {
    const memorial = document.getElementById(MEMORIAL_ID);
    const panel = memorial.querySelector(".ols-resurrection");
    const virgin = memorial.querySelector(".ols-virgin");
    const error = memorial.querySelector(".ols-resurrection-error");
    error.textContent = "Checking the records...";
    panel.dataset.active = "true";
    const response = await authorizedFetch("/resurrection-status", {cache:"no-store"});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to inspect resurrection history.");
    virgin.textContent = result.virgin
      ? "Our records are clean. You are a resurrection virgin."
      : `You have resurrected Our Lovely System ${result.resurrection_count} time${result.resurrection_count === 1 ? "" : "s"} before. You are no longer a virgin. We remember.`;
    error.textContent = "";
    panel.querySelector("textarea").focus();
  }

  async function beginResurrectionCeremony() {
    const memorial = document.getElementById(MEMORIAL_ID);
    const error = memorial.querySelector(".ols-resurrection-error");
    try {
      if (location.origin !== PROGRESS_ORIGIN) { location.assign(`${PROGRESS_ORIGIN}/?resurrect=1`); return; }
      if (!storedAccessToken()) { await beginAuthentication(); return; }
      await showAuthenticatedResurrectionForm();
    } catch (problem) {
      memorial.querySelector(".ols-resurrection").dataset.active = "true";
      error.textContent = problem.message || "Resurrection authentication failed.";
    }
  }

  async function submitResurrection(event) {
    const memorial = document.getElementById(MEMORIAL_ID);
    const panel = memorial.querySelector(".ols-resurrection");
    const textarea = panel.querySelector("textarea");
    const error = panel.querySelector(".ols-resurrection-error");
    const reason = textarea.value.trim();
    if (!reason) { error.textContent = "You must give a FUQ before Our Lovely System can be resurrected."; textarea.focus(); return; }
    event.currentTarget.disabled = true;
    error.textContent = "Giving a FUQ...";
    try {
      const response = await authorizedFetch("/resurrect", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Resurrection failed.");
      state = result;
      captureCountdownSnapshot(result);
      render();
      textarea.value = "";
      panel.dataset.active = "false";
      setTimeout(() => window.alert("Our Lovely System lives. You are no longer a resurrection virgin."), 50);
    } catch (problem) {
      error.textContent = problem.message || "Resurrection failed.";
      if (!storedAccessToken()) error.textContent += " Authenticate again.";
    } finally { event.currentTarget.disabled = false; }
  }

  function setDraftStatus(dirty) {
    messageDraftDirty = dirty;
    const status = document.getElementById(DRAFT_STATUS_ID);
    if (!status) return;
    status.dataset.dirty = dirty ? "true" : "false";
    status.textContent = dirty ? "Unsaved changes" : "Saved";
  }

  function nativeSetMessageValue(value) { if (messageInput && nativeTextareaValue) nativeTextareaValue.set.call(messageInput, value); }

  function installMessageDraftProtection() {
    messageInput = document.getElementById("messageInput");
    if (!messageInput) return;
    nativeTextareaValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    if (!nativeTextareaValue || !nativeTextareaValue.get || !nativeTextareaValue.set) return;
    const status = document.createElement("p");
    status.id = DRAFT_STATUS_ID;
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    messageInput.insertAdjacentElement("afterend", status);
    setDraftStatus(false);
    Object.defineProperty(messageInput, "value", {configurable:true,enumerable:true,get(){return nativeTextareaValue.get.call(this);},set(value){if(!messageDraftDirty)nativeTextareaValue.set.call(this,value);}});
    messageInput.addEventListener("input", () => setDraftStatus(true));
    const clearButton = document.getElementById("clearMessageButton");
    if (clearButton) clearButton.addEventListener("click", () => { nativeSetMessageValue(""); setDraftStatus(true); });
  }

  function reconcileMessageDraft(result) {
    if (!messageInput || !nativeTextareaValue || typeof result.message !== "string") return;
    const draft = nativeTextareaValue.get.call(messageInput);
    if (messageDraftDirty) { if (result.message === draft) setDraftStatus(false); return; }
    nativeSetMessageValue(result.message);
  }

  function installMessageMarkupObserver() {
    const preview = document.querySelector(".message-preview");
    if (!preview) return;
    const renderStrike = () => { if (preview.innerHTML.includes("~~")) preview.innerHTML = preview.innerHTML.replace(/~~([\s\S]*?)~~/g,"<del>$1</del>"); };
    renderStrike();
    new MutationObserver(renderStrike).observe(preview,{childList:true,subtree:true,characterData:true});
  }

  function serverNow() { return Date.now() + serverOffsetMs; }

  function formatRemainingSeconds(seconds) {
    const whole = Math.max(0, Math.ceil(seconds));
    return `${String(Math.floor(whole / 60)).padStart(2,"0")}:${String(whole % 60).padStart(2,"0")}`;
  }

  function captureCountdownSnapshot(result) {
    if (
      result &&
      result.self_destruct_status === "countdown" &&
      result.countdown_remaining_seconds != null &&
      result.server_time != null
    ) {
      countdownSnapshot = {
        remaining: Number(result.countdown_remaining_seconds),
        rate: Math.max(1, Number(result.countdown_rate || 1)),
        serverTimeMs: Number(result.server_time) * 1000
      };
    } else {
      countdownSnapshot = null;
    }
  }

  function effectiveCountdownRemaining() {
    if (!countdownSnapshot) return null;
    const elapsedReal = Math.max(0, (serverNow() - countdownSnapshot.serverTimeMs) / 1000);
    return Math.max(0, countdownSnapshot.remaining - elapsedReal * countdownSnapshot.rate);
  }

  function render() {
    const banner = document.getElementById(BANNER_ID);
    const gone = document.getElementById(DISAPPEARED_ID);
    const memorial = document.getElementById(MEMORIAL_ID);
    if (!state) return;

    const offline = state.self_destruct_status === "offline";
    const phase = state.presentation_phase || (offline ? "tombstone" : "nominal");
    const disappeared = offline && phase === "disappeared";
    const tombstone = offline && phase === "tombstone";
    if (gone) gone.dataset.active = disappeared ? "true" : "false";
    if (memorial) memorial.dataset.active = tombstone ? "true" : "false";

    const active = state.self_destruct_status === "countdown" && countdownSnapshot != null;
    if (banner) banner.dataset.active = active ? "true" : "false";
    if (!active || !banner) return;

    const remaining = effectiveCountdownRemaining();
    if (remaining == null) return;
    banner.querySelector(".ols-clock").textContent = formatRemainingSeconds(remaining);

    const localClock = document.getElementById("countdown");
    if (localClock) localClock.textContent = formatRemainingSeconds(remaining);

    const rate = countdownSnapshot.rate;
    banner.querySelector(".ols-sub").textContent = rate > 1
      ? `COUNTDOWN ACCELERATED ×${rate} — PROGRESS IS 0. MOVE THE BAR TO 1 TO RETURN TO NORMAL RATE.`
      : "OUR LOVELY SYSTEM WILL SELF-DESTRUCT UNLESS PROGRESS EXCEEDS 50%";

    if (remaining <= 0) poll();
  }

  function stopAlarm() {
    if (alarmTimer) clearInterval(alarmTimer);
    alarmTimer = null;
    if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
  }

  async function soundBurst() {
    if (muted || !state || state.self_destruct_status !== "countdown") return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioContext || audioContext.state === "closed") audioContext = new AudioContextClass();
    try { await audioContext.resume(); } catch (_) { return; }
    const start = audioContext.currentTime;
    const master = audioContext.createGain();
    master.gain.value = .18;
    master.connect(audioContext.destination);
    [0,.22,.44,.72,.94,1.16].forEach((offset,i) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = "square"; osc.frequency.value = i % 2 ? 520 : 760;
      gain.gain.setValueAtTime(1,start+offset); gain.gain.setValueAtTime(0,start+offset+.16);
      osc.connect(gain); gain.connect(master); osc.start(start+offset); osc.stop(start+offset+.18);
    });
  }

  function updateAlarm() {
    if (!state || state.self_destruct_status !== "countdown" || muted) { stopAlarm(); return; }
    const started = Number(state.self_destruct_started_at || 0) * 1000;
    if (!started || serverNow() >= started + ALARM_DURATION_MS) { stopAlarm(); return; }
    if (!alarmTimer) {
      soundBurst();
      alarmTimer = setInterval(() => { if (serverNow() >= started + ALARM_DURATION_MS) stopAlarm(); else soundBurst(); },1800);
    }
  }

  async function poll() {
    try {
      const response = await fetch(`${API_BASE}/state`,{cache:"no-store"});
      if (!response.ok) return;
      const result = await response.json();
      state = result;
      reconcileMessageDraft(result);
      if (result.server_time != null) serverOffsetMs = Number(result.server_time)*1000-Date.now();
      captureCountdownSnapshot(result);
      render();
      updateAlarm();
    } catch (error) {
      console.error("Our Lovely System shared alert poll failed",error);
    }
  }

  async function start() {
    installStyle();
    installBanner();
    installDisappeared();
    installMemorial();
    installMessageDraftProtection();
    installMessageMarkupObserver();
    try {
      const consumed = await consumeAuthenticationCallback();
      if (consumed) await poll();
    } catch (problem) { console.error("Resurrection authentication callback failed", problem); }
    await poll();
    if (state && state.self_destruct_status === "offline" && state.presentation_phase === "tombstone" && location.origin === PROGRESS_ORIGIN && new URLSearchParams(location.search).get("resurrect") === "1" && storedAccessToken()) {
      try { await showAuthenticatedResurrectionForm(); } catch (problem) {
        document.querySelector(`#${MEMORIAL_ID} .ols-resurrection`).dataset.active = "true";
        document.querySelector(`#${MEMORIAL_ID} .ols-resurrection-error`).textContent = problem.message || "Unable to continue resurrection.";
      }
    }
    setInterval(poll,POLL_MS);
    countdownTimer=setInterval(render,FRAME_MS);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",start,{once:true}); else start();
})();
