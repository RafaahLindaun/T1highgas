(() => {
  const BASE = "https://127.0.0.1:37654";
  const TOKEN_KEY = "highgas:helper-token";
  const SERVER_KEY = "highgas:selected-server";
  const PHASES = ["idle", "preparing", "waiting", "connected", "attention"];

  let token = "";
  let helperAvailable = false;
  let connected = false;
  let activeServer = "";
  let connectedAt = 0;
  let lastError = "";

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
    setText(badge, helperAvailable ? "HighGAS Local ✓" : "HighGAS Local offline");
  };

  const paint = () => {
    if (!document.body) return;
    ensureBadge();
    if (!helperAvailable) return;

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
      powerButton.setAttribute("aria-label", connected ? "DESLIGAR VPN" : "LIGAR VPN");
      setText(powerButton.querySelector("strong"), connected ? "DESLIGAR VPN" : "LIGAR VPN");
      setText(
        powerButton.querySelector("small"),
        connected ? `${activeServer || "HighGAS"} · controle local ativo` : "1 toque · controle local automático"
      );
    }

    if (check) {
      setText(check, connected ? "✓" : "·");
      check.classList.toggle("check-icon--ok", connected);
    }

    setText(checkTitle, connected ? "Você está conectado" : "VPN pronta para ligar");
    setText(
      checkCopy,
      lastError ||
        (connected
          ? "O HighGAS controla o túnel WireGuard diretamente e continua ativo em segundo plano."
          : "Toque em Ligar VPN. Não é necessário abrir o aplicativo WireGuard.")
    );
    setText(profileTitle, "Instalar perfil HighGAS");
    setText(profileCopy, "Escolha o .conf uma vez; o HighGAS guarda o perfil somente neste Mac.");
    setText(note, "HighGAS Local usa WireGuard por baixo e controla a VPN diretamente no macOS, sem Xcode.");
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
      const wasConnected = connected;
      connected = Boolean(result.connected);
      activeServer = result.activeServer || "";
      if (connected && !wasConnected) connectedAt = Date.now();
      if (!connected) connectedAt = 0;
      if (lastError === "Conexão solicitada. Confirmando o túnel…") lastError = "";
    } catch {
      helperAvailable = false;
    }

    paint();
  };

  const connect = async () => {
    const server = (localStorage.getItem(SERVER_KEY) || "br-sao-01").toLowerCase();
    lastError = "Conectando…";
    paint();

    try {
      await request("/v1/connect", {
        method: "POST",
        body: JSON.stringify({ server }),
      });
      lastError = "Conexão solicitada. Confirmando o túnel…";
      window.setTimeout(() => void refresh(), 800);
      window.setTimeout(() => void refresh(), 2200);
    } catch (error) {
      lastError = error && error.status === 409
        ? "O perfil deste país ainda não está instalado. Adicione o .conf uma única vez."
        : "Não consegui acionar o HighGAS Local agora.";
    }

    paint();
  };

  const disconnect = async () => {
    lastError = "Desligando…";
    paint();

    try {
      await request("/v1/disconnect", {
        method: "POST",
        body: JSON.stringify(activeServer ? { server: activeServer } : {}),
      });
      connected = false;
      activeServer = "";
      connectedAt = 0;
      lastError = "VPN desligada pelo HighGAS Local.";
    } catch {
      lastError = "Não consegui desligar pelo HighGAS Local agora.";
    }

    paint();
  };

  const installProfile = async (file) => {
    if (!file || !helperAvailable) return;
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

    const server = (localStorage.getItem(SERVER_KEY) || "br-sao-01").toLowerCase();
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
    const target = event.target instanceof Element ? event.target.closest(".power-button") : null;
    if (!target || !helperAvailable || !token) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void (connected ? disconnect() : connect());
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
