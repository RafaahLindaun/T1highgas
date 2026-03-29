import { useState, useEffect } from "react";
import { useEco } from "../context/EcoContext";

export default function CarBase() {
  const { vehicle, setVehicle } = useEco();

  const [model, setModel] = useState("");
  const [fuel, setFuel] = useState("Gasolina");
  const [consumption, setConsumption] = useState("");
  const [fuelPrice, setFuelPrice] = useState("");

  useEffect(() => {
    if (!vehicle) return;
    setModel(vehicle.model || "");
    setFuel(vehicle.fuel || "Gasolina");
    setConsumption(vehicle.consumption || "");
    setFuelPrice(vehicle.fuelPrice || "");
  }, [vehicle]);

  function save() {
    setVehicle({ model, fuel, consumption, fuelPrice });
    alert("Carro salvo (IA já consegue ler).");
  }

  return (
    <div className="container page">
      <h1>CarBase</h1>
      <p>Dados do veículo para cálculo de custo.</p>

      <div className="card" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <label style={lbl}>Modelo</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} style={inp} placeholder="Ex: Onix 1.0" />

        <label style={lbl}>Combustível</label>
        <select value={fuel} onChange={(e) => setFuel(e.target.value)} style={inp}>
          <option>Gasolina</option>
          <option>Etanol</option>
          <option>Diesel</option>
          <option>Elétrico</option>
        </select>

        <label style={lbl}>Consumo (km/L ou km/kWh)</label>
        <input value={consumption} onChange={(e) => setConsumption(e.target.value)} style={inp} placeholder="Ex: 12.5" />

        <label style={lbl}>Preço (R$/L ou R$/kWh)</label>
        <input value={fuelPrice} onChange={(e) => setFuelPrice(e.target.value)} style={inp} placeholder="Ex: 5.79" />

        <button onClick={save} style={btn}>Salvar</button>

        <button onClick={() => setVehicle(null)} style={{ ...btn, background: "#0f172a", marginTop: 10 }}>
          Limpar
        </button>
      </div>
    </div>
  );
}

const lbl = { fontSize: 12, fontWeight: 800, color: "#64748b" };
const inp = { width: "100%", padding: 12, borderRadius: 12, border: "1px solid #e5e7eb", margin: "6px 0 14px" };
const btn = { padding: 12, borderRadius: 12, border: "none", background: "#d97706", color: "#fff", fontWeight: 900, cursor: "pointer" };
