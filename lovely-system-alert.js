(() => {
  "use strict";

  const API_BASE = "https://uiwmie0l7e.execute-api.us-east-1.amazonaws.com";
  const POLL_MS = 15000;
  const ALARM_DURATION_MS = 60000;
  const COUNTDOWN_DURATION_MS = 90 * 60 * 1000;
  const STYLE_ID = "lovely-system-alert-style";
  const BANNER_ID = "lovely-system-global-alert";

  let state = null;
  let serverOffsetMs = 0;
  let audioContext = null;
  let alarmTimer = null;
  let countdownTimer = null;
  let muted = false;

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

  function serverNow() { return Date.now() + serverOffsetMs; }

  function formatRemaining(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2,"0")}:${String(seconds % 60).padStart(2,"0")}`;
  }

  function render() {
    const banner = document.getElementById(BANNER_ID);
    if (!banner || !state) return;
    const active = state.self_destruct_status === "countdown" && state.self_destruct_deadline != null;
    banner.dataset.active = active ? "true" : "false";
    if (!active) return;
    const remaining = Number(state.self_destruct_deadline) * 1000 - serverNow();
    banner.querySelector(".ols-clock").textContent = formatRemaining(remaining);
  }

  function stopAlarm() {
    if (alarmTimer) clearInterval(alarmTimer);
    alarmTimer = null;
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
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
    [0, .22, .44, .72, .94, 1.16].forEach((offset, i) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = "square";
      osc.frequency.value = i % 2 ? 520 : 760;
      gain.gain.setValueAtTime(1, start + offset);
      gain.gain.setValueAtTime(0, start + offset + .16);
      osc.connect(gain); gain.connect(master);
      osc.start(start + offset); osc.stop(start + offset + .18);
    });
  }

  function updateAlarm() {
    if (!state || state.self_destruct_status !== "countdown" || state.self_destruct_deadline == null || muted) {
      stopAlarm();
      return;
    }
    const deadlineMs = Number(state.self_destruct_deadline) * 1000;
    const startedMs = deadlineMs - COUNTDOWN_DURATION_MS;
    const alarmEndsMs = startedMs + ALARM_DURATION_MS;
    if (serverNow() >= alarmEndsMs) {
      stopAlarm();
      return;
    }
    if (!alarmTimer) {
      soundBurst();
      alarmTimer = setInterval(() => {
        if (serverNow() >= alarmEndsMs) stopAlarm(); else soundBurst();
      }, 1800);
    }
  }

  async function poll() {
    try {
      const response = await fetch(`${API_BASE}/state`, {cache:"no-store"});
      if (!response.ok) return;
      const result = await response.json();
      state = result;
      if (result.server_time != null) serverOffsetMs = Number(result.server_time) * 1000 - Date.now();
      render();
      updateAlarm();
    } catch (error) {
      console.error("Our Lovely System shared alert poll failed", error);
    }
  }

  function start() {
    installStyle();
    installBanner();
    poll();
    setInterval(poll, POLL_MS);
    countdownTimer = setInterval(render, 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once:true});
  else start();
})();
