import { useRef, useState } from "react";

type TargetTab = "home" | "locations" | "setup" | "diagnostics";

type JarvisPanelProps = {
  ip: string | null;
  country: string | null;
  city: string | null;
  selectedCountry: string;
  networkLoading: boolean;
  onNavigate: (tab: TargetTab) => void;
  onRefreshNetwork: () => Promise<void>;
};

type SpeechResultEvent = {
  results: {
    [index: number]: {
      0: { transcript: string };
      isFinal: boolean;
    };
    length: number;
  };
};

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type RecognitionCtor = new () => RecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  }
}

const quickCommands = [
  "Qual é meu IP?",
  "Abrir países",
  "Abrir proteção",
  "Atualizar IP",
];

function JarvisPanel({
  ip,
  country,
  city,
  selectedCountry,
  networkLoading,
  onNavigate,
  onRefreshNetwork,
}: JarvisPanelProps) {
  const [listening, setListening] = useState(false);
  const [command, setCommand] = useState("");
  const [lastCommand, setLastCommand] = useState("Diga “acorde” ou toque no núcleo para falar.");
  const [answer, setAnswer] = useState("JARVIS pronto. Posso navegar pelo HighGAS e consultar o estado da rede.");
  const recognitionRef = useRef<RecognitionLike | null>(null);

  const speak = (text: string) => {
    setAnswer(text);
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pt-BR";
    utterance.rate = 0.96;
    utterance.pitch = 0.82;
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((voice) => voice.lang.toLowerCase().startsWith("pt-br")) ||
      voices.find((voice) => voice.lang.toLowerCase().startsWith("pt"));
    if (preferred) utterance.voice = preferred;
    window.speechSynthesis.speak(utterance);
  };

  const executeCommand = (rawCommand: string) => {
    const spoken = rawCommand.trim();
    if (!spoken) return;

    const normalized = spoken
      .toLocaleLowerCase("pt-BR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    setLastCommand(spoken);
    setCommand("");

    if (normalized.includes("abrir") && (normalized.includes("pais") || normalized.includes("servidor"))) {
      onNavigate("locations");
      speak("Abrindo a seleção de países do HighGAS.");
      return;
    }

    if (normalized.includes("protec") || normalized.includes("seguranca")) {
      onNavigate("setup");
      speak("Abrindo os controles de proteção e segurança.");
      return;
    }

    if (normalized.includes("diagnost") || normalized.includes("estado da rede")) {
      onNavigate("diagnostics");
      speak("Abrindo o diagnóstico da rede.");
      return;
    }

    if (normalized.includes("inicio") || normalized.includes("home")) {
      onNavigate("home");
      speak("Voltando para o início do HighGAS.");
      return;
    }

    if (normalized.includes("atualizar") && normalized.includes("ip")) {
      void onRefreshNetwork();
      speak("Atualizando o endereço IP observado agora.");
      return;
    }

    if (normalized.includes("ip")) {
      speak(
        ip
          ? `Seu IP observado é ${ip}. Localização reportada: ${[country, city].filter(Boolean).join(", ") || "não identificada"}.`
          : "Ainda não tenho um IP confirmado. Posso atualizar a leitura para você."
      );
      return;
    }

    if (normalized.includes("pais selecionado") || normalized.includes("saida selecionada")) {
      speak(`A saída selecionada no HighGAS é ${selectedCountry || "não definida"}.`);
      return;
    }

    if (normalized.includes("ajuda") || normalized.includes("o que voce faz")) {
      speak("Posso consultar seu IP, atualizar a rede e abrir Início, Países, Proteção ou Diagnóstico.");
      return;
    }

    if (normalized === "acorde" || normalized.includes("jarvis")) {
      speak("Estou ouvindo. Diga um comando do HighGAS.");
      return;
    }

    speak("Comando ainda não mapeado no modo web. Diga ajuda para ver os comandos disponíveis.");
  };

  const startListening = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      speak("O reconhecimento de voz não está disponível neste navegador. Use o campo de texto abaixo.");
      return;
    }

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "pt-BR";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const index = event.results.length - 1;
      const transcript = event.results[index]?.[0]?.transcript || "";
      if (transcript) executeCommand(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      speak("Não consegui ouvir com clareza. Tente novamente ou escreva o comando.");
    };

    recognitionRef.current = recognition;
    setListening(true);
    setLastCommand("Ouvindo…");
    recognition.start();
  };

  return (
    <section className="page jarvis-page">
      <div className="page-title jarvis-title">
        <small>ASSISTENTE LOCAL · PORTUGUÊS</small>
        <h1>JARVIS</h1>
        <p>
          Controle por voz integrado ao HighGAS. A interface web executa comandos do painel; o modo offline
          completo continua disponível como módulo local.
        </p>
      </div>

      <article className={`jarvis-core-card ${listening ? "jarvis-core-card--listening" : ""}`}>
        <div className="jarvis-scanline" aria-hidden="true" />
        <div className="jarvis-orbit jarvis-orbit--one" aria-hidden="true" />
        <div className="jarvis-orbit jarvis-orbit--two" aria-hidden="true" />
        <button
          type="button"
          className="jarvis-core"
          onClick={startListening}
          aria-label={listening ? "Parar de ouvir" : "Falar com JARVIS"}
        >
          <span className="jarvis-core-dot" />
          <strong>{listening ? "OUVINDO" : "JARVIS"}</strong>
          <small>{listening ? "fale agora" : "toque para falar"}</small>
        </button>

        <div className="jarvis-live-status">
          <span className={listening ? "live-dot live-dot--connected" : "live-dot live-dot--idle"} />
          <div>
            <small>ÚLTIMO COMANDO</small>
            <strong>{lastCommand}</strong>
          </div>
        </div>
      </article>

      <article className="jarvis-console">
        <div className="jarvis-console-head">
          <div>
            <small>RESPOSTA</small>
            <strong>JARVIS HighGAS</strong>
          </div>
          <span>PT-BR</span>
        </div>
        <p>{answer}</p>

        <form
          className="jarvis-command-form"
          onSubmit={(event) => {
            event.preventDefault();
            executeCommand(command);
          }}
        >
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="Digite um comando…"
            aria-label="Comando para JARVIS"
          />
          <button type="submit" disabled={!command.trim()}>Enviar</button>
        </form>
      </article>

      <div className="jarvis-quick-grid">
        {quickCommands.map((item) => (
          <button type="button" key={item} onClick={() => executeCommand(item)}>
            <span>›</span>
            {item}
          </button>
        ))}
      </div>

      <article className="jarvis-network-card">
        <div>
          <small>IP OBSERVADO</small>
          <strong>{networkLoading ? "Atualizando…" : ip || "—"}</strong>
        </div>
        <div>
          <small>LOCALIZAÇÃO</small>
          <strong>{[country, city].filter(Boolean).join(" · ") || "—"}</strong>
        </div>
        <div>
          <small>SAÍDA HIGHGAS</small>
          <strong>{selectedCountry || "—"}</strong>
        </div>
      </article>

      <article className="jarvis-source-card">
        <div className="jarvis-source-mark">J</div>
        <div>
          <small>MODO OFFLINE COMPLETO</small>
          <strong>JARVIS HUD em português</strong>
          <p>
            O projeto original usa Python, Vosk, Whisper local e Ollama/OpenJarvis. Como ele é um aplicativo
            desktop, não roda dentro da hospedagem Vercel; esta aba integra a experiência de comando ao painel
            web sem enviar credenciais para terceiros.
          </p>
        </div>
        <a
          href="https://github.com/Twsman1/JARVIS/tree/master"
          target="_blank"
          rel="noreferrer"
        >
          Projeto original ↗
        </a>
      </article>

      <p className="system-note">
        O repositório de referência informa que não possui licença explícita. Por isso, o HighGAS não copia o
        código-fonte dele: esta integração foi implementada de forma independente e mantém apenas o link para
        o projeto original.
      </p>
    </section>
  );
}

export default JarvisPanel;
