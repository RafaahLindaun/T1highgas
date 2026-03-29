import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const ORANGE = "#FF6A00";
const ORANGE_SOFT = "rgba(255,106,0,.12)";
const TEXT = "#0f172a";
const MUTED = "#64748b";

export default function Login() {
  const { signup, loginWithEmail } = useAuth();
  const nav = useNavigate();

  const [mode, setMode] = useState("signup"); // "signup" | "login"
  const isSignup = useMemo(() => mode === "signup", [mode]);

  const [form, setForm] = useState({
    nome: "",
    email: "",
    senha: "",
    altura: "",
    peso: "",
  });

  const [erro, setErro] = useState("");

  function onChange(e) {
    const { name, value } = e.target;

    // 🔒 força apenas números para altura e peso
    if (name === "altura" || name === "peso") {
      if (!/^\d*$/.test(value)) return;
    }

    setForm((p) => ({ ...p, [name]: value }));
  }

  function submit() {
    setErro("");

    if (isSignup) {
      const res = signup(form);
      if (!res.ok) return setErro(res.msg);
      return nav("/conta");
    } else {
      const res = loginWithEmail(form.email, form.senha);
      if (!res.ok) return setErro(res.msg);
      return nav("/dashboard");
    }
  }

  return (
    <div className="container page" style={styles.page}>
      {/* LOGO (public/symbol.png) */}
      <div style={styles.logoWrap}>
        <div style={styles.logoImgWrap}>
          <img src="/symbol.png" alt="FitDeal" style={styles.logoImg} />
        </div>
        <div style={styles.brand}>
          <span style={styles.brandName}>fitdeal</span>
          <span style={styles.dot}>.</span>
        </div>
      </div>

      <h1 style={styles.title}>{isSignup ? "Criar conta" : "Entrar"}</h1>
      <p style={styles.subtitle}>
        {isSignup ? "Crie sua conta para começar seu plano" : "Entre com seu email e senha"}
      </p>

      {/* SWITCH */}
      <div style={styles.switchRow}>
        <button
          type="button"
          onClick={() => setMode("signup")}
          style={{ ...styles.switchBtn, ...(isSignup ? styles.switchActive : {}) }}
        >
          Sign up
        </button>
        <button
          type="button"
          onClick={() => setMode("login")}
          style={{ ...styles.switchBtn, ...(!isSignup ? styles.switchActive : {}) }}
        >
          Log in
        </button>
      </div>

      {/* FORM */}
      {isSignup && (
        <>
          <input
            name="nome"
            value={form.nome}
            onChange={onChange}
            placeholder="Nome"
            style={styles.input}
            autoComplete="name"
          />

          <div style={styles.row}>
            <input
              name="altura"
              value={form.altura}
              onChange={onChange}
              placeholder="Altura (cm)"
              style={styles.input}
              inputMode="numeric"
              autoComplete="off"
            />
            <input
              name="peso"
              value={form.peso}
              onChange={onChange}
              placeholder="Peso (kg)"
              style={styles.input}
              inputMode="numeric"
              autoComplete="off"
            />
          </div>
        </>
      )}

      <input
        name="email"
        value={form.email}
        onChange={onChange}
        placeholder="Email"
        style={styles.input}
        autoComplete="email"
      />
      <input
        name="senha"
        value={form.senha}
        onChange={onChange}
        placeholder="Senha"
        type="password"
        style={styles.input}
        autoComplete={isSignup ? "new-password" : "current-password"}
      />

      {erro ? <div style={styles.error}>{erro}</div> : null}

      {/* CTA */}
      <button type="button" onClick={submit} style={styles.cta}>
        {isSignup ? "Criar conta" : "Entrar"}
      </button>

      {/* micro texto opcional */}
      <div style={styles.hint}>
        Ao continuar, você concorda com uma grande mudança no seu dia a dia.
      </div>
    </div>
  );
}

/* ---------- STYLES ---------- */
const styles = {
  page: {
    paddingTop: 34,
    paddingBottom: 40,
  },

  /* LOGO */
  logoWrap: {
    display: "grid",
    placeItems: "center",
    marginBottom: 18,
  },
  logoImgWrap: {
    width: 74,
    height: 74,
    borderRadius: 22,
    background: ORANGE_SOFT,
    border: "1px solid rgba(255,106,0,.22)",
    display: "grid",
    placeItems: "center",
    boxShadow: "0 18px 50px rgba(15,23,42,.08)",
  },
  logoImg: {
    width: 46,
    height: 46,
    objectFit: "contain",
    display: "block",
  },
  brand: {
    marginTop: 10,
    display: "flex",
    alignItems: "baseline",
    gap: 2,
  },
  brandName: {
    fontSize: 22,
    fontWeight: 950,
    color: TEXT,
    letterSpacing: -0.6,
  },
  dot: {
    fontSize: 22,
    fontWeight: 950,
    color: ORANGE,
  },

  title: {
    fontSize: 26,
    fontWeight: 950,
    color: TEXT,
    textAlign: "center",
    letterSpacing: -0.6,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    color: MUTED,
    textAlign: "center",
    fontWeight: 700,
  },

  switchRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
    marginTop: 18,
    marginBottom: 12,
  },
  switchBtn: {
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,.10)",
    background: "#fff",
    fontWeight: 950,
    color: MUTED,
  },
  switchActive: {
    border: `1px solid rgba(255,106,0,.40)`,
    background: ORANGE_SOFT,
    color: ORANGE,
  },

  input: {
    width: "100%",
    padding: 14,
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,.10)",
    marginTop: 12,
    fontSize: 14,
    outline: "none",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },

  cta: {
    width: "100%",
    padding: 16,
    marginTop: 18,
    borderRadius: 18,
    border: "none",
    background: "linear-gradient(135deg, #FF6A00, #FF8A3D)",
    color: "#111",
    fontWeight: 950,
    fontSize: 15,
    boxShadow: "0 16px 40px rgba(255,106,0,.28)",
  },

  hint: {
    marginTop: 12,
    fontSize: 12,
    color: MUTED,
    textAlign: "center",
    fontWeight: 700,
    opacity: 0.9,
    lineHeight: 1.35,
  },

  error: {
    marginTop: 12,
    padding: "10px 12px",
    borderRadius: 12,
    background: "#fef2f2",
    color: "#991b1b",
    border: "1px solid #fecaca",
    fontSize: 13,
    fontWeight: 800,
  },
};
