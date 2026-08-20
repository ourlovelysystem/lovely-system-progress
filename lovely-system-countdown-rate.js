(() => {
  "use strict";

  const API_BASE = "https://uiwmie0l7e.execute-api.us-east-1.amazonaws.com";
  const POLL_MS = 2000;
  const FRAME_MS = 50;

  let snapshot = null;
  let serverOffsetMs = 0;
  let lastForcedPoll = 0;

  function serverNowMs() {
    return Date.now() + serverOffsetMs;
  }

  function formatRemaining(seconds) {
    const whole = Math.max(0, Math.ceil(seconds));
    const minutes = Math.floor(whole / 60);
    const secs = whole % 60;
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function effectiveRemaining() {
    if (!snapshot || snapshot.status !== "countdown") return null;
    const elapsedReal = Math.max(0, (serverNowMs() - snapshot.serverTimeMs) / 1000);
    return Math.max(0, snapshot.remaining - elapsedReal * snapshot.rate);
  }

  function paint() {
    const remaining = effectiveRemaining();
    if (remaining == null) return;
    const text = formatRemaining(remaining);

    document.querySelectorAll(".ols-clock").forEach(node => {
      node.textContent = text;
    });

    const localClock = document.getElementById("countdown");
    if (localClock) localClock.textContent = text;

    document.querySelectorAll(".ols-sub").forEach(node => {
      if (snapshot.rate > 1) {
        node.textContent = `COUNTDOWN ACCELERATED ${snapshot.rate}× — MOVE PROGRESS TO 1 TO RETURN TO NORMAL SPEED`;
      } else {
        node.textContent = "OUR LOVELY SYSTEM WILL SELF-DESTRUCT UNLESS PROGRESS EXCEEDS 50%";
      }
    });

    if (remaining <= 0 && Date.now() - lastForcedPoll > 500) {
      lastForcedPoll = Date.now();
      poll();
    }
  }

  async function poll() {
    try {
      const response = await fetch(`${API_BASE}/state`, {cache: "no-store"});
      if (!response.ok) return;
      const result = await response.json();
      if (result.server_time != null) {
        serverOffsetMs = Number(result.server_time) * 1000 - Date.now();
      }
      if (
        result.self_destruct_status === "countdown" &&
        result.countdown_remaining_seconds != null
      ) {
        snapshot = {
          status: "countdown",
          remaining: Number(result.countdown_remaining_seconds),
          rate: Math.max(1, Number(result.countdown_rate || 1)),
          serverTimeMs: Number(result.server_time) * 1000
        };
      } else {
        snapshot = {status: result.self_destruct_status || "normal"};
      }
      paint();
    } catch (error) {
      console.error("Our Lovely System countdown-rate poll failed", error);
    }
  }

  poll();
  setInterval(poll, POLL_MS);
  setInterval(paint, FRAME_MS);
})();
