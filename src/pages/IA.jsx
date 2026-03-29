import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useEco } from "../context/EcoContext";

const carDatabase = {
  brands: [
    { id: "vw", name: "VOLKSWAGEN", logo: "/marcas/vw.svg" },
    { id: "toyota", name: "TOYOTA", logo: "/marcas/toyota.svg" },
    { id: "fiat", name: "FIAT", logo: "/marcas/fiat.svg" },
    { id: "chevy", name: "CHEVROLET", logo: "/marcas/chevy.svg" },
  ],
  models: {
    vw: [
      { id: "gol", name: "GOL", img: "/carros/gol.png", engines: ["1.0 MPI", "1.6 MSI"] },
      { id: "polo", name: "POLO", img: "/carros/polo.png", engines: ["1.0 TSI", "1.4 GTS TSI"] },
    ],
    toyota: [{ id: "corolla", name: "COROLLA", img: "/carros/corolla.png", engines: ["2.0 Dynamic Force", "1.8 Hybrid"] }],
    fiat: [],
    chevy: [],
  },
};

function n(v) {
  const x = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(x) ? x : null;
}

export default function IA_Command() {
  const navigate = useNavigate();
  const { vehicle: activeVehicle, tank, setTank, setVehicle } = useEco();

  const [step, setStep] = useState("BRAND");
  const [pick, setPick] = useState({ brand: null, model: null, engine: null, modification: null });

  const [fuel, setFuel] = useState("Gasolina");
  const [consumption, setConsumption] = useState(activeVehicle?.consumption || "");
  const [fuelPrice, setFuelPrice] = useState(activeVehicle?.fuelPrice || "");
  const [capacityL, setCapacityL] = useState(String(tank?.capacityL ?? 50));
  const [levelL, setLevelL] = useState(String(tank?.levelL ?? 50));

  const headerText = useMemo(() => {
    if (step === "BRAND") return "QUAL A MARCA?";
    if (step === "MODEL") return "QUAL O MODELO?";
    if (step === "ENGINE") return "QUAL O MOTOR?";
    if (step === "MODIFICATION") return "TEM MODIFICAÇÃO?";
    if (step === "STATS") return "DADOS PRA ECONOMIA";
    return "";
  }, [step]);

  const goBack = () => {
    if (step === "MODEL") setStep("BRAND");
    else if (step === "ENGINE") setStep("MODEL");
    else if (step === "MODIFICATION") setStep("ENGINE");
    else if (step === "STATS") setStep("MODIFICATION");
    else navigate(-1);
  };

  function finishSave() {
    const brand = pick.brand?.name || "";
    const model = pick.model?.name || "";
    const engine = pick.engine || "";
    const mod = pick.modification ? ` • ${pick.modification}` : "";

    const cap = n(capacityL) ?? 50;
    const lvl = n(levelL) ?? cap;

    setTank({ capacityL: cap, levelL: lvl });

    // se o usuário não escolheu modelo/engine (pq a base é incompleta), ainda salva “manual”
    const composedModel =
      brand && model && engine ? `${brand} ${model} (${engine})${mod}`.trim() : (activeVehicle?.model || "Carro (manual)");

    setVehicle({
      model: composedModel,
      fuel,
      consumption: String(consumption ?? ""),
      fuelPrice: String(fuelPrice ?? ""),
    });

    navigate("/mapa");
  }

  const canFinish = useMemo(() => {
    // deixa salvar mesmo sem consumo/preço (você ajusta depois), mas evita NaN
    const cap = n(capacityL);
    const lvl = n(levelL);
    if (cap != null && cap <= 0) return false;
    if (lvl != null && lvl < 0) return false;
    return true;
  }, [capacityL, levelL]);

  return (
    <div style={styles.container}>
      <motion.button onClick={goBack} whileTap={{ scale: 0.9 }} style={styles.backBtn}>
        ‹
      </motion.button>

      <header style={styles.header}>
        <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 3 }} style={styles.iaWave} />
        <h1 style={styles.title}>ECO.IA</h1>
        <p style={styles.subtitle}>{headerText}</p>

        <div style={styles.statusPill}>
          <span style={{ opacity: 0.85 }}>Ativo:</span>{" "}
          <b>{activeVehicle?.model ? activeVehicle.model : "sem carro"}</b>
        </div>
      </header>

      <div style={styles.content}>
        <AnimatePresence mode="wait">
          {step === "BRAND" && (
            <motion.div key="b" style={styles.grid} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {carDatabase.brands.map((b) => (
                <button
                  key={b.id}
                  onClick={() => {
                    setPick((p) => ({ ...p, brand: b, model: null, engine: null }));
                    setStep("MODEL");
                  }}
                  style={styles.card}
                >
                  <div style={styles.logoCircle}>
                    <img src={b.logo} style={styles.logoImg} onError={(e) => (e.currentTarget.style.display = "none")} />
                  </div>
                  <span style={styles.boldLabel}>{b.name}</span>
                </button>
              ))}
            </motion.div>
          )}

          {step === "MODEL" && (
            <motion.div key="m" style={styles.list} initial={{ x: 50, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
              {(carDatabase.models[pick.brand?.id] || []).map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setPick((p) => ({ ...p, model: m, engine: null }));
                    setStep("ENGINE");
                  }}
                  style={styles.modelCard}
                >
                  <div style={styles.carImgWrap}>
                    <img src={m.img} style={styles.carImg} onError={(e) => (e.currentTarget.style.display = "none")} />
                  </div>
                  <span style={styles.boldLabel}>{m.name}</span>
                </button>
              ))}

              {(carDatabase.models[pick.brand?.id] || []).length === 0 && (
                <div style={styles.helper}>
                  Base ainda sem modelos pra essa marca (v1). Selecione outra marca ou volte e conclua pelo CarBase manual.
                </div>
              )}
            </motion.div>
          )}

          {step === "ENGINE" && (
            <motion.div key="e" style={styles.list} initial={{ x: 50, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
              {(pick.model?.engines || []).map((eng) => (
                <button
                  key={eng}
                  onClick={() => {
                    setPick((p) => ({ ...p, engine: eng }));
                    setStep("MODIFICATION");
                  }}
                  style={styles.engineBtn}
                >
                  {eng}
                </button>
              ))}
              {(pick.model?.engines || []).length === 0 && (
                <div style={styles.helper}>Sem motores cadastrados (v1). Você pode finalizar pelo CarBase manual.</div>
              )}
            </motion.div>
          )}

          {step === "MODIFICATION" && (
            <motion.div key="x" style={styles.list} initial={{ x: 50, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
              {["Original", "Leve", "Pesada"].map((mod) => (
                <button
                  key={mod}
                  onClick={() => {
                    setPick((p) => ({ ...p, modification: mod }));
                    setStep("STATS");
                  }}
                  style={styles.engineBtn}
                >
                  {mod}
                </button>
              ))}
            </motion.div>
          )}

          {step === "STATS" && (
            <motion.div key="s" style={styles.statsWrap} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div style={styles.row}>
                <label style={styles.lbl}>Combustível</label>
                <select value={fuel} onChange={(e) => setFuel(e.target.value)} style={styles.input}>
                  <option>Gasolina</option>
                  <option>Etanol</option>
                  <option>Diesel</option>
                  <option>Elétrico</option>
                </select>
              </div>

              <div style={styles.row2}>
                <div style={{ flex: 1 }}>
                  <label style={styles.lbl}>Consumo (km/L)</label>
                  <input
                    value={consumption}
                    onChange={(e) => setConsumption(e.target.value)}
                    style={styles.input}
                    placeholder="Ex: 12,5"
                    inputMode="decimal"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={styles.lbl}>Preço (R$/L)</label>
                  <input
                    value={fuelPrice}
                    onChange={(e) => setFuelPrice(e.target.value)}
                    style={styles.input}
                    placeholder="Ex: 5,79"
                    inputMode="decimal"
                  />
                </div>
              </div>

              <div style={styles.row2}>
                <div style={{ flex: 1 }}>
                  <label style={styles.lbl}>Tanque (L)</label>
                  <input value={capacityL} onChange={(e) => setCapacityL(e.target.value)} style={styles.input} placeholder="Ex: 50" inputMode="decimal" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={styles.lbl}>Nível atual (L)</label>
                  <input value={levelL} onChange={(e) => setLevelL(e.target.value)} style={styles.input} placeholder="Ex: 35" inputMode="decimal" />
                </div>
              </div>

              <button onClick={finishSave} style={{ ...styles.saveBtn, opacity: canFinish ? 1 : 0.5 }} disabled={!canFinish}>
                Salvar e ir pro mapa
              </button>

              <div style={styles.helper}>
                * Pode salvar sem consumo/preço agora (ajusta depois em <b>CarBase</b>). Sem esses dados, o mapa ainda traça rotas, mas não calcula R$.
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const ORANGE = "#FF6A00";
const BG = "#0b0f17";
const CARD = "rgba(255,255,255,0.06)";
const BORDER = "rgba(255,255,255,0.10)";

const styles = {
  container: { minHeight: "100vh", background: BG, color: "#fff", paddingBottom: 110 },
  backBtn: {
    position: "fixed",
    top: 12,
    left: 12,
    width: 44,
    height: 44,
    borderRadius: 14,
    border: `1px solid ${BORDER}`,
    background: "rgba(0,0,0,0.35)",
    color: "#fff",
    fontSize: 26,
    cursor: "pointer",
    zIndex: 10,
  },

  header: { padding: "26px 18px 10px", textAlign: "center" },
  iaWave: { width: 56, height: 56, borderRadius: 20, margin: "0 auto 10px", background: `linear-gradient(135deg, ${ORANGE}, rgba(255,106,0,.35))` },
  title: { margin: 0, fontSize: 28, letterSpacing: -0.5 },
  subtitle: { margin: "8px 0 10px", opacity: 0.75, fontWeight: 900 },

  statusPill: {
    display: "inline-flex",
    gap: 8,
    alignItems: "center",
    padding: "8px 12px",
    borderRadius: 999,
    border: `1px solid ${BORDER}`,
    background: "rgba(255,255,255,0.05)",
    fontSize: 12,
  },

  content: { padding: 16 },

  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  card: {
    background: CARD,
    border: `1px solid ${BORDER}`,
    borderRadius: 18,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    alignItems: "center",
    cursor: "pointer",
  },
  logoCircle: { width: 54, height: 54, borderRadius: 18, background: "rgba(255,255,255,0.08)", display: "grid", placeItems: "center" },
  logoImg: { width: 34, height: 34, objectFit: "contain" },
  boldLabel: { fontWeight: 950, letterSpacing: 0.4 },

  list: { display: "flex", flexDirection: "column", gap: 12 },
  modelCard: {
    background: CARD,
    border: `1px solid ${BORDER}`,
    borderRadius: 18,
    padding: 14,
    display: "flex",
    gap: 12,
    alignItems: "center",
    cursor: "pointer",
  },
  carImgWrap: { width: 64, height: 44, borderRadius: 14, overflow: "hidden", background: "rgba(255,255,255,0.06)" },
  carImg: { width: "100%", height: "100%", objectFit: "cover" },

  engineBtn: {
    background: "rgba(255,255,255,0.08)",
    border: `1px solid ${BORDER}`,
    borderRadius: 18,
    padding: 14,
    cursor: "pointer",
    color: "#fff",
    fontWeight: 950,
  },

  statsWrap: { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14, display: "grid", gap: 12 },
  row: { display: "grid", gap: 6 },
  row2: { display: "flex", gap: 12 },
  lbl: { fontSize: 12, fontWeight: 900, opacity: 0.8 },
  input: {
    width: "100%",
    padding: 12,
    borderRadius: 14,
    border: `1px solid ${BORDER}`,
    background: "rgba(0,0,0,0.35)",
    color: "#fff",
    outline: "none",
  },

  saveBtn: {
    marginTop: 4,
    padding: 14,
    borderRadius: 18,
    border: "none",
    background: ORANGE,
    color: "#111",
    fontWeight: 1000,
    cursor: "pointer",
  },

  helper: { fontSize: 12, opacity: 0.75, marginTop: 6, lineHeight: 1.35 },
};
