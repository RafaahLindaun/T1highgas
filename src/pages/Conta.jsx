import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { useEco } from "../context/EcoContext";

/**
 * Conta.jsx
 * - Estética: iOS-like (glass + blur), mais retangular
 * - Tipografia: “Ferrari vibe” (peso alto + uppercase em títulos)
 * - Paleta 60/30/10 (claro): 60% fundo, 30% superfícies, 10% acento (vermelho)
 * - Info breve/direta, avatar no canto esquerdo
 * - Mantém funcionalidades: foto, editar perfil, migração de email, eco profile
 */

export default function Conta() {
  const { user, updateUser, logout } = useAuth();
  const { vehicle, tank, routeMode, setRouteMode, setTank } = useEco();

  const nav = useNavigate();
  const fileRef = useRef(null);

  const photo = user?.photoUrl || "";

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

  const [editOpen, setEditOpen] = useState(false);
  const [editMsg, setEditMsg] = useState("");

  const [form, setForm] = useState(() => ({
    nome: user?.nome || "",
    email: user?.email || "",
    idade: user?.idade || "",
    altura: user?.altura || "",
    peso: user?.peso || "",
  }));

  function openEdit() {
    setEditMsg("");
    setForm({
      nome: user?.nome || "",
      email: user?.email || "",
      idade: user?.idade || "",
      altura: user?.altura || "",
      peso: user?.peso || "",
    });
    setEditOpen(true);
  }

  function closeEdit() {
    setEditOpen(false);
    setEditMsg("");
  }

  function onFormChange(e) {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
  }

  function migrateEmailData(oldEmail, newEmail) {
    // pagamentos
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
    const idade = String(form.idade || "").trim();
    const altura = String(form.altura || "").trim();
    const peso = String(form.peso || "").trim();

    if (!nome) return setEditMsg("Nome é obrigatório.");
    if (!email || !email.includes("@")) return setEditMsg("Email inválido.");
    if (idade && Number(idade) <= 0) return setEditMsg("Idade inválida.");
    if (altura && Number(altura) <= 0) return setEditMsg("Altura inválida.");
    if (peso && Number(peso) <= 0) return setEditMsg("Peso inválido.");

    const oldEmail = String(user?.email || "").toLowerCase();
    if (oldEmail && email !== oldEmail) migrateEmailData(oldEmail, email);

    updateUser({ nome, email, idade, altura, peso });
    setEditOpen(false);
  }

  if (!user) return null;

  const chips = [
    user?.idade ? { k: "Idade", v: `${user.idade}` } : null,
    user?.altura ? { k: "Altura", v: `${user.altura}cm` } : null,
    user?.peso ? { k: "Peso", v: `${user.peso}kg` } : null,
  ].filter(Boolean);

  return (
    <div style={S.page}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={onFile}
      />

      <motion.div
        initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        style={S.shell}
      >
        {/* Header Card */}
        <div style={S.headerCard}>
          <div style={S.headerGlass} />
          <div style={S.headerAccent} />

          <div style={S.profileRow}>
            {/* Avatar (canto esquerdo) */}
            <motion.button
              type="button"
              onClick={pickPhoto}
              whileTap={{ scale: 0.98 }}
              style={S.avatarBtn}
              aria-label="Trocar foto"
              title="Trocar foto"
            >
              {photo ? (
                <img src={photo} alt="avatar" style={S.avatarImg} />
              ) : (
                <div style={S.avatarFallback}>
                  {user.nome?.[0]?.toUpperCase() || "U"}
                </div>
              )}
              <div style={S.avatarBadge}>Editar</div>
            </motion.button>

            {/* Info (breve e direta) */}
            <div style={S.profileInfo}>
              <div style={S.name}>{user.nome}</div>
              <div style={S.email}>{user.email}</div>

              <div style={S.chipsRow}>
                {chips.length ? (
                  chips.map((c, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22, delay: 0.05 * idx }}
                      style={S.chip}
                    >
                      <span style={S.chipK}>{c.k}</span>
                      <span style={S.chipV}>{c.v}</span>
                    </motion.div>
                  ))
                ) : (
                  <div style={{ ...S.chip, opacity: 0.75 }}>
                    <span style={S.chipK}>Perfil</span>
                    <span style={S.chipV}>Completar</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Ações */}
          <div style={S.actionsRow}>
            <button style={S.btnSoft} onClick={openEdit}>
              Editar
            </button>
            <button style={S.btnAccent} onClick={() => nav("/pagamentos")}>
              Pagamentos
            </button>
            <button
              style={S.btnGhost}
              onClick={() => {
                logout();
                nav("/");
              }}
            >
              Sair
            </button>
          </div>
        </div>

        {/* Eco Profile (compacto) */}
        <div style={S.card}>
          <div style={S.cardTitle}>ECO</div>

          <div style={S.kvRow}>
            <div style={S.kvKey}>Carro</div>
            <div style={S.kvVal} title={vehicle?.model || ""}>
              {vehicle?.model || "—"}
            </div>
          </div>

          <div style={S.kvRow}>
            <div style={S.kvKey}>Modo</div>
            <select
              value={routeMode}
              onChange={(e) => setRouteMode(e.target.value)}
              style={S.select}
            >
              <option value="eco">Eco</option>
              <option value="balanced">Balanceado</option>
              <option value="fast">Rápido</option>
            </select>
          </div>

          <div style={S.grid2}>
            <div>
              <div style={S.label}>Tanque (L)</div>
              <input
                value={String(tank.capacityL)}
                onChange={(e) => setTank({ capacityL: e.target.value })}
                style={S.input}
                inputMode="decimal"
              />
            </div>

            <div>
              <div style={S.label}>Nível (L)</div>
              <input
                value={String(tank.levelL)}
                onChange={(e) => setTank({ levelL: e.target.value })}
                style={S.input}
                inputMode="decimal"
              />
            </div>
          </div>

          <div style={S.note}>
            GO no mapa debita o tanque automaticamente.
          </div>
        </div>
      </motion.div>

      {/* Modal Edit (sheet iOS-like) */}
      <AnimatePresence>
        {editOpen && (
          <motion.div
            style={S.overlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeEdit}
          >
            <motion.div
              initial={{ y: 24, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 24, opacity: 0, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              style={S.sheet}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={S.sheetHandle} />
              <div style={S.sheetTitle}>EDITAR PERFIL</div>

              <div style={S.form}>
                <input
                  style={S.input}
                  name="nome"
                  placeholder="Nome"
                  value={form.nome}
                  onChange={onFormChange}
                />
                <input
                  style={S.input}
                  name="email"
                  placeholder="Email"
                  value={form.email}
                  onChange={onFormChange}
                />

                <div style={S.row2}>
                  <input
                    style={S.input}
                    name="idade"
                    placeholder="Idade"
                    value={form.idade}
                    onChange={onFormChange}
                    inputMode="numeric"
                  />
                  <input
                    style={S.input}
                    name="altura"
                    placeholder="Altura (cm)"
                    value={form.altura}
                    onChange={onFormChange}
                    inputMode="numeric"
                  />
                </div>

                <input
                  style={S.input}
                  name="peso"
                  placeholder="Peso (kg)"
                  value={form.peso}
                  onChange={onFormChange}
                  inputMode="decimal"
                />

                {editMsg ? <div style={S.msg}>{editMsg}</div> : null}

                <div style={S.sheetActions}>
                  <button style={S.btnSoft} onClick={closeEdit}>
                    Cancelar
                  </button>
                  <button style={S.btnAccent} onClick={saveProfile}>
                    Salvar
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* --------------------- STYLE TOKENS (60/30/10) --------------------- */
/**
 * 60%: base/bg (claro neutro)
 * 30%: surfaces (branco/translúcido)
 * 10%: accent (vermelho)
 */
const T = {
  bg: "#F4F6FA",             // 60
  surface: "rgba(255,255,255,0.78)", // 30 (glass)
  surfaceSolid: "#FFFFFF",
  line: "rgba(15, 23, 42, 0.08)",
  text: "#0B1220",
  muted: "rgba(11,18,32,0.62)",
  muted2: "rgba(11,18,32,0.48)",
  shadow: "rgba(15,23,42,0.10)",
  accent: "#D40000",         // 10 (Ferrari red)
  accent2: "#FF2A2A",
};

const FerrariFont = {
  fontFamily:
    "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial",
};

const S = {
  page: {
    ...FerrariFont,
    minHeight: "100vh",
    background: `radial-gradient(1000px 520px at 20% 0%, rgba(212,0,0,0.10), transparent 60%),
                 radial-gradient(900px 520px at 100% 10%, rgba(255,42,42,0.07), transparent 55%),
                 ${T.bg}`,
    color: T.text,
    padding: 18,
    paddingBottom: 120,
  },

  shell: {
    display: "grid",
    gap: 14,
    maxWidth: 720,
    margin: "0 auto",
  },

  headerCard: {
    position: "relative",
    borderRadius: 20, // mais retangular
    overflow: "hidden",
    background: T.surface,
    border: `1px solid ${T.line}`,
    boxShadow: `0 22px 60px ${T.shadow}`,
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    padding: 14,
  },
  headerGlass: {
    position: "absolute",
    inset: 0,
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.60), rgba(255,255,255,0.30))",
    opacity: 0.35,
    pointerEvents: "none",
  },
  headerAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 6,
    background: `linear-gradient(180deg, ${T.accent2}, ${T.accent})`,
    boxShadow: `0 0 0 1px rgba(212,0,0,0.08)`,
    pointerEvents: "none",
  },

  profileRow: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "84px 1fr",
    gap: 12,
    alignItems: "center",
  },

  avatarBtn: {
    width: 84,
    height: 84,
    borderRadius: 18,
    border: `1px solid ${T.line}`,
    background: "rgba(255,255,255,0.65)",
    overflow: "hidden",
    position: "relative",
    cursor: "pointer",
    boxShadow: `0 14px 30px ${T.shadow}`,
    padding: 0,
  },
  avatarImg: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  avatarFallback: {
    width: "100%",
    height: "100%",
    display: "grid",
    placeItems: "center",
    fontWeight: 1000,
    fontSize: 28,
    letterSpacing: -0.6,
    color: T.text,
  },
  avatarBadge: {
    position: "absolute",
    bottom: 8,
    left: 8,
    padding: "6px 10px",
    borderRadius: 14,
    background: "rgba(255,255,255,0.78)",
    border: `1px solid ${T.line}`,
    fontWeight: 900,
    fontSize: 11,
    color: T.text,
    letterSpacing: -0.2,
  },

  profileInfo: { minWidth: 0 },

  name: {
    fontWeight: 1100,
    fontSize: 18,
    letterSpacing: -0.6,
    textTransform: "uppercase",
  },
  email: {
    marginTop: 2,
    fontSize: 12,
    color: T.muted,
    fontWeight: 800,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  chipsRow: {
    marginTop: 10,
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    display: "inline-flex",
    gap: 8,
    alignItems: "center",
    padding: "8px 10px",
    borderRadius: 16,
    background: "rgba(255,255,255,0.70)",
    border: `1px solid ${T.line}`,
    boxShadow: `0 10px 22px ${T.shadow}`,
  },
  chipK: { fontSize: 11, fontWeight: 950, color: T.muted2, letterSpacing: 0.2 },
  chipV: { fontSize: 12, fontWeight: 1000, color: T.text, letterSpacing: -0.2 },

  actionsRow: {
    position: "relative",
    marginTop: 12,
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 10,
  },

  btnSoft: {
    padding: "12px 12px",
    borderRadius: 18,
    border: `1px solid ${T.line}`,
    background: "rgba(255,255,255,0.70)",
    color: T.text,
    fontWeight: 1000,
    cursor: "pointer",
    letterSpacing: -0.2,
  },
  btnAccent: {
    padding: "12px 12px",
    borderRadius: 18,
    border: "none",
    background: `linear-gradient(180deg, ${T.accent2}, ${T.accent})`,
    color: "#ffffff",
    fontWeight: 1100,
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: -0.2,
    boxShadow: "0 14px 34px rgba(212,0,0,0.18)",
  },
  btnGhost: {
    padding: "12px 12px",
    borderRadius: 18,
    border: `1px solid ${T.line}`,
    background: "transparent",
    color: T.text,
    fontWeight: 1000,
    cursor: "pointer",
  },

  card: {
    borderRadius: 20,
    background: T.surface,
    border: `1px solid ${T.line}`,
    boxShadow: `0 22px 60px ${T.shadow}`,
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    padding: 14,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: 1100,
    letterSpacing: 1.2,
    color: T.muted,
    textTransform: "uppercase",
    marginBottom: 10,
  },

  kvRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 0",
    borderBottom: `1px solid rgba(15,23,42,0.06)`,
  },
  kvKey: { fontWeight: 950, color: T.text },
  kvVal: {
    fontWeight: 900,
    color: T.muted,
    textAlign: "right",
    maxWidth: "60%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  label: { fontSize: 12, fontWeight: 950, color: T.muted2, marginBottom: 6 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 },

  input: {
    width: "100%",
    padding: 12,
    borderRadius: 18,
    border: `1px solid ${T.line}`,
    outline: "none",
    background: "rgba(255,255,255,0.80)",
    color: T.text,
    fontWeight: 950,
    boxShadow: `0 10px 22px ${T.shadow}`,
  },

  select: {
    padding: "10px 12px",
    borderRadius: 18,
    border: `1px solid ${T.line}`,
    outline: "none",
    background: "rgba(255,255,255,0.80)",
    color: T.text,
    fontWeight: 950,
    boxShadow: `0 10px 22px ${T.shadow}`,
  },

  note: { marginTop: 10, fontSize: 12, color: T.muted, fontWeight: 800 },

  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(11,18,32,0.20)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    display: "grid",
    placeItems: "end center",
    padding: 14,
    zIndex: 1000,
  },
  sheet: {
    width: "min(720px, 100%)",
    borderRadius: 22,
    background: "rgba(255,255,255,0.92)",
    border: `1px solid ${T.line}`,
    boxShadow: "0 30px 90px rgba(15,23,42,0.18)",
    padding: 14,
  },
  sheetHandle: {
    width: 56,
    height: 5,
    borderRadius: 999,
    background: "rgba(15,23,42,0.16)",
    margin: "0 auto 10px",
  },
  sheetTitle: {
    fontSize: 12,
    fontWeight: 1100,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: T.text,
  },

  form: { marginTop: 12, display: "grid", gap: 10 },
  row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },

  msg: {
    padding: "10px 12px",
    borderRadius: 18,
    background: "rgba(212,0,0,0.10)",
    border: "1px solid rgba(212,0,0,0.18)",
    color: T.text,
    fontSize: 13,
    fontWeight: 900,
  },

  sheetActions: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 },
};
