(() => {
  const LOCAL_HOST = location.hostname === "127.0.0.1" || location.hostname === "localhost";
  if (!LOCAL_HOST) return;

  const BASE = location.origin;
  const SERVER_KEY = "highgas:selected-server";
  const TOR_SERVERS = ["de-fra-01", "us-mia-01"];
  let helperAvailable = false;
  let torReady = false;
  let connected = false;
  let activeServer = "";
  let activeMode = "";
  let connectedAt = 0;
  let lastError = "";
  let busy = false;

  const selectedServer = () => {
    try {
      const v = (localStorage.getItem(SERVER_KEY) || "de-fra-01").toLowerCase();
      return TOR_SERVERS.includes(v) ? v : "de-fra-01";
    } catch {
      return "de-fra-01";
    }
  };

  const label = (code) => code === "us-mia-01" ? "Estados Unidos" : "Alemanha";
  const isTor = () => TOR_SERVERS.includes(selectedServer());
  const setText = (el, value) => { if (el && el.textContent !== value) el.textContent = value; };

  const request = async (path, options = {}) => {
    const { timeoutMs = 5000, ...rest } = options;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE}${path}`, {
        ...rest,
        credentials: "same-origin",
        cache: "no-store",
        signal: ctrl.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(rest.headers || {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.error || `helper_${res.status}`);
        err.status = res.status;
        err.payload = data;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  };

  const findBox = (labelText) => {
    for (const el of document.querySelectorAll("small")) {
      if ((el.textContent || "").trim().toUpperCase() === labelText) return el.parentElement;
    }
    return null;
  };

  const setStat = (name, title, copy) => {
    const box = findBox(name);
    if (!box) return;
    setText(box.querySelector("strong"), title);
    const spans = box.querySelectorAll("span, small");
    const copyEl = [...spans].find((x) => x !== box.querySelector("small"));
    if (copyEl) setText(copyEl, copy);
  };

  const ensureBadge = () => {
    let badge = document.getElementById("highgas-local-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "highgas-local-badge";
      badge.style.cssText = "position:fixed;right:14px;top:14px;z-index:9999;padding:7px 10px;border-radius:999px;font:600 11px -apple-system,BlinkMacSystemFont,sans-serif;border:1px solid rgba(255,255,255,.12);box-shadow:0 8px 24px rgba(0,0,0,.25);pointer-events:none";
      document.body.appendChild(badge);
    }
    badge.style.background = helperAvailable ? "rgba(15,52,31,.92)" : "rgba(48,42,20,.92)";
    badge.style.color = helperAvailable ? "#8dffb6" : "#ffd978";
    setText(badge, helperAvailable ? (torReady ? "HighGAS Local + Tor ✓" : "HighGAS Local ✓") : "HighGAS Local offline");
  };

  const formatDuration = () => {
    if (!connected || !connectedAt) return "00:00:00";
    const t = Math.max(0, Math.floor((Date.now() - connectedAt) / 1000));
    return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map(v => String(v).padStart(2, "0")).join(":");
  };

  const paint = () => {
    ensureBadge();
    document.querySelectorAll(".server-card").forEach((card) => {
      const name = (card.querySelector(".server-copy strong")?.textContent || "").trim();
      if (name === "Alemanha" || name === "Estados Unidos") setText(card.querySelector(".server-copy small"), "Rede Tor · gratuito");
    });
    if (!helperAvailable) return;

    const selected = selectedServer();
    const power = document.querySelector(".power-button");
    const banner = document.querySelector(".connection-banner > div:not(.banner-time) strong");
    const timer = document.querySelector(".banner-time strong");
    const checkTitle = document.querySelector(".connection-check strong");
    const checkCopy = document.querySelector(".connection-check small");
    const profile = document.querySelector(".profile-cta");
    const note = document.querySelector(".system-note");

    setText(banner, connected ? "Conectado" : busy ? "Conectando" : "Não conectado");
    setText(timer, formatDuration());

    if (power) {
      power.disabled = busy;
      const action = busy ? "CONECTANDO…" : connected && activeServer === selected ? "DESLIGAR VPN" : connected ? "TROCAR SAÍDA" : "LIGAR VPN";
      setText(power.querySelector("strong"), action);
      setText(power.querySelector("small"), connected ? `${label(activeServer)} · Tor ativo` : "1 toque · Tor automático");
    }

    setText(checkTitle, connected ? "Tor ativo" : busy ? "Conectando ao Tor" : "Tor pronto para ligar");
    setText(checkCopy, lastError || (connected ? `Saída ${label(activeServer)} ativa.` : "Não precisa de arquivo. Escolha o país e toque em Ligar VPN."));

    if (profile) {
      setText(profile.querySelector("strong"), "Tor integrado");
      setText(profile.querySelector("small"), "Sem .conf, sem cartão e sem arquivo para abrir.");
    }
    setText(note, "HighGAS Local: o botão liga e desliga o Tor diretamente. Abra sempre por https://127.0.0.1:37654/");
    setStat("PERFIL", "Tor integrado", "sem arquivo .conf");
    setStat("MONITOR", connected ? "Tor ativo" : busy ? "Conectando" : "Em espera", connected ? label(activeServer) : "ativa ao ligar");
  };

  const refreshNetwork = async () => {
    if (!helperAvailable) return;
    try {
      const res = await fetch(`${BASE}/api/network-info?ts=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return;
      const data = await res.json();
      setStat("IP ATUAL", data.ip || "—", [data.country, data.city].filter(Boolean).join(" · ") || "—");
    } catch {}
  };

  const refresh = async () => {
    try {
      const s = await request("/v1/status", { method: "GET" });
      helperAvailable = true;
      torReady = Boolean(s.torReady);
      connected = Boolean(s.connected);
      activeServer = s.activeServer || "";
      activeMode = s.mode || "";
      if (connected) {
        const parsed = s.connectedAt ? new Date(s.connectedAt).getTime() : NaN;
        if (Number.isFinite(parsed)) connectedAt = parsed;
        else if (!connectedAt) connectedAt = Date.now();
      } else {
        connectedAt = 0;
      }
    } catch {
      helperAvailable = false;
    }
    paint();
    if (helperAvailable) void refreshNetwork();
  };

  const connect = async () => {
    if (busy) return;
    busy = true;
    lastError = `Conectando ao Tor em ${label(selectedServer())}…`;
    paint();
    try {
      await request("/v1/connect", { method: "POST", timeoutMs: 170000, body: JSON.stringify({ server: selectedServer() }) });
      lastError = "";
      await refresh();
    } catch (e) {
      const detail = e?.payload?.detail;
      lastError = detail || "Não consegui ligar o Tor agora. Tente novamente.";
    } finally {
      busy = false;
      paint();
      void refreshNetwork();
    }
  };

  const disconnect = async () => {
    if (busy) return;
    busy = true;
    lastError = "Desligando…";
    paint();
    try {
      await request("/v1/disconnect", { method: "POST", timeoutMs: 15000, body: "{}" });
      connected = false;
      activeServer = "";
      connectedAt = 0;
      lastError = "Conexão normal restaurada.";
    } catch {
      lastError = "Não consegui desligar agora.";
    } finally {
      busy = false;
      paint();
      setTimeout(() => void refresh(), 600);
    }
  };

  document.addEventListener("click", (event) => {
    const el = event.target instanceof Element ? event.target : null;
    if (!el) return;

    const card = el.closest(".server-card");
    if (card) {
      const name = (card.querySelector(".server-copy strong")?.textContent || "").trim();
      const code = name === "Estados Unidos" ? "us-mia-01" : name === "Alemanha" ? "de-fra-01" : "";
      if (code) {
        try { localStorage.setItem(SERVER_KEY, code); } catch {}
        setTimeout(paint, 80);
      }
    }

    if (el.closest(".profile-cta") && isTor()) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      lastError = "O Tor já está integrado. Nenhum arquivo é necessário.";
      paint();
      return;
    }

    const power = el.closest(".power-button");
    if (power) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      if (!helperAvailable || !torReady) {
        lastError = "HighGAS Local ainda não está pronto.";
        paint();
        return;
      }
      void (connected && activeServer === selectedServer() ? disconnect() : connect());
    }
  }, true);

  document.addEventListener("change", (event) => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.type === "file" && isTor()) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      input.value = "";
      lastError = "O Tor já está integrado. Nenhum arquivo é necessário.";
      paint();
    }
  }, true);

  const observer = new MutationObserver(() => paint());
  const start = () => {
    try { if (!localStorage.getItem(SERVER_KEY)) localStorage.setItem(SERVER_KEY, "de-fra-01"); } catch {}
    observer.observe(document.body, { childList: true, subtree: true });
    paint();
    void refresh();
    setInterval(() => void refresh(), 4000);
    setInterval(() => { if (connected) paint(); }, 1000);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
})();
