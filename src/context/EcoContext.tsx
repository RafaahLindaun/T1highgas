import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthContext";

type Fuel = "Gasolina" | "Etanol" | "Diesel" | "Elétrico";
export type RouteMode = "eco" | "fast" | "balanced";

export type Vehicle = {
  model: string;
  fuel: Fuel;
  consumption: string; // km/L (ou km/kWh)
  fuelPrice: string;   // R$/L (ou R$/kWh)
};

export type Tank = {
  capacityL: number;
  levelL: number;
  updatedAt: string;
};

export type Location = {
  lat: number;
  lon: number;
  accuracy?: number;
  updatedAt: string;
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

  mode?: RouteMode;
  ascentM?: number;

  litersEst?: number;
  costEst?: number;

  label?: string;
  createdAt: string;
};

export type RouteOption = RouteInfo & {
  id: string;
  score?: number;
};

export type POI = {
  id: string;
  lat: number;
  lon: number;
  label: string;
  kind: "fuel";
};

type PersistedEcoState = {
  vehicle: Vehicle | null;
  tank: Tank;
  routeMode: RouteMode;

  location: Location | null;

  destination: Destination | null;
  route: RouteInfo | null;
  routeOptions: RouteOption[];

  pois: POI[];

  history: RouteInfo[];
};

type EcoState = PersistedEcoState & {
  setVehicle: (v: Vehicle | null) => void;

  setTank: (t: Partial<Tank>) => void;
  consumeLiters: (liters: number) => void;
  refuelLiters: (liters: number) => void;

  setRouteMode: (m: RouteMode) => void;

  setLocation: (loc: Location | null) => void;

  setDestination: (d: Destination | null) => void;

  setRoute: (r: RouteInfo | null) => void;
  setRouteOptions: (opts: RouteOption[]) => void;

  setPois: (pois: POI[]) => void;

  addHistory: (r: RouteInfo) => void;
  clearHistory: () => void;
};

const EcoContext = createContext<EcoState | null>(null);

function num(v: unknown) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

function storageKey(email?: string) {
  const safe = String(email || "anon").toLowerCase();
  return `@EcoRoute:EcoState:${safe}:v2`;
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function EcoProvider({ children }: { children: React.ReactNode }) {
  // AuthContext é .jsx, então tipamos como any pra não travar TS.
  const { user, updateUser } = useAuth() as any;

  const key = storageKey(user?.email);

  const DEFAULT: PersistedEcoState = {
    vehicle: null,
    tank: { capacityL: 50, levelL: 50, updatedAt: new Date().toISOString() },
    routeMode: "eco",

    location: null,

    destination: null,
    route: null,
    routeOptions: [],

    pois: [],

    history: [],
  };

  const [vehicle, setVehicle] = useState<Vehicle | null>(DEFAULT.vehicle);
  const [tank, _setTank] = useState<Tank>(DEFAULT.tank);
  const [routeMode, setRouteMode] = useState<RouteMode>(DEFAULT.routeMode);

  const [location, setLocation] = useState<Location | null>(DEFAULT.location);

  const [destination, setDestination] = useState<Destination | null>(DEFAULT.destination);
  const [route, setRoute] = useState<RouteInfo | null>(DEFAULT.route);
  const [routeOptions, setRouteOptions] = useState<RouteOption[]>(DEFAULT.routeOptions);

  const [pois, setPois] = useState<POI[]>(DEFAULT.pois);

  const [history, setHistory] = useState<RouteInfo[]>(DEFAULT.history);

  // load: localStorage por usuário -> user.ecoState -> legado v1
  useEffect(() => {
    const fromLocal = readJSON<PersistedEcoState | null>(key, null);

    if (fromLocal) {
      setVehicle(fromLocal.vehicle ?? null);
      _setTank(fromLocal.tank ?? DEFAULT.tank);
      setRouteMode(fromLocal.routeMode ?? "eco");
      setLocation(fromLocal.location ?? null);
      setDestination(fromLocal.destination ?? null);
      setRoute(fromLocal.route ?? null);
      setRouteOptions(Array.isArray(fromLocal.routeOptions) ? fromLocal.routeOptions : []);
      setPois(Array.isArray(fromLocal.pois) ? fromLocal.pois : []);
      setHistory(Array.isArray(fromLocal.history) ? fromLocal.history : []);
      return;
    }

    if (user?.ecoState) {
      const s: PersistedEcoState = user.ecoState;
      setVehicle(s.vehicle ?? null);
      _setTank(s.tank ?? DEFAULT.tank);
      setRouteMode(s.routeMode ?? "eco");
      setLocation(s.location ?? null);
      setDestination(s.destination ?? null);
      setRoute(s.route ?? null);
      setRouteOptions(Array.isArray(s.routeOptions) ? s.routeOptions : []);
      setPois(Array.isArray(s.pois) ? s.pois : []);
      setHistory(Array.isArray(s.history) ? s.history : []);
      return;
    }

    const legacy = readJSON<any>("@EcoRoute:EcoState:v1", null);
    if (legacy) {
      setVehicle(legacy.vehicle ?? null);
      setDestination(legacy.destination ?? null);
      setRoute(legacy.route ?? null);
      setHistory(Array.isArray(legacy.history) ? legacy.history : []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // persist: localStorage + espelho no user (debounced)
  const syncTimer = useRef<number | null>(null);

  useEffect(() => {
    const payload: PersistedEcoState = {
      vehicle,
      tank,
      routeMode,
      location,
      destination,
      route,
      routeOptions,
      pois,
      history,
    };

    try {
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {}

    if (user?.email && typeof updateUser === "function") {
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => {
        updateUser({ ecoState: payload });
        syncTimer.current = null;
      }, 1200);
    }

    return () => {
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, vehicle, tank, routeMode, location, destination, route, routeOptions, pois, history]);

  const value = useMemo<EcoState>(() => {
    return {
      vehicle,
      tank,
      routeMode,

      location,

      destination,
      route,
      routeOptions,

      pois,

      history,

      setVehicle,

      setTank: (t) => {
        _setTank((prev) => {
          const cap = num(t.capacityL) ?? prev.capacityL;
          const lvl = num(t.levelL) ?? prev.levelL;
          return {
            capacityL: cap,
            levelL: clamp(lvl, 0, cap),
            updatedAt: new Date().toISOString(),
          };
        });
      },

      consumeLiters: (liters) => {
        const l = num(liters);
        if (!l || l <= 0) return;
        _setTank((prev) => ({
          ...prev,
          levelL: clamp(prev.levelL - l, 0, prev.capacityL),
          updatedAt: new Date().toISOString(),
        }));
      },

      refuelLiters: (liters) => {
        const l = num(liters);
        if (!l || l <= 0) return;
        _setTank((prev) => ({
          ...prev,
          levelL: clamp(prev.levelL + l, 0, prev.capacityL),
          updatedAt: new Date().toISOString(),
        }));
      },

      setRouteMode,

      setLocation,

      setDestination,

      setRoute,
      setRouteOptions,

      setPois,

      addHistory: (r) => setHistory((h) => [r, ...h].slice(0, 200)),
      clearHistory: () => setHistory([]),
    };
  }, [vehicle, tank, routeMode, location, destination, route, routeOptions, pois, history]);

  return <EcoContext.Provider value={value}>{children}</EcoContext.Provider>;
}

export function useEco() {
  const ctx = useContext(EcoContext);
  if (!ctx) throw new Error("useEco() precisa estar dentro de <EcoProvider>.");
  return ctx;
}
