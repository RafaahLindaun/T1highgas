import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type Fuel = "Gasolina" | "Etanol" | "Diesel" | "Elétrico";

export type Vehicle = {
  model: string;
  fuel: Fuel;
  consumption: string; // km/L ou km/kWh (string pra evitar NaN em input)
  fuelPrice: string;   // R$/L ou R$/kWh (opcional, mas ajuda a IA)
};

export type Destination = {
  lat: number;
  lon: number;
  label: string;
};

export type RouteInfo = {
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  distanceM: number;
  durationS: number;
  label?: string;
  createdAt: string;
};

type EcoState = {
  vehicle: Vehicle | null;
  destination: Destination | null;
  route: RouteInfo | null;
  history: RouteInfo[];

  setVehicle: (v: Vehicle | null) => void;
  setDestination: (d: Destination | null) => void;
  setRoute: (r: RouteInfo | null) => void;
  addHistory: (r: RouteInfo) => void;
  clearHistory: () => void;
};

const STORAGE_KEY = "@EcoRoute:EcoState:v1";

const EcoContext = createContext<EcoState | null>(null);

export function EcoProvider({ children }: { children: React.ReactNode }) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [history, setHistory] = useState<RouteInfo[]>([]);

  // load
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setVehicle(parsed.vehicle ?? null);
      setDestination(parsed.destination ?? null);
      setRoute(parsed.route ?? null);
      setHistory(Array.isArray(parsed.history) ? parsed.history : []);
    } catch {}
  }, []);

  // persist
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ vehicle, destination, route, history })
      );
    } catch {}
  }, [vehicle, destination, route, history]);

  const value = useMemo<EcoState>(() => {
    return {
      vehicle,
      destination,
      route,
      history,
      setVehicle,
      setDestination,
      setRoute,
      addHistory: (r) => setHistory((h) => [r, ...h].slice(0, 100)),
      clearHistory: () => setHistory([]),
    };
  }, [vehicle, destination, route, history]);

  return <EcoContext.Provider value={value}>{children}</EcoContext.Provider>;
}

export function useEco() {
  const ctx = useContext(EcoContext);
  if (!ctx) throw new Error("useEco() precisa estar dentro de <EcoProvider>.");
  return ctx;
}
