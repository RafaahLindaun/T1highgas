import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fallbackServers,
  loadVpnServers,
  type CatalogSource,
  type VpnServer,
} from "./lib/highgasData";

type Tab = "home" | "locations" | "setup" | "diagnostics";
type ConnectionPhase = "idle" | "preparing" | "waiting" | "connected" | "attention";

type NetworkInfo = {
  ip: string | null;
  country: string | null;
  city: string | null;
  source: string;
  checkedAt: string;
};

type ImportedConfig = {
  name: string;
  content: string;
};

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "Início", icon: "⌂" },
  { id: "locations", label: "Países", icon: "◎" },
  { id: "setup", label: "Perfil", icon: "◇" },
  { id: "diagnostics", label: "Status", icon: "◉" },
];

const flagFromCode = (code: string) =>
  code
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));

const formatClock = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const formatDuration = (totalSeconds: number) => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
};

const deviceLabel = () => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "iPhone / iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  return "Navegador";
};

async function fetchNetworkSnapshot(): Promise<NetworkInfo> {
  const response = await fetch(`/api/network-info?ts=${Date.now()}`, {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`network_${response.status}`);
  }

  return (await response.json()) as NetworkInfo;
}

function StatusDot({ status }: { status: VpnServer["status"] }) {
  return (
    <span
      className={`server-dot server-dot--${status}`}
      aria-label={status === "online" ? "online" : status}
    />
  );
}

function Brand() {
  return (
    <div className="brand" aria-label="HighGAS">
      <div className="brand-mark" aria-hidden="true">
        <span />
      </div>
      <div>
        <strong>HighGAS</strong>
        <small>VPN pessoal</small>
      </div>
    </div>
  );
}

