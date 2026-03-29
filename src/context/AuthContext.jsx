import { createContext, useContext, useEffect, useMemo, useState } from "react";

const AuthContext = createContext(null);

const USERS_KEY = "fitdeal_users_v1";
const SESSION_KEY = "fitdeal_session_v1";

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const sessionEmail = localStorage.getItem(SESSION_KEY);
    if (!sessionEmail) return;

    const users = readJSON(USERS_KEY, {});
    const found = users[sessionEmail.toLowerCase()];
    if (found) setUser(found);
  }, []);

  function signup(form) {
    const nome = String(form?.nome || "").trim();
    const email = normalizeEmail(form?.email);
    const senha = String(form?.senha || "").trim();

    if (!nome) return { ok: false, msg: "Nome é obrigatório." };
    if (!email || !email.includes("@")) return { ok: false, msg: "Email inválido." };
    if (!senha || senha.length < 4) return { ok: false, msg: "Senha muito curta." };

    const users = readJSON(USERS_KEY, {});
    if (users[email]) return { ok: false, msg: "Esse email já tem conta." };

    const newUser = {
      id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()),
      nome,
      email,
      senha,
      photoUrl: "",
      plano: "basic",
      createdAt: Date.now(),
      ecoState: null,
    };

    users[email] = newUser;
    writeJSON(USERS_KEY, users);
    localStorage.setItem(SESSION_KEY, email);
    setUser(newUser);

    return { ok: true };
  }

  function loginWithEmail(emailInput, senhaInput) {
    const email = normalizeEmail(emailInput);
    const senha = String(senhaInput || "").trim();

    const users = readJSON(USERS_KEY, {});
    const found = users[email];

    if (!found) return { ok: false, msg: "Conta não encontrada." };
    if (found.senha !== senha) return { ok: false, msg: "Senha incorreta." };

    localStorage.setItem(SESSION_KEY, email);
    setUser(found);
    return { ok: true };
  }

  function updateUser(patch) {
    setUser((prev) => {
      if (!prev) return prev;

      const users = readJSON(USERS_KEY, {});
      const prevEmail = normalizeEmail(prev.email);

      const next = { ...prev, ...patch };
      const nextEmail = normalizeEmail(next.email);

      if (nextEmail !== prevEmail) {
        delete users[prevEmail];
      }

      users[nextEmail] = next;
      writeJSON(USERS_KEY, users);
      localStorage.setItem(SESSION_KEY, nextEmail);

      return next;
    });
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
  }

  const value = useMemo(
    () => ({
      user,
      signup,
      loginWithEmail,
      updateUser,
      logout,
    }),
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
