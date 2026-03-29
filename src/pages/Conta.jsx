import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { useEco } from "../context/EcoContext";

const PREFS_KEY = "@EcoRoute:Prefs:v1";

const C = {
  bg: "#F2F2F7",
  surface: "#FFFFFF",
  line: "rgba(60,60,67,0.18)",
  text: "#111111",
  sub: "rgba(60,60,67,0.72)",
  sub2: "rgba(60,60,67,0.55)",
  accent: "#007AFF",
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
        color: C.sub2,
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

function Row({ title, subtitle, right, onClick, danger, disabled, chevron = true }) {
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
        <div style={{ minWidth: 0 }}>
          <div style={{ ...S.rowTitle, color: danger ? C.danger : C.text }}>{title}</div>
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

function ToggleRow({ title, subtitle, value, onChange }) {
  return (
    <div style={S.rowStatic}>
      <div style={S.rowLeft}>
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
        background: value ? C.accent : "rgba(120,120,128,0.20)",
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
  const [infoOpen, setInfoOpen] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const [form, setForm] = useState(() => ({
    nome: user?.nome || "",
    email: user?.email || "",
  }));

  const photo = user?.photoUrl || "";

  useMemo(() => {
    writeJSON(PREFS_KEY, prefs);
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
    });
    setEditOpen(true);
  }

  function saveProfile() {
    setEditMsg("");

    const nome = String(form.nome || "").trim();
    const email = String(form.email || "").trim().toLowerCase();

    if (!nome) return setEditMsg("Nome é obrigatório.");
    if (!email || !email.includes("@")) return setEditMsg("Email inválido.");

    updateUser({ nome, email });
    setEditOpen(false);
  }

  const planLabel = user?.plano === "nutri+" ? "Nutri+" : "Basic";

  const profileMeta = useMemo(() => {
    const car = eco?.vehicle?.model || "Sem carro";
    const mode =
      eco?.routeMode === "fast"
        ? "Rápido"
        : eco?.routeMode === "balanced"
        ? "Balanceado"
        : "Eco";

    const tankLabel =
      eco?.tank?.capacityL && eco?.tank?.levelL != null
        ? `${Number(eco.tank.levelL).toFixed(1)}L / ${Number(eco.tank.capacityL).toFixed(0)}L`
        : "Não configurado";

    return { car, mode, tankLabel };
  }, [eco?.vehicle?.model, eco?.routeMode, eco?.tank?.capacityL, eco?.tank?.levelL]);

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
    window.location.reload();
  }

  return (
    <div style={S.page}>
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
              <span style={S.pillSoft}>{profileMeta.mode}</span>
            </div>
          </div>

          <motion.button type="button" style={S.editBtn} onClick={openEdit} whileTap={{ scale: 0.98 }}>
            Editar
          </motion.button>
        </div>

        <div style={S.profileStats}>
          <div style={S.stat}>
            <div style={S.statK}>Carro</div>
            <div style={S.statV}>{profileMeta.car}</div>
          </div>
          <div style={S.stat}>
            <div style={S.statK}>Modo</div>
            <div style={S.statV}>{profileMeta.mode}</div>
          </div>
          <div style={S.stat}>
            <div style={S.statK}>Tanque</div>
            <div style={S.statV}>{profileMeta.tankLabel}</div>
          </div>
        </div>
      </motion.div>

      <Section title="CONTA">
        <Row
          title="Pagamentos"
          subtitle="Histórico e status do plano"
          onClick={() => nav("/pagamentos")}
          right={planLabel}
        />
      </Section>

      <Section title="ECO E NAVEGAÇÃO" hint="Somente dados úteis para o app atual.">
        <Row
          title="Carro e consumo"
          subtitle="Defina combustível, km/L e preço"
          onClick={() => nav("/carbase")}
          right={eco?.vehicle?.model ? "Configurado" : "Configurar"}
        />
        <Divider />
        <Row
          title="IA do carro"
          subtitle="Selecionar carro e perfil"
          onClick={() => nav("/ia")}
        />
        <Divider />
        <Row
          title="Histórico de rotas"
          subtitle="Distância, tempo e economia"
          onClick={() => nav("/routes")}
        />
      </Section>

      <Section title="PREFERÊNCIAS">
        <ToggleRow
          title="Notificações"
          subtitle="Alertas do app"
          value={prefs.notifications}
          onChange={(v) => setPrefs((p) => ({ ...p, notifications: v }))}
        />
        <Divider />
        <ToggleRow
          title="Sons"
          subtitle="Feedback do app"
          value={prefs.sounds}
          onChange={(v) => setPrefs((p) => ({ ...p, sounds: v }))}
        />
        <Divider />
        <ToggleRow
          title="Háptico"
          subtitle="Resposta ao toque"
          value={prefs.haptics}
          onChange={(v) => setPrefs((p) => ({ ...p, haptics: v }))}
        />
        <Divider />
        <ToggleRow
          title="Recalcular automaticamente"
          subtitle="Ao mudar de trajeto"
          value={prefs.autoRecalc}
          onChange={(v) => setPrefs((p) => ({ ...p, autoRecalc: v }))}
        />
        <Divider />
        <Row
          title="Evitar pedágios"
          subtitle="Preferência de rota"
          onClick={() => setPrefs((p) => ({ ...p, avoidTolls: !p.avoidTolls }))}
          right={prefs.avoidTolls ? "Ligado" : "Desligado"}
        />
        <Divider />
        <Row
          title="Evitar rodovias"
          subtitle="Preferência de rota"
          onClick={() => setPrefs((p) => ({ ...p, avoidHighways: !p.avoidHighways }))}
          right={prefs.avoidHighways ? "Ligado" : "Desligado"}
        />
      </Section>

      <Section title="PRIVACIDADE">
        <ToggleRow
          title="Compartilhar localização"
          subtitle="Necessário para GPS e rotas"
          value={prefs.shareLocation}
          onChange={(v) => setPrefs((p) => ({ ...p, shareLocation: v }))}
        />
        <Divider />
        <ToggleRow
          title="Diagnóstico"
          subtitle="Enviar dados anônimos"
          value={prefs.analytics}
          onChange={(v) => setPrefs((p) => ({ ...p, analytics: v }))}
        />
      </Section>

      <Section title="SUPORTE">
        <Row title="Ajuda" subtitle="Uso básico do app" onClick={() => setInfoOpen("help")} />
        <Divider />
        <Row title="Sobre" subtitle="Versão e informações" onClick={() => setInfoOpen("about")} />
        <Divider />
        <Row title="Privacidade" subtitle="Política local do protótipo" onClick={() => setInfoOpen("privacy")} />
      </Section>

      <Section title="AÇÕES">
        <Row
          title="Sair"
          subtitle="Encerrar sessão"
          onClick={() =>
            setConfirm({
              title: "Sair da conta?",
              body: "Você será desconectado deste dispositivo.",
              actionLabel: "Sair",
              onConfirm: () => {
                logout();
                nav("/");
              },
            })
          }
        />
        <Divider />
        <Row
          title="Apagar dados do app"
          subtitle="Limpa histórico, preferências e cache"
          onClick={() =>
            setConfirm({
              title: "Apagar dados do app?",
              body: "Isso remove dados locais deste dispositivo e mantém sua conta.",
              actionLabel: "Apagar",
              onConfirm: clearAppDataKeepAccount,
            })
          }
        />
      </Section>

      <AnimatePresence>
        {editOpen && (
          <Modal title="Editar perfil" subtitle="Informações principais da conta" onClose={() => setEditOpen(false)}>
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
                : infoOpen === "privacy"
                ? "Privacidade"
                : "Ajuda"
            }
            subtitle=""
            onClose={() => setInfoOpen(null)}
          >
            <div style={{ color: C.sub, fontSize: 13, lineHeight: 1.55 }}>
              {infoOpen === "about" && (
                <>
                  <div style={{ fontWeight: 900, color: C.text }}>EcoRoute (Teste)</div>
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
                  <div style={{ fontWeight: 900, color: C.text }}>Como usar</div>
                  <ul style={{ marginTop: 8 }}>
                    <li>Cadastre o carro em <b>CarBase</b>.</li>
                    <li>No mapa, selecione destino e veja litros e custo estimados.</li>
                    <li>Use <b>GO</b> e <b>STOP</b> para contagem ao vivo durante a viagem.</li>
                  </ul>
                </>
              )}

              {infoOpen === "privacy" && (
                <>
                  <div style={{ fontWeight: 900, color: C.text }}>Privacidade local</div>
                  <div style={{ marginTop: 6 }}>
                    Este protótipo usa armazenamento local e preferências do próprio navegador.
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
                style={S.btnAccentWide}
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

const S = {
  page: {
    minHeight: "100vh",
    background: C.bg,
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
  },
  blobB: {
    position: "absolute",
    width: 380,
    height: 380,
    borderRadius: 999,
    right: -150,
    top: -160,
    background: "radial-gradient(circle at 30% 30%, rgba(88,86,214,0.18), rgba(88,86,214,0.02))",
  },

  profileCard: {
    background: C.surface,
    borderRadius: 18,
    border: `1px solid ${C.line}`,
    boxShadow: `0 18px 45px ${C.shadow}`,
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
    border: `1px solid ${C.line}`,
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
    color: C.text,
    fontSize: 18,
  },

  profileName: {
    fontSize: 16,
    fontWeight: 1000,
    color: C.text,
    letterSpacing: -0.3,
    lineHeight: 1.1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  profileEmail: {
    marginTop: 4,
    fontSize: 12,
    color: C.sub,
    fontWeight: 700,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  profilePills: { marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" },
  pill: {
    fontSize: 11,
    fontWeight: 900,
    color: C.accent,
    background: "rgba(0,122,255,0.10)",
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(0,122,255,0.18)",
  },
  pillSoft: {
    fontSize: 11,
    fontWeight: 900,
    color: C.text,
    background: "rgba(60,60,67,0.08)",
    padding: "6px 10px",
    borderRadius: 999,
    border: `1px solid ${C.line}`,
  },

  editBtn: {
    padding: "10px 12px",
    borderRadius: 14,
    border: `1px solid ${C.line}`,
    background: "rgba(0,0,0,0.02)",
    fontWeight: 900,
    color: C.text,
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
    background: C.surface,
    borderRadius: 16,
    border: `1px solid ${C.line}`,
    boxShadow: `0 12px 30px ${C.shadow}`,
    padding: "10px 12px",
  },
  statK: { fontSize: 11, color: C.sub, fontWeight: 900, letterSpacing: 0.2 },
  statV: {
    marginTop: 4,
    fontSize: 13,
    color: C.text,
    fontWeight: 1000,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },

  sectionTitle: {
    margin: "0 6px 8px",
    fontSize: 12,
    fontWeight: 1000,
    color: C.sub,
    letterSpacing: 0.7,
  },
  sectionHint: {
    margin: "8px 10px 0",
    fontSize: 12,
    color: C.sub,
    fontWeight: 650,
    lineHeight: 1.35,
  },

  card: {
    background: C.surface,
    borderRadius: 18,
    border: `1px solid ${C.line}`,
    boxShadow: `0 18px 45px ${C.shadow}`,
    overflow: "hidden",
  },

  divider: { height: 1, background: C.line, marginLeft: 14 },

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
  rowTitle: { fontSize: 14, fontWeight: 900, color: C.text },
  rowSub: { marginTop: 2, fontSize: 12, color: C.sub, fontWeight: 650 },
  rowRightText: { fontSize: 12, color: C.sub2, fontWeight: 900 },

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
    border: `1px solid ${C.line}`,
    boxShadow: "0 40px 120px rgba(0,0,0,0.22)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    overflow: "hidden",
  },
  modalTop: { padding: 14, borderBottom: `1px solid ${C.line}` },
  modalTitle: { fontSize: 14, fontWeight: 1000, color: C.text, letterSpacing: -0.2 },
  modalSub: { marginTop: 4, fontSize: 12, color: C.sub, fontWeight: 650, lineHeight: 1.35 },
  modalBody: { padding: 14 },

  fieldLabel: { fontSize: 12, color: C.sub, fontWeight: 900, marginBottom: 6 },

  input: {
    width: "100%",
    padding: 12,
    borderRadius: 14,
    border: `1px solid ${C.line}`,
    background: "#fff",
    outline: "none",
    fontSize: 14,
    fontWeight: 750,
    color: C.text,
  },

  inlineMsg: {
    padding: "10px 12px",
    borderRadius: 14,
    background: "rgba(255,59,48,0.10)",
    border: "1px solid rgba(255,59,48,0.18)",
    color: C.text,
    fontWeight: 800,
    fontSize: 13,
  },

  btnSoft: {
    padding: 12,
    borderRadius: 14,
    border: `1px solid ${C.line}`,
    background: "rgba(0,0,0,0.03)",
    fontWeight: 900,
    color: C.text,
    cursor: "pointer",
  },
  btnAccent: {
    padding: 12,
    borderRadius: 14,
    border: "none",
    background: C.accent,
    fontWeight: 950,
    color: "#fff",
    cursor: "pointer",
    boxShadow: "0 18px 40px rgba(0,122,255,0.22)",
  },
  btnSoftWide: {
    width: "100%",
    padding: 12,
    borderRadius: 14,
    border: `1px solid ${C.line}`,
    background: "rgba(0,0,0,0.03)",
    fontWeight: 900,
    color: C.text,
    cursor: "pointer",
  },
  btnAccentWide: {
    width: "100%",
    padding: 12,
    borderRadius: 14,
    border: "none",
    background: C.accent,
    fontWeight: 950,
    color: "#fff",
    cursor: "pointer",
  },
};
