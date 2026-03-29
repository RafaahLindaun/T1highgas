import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useEco } from "../context/EcoContext";

const DEFAULT_CENTER = { lat: -23.5505, lon: -46.6333 };
const TANK_KEY = "@EcoRoute:Tank:v1";

// “vantagem” (cru): economia estimada vs “rota comum” (fator)
const BASELINE_COST_MULTIPLIER = 1.08;

// --- Leaflet CDN (sem depender de npm) ---
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);

  return new Promise((resolve, reject) => {
    const cssId = "leaflet-css";
    if (!document.getElementById(cssId)) {
      const link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    const jsId = "leaflet-js";
    if (document.getElementById(jsId)) {
      const t = setInterval(() => {
        if (window.L) {
          clearInterval(t);
          resolve(window.L);
        }
      }, 50);
      setTimeout(() => {
        clearInterval(t);
        reject(new Error("Leaflet demorou para carregar."));
      }, 8000);
      return;
    }

    const script = document.createElement("script");
    script.id = jsId;
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("Falha ao carregar Leaflet via CDN."));
    document.body.appendChild(script);
  });
}

function n(v) {
  const num = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function km(m) {
  return (m / 1000).toFixed(m > 9999 ? 0 : 1);
}

function mins(s) {
  return Math.round(s / 60);
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function readTank() {
  try {
    const raw = localStorage.getItem(TANK_KEY);
    if (!raw) return { capacityL: 50, levelL: 50 };
    const t = JSON.parse(raw);
    const cap = n(t.capacityL) ?? 50;
    const lvl = n(t.levelL) ?? cap;
    return { capacityL: cap, levelL: clamp(lvl, 0, cap) };
  } catch {
    return { capacityL: 50, levelL: 50 };
  }
}

function writeTank(tank) {
  try {
    localStorage.setItem(TANK_KEY, JSON.stringify(tank));
  } catch {}
}

export default function MapaGPS() {
  const nav = useNavigate();
  const { vehicle, setDestination, setRoute, destination, route, addHistory } = useEco();

  const mapDivRef = useRef(null);
  const leafletRef = useRef({
    L: null,
    map: null,
    userMarker: null,
    destMarker: null,
    routeLayer: null,
    watchId: null,
    lastGps: null,
  });

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState({ map: true, route: false });

  const [search, setSearch] = useState("");
  const [gps, setGps] = useState({ lat: null, lon: null });

  const [tank, setTank] = useState(() => readTank());
  const [showLitersToast, setShowLitersToast] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [tripActive, setTripActive] = useState(false);

  // double click detector
  const clickTimer = useRef(null);

  // inject a tiny CSS for a “chamativo” pulse
  useEffect(() => {
    const id = "eco-ui-css";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.innerHTML = `
      @keyframes ecoPulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.03); }
        100% { transform: scale(1); }
      }
    `;
    document.head.appendChild(style);
  }, []);

  // persist tank
  useEffect(() => {
    writeTank(tank);
  }, [tank]);

  // init map + gps
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const L = await loadLeaflet();
        if (!mounted) return;

        leafletRef.current.L = L;

        // evita “already initialized” em hot reload
        if (mapDivRef.current && mapDivRef.current._leaflet_id) {
          mapDivRef.current._leaflet_id = undefined;
        }

        const map = L.map(mapDivRef.current, {
          zoomControl: false,
          attributionControl: false,
        }).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lon], 13);

        L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
          maxZoom: 20,
        }).addTo(map);

        // hillshade leve
        L.tileLayer("https://tiles.wmflabs.org/hillshading/{z}/{x}/{y}.png", {
          opacity: 0.18,
          maxZoom: 18,
        }).addTo(map);

        const userIcon = L.divIcon({
          className: "eco-user",
          html: `<div style="
            width:14px;height:14px;border-radius:50%;
            background:#2563eb;border:3px solid #fff;
            box-shadow:0 10px 18px rgba(15,23,42,.18);
          "></div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        });

        const userMarker = L.marker([DEFAULT_CENTER.lat, DEFAULT_CENTER.lon], { icon: userIcon }).addTo(map);

        map.on("click", (e) => {
          const { lat, lng } = e.latlng;
          const dest = { lat, lon: lng, label: "Destino (toque no mapa)" };
          setDestination(dest);
        });

        leafletRef.current.map = map;
        leafletRef.current.userMarker = userMarker;

        setTimeout(() => map.invalidateSize(), 250);

        // GPS live
        if ("geolocation" in navigator) {
          const watchId = navigator.geolocation.watchPosition(
            (pos) => {
              const { latitude, longitude } = pos.coords;

              setGps({ lat: latitude, lon: longitude });

              const ll = [latitude, longitude];
              userMarker.setLatLng(ll);
              map.panTo(ll, { animate: true, duration: 0.5 });

              // consumo ao vivo (cru): se tripActive, debita pelo deslocamento real
              if (tripActive) {
                const prev = leafletRef.current.lastGps;
                leafletRef.current.lastGps = { lat: latitude, lon: longitude };

                if (prev) {
                  const dKm = haversineKm(prev.lat, prev.lon, latitude, longitude);
                  const cons = n(vehicle?.consumption) ?? 10; // fallback 10 km/L
                  const usedL = dKm / cons;
                  if (usedL > 0) {
                    setTank((t) => {
                      const next = { ...t, levelL: clamp(t.levelL - usedL, 0, t.capacityL) };
                      return next;
                    });
                  }
                }
              } else {
                leafletRef.current.lastGps = { lat: latitude, lon: longitude };
              }
            },
            (err) => console.error("GPS erro:", err),
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
          );

          leafletRef.current.watchId = watchId;
        }

        setBusy((s) => ({ ...s, map: false }));
        setReady(true);
      } catch (e) {
        console.error(e);
        setBusy((s) => ({ ...s, map: false }));
      }
    })();

    return () => {
      mounted = false;
      const { map, watchId } = leafletRef.current;

      if (watchId != null && "geolocation" in navigator) navigator.geolocation.clearWatch(watchId);
      if (map) {
        map.off();
        map.remove();
      }
      leafletRef.current.map = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripActive, vehicle?.consumption]);

  // quando destination mudar (via IA ou clique/busca) -> marca destino e traça rota
  useEffect(() => {
    const { L, map } = leafletRef.current;
    if (!L || !map || !destination) return;

    // dest marker
    if (leafletRef.current.destMarker) {
      map.removeLayer(leafletRef.current.destMarker);
      leafletRef.current.destMarker = null;
    }

    const destIcon = L.divIcon({
      className: "eco-dest",
      html: `<div style="
        width:14px;height:14px;border-radius:50%;
        background:#ef4444;border:3px solid #fff;
        box-shadow:0 10px 18px rgba(15,23,42,.18);
      "></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    leafletRef.current.destMarker = L.marker([destination.lat, destination.lon], { icon: destIcon })
      .addTo(map)
      .bindPopup(destination.label || "Destino");

    map.flyTo([destination.lat, destination.lon], 15, { duration: 0.6 });

    // rota se já tem GPS
    if (gps.lat != null && gps.lon != null) {
      buildRoute({ lat: gps.lat, lon: gps.lon }, destination).catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination, gps.lat, gps.lon]);

  async function buildRoute(from, to) {
    const { L, map } = leafletRef.current;
    if (!L || !map) return;

    setBusy((s) => ({ ...s, route: true }));

    // limpa rota anterior
    if (leafletRef.current.routeLayer) {
      map.removeLayer(leafletRef.current.routeLayer);
      leafletRef.current.routeLayer = null;
    }

    // OSRM público (teste rápido)
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();

    const r = data?.routes?.[0];
    if (!r?.geometry?.coordinates?.length) {
      setBusy((s) => ({ ...s, route: false }));
      return;
    }

    const latlngs = r.geometry.coordinates.map(([lon, lat]) => [lat, lon]);

    const line = L.polyline(latlngs, {
      weight: 6,
      opacity: 0.92,
    }).addTo(map);

    leafletRef.current.routeLayer = line;
    map.fitBounds(line.getBounds(), { padding: [30, 30] });

    const payload = {
      from,
      to,
      distanceM: r.distance,
      durationS: r.duration,
      label: to.label,
      createdAt: new Date().toISOString(),
    };

    setRoute(payload);
    setSheetOpen(true);

    setBusy((s) => ({ ...s, route: false }));
  }

  async function handleSearch(e) {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;

    try {
      setBusy((s) => ({ ...s, route: true }));
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url);
      const data = await res.json();
      const first = data?.[0];
      if (!first) return;

      setDestination({
        lat: Number(first.lat),
        lon: Number(first.lon),
        label: first.display_name || q,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setBusy((s) => ({ ...s, route: false }));
    }
  }

  function recenter() {
    const { map } = leafletRef.current;
    if (!map) return;
    if (gps.lat == null || gps.lon == null) return;
    map.flyTo([gps.lat, gps.lon], 16, { duration: 0.6 });
  }

  // --- Fuel numbers for the bottom sheet ---
  const fuelCalc = useMemo(() => {
    if (!route) return null;

    const cons = n(vehicle?.consumption);
    const price = n(vehicle?.fuelPrice);

    const distKm = route.distanceM / 1000;

    if (!cons || cons <= 0) {
      return { distKm, liters: null, cost: null, advantage: null, needsVehicle: true };
    }

    const liters = distKm / cons;

    if (!price || price <= 0) {
      return { distKm, liters, cost: null, advantage: null, needsVehicle: true };
    }

    const cost = liters * price;
    const baselineCost = cost * BASELINE_COST_MULTIPLIER;
    const advantage = baselineCost - cost; // economia

    return { distKm, liters, cost, advantage, needsVehicle: false };
  }, [route, vehicle?.consumption, vehicle?.fuelPrice]);

  function onTankClick() {
    if (clickTimer.current) {
      // double click
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      nav("/abastecimento");
      return;
    }

    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      setShowLitersToast(true);
      setTimeout(() => setShowLitersToast(false), 1600);
    }, 240);
  }

  function applyEstimatedConsumption() {
    if (!fuelCalc?.liters) return;
    setTank((t) => ({ ...t, levelL: clamp(t.levelL - fuelCalc.liters, 0, t.capacityL) }));
    if (route) addHistory(route);
  }

  const percent = tank.capacityL > 0 ? clamp(tank.levelL / tank.capacityL, 0, 1) : 0;

  return (
    <div style={styles.wrap}>
      {/* Search bar */}
      <div style={styles.topBar}>
        <form onSubmit={handleSearch} style={styles.searchForm}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Para onde vamos?"
            style={styles.searchInput}
          />
          <button type="submit" style={styles.searchBtn}>
            {busy.route ? "..." : "🔍"}
          </button>
        </form>
      </div>

      {/* Map */}
      <div ref={mapDivRef} style={styles.mapCanvas} />

      {/* Loading */}
      {!ready && (
        <div style={styles.loading}>
          <div style={styles.loadingCard}>
            <b>Carregando mapa…</b>
            <div style={{ marginTop: 6, opacity: 0.75 }}>se demorar, atualize a página</div>
          </div>
        </div>
      )}

      {/* Fabs (direita) */}
      <div style={styles.fabs}>
        <button style={styles.fab} onClick={recenter} title="Centralizar GPS">
          📍
        </button>
      </div>

      {/* Fuel gauge (esquerda) */}
      <div style={styles.tankWrap} onClick={onTankClick}>
        <div style={styles.tankLabelTop}>F</div>

        <div style={styles.dotsCol}>
          {Array.from({ length: 14 }).map((_, i) => {
            // i=0 topo, i=13 base
            const levelIndex = 13 - i;
            const filledDots = Math.round(percent * 14);
            const filled = levelIndex < filledDots;

            return (
              <div
                key={i}
                style={{
                  ...styles.dot,
                  opacity: filled ? 1 : 0.22,
                }}
              />
            );
          })}
        </div>

        <div style={styles.tankLabelBottom}>E</div>

        <AnimatePresence>
          {showLitersToast && (
            <motion.div
              initial={{ opacity: 0, x: -8, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -8, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              style={styles.litersToast}
            >
              <b style={{ fontSize: 14 }}>{tank.levelL.toFixed(1)} L</b>
              <div style={{ fontSize: 11, opacity: 0.75 }}>
                {Math.round(percent * 100)}%
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom pop-up (chamativo) */}
      <AnimatePresence>
        {sheetOpen && route && (
          <motion.div
            initial={{ y: 260, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 260, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            style={styles.sheet}
          >
            <div style={styles.sheetHandle} />

            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={styles.sheetTitle}>Estimativa</div>
                <div style={styles.sheetSub}>
                  {route.to?.label ? truncate(route.to.label, 52) : "Destino"}
                </div>
              </div>

              <button onClick={() => setSheetOpen(false)} style={styles.closeBtn}>
                ✕
              </button>
            </div>

            <div style={styles.metricsRow}>
              <div style={styles.metric}>
                <span style={styles.metricK}>DIST</span>
                <b style={styles.metricV}>{km(route.distanceM)} km</b>
              </div>
              <div style={styles.metric}>
                <span style={styles.metricK}>TEMPO</span>
                <b style={styles.metricV}>{mins(route.durationS)} min</b>
              </div>

              <div style={styles.metricStrong}>
                <span style={styles.metricK}>LITROS</span>
                <b style={styles.metricBig}>
                  {fuelCalc?.liters != null ? fuelCalc.liters.toFixed(2) : "--"} L
                </b>
              </div>
            </div>

            <div style={styles.moneyCard}>
              {fuelCalc?.needsVehicle ? (
                <div>
                  <b style={{ color: "#0f172a" }}>Cadastre consumo + preço</b>
                  <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>
                    Vá em <b>CarBase</b> e preencha “Consumo” e “Preço”.
                  </div>
                </div>
              ) : (
                <div style={{ width: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>Custo estimado</div>
                      <div style={{ fontSize: 18, fontWeight: 900 }}>
                        R$ {fuelCalc.cost.toFixed(2)}
                      </div>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>Vantagem (estim.)</div>
                      <div
                        style={{
                          fontSize: 18,
                          fontWeight: 900,
                          color: fuelCalc.advantage >= 0 ? "#16a34a" : "#ef4444",
                          animation: "ecoPulse 1.25s ease-in-out infinite",
                        }}
                      >
                        {fuelCalc.advantage >= 0 ? "+" : "-"} R$ {Math.abs(fuelCalc.advantage).toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 10, fontSize: 11, opacity: 0.7 }}>
                    * “Vantagem” é uma estimativa crua (comparação por fator). Depois trocamos por EcoRoute real.
                  </div>

                  <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                    <button
                      onClick={() => setTripActive((v) => !v)}
                      style={{
                        ...styles.actionBtn,
                        background: tripActive ? "#0f172a" : "#2563eb",
                      }}
                    >
                      {tripActive ? "Parar" : "Iniciar"}
                    </button>

                    <button
                      onClick={applyEstimatedConsumption}
                      style={{
                        ...styles.actionBtn,
                        background: "#d97706",
                      }}
                      disabled={fuelCalc?.liters == null}
                    >
                      Debitar (teste)
                    </button>

                    <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.8, alignSelf: "center" }}>
                      Tanque: <b>{tank.levelL.toFixed(1)}L</b> / {tank.capacityL.toFixed(0)}L
                    </div>
                  </div>

                  {fuelCalc?.liters != null && tank.levelL < fuelCalc.liters && (
                    <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 12, background: "rgba(239,68,68,.12)", color: "#991b1b", fontWeight: 800 }}>
                      Combustível insuficiente para essa rota.
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function truncate(s, n) {
  if (!s) return s;
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

// haversine (km)
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const styles = {
  wrap: { position: "relative", width: "100vw", height: "100vh", overflow: "hidden", background: "#e5e7eb" },
  mapCanvas: { width: "100%", height: "100%" },

  topBar: { position: "absolute", top: 12, left: 12, right: 12, zIndex: 9999 },
  searchForm: {
    display: "flex",
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(15,23,42,0.08)",
    borderRadius: 18,
    overflow: "hidden",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    boxShadow: "0 10px 26px rgba(15,23,42,0.10)",
  },
  searchInput: { flex: 1, border: "none", outline: "none", padding: "12px 14px", fontSize: 16, background: "transparent" },
  searchBtn: { border: "none", background: "transparent", padding: "0 14px", fontSize: 18, cursor: "pointer" },

  loading: { position: "absolute", inset: 0, display: "grid", placeItems: "center", zIndex: 9998, pointerEvents: "none" },
  loadingCard: {
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(15,23,42,0.08)",
    borderRadius: 18,
    padding: "14px 16px",
    boxShadow: "0 10px 26px rgba(15,23,42,0.10)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
  },

  fabs: { position: "absolute", right: 14, bottom: 92, display: "flex", flexDirection: "column", gap: 10, zIndex: 9999 },
  fab: {
    width: 54,
    height: 54,
    borderRadius: 18,
    border: "1px solid rgba(15,23,42,0.10)",
    background: "rgba(255,255,255,0.92)",
    boxShadow: "0 10px 26px rgba(15,23,42,0.12)",
    cursor: "pointer",
    fontSize: 22,
  },

  // tank
  tankWrap: {
    position: "absolute",
    left: 12,
    top: "35%",
    transform: "translateY(-50%)",
    zIndex: 9999,
    width: 42,
    padding: "10px 8px",
    borderRadius: 18,
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(15,23,42,0.08)",
    boxShadow: "0 10px 26px rgba(15,23,42,0.12)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    userSelect: "none",
  },
  tankLabelTop: { fontSize: 10, fontWeight: 900, color: "#0f172a", opacity: 0.7 },
  tankLabelBottom: { fontSize: 10, fontWeight: 900, color: "#0f172a", opacity: 0.7 },
  dotsCol: { display: "flex", flexDirection: "column", gap: 5 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    background: "#16a34a",
  },
  litersToast: {
    position: "absolute",
    left: 48,
    top: "50%",
    transform: "translateY(-50%)",
    background: "rgba(15,23,42,0.92)",
    color: "#fff",
    borderRadius: 14,
    padding: "10px 12px",
    boxShadow: "0 10px 26px rgba(15,23,42,0.25)",
    minWidth: 90,
    textAlign: "center",
  },

  // bottom sheet
  sheet: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 84, // acima do BottomMenu
    zIndex: 9999,
    borderRadius: 22,
    padding: 14,
    background: "rgba(255,255,255,0.94)",
    border: "1px solid rgba(15,23,42,0.08)",
    boxShadow: "0 18px 50px rgba(15,23,42,0.18)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
  },
  sheetHandle: { width: 48, height: 5, borderRadius: 999, background: "rgba(15,23,42,0.14)", margin: "0 auto 10px" },
  sheetTitle: { fontSize: 12, fontWeight: 900, letterSpacing: 0.5, color: "#64748b" },
  sheetSub: { fontSize: 14, fontWeight: 900, color: "#0f172a", marginTop: 2 },
  closeBtn: { border: "none", background: "transparent", cursor: "pointer", fontSize: 18, opacity: 0.65 },

  metricsRow: { marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr", gap: 10 },
  metric: {
    borderRadius: 16,
    padding: 10,
    background: "rgba(248,250,252,0.9)",
    border: "1px solid rgba(15,23,42,0.06)",
  },
  metricStrong: {
    borderRadius: 16,
    padding: 10,
    background: "rgba(34,197,94,0.10)",
    border: "1px solid rgba(34,197,94,0.20)",
  },
  metricK: { fontSize: 10, fontWeight: 900, color: "#64748b", letterSpacing: 0.7 },
  metricV: { display: "block", marginTop: 4, fontSize: 14, fontWeight: 900, color: "#0f172a" },
  metricBig: { display: "block", marginTop: 2, fontSize: 18, fontWeight: 1000, color: "#16a34a" },

  moneyCard: {
    marginTop: 10,
    borderRadius: 18,
    padding: 12,
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(15,23,42,0.06)",
  },

  actionBtn: {
    padding: "10px 12px",
    borderRadius: 14,
    border: "none",
    color: "#fff",
    fontWeight: 1000,
    cursor: "pointer",
  },
};
