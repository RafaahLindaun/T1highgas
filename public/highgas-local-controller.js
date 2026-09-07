(() => {
  const LOCAL_HOST = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
  const BASE = LOCAL_HOST ? window.location.origin : "https://127.0.0.1:37654";
  const TOKEN_KEY = "highgas:helper-token";
  const SERVER_KEY = "highgas:selected-server";
  const PHASES = ["idle", "preparing", "waiting", "connected", "attention"];
  const DEFAULT_TOR_SERVERS = ["de-fra-01", "us-mia-01"];

  let token = "";
  let helperAvailable = false;
  let connected = false;
  let activeServer = "";
  let activeMode = "";
  let activeCountry = "";
  let connectedAt = 0;
  let lastError = "";
  let torReady = false;
  let torServers = [...DEFAULT_TOR_SERVERS];

  try {
    const match = window.location.hash.match(/^#highgas-helper=([a-f0-9]{32,})$/i);
    if (match) {
      localStorage.setItem(TOKEN_KEY, match[1]);
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
    token = localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    token = "";
  }

  const selectedServerCode = () => {
    try {
      return (localStorage.getItem(SERVER_KEY) || "de-fra-01").toLowerCase();
    } catch {
      return "de-fra-01";
    }
  };

  const isTorSelection = () => torServers.includes(selectedServerCode());
  const countryLabel = (server) => {
    if (server === "de-fra-01") return "Alemanha";
    if (server === "us-mia-01") return "Estados Unidos";
    return server || "HighGAS";
  };

  const request = async (path, options = {}) => {
    if (!token) throw new Error("not_paired");
    const { timeoutMs = 3000, ...fetchOptions } = options;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${BASE}${path}`, {
        ...fetchOptions,
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(fetchOptions.headers || {}),
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || `helper_${response.status}`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const setText = (element, value) => {
    if (element && element.textContent !== value) element.textContent = value;
  };

  const setPhaseClass = (element, prefix, phase) => {
    if (!element) return;
    PHASES.forEach((item) => element.classList.remove(`${prefix}${item}`));
    element.classList.add(`${prefix}${phase}`);
  };

  const formatDuration = () => {
    if (!connected || !connectedAt) return "00:00:00";
    const total = Math.max(0, Math.floor((Date.now() - connectedAt) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  };

  const findLabeledContainer = (label) => {
    const wanted = label.toUpperCase();
    const labels = document.querySelectorAll("small, span, p, div");
    for (const element of labels) {
      if (element.childElementCount === 0 && (element.textContent || "").trim().toUpperCase() === wanted) {
        return element.parentElement;
      }
    }
    return null;
  };

  const updateLabeledStat = (label, title, copy) => {
    const box = findLabeledContainer(label);
    if (!box) return;
    setText(box.querySelector("strong"), title);
    setText(box.querySelector("small"), copy);
  };

  const updateServerCards = () => {
    document.querySelectorAll(".server-card").forEach((card) => {
      const name = card.querySelector(".server-copy strong");
      const copy = card.querySelector(".server-copy small");
      const value = (name && name.textContent || "").trim();
      if (value === "Alemanha" || value === "Estados Unidos") {
        setText(copy, "Rede Tor · gratuito");
      }
    });
  };

  const ensureBadge = () => {
    let badge = document.getElementById("highgas-local-badge");
    if (!token) {
      if (badge) badge.style.display = "none";
      return;
    }

    if (!badge) {
      badge = document.createElement("div");
      badge.id = "highgas-local-badge";
      badge.style.cssText = [
        "position:fixed",
        "right:14px",
        "top:max(14px, env(safe-area-inset-top))",
        "z-index:9999",
        "padding:7px 10px",
        "border-radius:999px",
        "font:600 11px/1.2 -apple-system,BlinkMacSystemFont,sans-serif",
        "backdrop-filter:blur(14px)",
        "border:1px solid rgba(255,255,255,.12)",
        "box-shadow:0 8px 24px rgba(0,0,0,.25)",
        "pointer-events:none",
      ].join(";");
      document.body.appendChild(badge);
    }

    badge.style.display = "block";
    badge.style.background = helperAvailable ? "rgba(15,52,31,.88)" : "rgba(48,42,20,.9)";
    badge.style.color = helperAvailable ? "#8dffb6" : "#ffd978";
    setText(badge, helperAvailable ? (torReady ? "HighGAS Local + Tor ✓" : "HighGAS Local ✓") : "HighGAS Local offline");
  };

  const paint = () => {
    if (!document.body) return;
    ensureBadge();
    updateServerCards();
    if (!helperAvailable) return;

    const selected = selectedServerCode();
    const torSelected = isTorSelection() && torReady;
    const sameActive = connected && activeServer === selected;
    const phase = connected ? "connected" : "idle";
    const powerCard = document.querySelector(".power-card");
    const powerButton = document.querySelector(".power-button");
    const bannerStatus = document.querySelector(".connection-banner > div:not(.banner-time) strong");
    const timer = document.querySelector(".banner-time strong");
    const check = document.querySelector(".connection-check .check-icon");
    const checkTitle = document.querySelector(".connection-check strong");
    const checkCopy = document.querySelector(".connection-check small");
    const note = document.querySelector(".system-note");
    const profileTitle = document.querySelector(".profile-cta strong");
    const profileCopy = document.querySelector(".profile-cta small");

    setPhaseClass(powerCard, "power-card--", phase);
    setPhaseClass(powerButton, "power-button--", phase);

    setText(bannerStatus, connected ? "Conectado" : "Não conectado");
    setText(timer, formatDuration());

    if (powerButton) {
      powerButton.disabled = false;
      const action = sameActive ? "DESLIGAR VPN" : connected ? "TROCAR SAÍDA" : "LIGAR VPN";
      powerButton.setAttribute("aria-label", action);
      setText(powerButton.querySelector("strong"), action);
      setText(
        powerButton.querySelector("small"),
        connected
          ? `${countryLabel(activeServer)} · ${activeMode === "tor" ? "Tor ativo" : "controle local ativo"}`
          : torSelected
            ? "1 toque · Tor automático"
            : "1 toque · controle local automático"
      );
    }

    if (check) {
      setText(check, connected ? "✓" : "·");
      check.classList.toggle("check-icon--ok", connected);
    }

    if (torSelected) {
      setText(checkTitle, connected ? "Tor ativo" : "Tor pronto para ligar");
      setText(
        checkCopy,
        lastError || (connected
          ? `Saída ${countryLabel(activeServer)} ativa. Alguns sites podem identificar ou bloquear IPs da rede Tor.`
          : "A primeira conexão pode levar até cerca de 1 minuto. Não precisa de perfil WireGuard.")
      );
      setText(profileTitle, "Tor integrado");
      setText(profileCopy, "Sem .conf, sem cartão e sem servidor pago.");
      setText(note, "Modo Tor gratuito: navegação e apps que respeitam o proxy do macOS passam pelo Tor. UDP e apps que ignoram proxy podem usar a conexão normal.");
      updateLabeledStat("PERFIL", "Tor integrado", "sem arquivo .conf");
      updateLabeledStat("MONITOR", connected ? "Tor ativo" : "Em espera", connected ? countryLabel(activeServer) : "ativa ao ligar");
    } else {
      setText(checkTitle, connected ? "Você está conectado" : "VPN pronta para ligar");
      setText(
        checkCopy,
        lastError || (connected
          ? "O HighGAS controla o túnel WireGuard diretamente e continua ativo em segundo plano."
          : "Toque em Ligar VPN. Não é necessário abrir o aplicativo WireGuard.")
      );
      setText(profileTitle, "Instalar perfil HighGAS");
      setText(profileCopy, "Escolha o .conf uma vez; o HighGAS guarda o perfil somente neste Mac.");
      setText(note, LOCAL_HOST
        ? "HighGAS Local ativo: interface e WireGuard estão conectados diretamente neste Mac."
        : "HighGAS Local usa WireGuard por baixo e controla a VPN diretamente no macOS, sem Xcode.");
    }
  };

  const refreshNetworkDisplay = async () => {
    if (!helperAvailable) return;
    try {
      const response = await fetch(`${BASE}/api/network-info?ts=${Date.now()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const data = await response.json();
      updateLabeledStat("IP ATUAL", data.ip || "—", [data.country, data.city].filter(Boolean).join(" · ") || "—");
    } catch {
      // O monitor principal continua funcionando mesmo se esta leitura visual falhar.
    }
  };

  const refresh = async () => {
    if (!token) {
      helperAvailable = false;
      paint();
      return;
    }

    try {
      const result = await request("/v1/status", { method: "GET" });
      helperAvailable = true;
      connected = Boolean(result.connected);
      activeServer = result.activeServer || "";
      activeMode = result.mode || "";
      activeCountry = result.country || "";
      torReady = Boolean(result.torReady);
      if (Array.isArray(result.torServers) && result.torServers.length) {
        torServers = result.torServers.map((item) => String(item).toLowerCase());
      }
      if (connected) {
        const parsed = result.connectedAt ? new Date(result.connectedAt).getTime() : NaN;
        if (Number.isFinite(parsed)) connectedAt = parsed;
        else if (!connectedAt) connectedAt = Date.now();
      } else {
        connectedAt = 0;
      }
      if (lastError === "Conexão solicitada. Confirmando o túnel…" || lastError === "Tor conectado. Confirmando o IP de saída…") {
        lastError = "";
      }
    } catch {
      helperAvailable = false;
    }

    paint();
    if (helperAvailable) void refreshNetworkDisplay();
  };

  const connect = async () => {
    const server = selectedServerCode();
    const torSelected = isTorSelection();
    lastError = torSelected ? "Conectando ao Tor e procurando uma saída no país escolhido…" : "Conectando…";
    paint();

    try {
      await request("/v1/connect", {
        method: "POST",
        timeoutMs: torSelected ? 170000 : 15000,
        body: JSON.stringify({ server }),
      });
      lastError = torSelected ? "Tor conectado. Confirmando o IP de saída…" : "Conexão solicitada. Confirmando o túnel…";
      await refresh();
      window.setTimeout(() => void refresh(), 1200);
      window.setTimeout(() => void refresh(), 3500);
    } catch (error) {
      const code = error && error.message;
      const detail = error && error.payload && error.payload.detail;
      if (code === "tor_not_installed") {
        lastError = "Esta instalação ainda não possui o motor Tor. Reinstale o pacote HighGAS com Tor.";
      } else if (code === "tor_timeout") {
        lastError = "O Tor demorou demais para conectar. Tente Ligar VPN novamente.";
      } else if (code === "tor_connect_failed") {
        lastError = detail || "Não consegui criar a saída Tor escolhida agora.";
      } else if (error && error.status === 409) {
        lastError = "O perfil deste país ainda não está instalado. Adicione o .conf uma única vez.";
      } else {
        lastError = "Não consegui acionar o HighGAS Local agora.";
      }
      paint();
    }
  };

  const disconnect = async () => {
    lastError = "Desligando…";
    paint();

    try {
      await request("/v1/disconnect", {
        method: "POST",
        timeoutMs: 15000,
        body: JSON.stringify(activeServer ? { server: activeServer } : {}),
      });
      connected = false;
      activeServer = "";
      activeMode = "";
      activeCountry = "";
      connectedAt = 0;
      lastError = "HighGAS desligado e conexão normal restaurada.";
      await refreshNetworkDisplay();
      window.setTimeout(() => void refresh(), 500);
    } catch {
      lastError = "Não consegui desligar pelo HighGAS Local agora.";
    }

    paint();
  };

  const installProfile = async (file) => {
    if (!file || !helperAvailable) return;
    if (isTorSelection()) {
      lastError = "O modo Tor já vem integrado e não precisa de arquivo .conf.";
      paint();
      return;
    }
    if (file.size > 64 * 1024) {
      lastError = "Esse arquivo é grande demais para um perfil WireGuard.";
      paint();
      return;
    }

    const config = await file.text();
    if (!/\[Interface\]/i.test(config) || !/\[Peer\]/i.test(config) || !/PrivateKey\s*=/i.test(config)) {
      lastError = "Esse arquivo não parece um perfil WireGuard válido.";
      paint();
      return;
    }

    const server = selectedServerCode();
    lastError = "Salvando o perfil somente neste Mac…";
    paint();

    try {
      await request("/v1/install-profile", {
        method: "POST",
        timeoutMs: 8000,
        body: JSON.stringify({ server, config }),
      });
      lastError = "Perfil HighGAS instalado localmente. Agora toque em Ligar VPN.";
      window.setTimeout(() => void refresh(), 800);
    } catch (error) {
      lastError = error && error.message === "invalid_wireguard_config"
        ? "O perfil WireGuard está incompleto."
        : "Não consegui salvar o perfil no HighGAS Local.";
    }

    paint();
  };

  document.addEventListener("click", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element || !helperAvailable || !token) return;

    const profile = element.closest(".profile-cta");
    if (profile && isTorSelection()) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      lastError = "O Tor já está integrado. Não precisa adicionar nenhum perfil.";
      paint();
      return;
    }

    const power = element.closest(".power-button");
    if (power) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const selected = selectedServerCode();
      void (connected && activeServer === selected ? disconnect() : connect());
      return;
    }

    if (element.closest(".server-card")) {
      window.setTimeout(paint, 80);
      window.setTimeout(() => void refreshNetworkDisplay(), 120);
    }
  }, true);

  document.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "file" || !helperAvailable || !token) return;
    const file = input.files && input.files[0];
    if (!file || !file.name.toLowerCase().endsWith(".conf")) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void installProfile(file);
  }, true);

  window.HighGASLocal = {
    refresh,
    connect,
    disconnect,
    installProfile,
    forgetPairing() {
      localStorage.removeItem(TOKEN_KEY);
      token = "";
      helperAvailable = false;
      paint();
    },
  };

  const paintWhenReady = () => {
    paint();
    window.setTimeout(paint, 150);
    window.setTimeout(paint, 600);
    window.setTimeout(paint, 1500);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", paintWhenReady, { once: true });
  } else {
    paintWhenReady();
  }

  void refresh();
  window.setInterval(() => {
    if (token) void refresh();
  }, 4000);
  window.setInterval(() => {
    if (connected) paint();
  }, 1000);
})();
