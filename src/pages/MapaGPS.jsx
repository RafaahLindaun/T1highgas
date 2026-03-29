import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useEco } from "../context/EcoContext";

/* ---------- THEME ---------- */
const ORANGE = "#FF6A00";
const BG = "#0b0f17";
const CARD = "rgba(255,255,255,0.92)";
const BORDER = "rgba(15,23,42,0.10)";

/* ---------- Leaflet CDN ---------- */
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

/* ---------- Helpers ---------- */
function n(v) {
  const num = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(num) ? num : null;
}
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function km(m) {
  return m / 1000;
}
function mins(s) {
  return Math.round(s / 60);
}
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ---------- Optional: Ascent estimate (best-effort) ---------- */
/* Nota: isso usa OpenTopoData (público). Se falhar, segue sem subida. */
async function estimateAscentM(samplePoints) {
  const pts = samplePoints.slice(0, 40);
  const locations = pts.map((p) => `${p.lat},${p.lon}`).join("|");
  const url = `https://api.opentopodata.org/v1/srtm90m?locations=${encodeURIComponent(locations)}`;

  const res = await fetch(url);
  const data = await res.json();
  const results = data?.results;
  if (!Array.isArray(results) || results.length < 2) return null;

  let ascent = 0;
  for (let i = 1; i < results.length; i++) {
    const prev = Number(results[i - 1]?.elevation);
    const cur = Number(results[i]?.elevation);
    if (Number.isFinite(prev) && Number.isFinite(cur)) {
      const diff = cur - prev;
      if (diff > 0) ascent += diff;
    }
  }
  return ascent;
}

function sampleRoutePoints(coords, max = 30) {
  if (!coords?.length) return [];
  const step = Math.max(1, Math.floor(coords.length / max));
  const out = [];
  for (let i = 0; i < coords.length; i += step) {
    const [lon, lat] = coords[i];
    out.push({ lat, lon });
  }
  const last = coords[coords.length - 1];
  if (last) out.push({ lat: last[1], lon: last[0] });
  return out.slice(0, max);
}

/* ---------- POIs: fuel stations (Overpass) ---------- */
async function fetchNearbyFuelStations(lat, lon) {
  const q = `
[out:json][timeout:10];
(
  node["amenity"="fuel"](around:2500,${lat},${lon});
  way["amenity"="fuel"](around:2500,${lat},${lon});
  relation["amenity"="fuel"](around:2500,${lat},${lon});
);
out center 25;`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: q,
  });
  const data = await res.json();
  const els = data?.elements || [];
  return els
    .map((el) => {
      const lat2 = el.lat ?? el.center?.lat;
      const lon2 = el.lon ?? el.center?.lon;
      if (!Number.isFinite(lat2) || !Number.isFinite(lon2)) return null;
      const name = el.tags?.name || "Posto";
      return { id: String(el.id), lat: lat2, lon: lon2, label: name, kind: "fuel" };
    })
    .filter(Boolean);
}

/* ---------- Geocode ---------- */
async function geocodeOne(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  const data = await res.json();
  const first = data?.[0];
  if (!first) return null;
  return { lat: Number(first.lat), lon: Number(first.lon), label: first.display_name || q };
}

