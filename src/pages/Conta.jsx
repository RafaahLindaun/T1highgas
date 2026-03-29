import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";

const C = {
  bg: "#F2F2F7",
  surface: "#FFFFFF",
  line: "rgba(60,60,67,0.18)",
  text: "#111111",
  sub: "rgba(60,60,67,0.72)",
  sub2: "rgba(60,60,67,0.55)",
  accent: "#007AFF",
  shadow: "rgba(0,0,0,0.08)",
};

export default function Login() {
  const { signup, loginWithEmail } = useAuth();
  const nav = useNavigate();

  const [mode, setMode] = useState("signup");
  const isSignup = useMemo(() => mode === "signup", [mode]);

  const [form, setForm] = useState({
    nome: "",
    email: "",
    senha: "",
  });

  const [erro, setErro] = useState("");

  function onChange(e) {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
  }

  function submit(e) {
    e?.preventDefault?.();
    setErro("");

    if (isSignup) {
      const res = signup(form);
      if (!res.ok) return setErro(res.msg);
      return nav("/mapa");
    }

    const res = loginWithEmail(form.email, form.senha);
    if (!res.ok) return setErro(res.msg);
    return nav("/mapa");
  }

  return (
    <div style={S.page}>
      <div style={S.bgBlobs} aria-hidden="true">
        <motion.div
          style={S.blobA}
          animate={{ x: [0, 12, 0], y: [0, -8, 0] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          style={S.blobB}
          animate={{ x: [0, -14, 0], y: [0, 10, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
        style={S.shell}
      >
        <div style={S.brandCard}>
          <div style={S.mark}>ER</div>

          <div>
            <div style={S.brandTop}>EcoRoute</div>
            <div style={S.brandSub}>
              Conta simples, rápida e direta para entrar no app.
            </div>
          </div>
        </div>

        <div style={S.switchWrap}>
          <button
            type="button"
            onClick={() => setMode("signup")}
            style={{
              ...S.switchBtn,
              ...(isSignup ? S.switchBtnActive : null),
            }}
          >
            Criar conta
          </button>

          <button
            type="button"
            onClick={() => setMode("login")}
            style={{
              ...S.switchBtn,
              ...(!isSignup ? S.switchBtnActive : null),
            }}
          >
            Entrar
          </button>
        </div>

        <form onSubmit={submit} style={S.formCard}>
          <div style={S.title}>{isSignup ? "Criar conta" : "Entrar"}</div>
          <div style={S.subtitle}>
            {isSignup
              ? "Use nome, email e senha para começar."
              : "Entre com o email e a senha da sua conta."}
          </div>

          {isSignup ? (
            <input
              style={S.input}
              name="nome"
              placeholder="Nome"
              value={form.nome}
              onChange={onChange}
            />
          ) : null}

          <input
            style={S.input}
            name="email"
            placeholder="Email"
            value={form.email}
            onChange={onChange}
            autoCapitalize="none"
          />

          <input
            style={S.input}
            name="senha"
            placeholder="Senha"
            type="password"
            value={form.senha}
            onChange={onChange}
          />

          {erro ? <div style={S.error}>{erro}</div> : null}

          <motion.button
            type="submit"
            whileTap={{ scale: 0.985 }}
            style={S.cta}
          >
            {isSignup ? "Continuar" : "Acessar"}
          </motion.button>

          <div style={S.hint}>
            Depois você configura carro, consumo, tanque e preferências dentro do app.
          </div>
        </form>
      </motion.div>
    </div>
  );
}

const S = {
  page: {
    minHeight: "100vh",
    background: C.bg,
    padding: 16,
    display: "grid",
    placeItems: "center",
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
    top: -110,
    background: "radial-gradient(circle at 30% 30%, rgba(0,122,255,0.20), rgba(0,122,255,0.02))",
  },
  blobB: {
    position: "absolute",
    width: 380,
    height: 380,
    borderRadius: 999,
    right: -150,
    bottom: -180,
    background: "radial-gradient(circle at 30% 30%, rgba(88,86,214,0.14), rgba(88,86,214,0.02))",
  },

  shell: {
    width: "min(460px, 100%)",
    position: "relative",
    zIndex: 1,
  },

  brandCard: {
    background: C.surface,
    border: `1px solid ${C.line}`,
    borderRadius: 22,
    boxShadow: `0 24px 60px ${C.shadow}`,
    padding: 16,
    display: "grid",
    gridTemplateColumns: "64px 1fr",
    gap: 14,
    alignItems: "center",
  },
  mark: {
    width: 64,
    height: 64,
    borderRadius: 18,
    background: "linear-gradient(180deg, rgba(0,122,255,0.16), rgba(0,122,255,0.06))",
    border: "1px solid rgba(0,122,255,0.16)",
    display: "grid",
    placeItems: "center",
    color: C.accent,
    fontWeight: 1000,
    fontSize: 20,
    letterSpacing: -0.6,
  },
  brandTop: {
    fontSize: 24,
    fontWeight: 1000,
    color: C.text,
    letterSpacing: -0.8,
    lineHeight: 1,
  },
  brandSub: {
    marginTop: 6,
    fontSize: 13,
    color: C.sub,
    fontWeight: 650,
    lineHeight: 1.4,
  },

  switchWrap: {
    marginTop: 14,
    padding: 4,
    borderRadius: 18,
    background: "rgba(60,60,67,0.10)",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 4,
  },
  switchBtn: {
    padding: 12,
    borderRadius: 14,
    border: "none",
    background: "transparent",
    color: C.sub,
    fontWeight: 900,
    cursor: "pointer",
  },
  switchBtnActive: {
    background: C.surface,
    color: C.text,
    boxShadow: `0 10px 24px ${C.shadow}`,
  },

  formCard: {
    marginTop: 14,
    background: "rgba(255,255,255,0.90)",
    border: `1px solid ${C.line}`,
    borderRadius: 22,
    boxShadow: `0 30px 90px ${C.shadow}`,
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    padding: 18,
  },

  title: {
    fontSize: 24,
    fontWeight: 1000,
    color: C.text,
    letterSpacing: -0.8,
    lineHeight: 1,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 13,
    color: C.sub,
    fontWeight: 650,
    lineHeight: 1.45,
  },

  input: {
    width: "100%",
    padding: 14,
    marginTop: 12,
    borderRadius: 16,
    border: `1px solid ${C.line}`,
    background: "#FFFFFF",
    color: C.text,
    outline: "none",
    fontSize: 14,
    fontWeight: 750,
  },

  error: {
    marginTop: 12,
    padding: "12px 14px",
    borderRadius: 16,
    background: "rgba(255,59,48,0.10)",
    border: "1px solid rgba(255,59,48,0.18)",
    color: C.text,
    fontSize: 13,
    fontWeight: 800,
  },

  cta: {
    width: "100%",
    padding: 16,
    marginTop: 16,
    borderRadius: 18,
    border: "none",
    background: C.accent,
    color: "#FFFFFF",
    fontWeight: 1000,
    fontSize: 15,
    boxShadow: "0 18px 44px rgba(0,122,255,0.22)",
    cursor: "pointer",
  },

  hint: {
    marginTop: 12,
    fontSize: 12,
    color: C.sub,
    textAlign: "center",
    fontWeight: 700,
    lineHeight: 1.4,
  },
};
