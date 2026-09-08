import { useCallback, useEffect, useMemo, useState } from "react";
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

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "Início", icon: "⌂" },
  { id: "locations", label: "Países", icon: "◎" },
  { id: "setup", label: "Proteção", icon: "◇" },
  { id: "diagnostics", label: "Status", icon: "◉" },
];

const flagFromCode = (code: string) =>
  code
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));

const protocolLabel = (protocol: VpnServer["protocol"]) =>
  protocol === "tor" ? "Full Tunnel · Tor" : protocol === "wireguard" ? "WireGuard" : "OpenVPN";

async function fetchNetworkSnapshot(): Promise<NetworkInfo> {
  const response = await fetch(`/api/network-info?ts=${Date.now()}`, {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`network_${response.status}`);
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
      <div className="brand-mark" aria-hidden="true"><span /></div>
      <div>
        <strong>HighGAS</strong>
        <small>VPN pessoal</small>
      </div>
    </div>
  );
}

function ServerCard({ server, selected, onSelect }: {
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
        <small>{server.city} · {protocolLabel(server.protocol)}</small>
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
  const [selectedCode, setSelectedCode] = useState(() => {
    try {
      const saved = localStorage.getItem("highgas:selected-server");
      return saved === "us-mia-01" || saved === "de-fra-01" ? saved : "de-fra-01";
    } catch {
      return "de-fra-01";
    }
  });
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [notice, setNotice] = useState("O HighGAS Local controla a conexão e só confirma depois das verificações de segurança.");

  const isLocal = location.hostname === "127.0.0.1" || location.hostname === "localhost";

  useEffect(() => {
    let mounted = true;
    void loadVpnServers().then((result) => {
      if (!mounted) return;
      const torOnly = result.servers.filter((server) => server.protocol === "tor");
      const next = torOnly.length ? torOnly : fallbackServers;
      setServers(next);
      if (!next.some((server) => server.code === selectedCode)) {
        setSelectedCode(next.find((server) => server.is_recommended)?.code || next[0]?.code || "de-fra-01");
      }
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem("highgas:selected-server", selectedCode); } catch { /* preferência apenas */ }
  }, [selectedCode]);

  const selectedServer = useMemo(
    () => servers.find((server) => server.code === selectedCode) || servers[0],
    [servers, selectedCode]
  );

  const checkNetwork = useCallback(async () => {
    setNetworkLoading(true);
    try {
      const snapshot = await fetchNetworkSnapshot();
      setNetwork(snapshot);
    } catch {
      setNotice("Não consegui consultar o IP neste instante. A conexão segura continua sendo controlada pelo HighGAS Local.");
    } finally {
      setNetworkLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkNetwork();
    const id = window.setInterval(() => void checkNetwork(), 15000);
    return () => window.clearInterval(id);
  }, [checkNetwork]);

  const chooseServer = (server: VpnServer) => {
    if (server.status === "offline") return;
    setSelectedCode(server.code);
    setNotice(`Saída ${server.country_name} selecionada. Volte ao Início e toque em Ligar VPN.`);
    if (window.innerWidth < 760) setActiveTab("home");
  };

  const powerFallback = () => {
    if (!isLocal) {
      setNotice("Abra o atalho HighGAS instalado no Mac. O site público não recebe permissão para alterar a rede do sistema.");
    }
  };

  const renderHome = () => (
    <section className="page page--home">
      <div className="connection-banner">
        <span className="live-dot live-dot--idle" />
        <div>
          <small>STATUS DA VPN</small>
          <strong>Não conectado</strong>
        </div>
        <div className="banner-time">
          <small>SESSÃO</small>
          <strong>00:00:00</strong>
        </div>
      </div>

      <article className="power-card power-card--idle">
        <div className="power-aura" aria-hidden="true" />
        <div className="power-location">
          <span>{selectedServer ? flagFromCode(selectedServer.country_code) : "◎"}</span>
          <div>
            <small>SAÍDA ESCOLHIDA</small>
            <strong>{selectedServer ? selectedServer.country_name : "Escolha um país"}</strong>
          </div>
          <button type="button" onClick={() => setActiveTab("locations")}>Trocar</button>
        </div>

        <button
          type="button"
          className="power-button power-button--idle"
          onClick={powerFallback}
          aria-label="Ligar VPN"
        >
          <span className="power-symbol" aria-hidden="true" />
          <strong>LIGAR VPN</strong>
          <small>1 toque · proteção do sistema inteiro</small>
        </button>

        <div className="connection-check">
          <span className="check-icon">·</span>
          <div>
            <strong>Full Tunnel pronto para ligar</strong>
            <small>{notice}</small>
          </div>
        </div>
      </article>

      <div className="status-grid">
        <article>
          <small>IP ATUAL</small>
          <strong>{network?.ip || "Verificando…"}</strong>
          <span>{[network?.country, network?.city].filter(Boolean).join(" · ") || "—"}</span>
        </article>
        <article>
          <small>PERFIL</small>
          <strong>Full Tunnel</strong>
          <span>Tor integrado · sem .conf</span>
        </article>
        <article>
          <small>MONITOR</small>
          <strong>Em espera</strong>
          <span>fail-closed ao ligar</span>
        </article>
      </div>

      <button type="button" className="profile-cta" onClick={() => setActiveTab("setup")}>
        <span>✓</span>
        <div>
          <strong>Full Tunnel integrado</strong>
          <small>Não precisa importar perfil nem abrir outro aplicativo.</small>
        </div>
      </button>

      <p className="system-note">
        Enquanto ligado, TCP IPv4 e DNS passam pela rede Tor no país selecionado. IPv6 e UDP são bloqueados para evitar vazamento do IP real.
      </p>
    </section>
  );

  const renderLocations = () => (
    <section className="page">
      <div className="page-title">
        <small>SAÍDAS DISPONÍVEIS</small>
        <h1>Escolha o país</h1>
        <p>O HighGAS garante o país da saída. A cidade do nó Tor pode variar a cada conexão.</p>
      </div>
      <div className="source-row">
        <span>Modo</span>
        <strong>Full Tunnel gratuito</strong>
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
        <small>PROTEÇÃO</small>
        <h1>Integrado ao HighGAS</h1>
        <p>Depois de instalar o HighGAS Local uma vez, não há perfil .conf, assinatura ou aplicativo de VPN para abrir.</p>
      </div>

      <article className="setup-card">
        <div className="setup-status setup-status--ok">
          <span>✓</span>
          <div>
            <strong>Full Tunnel do sistema</strong>
            <small>O tráfego TCP IPv4 é encaminhado pelo túnel local até a rede Tor.</small>
          </div>
        </div>
      </article>

      <article className="setup-card">
        <div className="setup-status setup-status--ok">
          <span>✓</span>
          <div>
            <strong>Kill Switch fail-closed</strong>
            <small>O tráfego direto é bloqueado antes do Tor iniciar; se a validação falhar, a conexão é encerrada e a rede é restaurada.</small>
          </div>
        </div>
      </article>

      <article className="setup-card">
        <div className="setup-status setup-status--ok">
          <span>✓</span>
          <div>
            <strong>Verificação em 5 pontos</strong>
            <small>IP alterado, país correto, DNS protegido, IPv6 sem vazamento e rotas/Kill Switch.</small>
          </div>
        </div>
        <div className="mini-specs">
          <span>Tor</span>
          <span>DNS protegido</span>
          <span>Kill Switch</span>
        </div>
      </article>

      <p className="system-note">
        Limitação intencional: UDP e IPv6 ficam bloqueados enquanto a VPN está ligada. Aplicativos que dependem exclusivamente de UDP podem não funcionar nesse período.
      </p>
    </section>
  );

  const renderDiagnostics = () => (
    <section className="page">
      <div className="page-title">
        <small>DIAGNÓSTICO</small>
        <h1>Estado da rede</h1>
        <p>Na tela Início, o HighGAS Local exibe a validação completa do túnel em tempo real.</p>
      </div>

      <article className="diagnostic-hero diagnostic-hero--idle">
        <div className="diag-head">
          <span className="live-dot live-dot--idle" />
          <div>
            <small>IP OBSERVADO</small>
            <strong>{network?.ip || "—"}</strong>
          </div>
          <span className="diag-timer">{network?.country || "—"}</span>
        </div>

        <div className="diag-grid">
          <div><small>PAÍS</small><strong>{network?.country || "—"}</strong></div>
          <div><small>CIDADE</small><strong>{network?.city || "—"}</strong></div>
          <div><small>ALVO</small><strong>{selectedServer?.country_code || "—"}</strong></div>
          <div><small>MODO</small><strong>Full Tunnel</strong></div>
        </div>

        <div className="signal-list">
          <div className="signal signal--ok"><span>✓</span><p>Kill Switch com bloqueio IPv4 direto</p></div>
          <div className="signal signal--ok"><span>✓</span><p>IPv6 bloqueado durante a sessão</p></div>
          <div className="signal signal--ok"><span>✓</span><p>DNS encaminhado pelo Tor</p></div>
        </div>

        <button type="button" className="secondary-button" disabled={networkLoading} onClick={() => void checkNetwork()}>
          {networkLoading ? "Verificando…" : "Atualizar IP"}
        </button>
      </article>

      <p className="system-note">
        O indicador “Conectado” só é liberado pelo controlador local depois que todas as provas de segurança retornam positivas.
      </p>
    </section>
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand />
        <div className="topbar-status topbar-status--idle">
          <span />
          HighGAS
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
