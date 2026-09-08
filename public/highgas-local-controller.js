(() => {
  const LOCAL_HOST = location.hostname === "127.0.0.1" || location.hostname === "localhost";
  if (!LOCAL_HOST) return;

  const BASE = location.origin;
  const SERVER_KEY = "highgas:selected-server";
  const TOR_SERVERS = ["de-fra-01", "us-mia-01"];
  const CHECKS = [
    { key: "ip", icon: "⇄", label: "IP alterado" },
    { key: "country", icon: "◎", label: "País correto" },
    { key: "dns", icon: "⌁", label: "DNS protegido" },
    { key: "ipv6", icon: "6", label: "IPv6 sem vazamento" },
    { key: "route", icon: "⬟", label: "Kill Switch" },
  ];

  let helperAvailable = false;
  let torReady = false;
  let connected = false;
  let activeServer = "";
  let connectedAt = 0;
  let lastError = "";
  let busy = false;
  let verifyStage = 0;
  let verifyFailed = false;
  let stageTimer = 0;

  const selectedServer = () => {
    try {
      const value = (localStorage.getItem(SERVER_KEY) || "de-fra-01").toLowerCase();
      return TOR_SERVERS.includes(value) ? value : "de-fra-01";
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
    const candidates = [...box.querySelectorAll("span, small")].filter((x) => (x.textContent || "").trim().toUpperCase() !== name);
    if (candidates.length) setText(candidates[candidates.length - 1], copy);
  };

  const installStyles = () => {
    if (document.getElementById("highgas-full-tunnel-style")) return;
    const style = document.createElement("style");
    style.id = "highgas-full-tunnel-style";
    style.textContent = `
      #highgas-verify-panel{margin-top:14px;padding:14px;border:1px solid rgba(141,255,182,.13);border-radius:18px;background:rgba(4,15,10,.46);backdrop-filter:blur(12px)}
      #highgas-verify-panel .hg-v-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
      #highgas-verify-panel .hg-v-head strong{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#dce8e1}
      #highgas-verify-panel .hg-v-head span{font-size:10px;color:#7f9488}
      #highgas-verify-panel .hg-v-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px}
      #highgas-verify-panel .hg-v-item{min-width:0;padding:9px 6px;border:1px solid rgba(255,255,255,.07);border-radius:13px;background:rgba(255,255,255,.025);text-align:center;transition:.25s ease}
      #highgas-verify-panel .hg-v-icon{width:27px;height:27px;margin:0 auto 5px;display:grid;place-items:center;border-radius:50%;font:700 12px -apple-system,BlinkMacSystemFont,sans-serif;background:rgba(255,255,255,.055);color:#75877d;transition:.25s ease}
      #highgas-verify-panel .hg-v-item small{display:block;font-size:9px;line-height:1.2;color:#708078;white-space:normal}
      #highgas-verify-panel .hg-v-item.running{border-color:rgba(255,217,120,.24);background:rgba(255,217,120,.045)}
      #highgas-verify-panel .hg-v-item.running .hg-v-icon{color:#ffd978;box-shadow:0 0 0 0 rgba(255,217,120,.22);animation:hgPulse 1s infinite}
      #highgas-verify-panel .hg-v-item.ok{border-color:rgba(112,255,164,.24);background:rgba(78,255,141,.055)}
      #highgas-verify-panel .hg-v-item.ok .hg-v-icon{color:#7cffac;background:rgba(68,226,124,.12);box-shadow:0 0 18px rgba(70,255,139,.10)}
      #highgas-verify-panel .hg-v-item.ok small{color:#9cb5a7}
      #highgas-verify-panel .hg-v-item.error{border-color:rgba(255,105,105,.28);background:rgba(255,82,82,.05)}
      #highgas-verify-panel .hg-v-item.error .hg-v-icon{color:#ff8d8d;background:rgba(255,82,82,.10)}
      @keyframes hgPulse{0%{box-shadow:0 0 0 0 rgba(255,217,120,.25)}70%{box-shadow:0 0 0 8px rgba(255,217,120,0)}100%{box-shadow:0 0 0 0 rgba(255,217,120,0)}}
      @media(max-width:700px){#highgas-verify-panel .hg-v-grid{grid-template-columns:repeat(3,1fr)}#highgas-verify-panel .hg-v-item:nth-child(4),#highgas-verify-panel .hg-v-item:nth-child(5){grid-column:auto}}
    `;
    document.head.appendChild(style);
  };

  const ensureVerifyPanel = () => {
    installStyles();
    let panel = document.getElementById("highgas-verify-panel");
    const anchor = document.querySelector(".connection-check");
    if (!anchor) return null;
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "highgas-verify-panel";
      panel.innerHTML = `
        <div class="hg-v-head"><strong>Verificação completa</strong><span>5 pontos</span></div>
        <div class="hg-v-grid">${CHECKS.map((item) => `<div class="hg-v-item" data-check="${item.key}"><div class="hg-v-icon">${item.icon}</div><small>${item.label}</small></div>`).join("")}</div>
      `;
      anchor.insertAdjacentElement("afterend", panel);
    }
    return panel;
  };

  const paintChecks = () => {
    const panel = ensureVerifyPanel();
    if (!panel) return;
    const stateLabel = panel.querySelector(".hg-v-head span");
    if (connected) setText(stateLabel, "5/5 protegidos");
    else if (busy) setText(stateLabel, `${Math.min(verifyStage, 5)}/5 verificando`);
    else if (verifyFailed) setText(stateLabel, "falhou · desconectado");
    else setText(stateLabel, "aguardando");

    CHECKS.forEach((item, index) => {
      const row = panel.querySelector(`[data-check="${item.key}"]`);
      if (!row) return;
      row.classList.remove("running", "ok", "error");
      const icon = row.querySelector(".hg-v-icon");
      if (connected || (busy && index < verifyStage)) {
        row.classList.add("ok");
        setText(icon, "✓");
      } else if (busy && index === verifyStage) {
        row.classList.add("running");
        setText(icon, item.icon);
      } else if (verifyFailed && index === Math.min(verifyStage, CHECKS.length - 1)) {
        row.classList.add("error");
        setText(icon, "!");
      } else {
        setText(icon, item.icon);
      }
    });
  };

  const startCheckAnimation = () => {
    clearInterval(stageTimer);
    verifyStage = 0;
    verifyFailed = false;
    stageTimer = window.setInterval(() => {
      if (!busy || connected) {
        clearInterval(stageTimer);
        return;
      }
      verifyStage = Math.min(4, verifyStage + 1);
      paintChecks();
    }, 1700);
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
    setText(badge, helperAvailable ? (torReady ? "HighGAS Full Tunnel ✓" : "HighGAS Local ✓") : "HighGAS Local offline");
  };

  const formatDuration = () => {
    if (!connected || !connectedAt) return "00:00:00";
    const t = Math.max(0, Math.floor((Date.now() - connectedAt) / 1000));
    return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map(v => String(v).padStart(2, "0")).join(":");
  };

  const paint = () => {
    ensureBadge();
    paintChecks();
    document.querySelectorAll(".server-card").forEach((card) => {
      const name = (card.querySelector(".server-copy strong")?.textContent || "").trim();
      if (name === "Alemanha" || name === "Estados Unidos") setText(card.querySelector(".server-copy small"), "Full Tunnel · Tor gratuito");
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

    setText(banner, connected ? "Conectado · 5/5" : busy ? "Protegendo o Mac…" : "Não conectado");
    setText(timer, formatDuration());

    if (power) {
      power.disabled = busy;
      const action = busy ? "VERIFICANDO…" : connected && activeServer === selected ? "DESLIGAR VPN" : connected ? "TROCAR SAÍDA" : "LIGAR VPN";
      setText(power.querySelector("strong"), action);
      setText(power.querySelector("small"), connected ? `${label(activeServer)} · Full Tunnel protegido` : busy ? "IP · país · DNS · IPv6 · Kill Switch" : "1 toque · proteção do sistema inteiro");
    }

    setText(checkTitle, connected ? "Proteção completa ativa" : busy ? "Validando 5 pontos antes de conectar" : "Full Tunnel pronto para ligar");
    setText(checkCopy, lastError || (connected ? `Saída ${label(activeServer)} confirmada. Se algum ponto de segurança cair, o HighGAS encerra a conexão.` : "O HighGAS só fica verde depois das cinco verificações."));

    if (profile) {
      setText(profile.querySelector("strong"), "Full Tunnel integrado");
      setText(profile.querySelector("small"), "Sem .conf e sem servidor pago. Kill Switch fail-closed.");
    }
    setText(note, "Full Tunnel gratuito: TCP IPv4 e DNS passam pelo Tor. IPv6 e UDP são bloqueados enquanto ligado para impedir vazamento do IP real; apps que exigem UDP podem ficar sem conexão.");
    setStat("PERFIL", "Full Tunnel", "Tor + tun2socks + Kill Switch");
    setStat("MONITOR", connected ? "5/5 protegido" : busy ? "Verificando" : "Em espera", connected ? label(activeServer) : "fail-closed ao ligar");
  };

  const refreshNetwork = async () => {
    if (!helperAvailable || busy) return;
    try {
      const res = await fetch(`${BASE}/api/network-info?ts=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return;
      const data = await res.json();
      setStat("IP ATUAL", data.ip || "—", [data.country, data.city].filter(Boolean).join(" · ") || "—");
    } catch {}
  };

  const refresh = async () => {
    if (busy) return;
    try {
      const s = await request("/v1/status", { method: "GET", timeoutMs: 9000 });
      helperAvailable = true;
      torReady = Boolean(s.torReady);
      connected = Boolean(s.connected);
      activeServer = s.activeServer || "";
      if (connected) {
        verifyStage = 5;
        verifyFailed = false;
        const parsed = s.connectedAt ? new Date(s.connectedAt).getTime() : NaN;
        if (Number.isFinite(parsed)) connectedAt = parsed;
        else if (!connectedAt) connectedAt = Date.now();
      } else {
        connectedAt = 0;
        if (!lastError) verifyStage = 0;
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
    verifyStage = 0;
    verifyFailed = false;
    lastError = `Criando Full Tunnel em ${label(selectedServer())}…`;
    startCheckAnimation();
    paint();
    try {
      await request("/v1/connect", { method: "POST", timeoutMs: 250000, body: JSON.stringify({ server: selectedServer() }) });
      connected = true;
      activeServer = selectedServer();
      verifyStage = 5;
      verifyFailed = false;
      lastError = "5 verificações concluídas. IP real protegido.";
    } catch (e) {
      connected = false;
      verifyFailed = true;
      const detail = e?.payload?.detail;
      lastError = detail || "A proteção não passou em todas as verificações. O HighGAS desligou para não vazar seu IP.";
    } finally {
      clearInterval(stageTimer);
      busy = false;
      paint();
      setTimeout(() => void refresh(), 450);
    }
  };

  const disconnect = async () => {
    if (busy) return;
    busy = true;
    lastError = "Restaurando a conexão normal…";
    paint();
    try {
      await request("/v1/disconnect", { method: "POST", timeoutMs: 20000, body: "{}" });
      connected = false;
      activeServer = "";
      connectedAt = 0;
      verifyStage = 0;
      verifyFailed = false;
      lastError = "Conexão normal restaurada.";
    } catch {
      lastError = "Não consegui confirmar a restauração da rede. Tente Desligar novamente.";
    } finally {
      busy = false;
      paint();
      setTimeout(() => void refresh(), 700);
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
        verifyStage = 0;
        verifyFailed = false;
        setTimeout(paint, 80);
      }
    }

    if (el.closest(".profile-cta") && isTor()) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      lastError = "Full Tunnel já está integrado. Nenhum arquivo é necessário.";
      paint();
      return;
    }

    const power = el.closest(".power-button");
    if (power) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
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
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      input.value = "";
      lastError = "Full Tunnel já está integrado. Nenhum arquivo é necessário.";
      paint();
    }
  }, true);

  const observer = new MutationObserver(() => paint());
  const start = () => {
    try { if (!localStorage.getItem(SERVER_KEY)) localStorage.setItem(SERVER_KEY, "de-fra-01"); } catch {}
    observer.observe(document.body, { childList: true, subtree: true });
    paint();
    void refresh();
    setInterval(() => { if (!busy) void refresh(); }, 5000);
    setInterval(() => { if (connected && !busy) paint(); }, 1000);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
