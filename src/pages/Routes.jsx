import React from "react";
import { useEco } from "../context/EcoContext";

export default function RoutesHistory() {
  const { history, clearHistory } = useEco();

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <h2 style={styles.title}>Histórico Eco</h2>
        <button onClick={clearHistory} style={styles.clearBtn}>
          Limpar
        </button>
      </div>

      <p style={styles.sub}>
        Aqui aparecem as rotas que você salvou (SAVE) ou finalizou (STOP).
      </p>

      {history.length === 0 ? (
        <div style={styles.empty}>Sem rotas ainda.</div>
      ) : (
        history.map((r, idx) => (
          <div key={idx} style={styles.item}>
            <div style={styles.dot} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.name}>{r.label || "Rota"}</div>

              <div style={styles.meta}>
                {(r.distanceM / 1000).toFixed(1)} km • {Math.round(r.durationS / 60)} min
                {r.mode ? ` • ${String(r.mode).toUpperCase()}` : ""}
                {Number.isFinite(r.ascentM) ? ` • +${Math.round(r.ascentM)}m` : ""}
              </div>

              <div style={styles.date}>
                {r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
              </div>
            </div>

            <div style={styles.right}>
              <div style={styles.liters}>
                {r.litersEst != null ? `${r.litersEst.toFixed(2)} L` : "--"}
              </div>
              <div style={styles.cost}>
                {r.costEst != null ? `R$ ${r.costEst.toFixed(2)}` : ""}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

const styles = {
  container: {
    padding: 20,
    paddingBottom: 120,
    background: "#f8fafc",
    minHeight: "100vh",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  title: { color: "#0f172a", margin: 0 },
  sub: { color: "#64748b", fontSize: 13, marginTop: 8, marginBottom: 12 },
  clearBtn: {
    padding: "10px 12px",
    borderRadius: 14,
    border: "none",
    background: "#0f172a",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
  },
  empty: {
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
    background: "#fff",
    border: "1px solid rgba(15,23,42,0.08)",
    color: "#64748b",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: "white",
    padding: 14,
    borderRadius: 18,
    marginTop: 10,
    boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
  },
  dot: { width: 10, height: 10, borderRadius: "50%", background: "#FF6A00", flex: "0 0 auto" },
  name: {
    fontWeight: 1000,
    color: "#0f172a",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  meta: { fontSize: 12, color: "#64748b", marginTop: 2 },
  date: { fontSize: 11, color: "#94a3b8", marginTop: 4 },

  right: { textAlign: "right", flex: "0 0 auto" },
  liters: { fontSize: 12, fontWeight: 1000, color: "#16a34a" },
  cost: { fontSize: 12, fontWeight: 900, color: "#0f172a", opacity: 0.8, marginTop: 2 },
};
