import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { useEco } from "../context/EcoContext";

/**
 * iOS “Settings” inspired (light, 60/30/10) with simple motion.
 * - 60% background: iOS grouped background
 * - 30% surfaces: white cards
 * - 10% accent: iOS blue
 *
 * NOTE: Some toggles are app-level preferences stored locally (not OS settings).
 */

const USERS_KEY = "fitdeal_users_v1";
const SESSION_KEY = "fitdeal_session_v1";
const PREFS_KEY = "@EcoRoute:Prefs:v1";

const COLORS = {
  bg: "#F2F2F7", // iOS grouped background
  card: "#FFFFFF",
  line: "rgba(60,60,67,0.18)",
  text: "#111111",
  sub: "rgba(60,60,67,0.72)",
  sub2: "rgba(60,60,67,0.55)",
  accent: "#007AFF", // iOS blue
  danger: "#FF3B30",
  shadow: "rgba(0,0,0,0.08)",
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function clampNum(x, a, b) {
  const n = Number(String(x ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.max(a, Math.min(b, n));
}

function Chevron() {
  return (
    <span
      aria-hidden="true"
      style={{
        color: COLORS.sub2,
        fontWeight: 900,
        marginLeft: 10,
        transform: "translateY(-0.5px)",
      }}
    >
      ›
    </span>
  );
}

function Section({ title, children, hint }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={S.sectionTitle}>{title}</div>
      <div style={S.card}>{children}</div>
      {hint ? <div style={S.sectionHint}>{hint}</div> : null}
    </div>
  );
}

function Row({
  title,
  subtitle,
  right,
  onClick,
  danger,
  disabled,
  icon,
  chevron = true,
}) {
  return (
    <motion.button
      type="button"
      onClick={disabled ? undefined : onClick}
      whileTap={disabled ? undefined : { scale: 0.985 }}
      style={{
        ...S.rowBtn,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "not-allowed" : onClick ? "pointer" : "default",
      }}
    >
      <div style={S.rowLeft}>
        {icon ? <div style={S.iconWrap}>{icon}</div> : null}
        <div style={{ minWidth: 0 }}>
          <div style={{ ...S.rowTitle, color: danger ? COLORS.danger : COLORS.text }}>
            {title}
          </div>
          {subtitle ? <div style={S.rowSub}>{subtitle}</div> : null}
        </div>
      </div>

      <div style={S.rowRight}>
        {right ? <div style={S.rowRightText}>{right}</div> : null}
        {chevron && onClick ? <Chevron /> : null}
      </div>
    </motion.button>
  );
}

function ToggleRow({ title, subtitle, value, onChange, icon }) {
  return (
    <div style={S.rowStatic}>
      <div style={S.rowLeft}>
        {icon ? <div style={S.iconWrap}>{icon}</div> : null}
        <div style={{ minWidth: 0 }}>
          <div style={S.rowTitle}>{title}</div>
          {subtitle ? <div style={S.rowSub}>{subtitle}</div> : null}
        </div>
      </div>

      <IOSSwitch value={value} onChange={onChange} />
    </div>
  );
}

function IOSSwitch({ value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      aria-pressed={value}
      style={{
        ...S.switch,
        background: value ? COLORS.accent : "rgba(120,120,128,0.20)",
        justifyContent: value ? "flex-end" : "flex-start",
      }}
    >
      <div style={S.switchKnob} />
    </button>
  );
}

function Modal({ title, subtitle, children, onClose }) {
  return (
    <motion.div
      style={S.modalOverlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        style={S.modal}
        initial={{ y: 18, opacity: 0, scale: 0.99 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 18, opacity: 0, scale: 0.99 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={S.modalTop}>
          <div style={S.modalTitle}>{title}</div>
          {subtitle ? <div style={S.modalSub}>{subtitle}</div> : null}
        </div>

        <div style={S.modalBody}>{children}</div>
      </motion.div>
    </motion.div>
  );
}

export default function Conta() {
  const { user, updateUser, logout } = useAuth();
  const eco = useEco();
  const nav = useNavigate();

  const fileRef = useRef(null);

  const [prefs, setPrefs] = useState(() =>
    readJSON(PREFS_KEY, {
      notifications: true,
      sounds: true,
      haptics: true,
      shareLocation: true,
      analytics: false,
      autoRecalc: true,
      avoidTolls: false,
      avoidHighways: false,
    })
  );

  const [editOpen, setEditOpen] = useState(false);
  const [editMsg, setEditMsg] = useState("");
  const [infoOpen, setInfoOpen] = useState(null); // "about" | "terms" | "privacy"

  const [confirm, setConfirm] = useState(null); // {type, title, body, actionLabel, onConfirm}

  const [form, setForm] = useState(() => ({
    nome: user?.nome || "",
    email: user?.email || "",
    altura: user?.altura || "",
    peso: user?.peso || "",
    objetivo: user?.objetivo || "hipertrofia",
    frequencia: String(user?.frequencia ?? 4),
  }));

  const photo = user?.photoUrl || "";

  // persist prefs
  useMemo(() => {
    writeJSON(PREFS_KEY, prefs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs]);

  if (!user) return null;

  function pickPhoto() {
    fileRef.current?.click();
  }

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => updateUser({ photoUrl: reader.result });
    reader.readAsDataURL(file);
  }

  function openEdit() {
    setEditMsg("");
    setForm({
      nome: user?.nome || "",
      email: user?.email || "",
      altura: user?.altura || "",
      peso: user?.peso || "",
      objetivo: user?.objetivo || "hipertrofia",
      frequencia: String(user?.frequencia ?? 4),
    });
    setEditOpen(true);
  }

  function migrateEmailData(oldEmail, newEmail) {
    // Pagamentos
    const oldKeyPay = `payments_${oldEmail}`;
    const newKeyPay = `payments_${newEmail}`;
    const payRaw = localStorage.getItem(oldKeyPay);
    if (payRaw && !localStorage.getItem(newKeyPay)) localStorage.setItem(newKeyPay, payRaw);
    if (payRaw) localStorage.removeItem(oldKeyPay);

    // status pago
    const oldPaid = `paid_${oldEmail}`;
    const newPaid = `paid_${newEmail}`;
    const paid = localStorage.getItem(oldPaid);
    if (paid && !localStorage.getItem(newPaid)) localStorage.setItem(newPaid, paid);
    if (paid) localStorage.removeItem(oldPaid);

    // EcoContext por email (v2)
    const oldEco = `@EcoRoute:EcoState:${oldEmail}:v2`;
    const newEco = `@EcoRoute:EcoState:${newEmail}:v2`;
    const ecoRaw = localStorage.getItem(oldEco);
    if (ecoRaw && !localStorage.getItem(newEco)) localStorage.setItem(newEco, ecoRaw);
    if (ecoRaw) localStorage.removeItem(oldEco);
  }

  function saveProfile() {
    setEditMsg("");

    const nome = String(form.nome || "").trim();
    const email = String(form.email || "").trim().toLowerCase();
    const altura = String(form.altura || "").trim();
    const peso = String(form.peso || "").trim();
    const objetivo = String(form.objetivo || "").trim() || "hipertrofia";
    const freq = clampNum(form.frequencia, 1, 14);

    if (!nome) return setEditMsg("Nome é obrigatório.");
    if (!email || !email.includes("@")) return setEditMsg("Email inválido.");

    const oldEmail = String(user?.email || "").toLowerCase();
    if (oldEmail && email !== oldEmail) migrateEmailData(oldEmail, email);

    updateUser({
      nome,
      email,
      altura,
      peso,
      objetivo,
      frequencia: freq ?? 4,
    });

    setEditOpen(false);
  }

  const planLabel = user?.plano === "nutri+" ? "Nutri+" : "Basic";

  const profileMeta = useMemo(() => {
    const a = user?.altura ? `${user.altura} cm` : "—";
    const p = user?.peso ? `${user.peso} kg` : "—";
    const f = Number.isFinite(Number(user?.frequencia)) ? `${user.frequencia}x/sem` : "—";
    const obj = user?.objetivo ? String(user.objetivo) : "—";
    return { a, p, f, obj };
  }, [user]);

  function clearAppDataKeepAccount() {
    const email = String(user?.email || "").toLowerCase();
    const keysToRemove = [
      PREFS_KEY,
      `payments_${email}`,
      `paid_${email}`,
      `@EcoRoute:EcoState:${email}:v2`,
      "@EcoRoute:EcoState:v1",
      "@EcoRoute:Tank:v1",
    ];
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    setPrefs(readJSON(PREFS_KEY, {
      notifications: true,
      sounds: true,
      haptics: true,
      shareLocation: true,
      analytics: false,
      autoRecalc: true,
      avoidTolls: false,
      avoidHighways: false,
    }));
    // mantém usuário logado e conta intacta
    window.location.reload();
  }

  function deleteAccount() {
    const email = String(user?.email || "").toLowerCase();

    const users = readJSON(USERS_KEY, {});
    delete users[email];
    writeJSON(USERS_KEY, users);

    localStorage.removeItem(`payments_${email}`);
    localStorage.removeItem(`paid_${email}`);
    localStorage.removeItem(`@EcoRoute:EcoState:${email}:v2`);
    localStorage.removeItem(SESSION_KEY);

    logout();
    nav("/");
  }

  return (
    <div style={S.page}>
      {/* header background blobs */}
      <div style={S.bgBlobs} aria-hidden="true">
        <motion.div
          style={S.blobA}
          animate={{ x: [0, 10, 0], y: [0, -8, 0] }}
          transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          style={S.blobB}
          animate={{ x: [0, -12, 0], y: [0, 10, 0] }}
          transition={{ duration: 7.2, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFile} />

      {/* Apple ID style cell */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        <div style={S.profileCard}>
          <button type="button" onClick={pickPhoto} style={S.avatarBtn} title="Trocar foto">
            {photo ? (
              <img src={photo} alt="avatar" style={S.avatarImg} />
            ) : (
              <div style={S.avatarFallback}>{user.nome?.[0]?.toUpperCase() || "U"}</div>
            )}
          </button>

          <div style={{ minWidth: 0 }}>
            <div style={S.profileName}>{user.nome}</div>
            <div style={S.profileEmail}>{user.email}</div>
            <div style={S.profilePills}>
              <span style={S.pill}>{planLabel}</span>
              <span style={S.pillSoft}>{profileMeta.obj}</span>
            </div>
          </div>

          <motion.button
            type="button"
            style={S.editBtn}
            onClick={openEdit}
            whileTap={{ scale: 0.98 }}
          >
            Editar
          </motion.button>
        </div>

        <div style={S.profileStats}>
          <div style={S.stat}>
            <div style={S.statK}>Altura</div>
            <div style={S.statV}>{profileMeta.a}</div>
          </div>
          <div style={S.stat}>
            <div style={S.statK}>Peso</div>
            <div style={S.statV}>{profileMeta.p}</div>
          </div>
          <div style={S.stat}>
            <div style={S.statK}>Frequência</div>
            <div style={S.statV}>{profileMeta.f}</div>
          </div>
        </div>
      </motion.div>

      {/* Settings sections */}
      <Section title="CONTA">
        <Row
          title="Pagamentos"
          subtitle="Histórico e status do plano"
          onClick={() => nav("/pagamentos")}
          right={planLabel}
          icon={<span>💳</span>}
        />
        <Divider />
        <Row
          title="Assinatura"
          subtitle="Gerenciar plano e benefícios"
          onClick={() => nav("/pagamentos")}
          right={planLabel}
          icon={<span>🧾</span>}
        />
      </Section>

      <Section title="ECO & NAVEGAÇÃO" hint="O essencial do app: carro, tanque e rotas.">
        <Row
          title="Carro e consumo"
          subtitle="Defina combustível, km/L e preço"
          onClick={() => nav("/carbase")}
          right={eco?.vehicle?.model ? "Configurado" : "Configurar"}
          icon={<span>🚗</span>}
        />
        <Divider />
        <Row
          title="IA do carro"
          subtitle="Selecionar carro e perfil"
          onClick={() => nav("/ia")}
          icon={<span>✨</span>}
        />
        <Divider />
        <Row
          title="Histórico de rotas"
          subtitle="Distância, tempo e economia"
          onClick={() => nav("/routes")}
          icon={<span>🗺️</span>}
        />
        <Divider />
        <Row
          title="Insights"
          subtitle="Resumo e comportamento eco"
          onClick={() => nav("/ecoinsights")}
          icon={<span>📈</span>}
        />
        <Divider />
        <Row
          title="Manutenção"
          subtitle="Rotina e lembretes"
          onClick={() => nav("/maintenance")}
          icon={<span>🧰</span>}
        />
        <Divider />
        <Row
          title="Radar de postos"
          subtitle="Ver postos próximos (no mapa)"
          onClick={() => nav("/mapa")}
          right="Abrir"
          icon={<span>⛽</span>}
        />
      </Section>

      <Section title="PREFERÊNCIAS">
        <ToggleRow
          title="Notificações"
          subtitle="Alertas do app"
          value={prefs.notifications}
          onChange={(v) => setPrefs((p) => ({ ...p, notifications: v }))}
          icon={<span>🔔</span>}
        />
        <Divider />
        <ToggleRow
          title="Sons"
          subtitle="Efeitos e feedback"
          value={prefs.sounds}
          onChange={(v) => setPrefs((p) => ({ ...p, sounds: v }))}
          icon={<span>🔊</span>}
        />
        <Divider />
        <ToggleRow
          title="Háptico"
          subtitle="Vibração ao tocar"
          value={prefs.haptics}
          onChange={(v) => setPrefs((p) => ({ ...p, haptics: v }))}
          icon={<span>📳</span>}
        />
        <Divider />
        <ToggleRow
          title="Recalcular automaticamente"
          subtitle="Ao mudar trajeto"
          value={prefs.autoRecalc}
          onChange={(v) => setPrefs((p) => ({ ...p, autoRecalc: v }))}
          icon={<span>🔁</span>}
        />
        <Divider />
        <Row
          title="Evitar pedágios"
          subtitle="Preferência de rota"
          onClick={() => setPrefs((p) => ({ ...p, avoidTolls: !p.avoidTolls }))}
          right={prefs.avoidTolls ? "Ligado" : "Desligado"}
          icon={<span>🛣️</span>}
        />
        <Divider />
        <Row
          title="Evitar rodovias"
          subtitle="Preferência de rota"
          onClick={() => setPrefs((p) => ({ ...p, avoidHighways: !p.avoidHighways }))}
          right={prefs.avoidHighways ? "Ligado" : "Desligado"}
          icon={<span>🚧</span>}
        />
      </Section>

      <Section title="PRIVACIDADE & SEGURANÇA">
        <ToggleRow
          title="Compartilhar localização"
          subtitle="Necessário para GPS e rotas"
          value={prefs.shareLocation}
          onChange={(v) => setPrefs((p) => ({ ...p, shareLocation: v }))}
          icon={<span>📍</span>}
        />
        <Divider />
        <ToggleRow
          title="Diagnóstico"
          subtitle="Enviar dados anônimos"
          value={prefs.analytics}
          onChange={(v) => setPrefs((p) => ({ ...p, analytics: v }))}
          icon={<span>🧪</span>}
        />
        <Divider />
        <Row
          title="Senha"
          subtitle="Trocar senha (v2)"
          disabled
          right="Em breve"
          icon={<span>🔒</span>}
        />
      </Section>

      <Section title="SUPORTE">
        <Row
          title="Ajuda"
          subtitle="Dúvidas e tutoriais"
          onClick={() => setInfoOpen("help")}
          icon={<span>💬</span>}
        />
        <Divider />
        <Row
          title="Sobre"
          subtitle="Versão e créditos"
          onClick={() => setInfoOpen("about")}
          icon={<span>ℹ️</span>}
        />
        <Divider />
        <Row
          title="Termos"
          subtitle="Uso do app"
          onClick={() => setInfoOpen("terms")}
          icon={<span>📄</span>}
        />
        <Divider />
        <Row
          title="Privacidade"
          subtitle="Política de privacidade"
          onClick={() => setInfoOpen("privacy")}
          icon={<span>🛡️</span>}
        />
      </Section>

      <Section title="AÇÕES">
        <Row
          title="Sair"
          subtitle="Encerrar sessão"
          onClick={() =>
            setConfirm({
              type: "logout",
              title: "Sair da conta?",
              body: "Você será desconectado deste dispositivo.",
              actionLabel: "Sair",
              onConfirm: () => {
                logout();
                nav("/");
              },
            })
          }
          icon={<span>🚪</span>}
        />
        <Divider />
        <Row
          title="Apagar dados do app"
          subtitle="Limpa rotas, prefs e cache (mantém a conta)"
          onClick={() =>
            setConfirm({
              type: "wipe",
              title: "Apagar dados do app?",
              body: "Isso remove histórico de rotas, preferências e estado Eco deste dispositivo.",
              actionLabel: "Apagar",
              onConfirm: clearAppDataKeepAccount,
            })
          }
          icon={<span>🧹</span>}
        />
        <Divider />
        <Row
          title="Apagar conta"
          subtitle="Remove sua conta deste app"
          danger
          onClick={() =>
            setConfirm({
              type: "delete",
              title: "Apagar conta?",
              body: "Isso remove sua conta e dados locais associados. Não pode ser desfeito.",
              actionLabel: "Apagar conta",
              onConfirm: deleteAccount,
            })
          }
          icon={<span>🗑️</span>}
        />
      </Section>

      {/* Modals */}
      <AnimatePresence>
        {editOpen && (
          <Modal
            title="Editar perfil"
            subtitle="Informações da sua conta"
            onClose={() => setEditOpen(false)}
          >
            <div style={{ display: "grid", gap: 10 }}>
              <Field label="Nome">
                <input
                  value={form.nome}
                  onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))}
                  style={S.input}
                  placeholder="Seu nome"
                />
              </Field>

              <Field label="Email">
                <input
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  style={S.input}
                  placeholder="seu@email.com"
                />
              </Field>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Altura (cm)">
                  <input
                    value={form.altura}
                    onChange={(e) => setForm((p) => ({ ...p, altura: e.target.value }))}
                    style={S.input}
                    inputMode="numeric"
                    placeholder="Ex: 175"
                  />
                </Field>
                <Field label="Peso (kg)">
                  <input
                    value={form.peso}
                    onChange={(e) => setForm((p) => ({ ...p, peso: e.target.value }))}
                    style={S.input}
                    inputMode="decimal"
                    placeholder="Ex: 80"
                  />
                </Field>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Objetivo">
                  <select
                    value={form.objetivo}
                    onChange={(e) => setForm((p) => ({ ...p, objetivo: e.target.value }))}
                    style={S.input}
                  >
                    <option value="hipertrofia">Hipertrofia</option>
                    <option value="emagrecimento">Emagrecimento</option>
                    <option value="condicionamento">Condicionamento</option>
                  </select>
                </Field>
                <Field label="Frequência (x/sem)">
                  <input
                    value={form.frequencia}
                    onChange={(e) => setForm((p) => ({ ...p, frequencia: e.target.value }))}
                    style={S.input}
                    inputMode="numeric"
                    placeholder="Ex: 4"
                  />
                </Field>
              </div>

              {editMsg ? <div style={S.inlineMsg}>{editMsg}</div> : null}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                <motion.button type="button" style={S.btnSoft} whileTap={{ scale: 0.985 }} onClick={() => setEditOpen(false)}>
                  Cancelar
                </motion.button>
                <motion.button type="button" style={S.btnAccent} whileTap={{ scale: 0.985 }} onClick={saveProfile}>
                  Salvar
                </motion.button>
              </div>
            </div>
          </Modal>
        )}

        {infoOpen && (
          <Modal
            title={
              infoOpen === "about"
                ? "Sobre"
                : infoOpen === "terms"
                ? "Termos"
                : infoOpen === "privacy"
                ? "Privacidade"
                : "Ajuda"
            }
            subtitle=""
            onClose={() => setInfoOpen(null)}
          >
            <div style={{ color: COLORS.sub, fontSize: 13, lineHeight: 1.55 }}>
              {infoOpen === "about" && (
                <>
                  <div style={{ fontWeight: 900, color: COLORS.text }}>EcoRoute (Teste)</div>
                  <div style={{ marginTop: 6 }}>
                    App focado em rotas e economia de combustível.
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <b>Plano:</b> {planLabel}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <b>Conta criada:</b>{" "}
                    {user?.createdAt ? new Date(user.createdAt).toLocaleString("pt-BR") : "—"}
                  </div>
                </>
              )}

              {infoOpen === "help" && (
                <>
                  <div style={{ fontWeight: 900, color: COLORS.text }}>Como usar</div>
                  <ul style={{ marginTop: 8 }}>
                    <li>Cadastre o carro em <b>CarBase</b> (km/L e preço).</li>
                    <li>No mapa, selecione destino e veja litros/R$ estimados.</li>
                    <li>Use <b>GO/STOP</b> para contagem real durante a viagem.</li>
                  </ul>
                </>
              )}

              {infoOpen === "terms" && (
                <>
                  <div style={{ fontWeight: 900, color: COLORS.text }}>Termos (placeholder)</div>
                  <div style={{ marginTop: 6 }}>
                    Este é um protótipo. As estimativas são aproximadas e podem variar.
                  </div>
                </>
              )}

              {infoOpen === "privacy" && (
                <>
                  <div style={{ fontWeight: 900, color: COLORS.text }}>Privacidade (placeholder)</div>
                  <div style={{ marginTop: 6 }}>
                    Dados são armazenados localmente neste protótipo. Desative “Compartilhar localização” se preferir.
                  </div>
                </>
              )}

              <div style={{ marginTop: 14 }}>
                <motion.button type="button" style={S.btnSoftWide} whileTap={{ scale: 0.985 }} onClick={() => setInfoOpen(null)}>
                  Fechar
                </motion.button>
              </div>
            </div>
          </Modal>
        )}

        {confirm && (
          <Modal title={confirm.title} subtitle={confirm.body} onClose={() => setConfirm(null)}>
            <div style={{ display: "grid", gap: 10 }}>
              <motion.button
                type="button"
                style={{
                  ...S.btnDangerWide,
                  background: confirm.type === "delete" ? COLORS.danger : COLORS.accent,
                }}
                whileTap={{ scale: 0.985 }}
                onClick={() => {
                  const fn = confirm.onConfirm;
                  setConfirm(null);
                  fn?.();
                }}
              >
                {confirm.actionLabel}
              </motion.button>

              <motion.button type="button" style={S.btnSoftWide} whileTap={{ scale: 0.985 }} onClick={() => setConfirm(null)}>
                Cancelar
              </motion.button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      <div style={{ height: 26 }} />
    </div>
  );
}

function Divider() {
  return <div style={S.divider} />;
}

function Field({ label, children }) {
  return (
    <div>
      <div style={S.fieldLabel}>{label}</div>
      {children}
    </div>
  );
}

/* ---------------- Styles ---------------- */
const S = {
  page: {
    minHeight: "100vh",
    background: COLORS.bg,
    padding: 16,
    paddingBottom: 110,
    position: "relative",
    overflow: "hidden",
  },

  bgBlobs: { position: "absolute", inset: 0, pointerEvents: "none" },
  blobA: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 999,
    left: -110,
    top: -120,
    background: "radial-gradient(circle at 30% 30%, rgba(0,122,255,0.22), rgba(0,122,255,0.02))",
    filter: "blur(2px)",
  },
  blobB: {
    position: "absolute",
    width: 380,
    height: 380,
    borderRadius: 999,
    right: -150,
    top: -160,
    background: "radial-gradient(circle at 30% 30%, rgba(88,86,214,0.18), rgba(88,86,214,0.02))",
    filter: "blur(2px)",
  },

  profileCard: {
    background: COLORS.card,
    borderRadius: 18,
    border: `1px solid ${COLORS.line}`,
    boxShadow: `0 18px 45px ${COLORS.shadow}`,
    padding: 14,
    display: "grid",
    gridTemplateColumns: "56px 1fr auto",
    gap: 12,
    alignItems: "center",
    position: "relative",
  },

  avatarBtn: {
    width: 56,
    height: 56,
    borderRadius: 16,
    border: `1px solid ${COLORS.line}`,
    background: "rgba(0,0,0,0.02)",
    overflow: "hidden",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
  },
  avatarImg: { width: "100%", height: "100%", objectFit: "cover" },
  avatarFallback: {
    width: "100%",
    height: "100%",
    display: "grid",
    placeItems: "center",
    fontWeight: 1000,
    color: COLORS.text,
    fontSize: 18,
  },

  profileName: {
    fontSize: 16,
    fontWeight: 1000,
    color: COLORS.text,
    letterSpacing: -0.3,
    lineHeight: 1.1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  profileEmail: {
    marginTop: 4,
    fontSize: 12,
    color: COLORS.sub,
    fontWeight: 700,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  profilePills: { marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" },
  pill: {
    fontSize: 11,
    fontWeight: 900,
    color: COLORS.accent,
    background: "rgba(0,122,255,0.10)",
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(0,122,255,0.18)",
  },
  pillSoft: {
    fontSize: 11,
    fontWeight: 900,
    color: COLORS.text,
    background: "rgba(60,60,67,0.08)",
    padding: "6px 10px",
    borderRadius: 999,
    border: `1px solid ${COLORS.line}`,
  },

  editBtn: {
    padding: "10px 12px",
    borderRadius: 14,
    border: `1px solid ${COLORS.line}`,
    background: "rgba(0,0,0,0.02)",
    fontWeight: 900,
    color: COLORS.text,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  profileStats: {
    marginTop: 10,
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 10,
  },
  stat: {
    background: COLORS.card,
    borderRadius: 16,
    border: `1px solid ${COLORS.line}`,
    boxShadow: `0 12px 30px ${COLORS.shadow}`,
    padding: "10px 12px",
  },
  statK: { fontSize: 11, color: COLORS.sub, fontWeight: 900, letterSpacing: 0.2 },
  statV: { marginTop: 4, fontSize: 13, color: COLORS.text, fontWeight: 1000 },

  sectionTitle: {
    margin: "0 6px 8px",
    fontSize: 12,
    fontWeight: 1000,
    color: COLORS.sub,
    letterSpacing: 0.7,
  },
  sectionHint: {
    margin: "8px 10px 0",
    fontSize: 12,
    color: COLORS.sub,
    fontWeight: 650,
    lineHeight: 1.35,
  },

  card: {
    background: COLORS.card,
    borderRadius: 18,
    border: `1px solid ${COLORS.line}`,
    boxShadow: `0 18px 45px ${COLORS.shadow}`,
    overflow: "hidden",
  },

  divider: { height: 1, background: COLORS.line, marginLeft: 14 },

  rowBtn: {
    width: "100%",
    border: "none",
    background: "transparent",
    padding: "12px 14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    textAlign: "left",
  },
  rowStatic: {
    padding: "12px 14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  rowLeft: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
  rowRight: { display: "flex", alignItems: "center", gap: 6 },
  rowTitle: { fontSize: 14, fontWeight: 900, color: COLORS.text },
  rowSub: { marginTop: 2, fontSize: 12, color: COLORS.sub, fontWeight: 650 },
  rowRightText: { fontSize: 12, color: COLORS.sub2, fontWeight: 900 },

  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    background: "rgba(0,0,0,0.03)",
    border: `1px solid ${COLORS.line}`,
    display: "grid",
    placeItems: "center",
    flex: "0 0 auto",
    fontSize: 15,
  },

  switch: {
    width: 50,
    height: 30,
    borderRadius: 999,
    border: "1px solid rgba(60,60,67,0.12)",
    padding: 2,
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
    transition: "background 180ms ease",
  },
  switchKnob: {
    width: 26,
    height: 26,
    borderRadius: 999,
    background: "#fff",
    boxShadow: "0 8px 18px rgba(0,0,0,0.18)",
  },

  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.22)",
    display: "grid",
    placeItems: "center",
    zIndex: 9999,
    padding: 16,
  },
  modal: {
    width: "min(560px, 100%)",
    background: "rgba(255,255,255,0.92)",
    borderRadius: 20,
    border: `1px solid ${COLORS.line}`,
    boxShadow: "0 40px 120px rgba(0,0,0,0.22)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    overflow: "hidden",
  },
  modalTop: { padding: 14, borderBottom: `1px solid ${COLORS.line}` },
  modalTitle: { fontSize: 14, fontWeight: 1000, color: COLORS.text, letterSpacing: -0.2 },
  modalSub: { marginTop: 4, fontSize: 12, color: COLORS.sub, fontWeight: 650, lineHeight: 1.35 },
  modalBody: { padding: 14 },

  fieldLabel: { fontSize: 12, color: COLORS.sub, fontWeight: 900, marginBottom: 6 },

  input: {
    width: "100%",
    padding: 12,
    borderRadius: 14,
    border: `1px solid ${COLORS.line}`,
    background: "#fff",
    outline: "none",
    fontSize: 14,
    fontWeight: 750,
    color: COLORS.text,
  },

  inlineMsg: {
    padding: "10px 12px",
    borderRadius: 14,
    background: "rgba(255,59,48,0.10)",
    border: "1px solid rgba(255,59,48,0.18)",
    color: COLORS.text,
    fontWeight: 800,
    fontSize: 13,
  },

  btnSoft: {
    padding: 12,
    borderRadius: 14,
    border: `1px solid ${COLORS.line}`,
    background: "rgba(0,0,0,0.03)",
    fontWeight: 900,
    color: COLORS.text,
    cursor: "pointer",
  },
  btnAccent: {
    padding: 12,
    borderRadius: 14,
    border: "none",
    background: COLORS.accent,
    fontWeight: 950,
    color: "#fff",
    cursor: "pointer",
    boxShadow: "0 18px 40px rgba(0,122,255,0.22)",
  },
  btnSoftWide: {
    width: "100%",
    padding: 12,
    borderRadius: 14,
    border: `1px solid ${COLORS.line}`,
    background: "rgba(0,0,0,0.03)",
    fontWeight: 900,
    color: COLORS.text,
    cursor: "pointer",
  },
  btnDangerWide: {
    width: "100%",
    padding: 12,
    borderRadius: 14,
    border: "none",
    fontWeight: 950,
    color: "#fff",
    cursor: "pointer",
  },
};

