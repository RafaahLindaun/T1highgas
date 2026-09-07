import { useEffect, useMemo, useRef, useState } from "react";
import {
  fallbackServers,
  loadVpnServers,
  type VpnServer,
} from "./lib/highgasData";

type Tab = "home" | "locations" | "setup" | "diagnostics";

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
  { id: "setup", label: "Configurar", icon: "⚙" },
  { id: "diagnostics", label: "Diagnóstico", icon: "◌" },
];

const flagFromCode = (code: string) =>
  code
    .toUpperCase()
    .replace(/./g, (char) =>
      String.fromCodePoint(127397 + char.charCodeAt(0))
    );

const formatTime = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

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
        {server.is_recommended ? <small>Recomendado</small> : <small>Disponível</small>}
      </span>
    </button>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [servers, setServers] = useState<VpnServer[]>(fallbackServers);
  const [serverSource, setServerSource] = useState<"supabase" | "fallback">(
    "fallback"
  );
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
  const [networkLoading, setNetworkLoading] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [compactMode, setCompactMode] = useState(() => {
    try {
      return localStorage.getItem("highgas:compact-mode") === "true";
    } catch {
      return false;
    }
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;

    loadVpnServers().then((result) => {
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

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("highgas:selected-server", selectedCode);
    } catch {
      // The app still works when private mode blocks localStorage.
    }
  }, [selectedCode]);

  useEffect(() => {
    try {
      localStorage.setItem("highgas:compact-mode", String(compactMode));
    } catch {
      // Non-critical preference.
    }
  }, [compactMode]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const selectedServer = useMemo(
    () =>
      servers.find((server) => server.code === selectedCode) ||
      servers.find((server) => server.is_recommended) ||
      servers[0],
    [servers, selectedCode]
  );

  const isReady = Boolean(config && selectedServer && online);

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
      /\[Interface\]/i.test(text) && /\[Peer\]/i.test(text);

    if (!looksLikeWireGuard) {
      setConfigMessage(
        "O arquivo não parece um perfil WireGuard válido (.conf)."
      );
      return;
    }

    setConfig({ name: file.name, content: text });
    setConfigMessage("Perfil carregado somente neste navegador.");
  };

  const downloadConfig = () => {
    if (!config) {
      fileInputRef.current?.click();
      return;
    }

    const blob = new Blob([config.content], {
      type: "text/plain;charset=utf-8",
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

  const checkNetwork = async () => {
    setNetworkLoading(true);
    try {
      const response = await fetch("/api/network-info", {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Falha ao consultar rede.");
      const data = (await response.json()) as NetworkInfo;
      setNetwork(data);
    } catch {
      setNetwork({
        ip: null,
        country: null,
        city: null,
        source: "browser",
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setNetworkLoading(false);
    }
  };

  const renderHome = () => (
    <section className="page page--home">
      <div className="eyebrow-row">
        <span className={`availability ${online ? "availability--ok" : ""}`}>
          <i />
          {online ? "Internet disponível" : "Sem conexão"}
        </span>
        <span className="source-chip">
          {serverSource === "supabase" ? "Cloud" : "Local"}
        </span>
      </div>

      <article className="hero-card">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-top">
          <div>
            <p>Localização escolhida</p>
            <h1>
              {selectedServer
                ? `${flagFromCode(selectedServer.country_code)} ${selectedServer.country_name}`
                : "Selecionar servidor"}
            </h1>
            <span>
              {selectedServer
                ? `${selectedServer.city} · WireGuard`
                : "Nenhum servidor disponível"}
            </span>
          </div>
          <div className={`shield ${isReady ? "shield--ready" : ""}`}>
            <span />
          </div>
        </div>

        <div className="connection-state">
          <div>
            <small>ESTADO</small>
            <strong>{isReady ? "Pronto para usar" : "Configuração pendente"}</strong>
          </div>
          <span className={`state-pill ${isReady ? "state-pill--ready" : ""}`}>
            {isReady ? "Perfil OK" : "Sem túnel"}
          </span>
        </div>

        <button
          type="button"
          className="primary-button"
          onClick={() =>
            config ? downloadConfig() : fileInputRef.current?.click()
          }
        >
          <span className="primary-button__icon">{config ? "↓" : "+"}</span>
          <span>
            <strong>{config ? "Baixar perfil WireGuard" : "Importar perfil WireGuard"}</strong>
            <small>
              {config
                ? "Abra o arquivo no app WireGuard do dispositivo"
                : "O arquivo fica somente nesta sessão"}
            </small>
          </span>
        </button>

        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept=".conf,text/plain"
          onChange={handleConfigFile}
        />

        {configMessage ? <p className="inline-message">{configMessage}</p> : null}

        <p className="privacy-note">
          <span>◆</span>
          O HighGAS não envia nem salva sua chave privada no Supabase.
        </p>
      </article>

      <div className="section-heading">
        <div>
          <small>ACESSO RÁPIDO</small>
          <h2>Seu servidor</h2>
        </div>
        <button type="button" onClick={() => setActiveTab("locations")}>
          Ver países
        </button>
      </div>

      {selectedServer ? (
        <ServerCard
          server={selectedServer}
          selected
          onSelect={() => setActiveTab("locations")}
        />
      ) : null}

      <div className="quick-grid">
        <button type="button" className="quick-card" onClick={() => setActiveTab("setup")}>
          <span className="quick-icon">⚙</span>
          <strong>Configurar</strong>
          <small>WireGuard e DNS</small>
        </button>
        <button
          type="button"
          className="quick-card"
          onClick={() => {
            setActiveTab("diagnostics");
            void checkNetwork();
          }}
        >
          <span className="quick-icon">↗</span>
          <strong>Verificar IP</strong>
          <small>Confirme a saída VPN</small>
        </button>
      </div>
    </section>
  );

  const renderLocations = () => (
    <section className="page">
      <div className="page-title">
        <small>SERVIDORES</small>
        <h1>Escolha um país</h1>
        <p>
          O HighGAS usa uma lista pequena de destinos para manter a interface
          rápida e previsível.
        </p>
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

      <div className="info-card">
        <span>i</span>
        <div>
          <strong>Catálogo seguro</strong>
          <p>
            O frontend lê apenas países e status. Chaves privadas nunca devem
            ficar em uma tabela pública do Supabase.
          </p>
        </div>
      </div>
    </section>
  );

  const renderSetup = () => (
    <section className="page">
      <div className="page-title">
        <small>CONFIGURAÇÃO</small>
        <h1>Deixe pronto uma vez</h1>
        <p>
          Para VPN de sistema, o navegador entrega o perfil e o WireGuard faz o
          túnel no iPhone, Android, Mac ou Windows.
        </p>
      </div>

      <div className="step-list">
        <article className="step-card">
          <span className="step-number">1</span>
          <div>
            <strong>Instale o WireGuard</strong>
            <p>
              Use o aplicativo oficial no dispositivo em que você quer ativar a
              VPN.
            </p>
          </div>
        </article>

        <article className="step-card">
          <span className="step-number">2</span>
          <div>
            <strong>Importe seu perfil .conf</strong>
            <p>
              Carregue o arquivo aqui para validar e depois abra o mesmo perfil
              no WireGuard.
            </p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => fileInputRef.current?.click()}
            >
              {config ? `Trocar ${config.name}` : "Escolher arquivo"}
            </button>
          </div>
        </article>

        <article className="step-card">
          <span className="step-number">3</span>
          <div>
            <strong>Ative e confira seu IP</strong>
            <p>
              Ligue o túnel no WireGuard e volte ao diagnóstico do HighGAS para
              conferir país e IP de saída.
            </p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setActiveTab("diagnostics");
                void checkNetwork();
              }}
            >
              Abrir diagnóstico
            </button>
          </div>
        </article>
      </div>

      <article className="settings-card">
        <div className="settings-row">
          <div>
            <strong>Protocolo preferido</strong>
            <small>WireGuard</small>
          </div>
          <span className="value-pill">WG</span>
        </div>
        <div className="settings-row">
          <div>
            <strong>DNS recomendado</strong>
            <small>1.1.1.1 · 1.0.0.1</small>
          </div>
          <button
            type="button"
            className="text-action"
            onClick={() => void navigator.clipboard?.writeText("1.1.1.1, 1.0.0.1")}
          >
            Copiar
          </button>
        </div>
        <div className="settings-row">
          <div>
            <strong>Interface compacta</strong>
            <small>Melhor para telas pequenas</small>
          </div>
          <button
            type="button"
            className={`switch ${compactMode ? "switch--on" : ""}`}
            aria-pressed={compactMode}
            onClick={() => setCompactMode((value) => !value)}
          >
            <span />
          </button>
        </div>
      </article>
    </section>
  );

  const renderDiagnostics = () => (
    <section className="page">
      <div className="page-title">
        <small>DIAGNÓSTICO</small>
        <h1>Rede e estabilidade</h1>
        <p>
          Esta tela ajuda a confirmar se o dispositivo está online e se o IP de
          saída mudou depois de ativar o WireGuard.
        </p>
      </div>

      <article className="diagnostic-card">
        <div className="diagnostic-status">
          <div className={`pulse ${online ? "pulse--ok" : ""}`} />
          <div>
            <small>INTERNET</small>
            <strong>{online ? "Online" : "Offline"}</strong>
          </div>
        </div>

        <div className="diagnostic-grid">
          <div>
            <small>IP PÚBLICO</small>
            <strong>{network?.ip || "Não verificado"}</strong>
          </div>
          <div>
            <small>PAÍS</small>
            <strong>{network?.country || "—"}</strong>
          </div>
          <div>
            <small>CIDADE</small>
            <strong>{network?.city || "—"}</strong>
          </div>
          <div>
            <small>ÚLTIMA CHECAGEM</small>
            <strong>{formatTime(network?.checkedAt || null)}</strong>
          </div>
        </div>

        <button
          type="button"
          className="primary-button primary-button--simple"
          onClick={() => void checkNetwork()}
          disabled={networkLoading}
        >
          {networkLoading ? "Verificando..." : "Verificar IP agora"}
        </button>
      </article>

      <article className="device-card">
        <div>
          <small>DISPOSITIVO</small>
          <strong>
            {/iPhone|iPad|iPod/i.test(navigator.userAgent)
              ? "iOS / iPadOS"
              : /Android/i.test(navigator.userAgent)
                ? "Android"
                : /Macintosh|Mac OS X/i.test(navigator.userAgent)
                  ? "macOS"
                  : /Windows/i.test(navigator.userAgent)
                    ? "Windows"
                    : "Navegador"}
          </strong>
        </div>
        <div>
          <small>PAÍS SELECIONADO</small>
          <strong>{selectedServer?.country_name || "—"}</strong>
        </div>
        <div>
          <small>PERFIL WG</small>
          <strong>{config ? "Carregado" : "Pendente"}</strong>
        </div>
      </article>

      <div className="info-card info-card--warning">
        <span>!</span>
        <div>
          <strong>O site não consegue ligar a VPN sozinho</strong>
          <p>
            Isso é uma proteção dos sistemas operacionais. A ativação do túnel
            acontece no WireGuard; o HighGAS organiza o processo e verifica a
            saída.
          </p>
        </div>
      </div>
    </section>
  );

  return (
    <div className={`app-shell ${compactMode ? "app-shell--compact" : ""}`}>
      <header className="topbar">
        <Brand />
        <div className="topbar-status" title="Sem login">
          <span />
          Pessoal
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