/* ---------- Main ---------- */
export default function MapaGPS() {
  const {
    vehicle,
    tank,
    routeMode,
    setRouteMode,
    setLocation,
    destination,
    setDestination,
    route,
    setRoute,
    routeOptions,
    setRouteOptions,
    consumeLiters,
    addHistory,
    pois,
    setPois,
  } = useEco();

  const mapDivRef = useRef(null);
  const refs = useRef({
    L: null,
    map: null,
    userMarker: null,
    destMarker: null,
    routeLayer: null,
    altLayer: null,
    poiLayer: null,
    watchId: null,
    lastGps: null,
  });

  const [busy, setBusy] = useState({ map: true, route: false, radar: false });
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");

  const [tripActive, setTripActive] = useState(false);
  const [tripKm, setTripKm] = useState(0);
  const [tripUsedL, setTripUsedL] = useState(0);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [uiWake, setUiWake] = useState(true);

  useEffect(() => {
    const id = "ecoPulseCss";
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

  /* ---------- Init map + GPS ---------- */
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const L = await loadLeaflet();
        if (!mounted) return;

        refs.current.L = L;

        // evita “already initialized” em hot reload
        if (mapDivRef.current && mapDivRef.current._leaflet_id) {
          mapDivRef.current._leaflet_id = undefined;
        }

        const map = L.map(mapDivRef.current, {
          zoomControl: false,
          attributionControl: false,
        }).setView([-23.55, -46.63], 13);

        L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 20 }).addTo(map);

        // Hillshade leve (visual)
        L.tileLayer("https://tiles.wmflabs.org/hillshading/{z}/{x}/{y}.png", { opacity: 0.18, maxZoom: 18 }).addTo(map);

        map.on("click", (e) => {
          const { lat, lng } = e.latlng;
          setDestination({ lat, lon: lng, label: "Destino (toque no mapa)" });
          setUiWake(true);
          setTimeout(() => setUiWake(false), 4500);
        });

        const userIcon = L.divIcon({
          className: "eco-user",
          html: `<div style="width:14px;height:14px;border-radius:50%;background:${ORANGE};border:3px solid #fff;box-shadow:0 12px 22px rgba(15,23,42,.22);"></div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        });

        const userMarker = L.marker([-23.55, -46.63], { icon: userIcon }).addTo(map);

        refs.current.map = map;
        refs.current.userMarker = userMarker;

        setTimeout(() => map.invalidateSize(), 250);

        // GPS watch
        if ("geolocation" in navigator) {
          const watchId = navigator.geolocation.watchPosition(
            (pos) => {
              const { latitude, longitude, accuracy } = pos.coords;
              const now = new Date().toISOString();

              setLocation({ lat: latitude, lon: longitude, accuracy, updatedAt: now });

              userMarker.setLatLng([latitude, longitude]);
              map.panTo([latitude, longitude], { animate: true, duration: 0.45 });

              if (tripActive) {
                const prev = refs.current.lastGps;
                refs.current.lastGps = { lat: latitude, lon: longitude };

                if (prev) {
                  const d = haversineKm(prev.lat, prev.lon, latitude, longitude);
                  if (d > 0.002) {
                    setTripKm((k) => k + d);

                    const cons = n(vehicle?.consumption);
                    if (cons && cons > 0) {
                      const used = d / cons;
                      setTripUsedL((u) => u + used);
                      consumeLiters(used);
                    }
                  }
                }
              } else {
                refs.current.lastGps = { lat: latitude, lon: longitude };
              }
            },
            (err) => console.error("GPS erro:", err),
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
          );

          refs.current.watchId = watchId;
        }

        setBusy((s) => ({ ...s, map: false }));
      } catch (e) {
        console.error(e);
        setBusy((s) => ({ ...s, map: false }));
      }
    })();

    return () => {
      mounted = false;
      const { map, watchId } = refs.current;
      if (watchId != null && "geolocation" in navigator) navigator.geolocation.clearWatch(watchId);
      if (map) {
        map.off();
        map.remove();
      }
      refs.current.map = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripActive, vehicle?.consumption]);

  /* ---------- Render POIs ---------- */
  useEffect(() => {
    const { L, map } = refs.current;
    if (!L || !map) return;

    if (refs.current.poiLayer) {
      map.removeLayer(refs.current.poiLayer);
      refs.current.poiLayer = null;
    }

    if (!pois?.length) return;

    const layer = L.layerGroup();
    pois.forEach((p) => {
      const icon = L.divIcon({
        className: "eco-poi",
        html: `<div style="width:12px;height:12px;border-radius:50%;background:#111;border:3px solid ${ORANGE};box-shadow:0 10px 18px rgba(15,23,42,.20);"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      L.marker([p.lat, p.lon], { icon }).addTo(layer).bindPopup(p.label);
    });

    layer.addTo(map);
    refs.current.poiLayer = layer;
  }, [pois]);

  /* ---------- When destination changes -> set marker + route ---------- */
  useEffect(() => {
    if (!destination) return;
    const { L, map } = refs.current;
    if (!L || !map) return;

    if (refs.current.destMarker) {
      map.removeLayer(refs.current.destMarker);
      refs.current.destMarker = null;
    }

    const destIcon = L.divIcon({
      className: "eco-dest",
      html: `<div style="width:14px;height:14px;border-radius:50%;background:#111;border:3px solid ${ORANGE};box-shadow:0 12px 22px rgba(15,23,42,.22);"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    refs.current.destMarker = L.marker([destination.lat, destination.lon], { icon: destIcon })
      .addTo(map)
      .bindPopup(destination.label);

    const loc = refs.current.lastGps;
    if (loc?.lat != null && loc?.lon != null) {
      buildRoutes({ lat: loc.lat, lon: loc.lon }, destination).catch(console.error);
    }

    setSheetOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination]);

  function computeEstimates(distanceM) {
    const cons = n(vehicle?.consumption);
    const price = n(vehicle?.fuelPrice);

    if (!cons || cons <= 0) return { liters: null, cost: null };
    const liters = km(distanceM) / cons;

    if (!price || price <= 0) return { liters, cost: null };
    return { liters, cost: liters * price };
  }

  async function buildRoutes(from, to) {
    const { L, map } = refs.current;
    if (!L || !map) return;

    setBusy((s) => ({ ...s, route: true }));

    if (refs.current.routeLayer) {
      map.removeLayer(refs.current.routeLayer);
      refs.current.routeLayer = null;
    }
    if (refs.current.altLayer) {
      map.removeLayer(refs.current.altLayer);
      refs.current.altLayer = null;
    }

    const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&alternatives=true`;
    const res = await fetch(url);
    const data = await res.json();

    const routes = Array.isArray(data?.routes) ? data.routes.slice(0, 2) : [];
    if (!routes.length) {
      setBusy((s) => ({ ...s, route: false }));
      return;
    }

    // cria opções base
    let opts = routes.map((r, idx) => {
      const est = computeEstimates(r.distance);
      return {
        id: `r${idx}`,
        from,
        to,
        distanceM: r.distance,
        durationS: r.duration,
        litersEst: est.liters ?? undefined,
        costEst: est.cost ?? undefined,
        mode: routeMode,
        createdAt: new Date().toISOString(),
        label: to.label,
      };
    });

    // tenta enriquecer com subida (não obrigatório)
    if (routeMode !== "fast") {
      try {
        const enriched = await Promise.all(
          routes.map(async (r, idx) => {
            const coords = r.geometry?.coordinates || [];
            const samples = sampleRoutePoints(coords, 30);
            const ascent = await estimateAscentM(samples);
            return { idx, ascent };
          })
        );
        enriched.forEach(({ idx, ascent }) => {
          if (ascent != null) opts[idx].ascentM = ascent;
        });
      } catch {}
    }

    // score eco/balanced/fast
    opts = opts.map((o) => {
      const cons = n(vehicle?.consumption) || 10;
      const liters = o.litersEst ?? km(o.distanceM) / cons;

      const ascentPenalty = (o.ascentM ?? 0) * 0.00008; // ajuste fino depois
      const hours = o.durationS / 3600;

      const score =
        routeMode === "fast"
          ? hours
          : routeMode === "balanced"
          ? liters * 0.75 + ascentPenalty + hours * 0.25
          : liters + ascentPenalty;

      return { ...o, score };
    });

    const best =
      routeMode === "fast"
        ? opts.slice().sort((a, b) => a.durationS - b.durationS)[0]
        : opts.slice().sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];

    setRouteOptions(opts);
    setRoute(best);

    // desenha rota melhor (laranja) e alternativa (preta)
    const bestIdx = opts.findIndex((o) => o.id === best.id);
    const bestCoords = routes[bestIdx]?.geometry?.coordinates || [];
    const bestLatLngs = bestCoords.map(([lon, lat]) => [lat, lon]);

    const line = L.polyline(bestLatLngs, { weight: 6, opacity: 0.92, color: ORANGE }).addTo(map);
    refs.current.routeLayer = line;
    map.fitBounds(line.getBounds(), { padding: [30, 30] });

    if (routes.length > 1) {
      const altIdx = bestIdx === 0 ? 1 : 0;
      const altCoords = routes[altIdx]?.geometry?.coordinates || [];
      const altLatLngs = altCoords.map(([lon, lat]) => [lat, lon]);
      const alt = L.polyline(altLatLngs, { weight: 4, opacity: 0.45, color: "#111" }).addTo(map);
      refs.current.altLayer = alt;
    }

    setBusy((s) => ({ ...s, route: false }));
  }

  async function onRadar() {
    const loc = refs.current.lastGps;
    if (!loc) return;
    setBusy((s) => ({ ...s, radar: true }));
    try {
      const list = await fetchNearbyFuelStations(loc.lat, loc.lon);
      setPois(list);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy((s) => ({ ...s, radar: false }));
    }
  }

  function toggleMode() {
    const next = routeMode === "eco" ? "balanced" : routeMode === "balanced" ? "fast" : "eco";
    setRouteMode(next);

    const loc = refs.current.lastGps;
    if (destination && loc) buildRoutes({ lat: loc.lat, lon: loc.lon }, destination).catch(console.error);
  }

  function onSaveRoute() {
    if (!route) return;
    addHistory(route);
  }

  async function onSearchSubmit(e) {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    setBusy((s) => ({ ...s, route: true }));
    try {
      const found = await geocodeOne(q);
      if (found) setDestination(found);
      setSearchOpen(false);
      setUiWake(true);
      setTimeout(() => setUiWake(false), 4500);
    } finally {
      setBusy((s) => ({ ...s, route: false }));
    }
  }

  const bottom = useMemo(() => {
    if (!route) return null;

    const liters = route.litersEst ?? null;
    const cost = route.costEst ?? null;

    // “vantagem” v1: compara com outra rota (se tiver)
    let advantage = null;
    if (routeOptions?.length >= 2) {
      const other = routeOptions.find((o) => o.id !== route.id);
      if (other?.costEst != null && cost != null) advantage = other.costEst - cost;
    } else if (cost != null) {
      advantage = cost * 0.08;
    }

    return { liters, cost, advantage };
  }, [route, routeOptions]);

  const fuelOk = useMemo(() => {
    if (!bottom?.liters) return null;
    return tank.levelL >= bottom.liters;
  }, [tank.levelL, bottom?.liters]);

  return (
    <div style={styles.wrap}>
      <div ref={mapDivRef} style={styles.map} />

      {/* TOP TOOLS (abre e some) */}
      <AnimatePresence>
        {uiWake && (
          <motion.div
            initial={{ y: -120, opacity: 0, scale: 0.92 }}
            animate={{ y: 14, opacity: 1, scale: 1 }}
            exit={{ y: -120, opacity: 0, scale: 0.92 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            style={styles.topIsland}
          >
            <div style={styles.tools}>
              <button onClick={toggleMode} style={styles.toolBtn}>
                ECO <span style={styles.toolMini}>{routeMode.toUpperCase()}</span>
              </button>
              <button onClick={() => setSearchOpen(true)} style={styles.toolBtn}>
                ROUTE
              </button>
              <button onClick={onRadar} style={styles.toolBtn}>
                {busy.radar ? "..." : "RADAR"}
              </button>
              <button onClick={onSaveRoute} style={styles.toolBtn}>
                SAVE
              </button>
              <button
                onClick={() => {
                  setTripActive((v) => {
                    const next = !v;
                    if (next) {
                      setTripKm(0);
                      setTripUsedL(0);
                    } else {
                      if (route) addHistory({ ...route });
                    }
                    return next;
                  });
                }}
                style={{
                  ...styles.toolBtn,
                  borderColor: tripActive ? ORANGE : "rgba(255,255,255,0.14)",
                }}
              >
                {tripActive ? "STOP" : "GO"}
              </button>
              <button
                onClick={() => {
                  setUiWake(false);
                }}
                style={{
                  ...styles.toolBtn,
                  background: "rgba(255,255,255,0.03)",
                }}
              >
                ✕
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* QUICK WAKE BUTTON */}
      {!uiWake && (
        <button
          onClick={() => {
            setUiWake(true);
            setTimeout(() => setUiWake(false), 4500);
          }}
          style={styles.wakeBtn}
        >
          +
        </button>
      )}

      {/* SEARCH MODAL */}
      <AnimatePresence>
        {searchOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.modalOverlay} onClick={() => setSearchOpen(false)}>
            <motion.div initial={{ y: 18, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 18, scale: 0.98 }} style={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div style={{ fontWeight: 1000, marginBottom: 10 }}>Destino</div>
              <form onSubmit={onSearchSubmit} style={{ display: "flex", gap: 10 }}>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ex: Av Paulista" style={styles.input} />
                <button type="submit" style={styles.goBtn}>
                  {busy.route ? "..." : "Ir"}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* BOTTOM POPUP */}
      <AnimatePresence>
        {sheetOpen && route && (
          <motion.div
            initial={{ y: 240, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 240, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            style={styles.sheet}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 1000, color: "#64748b" }}>ECO RESULT</div>
                <div style={styles.destLine}>
                  {destination?.label || "Destino"}
                </div>
              </div>

              <button onClick={() => setSheetOpen(false)} style={styles.closeBtn}>
                ✕
              </button>
            </div>

            <div style={styles.metrics}>
              <div style={styles.metric}>
                <div style={styles.k}>KM</div>
                <div style={styles.v}>{km(route.distanceM).toFixed(1)}</div>
              </div>
              <div style={styles.metric}>
                <div style={styles.k}>MIN</div>
                <div style={styles.v}>{mins(route.durationS)}</div>
              </div>
              <div style={styles.metricStrong}>
                <div style={styles.k}>LITROS</div>
                <div style={styles.vStrong}>{bottom?.liters != null ? bottom.liters.toFixed(2) : "--"}</div>
              </div>
            </div>

            <div style={styles.money}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>Custo</div>
                <div style={{ fontSize: 18, fontWeight: 1000 }}>
                  {bottom?.cost != null ? `R$ ${bottom.cost.toFixed(2)}` : "Preencha preço/consumo"}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, opacity: 0.75 }}>Vantagem</div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 1000,
                    color: bottom?.advantage >= 0 ? "#16a34a" : "#ef4444",
                    animation: "ecoPulse 1.25s ease-in-out infinite",
                  }}
                >
                  {bottom?.advantage != null ? `${bottom.advantage >= 0 ? "+" : "-"} R$ ${Math.abs(bottom.advantage).toFixed(2)}` : "--"}
                </div>
              </div>
            </div>

            <div style={styles.tankLine}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>Tanque</div>
                <div style={{ fontWeight: 1000 }}>
                  {tank.levelL.toFixed(1)}L / {tank.capacityL.toFixed(0)}L
                </div>
              </div>

              {fuelOk === false && (
                <div style={styles.alertRed}>Sem combustível pra rota</div>
              )}
              {fuelOk === true && bottom?.liters != null && (
                <div style={styles.alertGreen}>
                  Sobra ~{(tank.levelL - bottom.liters).toFixed(1)}L
                </div>
              )}
            </div>

            {tripActive && (
              <div style={styles.tripBox}>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>Viagem (ao vivo)</div>
                  <div style={{ fontWeight: 1000 }}>{tripKm.toFixed(2)} km</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>Gasto real</div>
                  <div style={{ fontWeight: 1000 }}>{tripUsedL.toFixed(2)} L</div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {busy.map && <div style={styles.loading}>Carregando mapa…</div>}
    </div>
  );
}

/* ---------- Styles ---------- */
const styles = {
  wrap: { position: "relative", width: "100vw", height: "100vh", background: BG },
  map: { position: "absolute", inset: 0 },

  loading: {
    position: "absolute",
    left: 12,
    bottom: 92,
    padding: "10px 12px",
    borderRadius: 14,
    background: "rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#fff",
    fontWeight: 900,
    zIndex: 9999,
  },

  topIsland: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 0,
    zIndex: 9999,
    background: "rgba(0,0,0,0.38)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 22,
    padding: 10,
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
  },
  tools: { display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" },
  toolBtn: {
    flex: "1 1 90px",
    padding: "10px 10px",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    fontWeight: 1000,
    cursor: "pointer",
    fontSize: 12,
  },
  toolMini: { marginLeft: 6, fontSize: 10, opacity: 0.85 },

  wakeBtn: {
    position: "absolute",
    top: 16,
    right: 12,
    zIndex: 9999,
    width: 54,
    height: 54,
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.35)",
    color: "#fff",
    fontSize: 28,
    fontWeight: 900,
    cursor: "pointer",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
  },

  modalOverlay: {
    position: "absolute",
    inset: 0,
    zIndex: 10000,
    background: "rgba(0,0,0,0.45)",
    display: "grid",
    placeItems: "center",
    padding: 16,
  },
  modal: {
    width: "100%",
    maxWidth: 520,
    background: CARD,
    border: `1px solid ${BORDER}`,
    borderRadius: 22,
    padding: 14,
    boxShadow: "0 20px 60px rgba(0,0,0,0.22)",
  },
  input: { flex: 1, padding: 12, borderRadius: 14, border: `1px solid ${BORDER}`, outline: "none" },
  goBtn: { padding: "12px 14px", borderRadius: 14, border: "none", background: ORANGE, fontWeight: 1000, cursor: "pointer" },

  sheet: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 84,
    zIndex: 9999,
    borderRadius: 22,
    padding: 14,
    background: CARD,
    border: `1px solid ${BORDER}`,
    boxShadow: "0 18px 50px rgba(15,23,42,0.18)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
  },
  closeBtn: { border: "none", background: "transparent", cursor: "pointer", fontSize: 18, opacity: 0.65 },

  destLine: {
    fontSize: 14,
    fontWeight: 1000,
    color: "#0f172a",
    marginTop: 2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },

  metrics: { marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr", gap: 10 },
  metric: { borderRadius: 16, padding: 10, background: "rgba(248,250,252,0.9)", border: "1px solid rgba(15,23,42,0.06)" },
  metricStrong: { borderRadius: 16, padding: 10, background: "rgba(255,106,0,0.10)", border: "1px solid rgba(255,106,0,0.22)" },
  k: { fontSize: 10, fontWeight: 1000, color: "#64748b", letterSpacing: 0.7 },
  v: { marginTop: 4, fontSize: 14, fontWeight: 1000, color: "#0f172a" },
  vStrong: { marginTop: 2, fontSize: 18, fontWeight: 1100, color: ORANGE },

  money: { marginTop: 10, display: "flex", justifyContent: "space-between", gap: 12 },

  tankLine: {
    marginTop: 10,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingTop: 10,
    borderTop: "1px solid rgba(15,23,42,0.06)",
  },
  alertRed: { padding: "8px 10px", borderRadius: 14, background: "rgba(239,68,68,.12)", color: "#991b1b", fontWeight: 1000 },
  alertGreen: { padding: "8px 10px", borderRadius: 14, background: "rgba(22,163,74,.12)", color: "#14532d", fontWeight: 1000 },

  tripBox: {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 14,
    background: "rgba(15,23,42,0.06)",
    display: "flex",
    justifyContent: "space-between",
  },
};