function ServerCard({
  server,
  selected,
  onSelect,
}: {
  server: VpnServer;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`server-card ${selected ? "server-card--selected" : ""}`}
      onClick={onSelect}
      disabled={server.status === "offline"}
    >
      <span className="flag">{flagFromCode(server.country_code)}</span>
      <span className="server-copy">
        <strong>{server.country_name}</strong>
        <small>
          {server.city} · {server.protocol === "wireguard" ? "WireGuard" : "OpenVPN"}
        </small>
      </span>
      <span className="server-side">
        <StatusDot status={server.status} />
        <small>{server.is_recommended ? "Recomendado" : "Disponível"}</small>
      </span>
    </button>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [servers, setServers] = useState<VpnServer[]>(fallbackServers);
  const [serverSource, setServerSource] = useState<CatalogSource>("fallback");
  const [selectedCode, setSelectedCode] = useState(() => {
    try {
      return localStorage.getItem("highgas:selected-server") || "br-sao-01";
    } catch {
      return "br-sao-01";
    }
  });
  const [config, setConfig] = useState<ImportedConfig | null>(null);
  const [configMessage, setConfigMessage] = useState("");
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [baselineNetwork, setBaselineNetwork] = useState<NetworkInfo | null>(null);
  const [phase, setPhase] = useState<ConnectionPhase>("idle");
  const [connectionStartedAt, setConnectionStartedAt] = useState<string | null>(null);
  const [connectionDetectedAt, setConnectionDetectedAt] = useState<string | null>(null);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [statusMessage, setStatusMessage] = useState(
    "Escolha um país e toque em Ligar VPN."
  );
  const [networkLoading, setNetworkLoading] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;

    void loadVpnServers().then((result) => {
      if (!mounted) return;
      setServers(result.servers);
      setServerSource(result.source);

      const stillExists = result.servers.some(
        (server) => server.code === selectedCode
      );
      if (!stillExists) {
        const recommended =
          result.servers.find((server) => server.is_recommended) ||
          result.servers[0];
        if (recommended) setSelectedCode(recommended.code);
      }
    });

    void fetchNetworkSnapshot()
      .then((snapshot) => {
        if (mounted) setNetwork(snapshot);
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("highgas:selected-server", selectedCode);
    } catch {
      // Preference only.
    }
  }, [selectedCode]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      if (phase === "attention") {
        setPhase("waiting");
        setStatusMessage("Internet voltou. Verificando a VPN automaticamente…");
      }
    };
    const handleOffline = () => {
      setOnline(false);
      if (phase !== "idle") {
        setPhase("attention");
        setStatusMessage("Sem internet. O HighGAS volta a verificar assim que a rede retornar.");
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [phase]);

  const selectedServer = useMemo(
    () =>
      servers.find((server) => server.code === selectedCode) ||
      servers.find((server) => server.is_recommended) ||
      servers[0],
    [servers, selectedCode]
  );

  const isConnected = phase === "connected";
  const isBusy = phase === "preparing" || phase === "waiting";
  const targetMatches = Boolean(
    network?.country &&
      selectedServer &&
      network.country.toUpperCase() === selectedServer.country_code.toUpperCase()
  );
  const ipChanged = Boolean(
    baselineNetwork?.ip &&
      network?.ip &&
      baselineNetwork.ip !== network.ip
  );

  const evaluateConnection = useCallback(
    (snapshot: NetworkInfo) => {
      if (!selectedServer || phase === "idle" || phase === "preparing") return;

      const sameTargetCountry =
        snapshot.country?.toUpperCase() === selectedServer.country_code.toUpperCase();
      const changedFromBaseline = Boolean(
        baselineNetwork?.ip &&
          snapshot.ip &&
          baselineNetwork.ip !== snapshot.ip
      );

      if (changedFromBaseline && sameTargetCountry) {
        setPhase("connected");
        setConnectionDetectedAt((current) => current || new Date().toISOString());
        setStatusMessage(
          `VPN detectada em ${selectedServer.city}. O HighGAS continuará monitorando automaticamente.`
        );
        return;
      }

      if (
        phase === "connected" &&
        baselineNetwork?.ip &&
        snapshot.ip === baselineNetwork.ip
      ) {
        setPhase("waiting");
        setConnectionDetectedAt(null);
        setSessionSeconds(0);
        setStatusMessage(
          "O IP voltou ao endereço anterior. Ative novamente o túnel no WireGuard."
        );
        return;
      }

      if (phase === "waiting") {
        setStatusMessage(
          `Aguardando o WireGuard assumir a conexão em ${selectedServer.country_name}. Você pode sair do navegador e voltar; eu verifico quando a página retornar.`
        );
      }
    },
    [baselineNetwork, phase, selectedServer]
  );

  const checkNetwork = useCallback(
    async (silent = false) => {
      if (!silent) setNetworkLoading(true);
      try {
        const snapshot = await fetchNetworkSnapshot();
        setNetwork(snapshot);
        evaluateConnection(snapshot);
        return snapshot;
      } catch {
        if (!silent) {
          setStatusMessage("Não consegui consultar seu IP agora. Vou tentar novamente sozinho.");
        }
        return null;
      } finally {
        if (!silent) setNetworkLoading(false);
      }
    },
    [evaluateConnection]
  );

  useEffect(() => {
    if (phase !== "waiting" && phase !== "connected") return;

    const delay = phase === "waiting" ? 4000 : 12000;
    const id = window.setInterval(() => {
      void checkNetwork(true);
    }, delay);

    const refresh = () => {
      if (document.visibilityState === "visible") void checkNetwork(true);
    };

    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [checkNetwork, phase]);

  useEffect(() => {
    if (!connectionDetectedAt || phase !== "connected") {
      setSessionSeconds(0);
      return;
    }

    const tick = () => {
      const detected = new Date(connectionDetectedAt).getTime();
      setSessionSeconds(Math.max(0, Math.floor((Date.now() - detected) / 1000)));
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [connectionDetectedAt, phase]);

  useEffect(() => {
    if (phase === "idle") return;
    setBaselineNetwork(null);
    setConnectionStartedAt(null);
    setConnectionDetectedAt(null);
    setSessionSeconds(0);
    setPhase("idle");
    setStatusMessage("País alterado. Toque em Ligar VPN para iniciar uma nova verificação.");
  }, [selectedCode]);

  const chooseServer = (server: VpnServer) => {
    if (server.status === "offline") return;
    setSelectedCode(server.code);
    if (window.innerWidth < 760) setActiveTab("home");
  };

  const handleConfigFile = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setConfigMessage("");

    if (file.size > 64 * 1024) {
      setConfigMessage("Esse arquivo é grande demais para um perfil WireGuard.");
      return;
    }

    const text = await file.text();
    const looksLikeWireGuard =
      /\[Interface\]/i.test(text) &&
      /\[Peer\]/i.test(text) &&
      /PrivateKey\s*=/i.test(text);

    if (!looksLikeWireGuard) {
      setConfigMessage("O arquivo não parece um perfil WireGuard válido (.conf).");
      return;
    }

    setConfig({ name: file.name, content: text });
    setConfigMessage("Perfil validado. Ele fica somente neste navegador.");
    setStatusMessage("Perfil pronto. Agora toque em Ligar VPN.");
  };

  const downloadConfig = () => {
    if (!config) {
      fileInputRef.current?.click();
      return;
    }

    const blob = new Blob([config.content], {
      type: "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = config.name.endsWith(".conf")
      ? config.name
      : `${config.name}.conf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const handoffConfig = async () => {
    if (!config) return false;

    const file = new File(
      [config.content],
      config.name.endsWith(".conf") ? config.name : `${config.name}.conf`,
      { type: "application/octet-stream" }
    );

    const sharePayload = {
      files: [file],
      title: "HighGAS WireGuard",
      text: "Abra este perfil no WireGuard e ative o túnel.",
    };

    try {
      if (
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare(sharePayload)
      ) {
        await navigator.share(sharePayload);
        return true;
      }
    } catch {
      // If the share sheet is cancelled, keep the fallback download available.
    }

    downloadConfig();
    return true;
  };

  const startConnection = async () => {
    if (!online) {
      setPhase("attention");
      setStatusMessage("Sem internet. Conecte o dispositivo a uma rede primeiro.");
      return;
    }

    if (!selectedServer) {
      setActiveTab("locations");
      return;
    }

    if (!config) {
      setStatusMessage("Importe seu perfil WireGuard uma vez para continuar.");
      fileInputRef.current?.click();
      return;
    }

    setPhase("preparing");
    setConnectionDetectedAt(null);
    setSessionSeconds(0);
    setStatusMessage("Preparando o perfil e registrando seu IP atual…");

    const baselinePromise = fetchNetworkSnapshot().catch(() => null);
    await handoffConfig();

    const baseline = await baselinePromise;
    if (baseline) {
      setBaselineNetwork(baseline);
      setNetwork(baseline);
    } else {
      setBaselineNetwork(network);
    }

    setConnectionStartedAt(new Date().toISOString());
    setPhase("waiting");
    setStatusMessage(
      "Ative o túnel no WireGuard. O HighGAS já está verificando sozinho e confirma assim que o IP mudar."
    );

    window.setTimeout(() => {
      void checkNetwork(true);
    }, 1500);
  };

  const stopMonitoring = () => {
    setPhase("idle");
    setBaselineNetwork(null);
    setConnectionStartedAt(null);
    setConnectionDetectedAt(null);
    setSessionSeconds(0);
    setStatusMessage(
      "Monitoramento encerrado. Para desligar a VPN de verdade, desligue o túnel no WireGuard."
    );
  };

  const phaseLabel = {
    idle: "Não conectado",
    preparing: "Preparando",
    waiting: "Aguardando VPN",
    connected: "Conectado",
    attention: "Sem rede",
  }[phase];

  const powerLabel = isConnected
    ? "VPN CONECTADA"
    : isBusy
      ? "VERIFICANDO…"
      : "LIGAR VPN";

  const renderHome = () => (
    <section className="page page--home">
      <div className="connection-banner">
        <span className={`live-dot live-dot--${phase}`} />
        <div>
          <small>STATUS DA VPN</small>
          <strong>{phaseLabel}</strong>
        </div>
        <div className="banner-time">
          <small>SESSÃO</small>
          <strong>{isConnected ? formatDuration(sessionSeconds) : "00:00:00"}</strong>
        </div>
      </div>

      <article className={`power-card power-card--${phase}`}>
        <div className="power-aura" aria-hidden="true" />
        <div className="power-location">
          <span>{selectedServer ? flagFromCode(selectedServer.country_code) : "◎"}</span>
          <div>
            <small>SAÍDA ESCOLHIDA</small>
            <strong>
              {selectedServer
                ? `${selectedServer.country_name} · ${selectedServer.city}`
                : "Escolha um país"}
            </strong>
          </div>
          <button type="button" onClick={() => setActiveTab("locations")}>
            Trocar
          </button>
        </div>

        <button
          type="button"
          className={`power-button power-button--${phase}`}
          onClick={() => {
            if (isConnected) {
              setActiveTab("diagnostics");
            } else if (!isBusy) {
              void startConnection();
            }
          }}
          disabled={isBusy}
          aria-label={powerLabel}
        >
          <span className="power-symbol" aria-hidden="true" />
          <strong>{powerLabel}</strong>
          <small>
            {isConnected
              ? `${network?.ip || "IP protegido"} · ${network?.city || selectedServer?.city || "VPN"}`
              : config
                ? "1 toque · verificação automática"
                : "Importe o perfil uma vez"}
          </small>
        </button>

        <div className="connection-check">
          <span className={`check-icon ${isConnected ? "check-icon--ok" : ""}`}>
            {isConnected ? "✓" : "·"}
          </span>
          <div>
            <strong>
              {isConnected ? "Você está conectado" : "Aguardando conexão segura"}
            </strong>
            <small>{statusMessage}</small>
          </div>
        </div>

        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept=".conf,text/plain,application/octet-stream"
          onChange={handleConfigFile}
        />
      </article>

      <div className="status-grid">
        <article>
          <small>IP ATUAL</small>
          <strong>{network?.ip || "Verificando…"}</strong>
          <span>{network?.country || "—"} · {network?.city || "—"}</span>
        </article>
        <article>
          <small>PERFIL</small>
          <strong>{config ? "Pronto" : "Pendente"}</strong>
          <span>{config?.name || "WireGuard .conf"}</span>
        </article>
        <article>
          <small>MONITOR</small>
          <strong>{phase === "waiting" || phase === "connected" ? "Automático" : "Em espera"}</strong>
          <span>{phase === "waiting" ? "a cada 4s" : phase === "connected" ? "a cada 12s" : "ativa ao ligar"}</span>
        </article>
      </div>

      {!config ? (
        <button
          type="button"
          className="profile-cta"
          onClick={() => fileInputRef.current?.click()}
        >
          <span>＋</span>
          <div>
            <strong>Adicionar perfil WireGuard</strong>
            <small>Necessário só para iniciar o túnel no sistema.</small>
          </div>
        </button>
      ) : (
        <div className="profile-ready">
          <span>✓</span>
          <div>
            <strong>Perfil pronto</strong>
            <small>{configMessage || "Chave privada não é enviada ao servidor."}</small>
          </div>
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            Trocar
          </button>
        </div>
      )}

      <p className="system-note">
        O HighGAS monitora e confirma a conexão sozinho. A ativação do túnel continua sendo autorizada pelo sistema operacional no WireGuard.
      </p>
    </section>
  );

  const renderLocations = () => (
    <section className="page">
      <div className="page-title">
        <small>SERVIDORES</small>
        <h1>Escolha a saída</h1>
        <p>O país fica salvo neste dispositivo. Ao trocar, o HighGAS reinicia o monitoramento para evitar status falso.</p>
      </div>

      <div className="source-row">
        <span>Catálogo</span>
        <strong>{serverSource === "neon" ? "Neon online" : "Fallback seguro"}</strong>
      </div>

      <div className="server-list">
        {servers.map((server) => (
          <ServerCard
            key={server.code}
            server={server}
            selected={server.code === selectedServer?.code}
            onSelect={() => chooseServer(server)}
          />
        ))}
      </div>
    </section>
  );

  const renderSetup = () => (
    <section className="page">
      <div className="page-title">
        <small>PERFIL VPN</small>
        <h1>Configure uma vez</h1>
        <p>
          O HighGAS valida o arquivo e tenta entregá-lo ao sistema. Em iPhone e Android, usa a folha de compartilhamento quando disponível; em Mac e Windows, baixa o .conf para abrir no WireGuard.
        </p>
      </div>

      <article className="setup-card">
        <div className={`setup-status ${config ? "setup-status--ok" : ""}`}>
          <span>{config ? "✓" : "1"}</span>
          <div>
            <strong>{config ? "Perfil WireGuard validado" : "Importe um perfil .conf"}</strong>
            <small>{config ? config.name : "O arquivo precisa conter [Interface], [Peer] e PrivateKey."}</small>
          </div>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => fileInputRef.current?.click()}
        >
          {config ? "Trocar perfil" : "Escolher arquivo"}
        </button>
      </article>

      <article className="setup-card">
        <div className="setup-status">
          <span>2</span>
          <div>
            <strong>Entregar ao WireGuard</strong>
            <small>O sistema operacional precisa autorizar a criação/ativação da VPN.</small>
          </div>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={!config}
          onClick={() => void handoffConfig()}
        >
          Abrir perfil no sistema
        </button>
      </article>

      <article className="setup-card">
        <div className="setup-status">
          <span>3</span>
          <div>
            <strong>Monitoramento automático</strong>
            <small>Depois de tocar em Ligar VPN, o HighGAS checa o IP a cada 4 segundos até detectar a saída escolhida.</small>
          </div>
        </div>
        <div className="mini-specs">
          <span>WireGuard</span>
          <span>DNS 1.1.1.1</span>
          <span>Auto-check</span>
        </div>
      </article>

      <a
        className="official-link"
        href="https://www.wireguard.com/install/"
        target="_blank"
        rel="noreferrer"
      >
        Instalar o WireGuard oficial
        <span>↗</span>
      </a>
    </section>
  );

  const renderDiagnostics = () => (
    <section className="page">
      <div className="page-title">
        <small>DIAGNÓSTICO AO VIVO</small>
        <h1>Conexão</h1>
        <p>O status abaixo é baseado no IP público observado pelo HighGAS e no país de saída escolhido.</p>
      </div>

      <article className={`diagnostic-hero diagnostic-hero--${phase}`}>
        <div className="diag-head">
          <span className={`live-dot live-dot--${phase}`} />
          <div>
            <small>VPN</small>
            <strong>{phaseLabel}</strong>
          </div>
          <span className="diag-timer">{isConnected ? formatDuration(sessionSeconds) : "—"}</span>
        </div>

        <div className="diag-grid">
          <div>
            <small>IP ATUAL</small>
            <strong>{network?.ip || "—"}</strong>
          </div>
          <div>
            <small>IP ANTES</small>
            <strong>{baselineNetwork?.ip || "—"}</strong>
          </div>
          <div>
            <small>PAÍS</small>
            <strong>{network?.country || "—"}</strong>
          </div>
          <div>
            <small>ALVO</small>
            <strong>{selectedServer?.country_code || "—"}</strong>
          </div>
        </div>

        <div className="signal-list">
          <div className={ipChanged ? "signal signal--ok" : "signal"}>
            <span>{ipChanged ? "✓" : "·"}</span>
            <p>IP mudou após ligar a VPN</p>
          </div>
          <div className={targetMatches ? "signal signal--ok" : "signal"}>
            <span>{targetMatches ? "✓" : "·"}</span>
            <p>País atual coincide com o selecionado</p>
          </div>
          <div className={online ? "signal signal--ok" : "signal"}>
            <span>{online ? "✓" : "!"}</span>
            <p>Internet disponível</p>
          </div>
        </div>

        <button
          type="button"
          className="secondary-button"
          disabled={networkLoading}
          onClick={() => void checkNetwork(false)}
        >
          {networkLoading ? "Verificando…" : "Verificar agora"}
        </button>
      </article>

      <article className="detail-card">
        <div>
          <small>DISPOSITIVO</small>
          <strong>{deviceLabel()}</strong>
        </div>
        <div>
          <small>INÍCIO DA TENTATIVA</small>
          <strong>{formatClock(connectionStartedAt)}</strong>
        </div>
        <div>
          <small>VPN DETECTADA</small>
          <strong>{formatClock(connectionDetectedAt)}</strong>
        </div>
        <div>
          <small>ÚLTIMA LEITURA</small>
          <strong>{formatClock(network?.checkedAt || null)}</strong>
        </div>
      </article>

      {phase !== "idle" ? (
        <button type="button" className="ghost-button" onClick={stopMonitoring}>
          Encerrar monitoramento
        </button>
      ) : null}

      <p className="system-note">
        “Conectado” significa que o HighGAS observou mudança de IP depois do comando e saída no país selecionado. O navegador não recebe do sistema operacional o estado interno do túnel WireGuard.
      </p>
    </section>
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand />
        <div className={`topbar-status topbar-status--${phase}`}>
          <span />
          {phaseLabel}
        </div>
      </header>

      <main className="main-content">
        {activeTab === "home" && renderHome()}
        {activeTab === "locations" && renderLocations()}
        {activeTab === "setup" && renderSetup()}
        {activeTab === "diagnostics" && renderDiagnostics()}
      </main>

      <nav className="bottom-nav" aria-label="Navegação principal">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.icon}</span>
            <small>{tab.label}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default App;
