import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useEco } from "../context/EcoContext";

const DEFAULT_CENTER = { lat: -23.5505, lon: -46.6333 };
const TANK_KEY = "@EcoRoute:Tank:v1";
const ROUTE_MODE_KEY = "@EcoRoute:RouteMode:v1";
const VISITED_KEY = "@EcoRoute:VisitedRoads:v1";

const C = {
  bg: "#E9EEF5",
  card: "rgba(255,255,255,0.76)",
  cardStrong: "rgba(255,255,255,0.90)",
  line: "rgba(255,255,255,0.55)",
  lineDark: "rgba(15,23,42,0.10)",
  text: "#0F172A",
  sub: "#64748B",
  accent: "#007AFF",
  success: "#16A34A",
  danger: "#EF4444",
  dark: "#111827",
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

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

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function km(m) {
  return m / 1000;
}

function mins(s) {
  return Math.round(s / 60);
}

function formatKm(m) {
  return `${km(m).toFixed(m > 10000 ? 0 : 1)} km`;
}

function formatMin(s) {
  return `${mins(s)} min`;
}

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

function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const λ1 = (lon1 * Math.PI) / 180;
  const λ2 = (lon2 * Math.PI) / 180;
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

function parseCoordinates(input) {
  const clean = String(input || "").trim().replace(/[()]/g, "");
  const match = clean.match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;

  const a = Number(match[1]);
  const b = Number(match[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
    return { lat: a, lon: b, label: `${a.toFixed(6)}, ${b.toFixed(6)}` };
  }

  if (Math.abs(b) <= 90 && Math.abs(a) <= 180) {
    return { lat: b, lon: a, label: `${b.toFixed(6)}, ${a.toFixed(6)}` };
  }

  return null;
}

function truncate(s, n) {
  if (!s) return s;
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function sampleRoutePoints(coords, max = 28) {
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

async function estimateAscentM(samplePoints) {
  try {
    const pts = sampleRoutePoints(samplePoints, 30);
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
  } catch {
    return null;
  }
}

function distancePointToSegmentMeters(p, a, b) {
  const toXY = ({ lat, lon }) => ({
    x: lon * 111320 * Math.cos((lat * Math.PI) / 180),
    y: lat * 110540,
  });

  const P = toXY(p);
  const A = toXY(a);
  const B = toXY(b);

  const ABx = B.x - A.x;
  const ABy = B.y - A.y;
  const APx = P.x - A.x;
  const APy = P.y - A.y;

  const ab2 = ABx * ABx + ABy * ABy;
  const t = ab2 === 0 ? 0 : clamp((APx * ABx + APy * ABy) / ab2, 0, 1);

  const x = A.x + ABx * t;
  const y = A.y + ABy * t;
  return Math.hypot(P.x - x, P.y - y);
}

function countPoiNearRoute(routeCoords, pois, thresholdMeters = 120) {
  if (!routeCoords?.length || !pois?.length) return 0;
  let count = 0;

  pois.forEach((poi) => {
    let hit = false;
    for (let i = 1; i < routeCoords.length; i++) {
      const a = { lat: routeCoords[i - 1][1], lon: routeCoords[i - 1][0] };
      const b = { lat: routeCoords[i][1], lon: routeCoords[i][0] };
      if (distancePointToSegmentMeters({ lat: poi.lat, lon: poi.lon }, a, b) <= thresholdMeters) {
        hit = true;
        break;
      }
    }
    if (hit) count += 1;
  });

  return count;
}

async function geocodeOne(query) {
  const coord = parseCoordinates(query);
  if (coord) return coord;

  const q = String(query || "").trim();
  if (!q) return null;

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" },
  });
  const data = await res.json();
  const first = data?.[0];
  if (!first) return null;

  return {
    lat: Number(first.lat),
    lon: Number(first.lon),
    label: first.display_name || q,
  };
}

async function fetchFuelStationsAround(lat, lon, radius = 4000) {
  const q = `
[out:json][timeout:12];
(
  node["amenity"="fuel"](around:${radius},${lat},${lon});
  way["amenity"="fuel"](around:${radius},${lat},${lon});
  relation["amenity"="fuel"](around:${radius},${lat},${lon});
);
out center;`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: q,
  });
  const data = await res.json();

  return (data?.elements || [])
    .map((el) => {
      const lat2 = el.lat ?? el.center?.lat;
      const lon2 = el.lon ?? el.center?.lon;
      if (!Number.isFinite(lat2) || !Number.isFinite(lon2)) return null;
      return {
        id: String(el.id),
        lat: lat2,
        lon: lon2,
        label: el.tags?.name || "Posto",
        kind: "fuel",
      };
    })
    .filter(Boolean);
}

async function fetchSpeedCamerasAround(lat, lon, radius = 5000) {
  const q = `
[out:json][timeout:12];
(
  node["highway"="speed_camera"](around:${radius},${lat},${lon});
  node["enforcement"="maxspeed"](around:${radius},${lat},${lon});
);
out center;`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: q,
  });
  const data = await res.json();

  return (data?.elements || [])
    .map((el) => {
      const lat2 = el.lat ?? el.center?.lat;
      const lon2 = el.lon ?? el.center?.lon;
      if (!Number.isFinite(lat2) || !Number.isFinite(lon2)) return null;
      return {
        id: String(el.id),
        lat: lat2,
        lon: lon2,
        label: el.tags?.name || "Radar",
        kind: "camera",
      };
    })
    .filter(Boolean);
}

async function fetchTollsAround(lat, lon, radius = 7000) {
  const q = `
[out:json][timeout:12];
(
  node["barrier"="toll_booth"](around:${radius},${lat},${lon});
  node["toll"="yes"](around:${radius},${lat},${lon});
  way["barrier"="toll_booth"](around:${radius},${lat},${lon});
);
out center;`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: q,
  });
  const data = await res.json();

  return (data?.elements || [])
    .map((el) => {
      const lat2 = el.lat ?? el.center?.lat;
      const lon2 = el.lon ?? el.center?.lon;
      if (!Number.isFinite(lat2) || !Number.isFinite(lon2)) return null;
      return {
        id: String(el.id),
        lat: lat2,
        lon: lon2,
        label: el.tags?.name || "Pedágio",
        kind: "toll",
      };
    })
    .filter(Boolean);
}

function readTank() {
  const t = readJSON(TANK_KEY, { capacityL: 50, levelL: 50 });
  const cap = n(t.capacityL) ?? 50;
  const lvl = n(t.levelL) ?? cap;
  return { capacityL: cap, levelL: clamp(lvl, 0, cap) };
}

function writeTank(tank) {
  writeJSON(TANK_KEY, tank);
}

function readVisited() {
  return readJSON(VISITED_KEY, []);
}

function writeVisited(points) {
  writeJSON(VISITED_KEY, points.slice(-2000));
}

function getRouteMode() {
  const m = localStorage.getItem(ROUTE_MODE_KEY);
  return m === "fast" || m === "balanced" || m === "eco" ? m : "eco";
}

function setRouteModeStorage(v) {
  localStorage.setItem(ROUTE_MODE_KEY, v);
}

function iconSvg(type) {
  const common =
    'width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0F172A" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round"';

  if (type === "search") return `<svg ${common}><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>`;
  if (type === "locate") return `<svg ${common}><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3"></path><path d="M12 19v3"></path><path d="M2 12h3"></path><path d="M19 12h3"></path></svg>`;
  if (type === "plus") return `<svg ${common}><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>`;
  if (type === "minus") return `<svg ${common}><path d="M5 12h14"></path></svg>`;
  if (type === "compass") return `<svg ${common}><circle cx="12" cy="12" r="9"></circle><path d="m15.5 8.5-2.4 6.4-4.6 1.6 2.4-6.4 4.6-1.6Z"></path></svg>`;
  if (type === "camera") return `<svg ${common}><rect x="4" y="7" width="16" height="12" rx="2"></rect><path d="M9 7 10.5 5h3L15 7"></path><circle cx="12" cy="13" r="3"></circle></svg>`;
  if (type === "toll") return `<svg ${common}><path d="M4 20V10l4-4 4 4v10"></path><path d="M12 20V8l4-4 4 4v12"></path></svg>`;
  if (type === "fuel") return `<svg ${common}><path d="M8 20h8"></path><path d="M9 20V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14"></path><path d="M15 8h2.5a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 0 1.5 1.5H21"></path></svg>`;
  if (type === "route") return `<svg ${common}><circle cx="6" cy="18" r="2"></circle><path d="M8 18h7a4 4 0 1 0 0-8H9a4 4 0 1 1 0-8h8"></path><circle cx="18" cy="2" r="2"></circle></svg>`;
  if (type === "start") return `<svg ${common}><path d="M8 5l10 7-10 7V5Z"></path></svg>`;
  if (type === "stop") return `<svg ${common}><rect x="7" y="7" width="10" height="10" rx="1"></rect></svg>`;
  if (type === "sheet") return `<svg ${common}><path d="M12 3v18"></path><path d="m6 9 6-6 6 6"></path></svg>`;
  return `<svg ${common}><circle cx="12" cy="12" r="9"></circle></svg>`;
}

function uiIcon(type, size = 18) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, display: "inline-grid", placeItems: "center" }}
      dangerouslySetInnerHTML={{
        __html: iconSvg(type)
          .replace('width="22"', `width="${size}"`)
          .replace('height="22"', `height="${size}"`),
      }}
    />
  );
}

function makeMapIcon(L, kind) {
  const svg =
    kind === "fuel"
      ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0F172A" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round"><path d="M8 20h8"></path><path d="M9 20V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14"></path><path d="M15 8h2.5a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 0 1.5 1.5H21"></path></svg>`
      : kind === "camera"
      ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0F172A" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="16" height="12" rx="2"></rect><path d="M9 7 10.5 5h3L15 7"></path><circle cx="12" cy="13" r="3"></circle></svg>`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0F172A" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10l4-4 4 4v10"></path><path d="M12 20V8l4-4 4 4v12"></path></svg>`;

  return L.divIcon({
    className: `poi-${kind}`,
    html: `<div style="width:34px;height:34px;border-radius:999px;background:rgba(255,255,255,.88);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.55);display:grid;place-items:center;box-shadow:0 12px 28px rgba(15,23,42,.16)">${svg}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
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
    altRouteLayer: null,
    passedLayer: null,
    poiLayers: { fuel: null, camera: null, toll: null },
    watchId: null,
    lastGps: null,
  });

  const lastPanAtRef = useRef(0);
  const lastStableGpsRef = useRef(null);
  const lastHeadingRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState({ map: true, route: false, pois: false });

  const [search, setSearch] = useState("");
  const [gps, setGps] = useState({ lat: null, lon: null, heading: 0 });
  const [routeMode, setRouteMode] = useState(getRouteMode);
  const [routeAlternatives, setRouteAlternatives] = useState([]);
  const [activeRouteIndex, setActiveRouteIndex] = useState(0);

  const [showSearchBar, setShowSearchBar] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tripActive, setTripActive] = useState(false);
  const [navMode, setNavMode] = useState(false);

  const [tank, setTank] = useState(() => readTank());
  const [showLitersToast, setShowLitersToast] = useState(false);
  const [visitedPoints, setVisitedPoints] = useState(() => readVisited());

  const [poiData, setPoiData] = useState({ fuel: [], camera: [], toll: [] });
  const [poiVisible, setPoiVisible] = useState({ fuel: true, camera: true, toll: true });

  const clickTimer = useRef(null);

  useEffect(() => {
    writeTank(tank);
  }, [tank]);

  useEffect(() => {
    writeVisited(visitedPoints);
  }, [visitedPoints]);

  useEffect(() => {
    setRouteModeStorage(routeMode);
  }, [routeMode]);

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
      .leaflet-control-attribution { display:none !important; }
    `;
    document.head.appendChild(style);
  }, []);

  function drawVisitedPath() {
    const { L, map } = leafletRef.current;
    if (!L || !map) return;

    if (leafletRef.current.passedLayer) {
      map.removeLayer(leafletRef.current.passedLayer);
      leafletRef.current.passedLayer = null;
    }

    if (visitedPoints.length < 2) return;

    const layer = L.polyline(
      visitedPoints.map((p) => [p.lat, p.lon]),
      {
        color: "#F8FAFC",
        weight: 5,
        opacity: 0.92,
        lineCap: "round",
        lineJoin: "round",
      }
    ).addTo(map);

    leafletRef.current.passedLayer = layer;
  }

  function updateThirdPersonCamera(pos) {
    const { map } = leafletRef.current;
    if (!map || !navMode) return;

    const latlng = [pos.lat, pos.lon];
    const p = map.project(latlng, map.getZoom());

    const centerPoint = {
      x: p.x,
      y: p.y + 145,
    };

    const center = map.unproject(centerPoint, map.getZoom());
    map.setView(center, Math.max(map.getZoom(), 17), { animate: true });
  }

  useEffect(() => {
    drawVisitedPath();
  }, [visitedPoints]);

  function renderPoiLayers() {
    const { L, map } = leafletRef.current;
    if (!L || !map) return;

    ["fuel", "camera", "toll"].forEach((kind) => {
      const current = leafletRef.current.poiLayers[kind];
      if (current) {
        map.removeLayer(current);
        leafletRef.current.poiLayers[kind] = null;
      }

      if (!poiVisible[kind]) return;
      const items = poiData[kind] || [];
      if (!items.length) return;

      const layer = L.layerGroup();
      const icon = makeMapIcon(L, kind);

      items.forEach((item) => {
        L.marker([item.lat, item.lon], { icon })
          .addTo(layer)
          .bindPopup(item.label || (kind === "fuel" ? "Posto" : kind === "camera" ? "Radar" : "Pedágio"));
      });

      layer.addTo(map);
      leafletRef.current.poiLayers[kind] = layer;
    });
  }

  useEffect(() => {
    renderPoiLayers();
  }, [poiData, poiVisible]);

  useEffect(() => {
    let mounted = true;
    let resizeMap = null;

    (async () => {
      try {
        const L = await loadLeaflet();
        if (!mounted) return;

        leafletRef.current.L = L;

        if (mapDivRef.current && mapDivRef.current._leaflet_id) {
          mapDivRef.current._leaflet_id = undefined;
        }

        const map = L.map(mapDivRef.current, {
          zoomControl: false,
          attributionControl: false,
          preferCanvas: true,
          tap: true,
          touchZoom: true,
          doubleClickZoom: true,
          scrollWheelZoom: true,
          boxZoom: false,
          keyboard: false,
        }).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lon], 14);

        L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
          maxZoom: 20,
        }).addTo(map);

        L.tileLayer("https://tiles.wmflabs.org/hillshading/{z}/{x}/{y}.png", {
          opacity: 0.12,
          maxZoom: 18,
        }).addTo(map);

        const userIcon = L.divIcon({
          className: "eco-user",
          html: `<div style="width:18px;height:18px;border-radius:999px;background:${C.accent};border:4px solid #fff;box-shadow:0 14px 28px rgba(15,23,42,.18)"></div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });

        const userMarker = L.marker([DEFAULT_CENTER.lat, DEFAULT_CENTER.lon], { icon: userIcon }).addTo(map);

        map.on("click", (e) => {
          const { lat, lng } = e.latlng;
          const dest = { lat, lon: lng, label: "Destino selecionado no mapa" };
          setDestination(dest);
        });

        leafletRef.current.map = map;
        leafletRef.current.userMarker = userMarker;

        setTimeout(() => map.invalidateSize(), 250);

        resizeMap = () => {
          setTimeout(() => {
            map.invalidateSize();
          }, 120);
        };

        window.addEventListener("resize", resizeMap);
        window.addEventListener("orientationchange", resizeMap);

        if ("geolocation" in navigator) {
          const watchId = navigator.geolocation.watchPosition(
            (pos) => {
              const { latitude, longitude, heading, accuracy } = pos.coords;
              const prev = lastStableGpsRef.current;

              if (accuracy && accuracy > 80) return;

              let computedHeading =
                Number.isFinite(heading) && heading !== null ? heading : lastHeadingRef.current || 0;

              if (prev) {
                const dKm = haversineKm(prev.lat, prev.lon, latitude, longitude);
                if (dKm > 0.005) {
                  computedHeading = bearingDeg(prev.lat, prev.lon, latitude, longitude);
                } else {
                  computedHeading = lastHeadingRef.current || computedHeading;
                }
              }

              lastHeadingRef.current = computedHeading;

              const nextGps = { lat: latitude, lon: longitude, heading: computedHeading };
              setGps(nextGps);
              leafletRef.current.lastGps = nextGps;
              lastStableGpsRef.current = nextGps;

              const ll = [latitude, longitude];
              userMarker.setLatLng(ll);

              if (tripActive && prev) {
                const dKm = haversineKm(prev.lat, prev.lon, latitude, longitude);
                const cons = n(vehicle?.consumption) ?? 10;
                const usedL = dKm / cons;

                if (dKm > 0.003) {
                  setVisitedPoints((list) => [...list, { lat: latitude, lon: longitude }].slice(-2000));
                }

                if (usedL > 0 && dKm > 0.003) {
                  setTank((t) => ({ ...t, levelL: clamp(t.levelL - usedL, 0, t.capacityL) }));
                }
              }

              const now = Date.now();

              if (navMode) {
                if (now - lastPanAtRef.current > 700) {
                  updateThirdPersonCamera(nextGps);
                  lastPanAtRef.current = now;
                }
              } else {
                if (now - lastPanAtRef.current > 1200) {
                  map.panTo(ll, { animate: true, duration: 0.45 });
                  lastPanAtRef.current = now;
                }
              }
            },
            (err) => console.error("GPS erro:", err),
            {
              enableHighAccuracy: true,
              timeout: 12000,
              maximumAge: 1200,
            }
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
      if (resizeMap) {
        window.removeEventListener("resize", resizeMap);
        window.removeEventListener("orientationchange", resizeMap);
      }
      if (map) {
        map.off();
        map.remove();
      }
      leafletRef.current.map = null;
    };
  }, [tripActive, navMode, vehicle?.consumption, setDestination]);

  useEffect(() => {
    const { L, map } = leafletRef.current;
    if (!L || !map || !destination) return;

    if (leafletRef.current.destMarker) {
      map.removeLayer(leafletRef.current.destMarker);
      leafletRef.current.destMarker = null;
    }

    const destIcon = L.divIcon({
      className: "eco-dest",
      html: `<div style="width:18px;height:18px;border-radius:999px;background:#111827;border:4px solid #fff;box-shadow:0 14px 28px rgba(15,23,42,.18)"></div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });

    leafletRef.current.destMarker = L.marker([destination.lat, destination.lon], { icon: destIcon })
      .addTo(map)
      .bindPopup(destination.label || "Destino");

    map.flyTo([destination.lat, destination.lon], 16, { duration: 0.55 });

    if (gps.lat != null && gps.lon != null) {
      buildRoutes({ lat: gps.lat, lon: gps.lon }, destination).catch(console.error);
    }
  }, [destination, gps.lat, gps.lon, routeMode]);

  async function buildRoutes(from, to) {
    const { L, map } = leafletRef.current;
    if (!L || !map) return;

    setBusy((s) => ({ ...s, route: true, pois: true }));

    if (leafletRef.current.routeLayer) {
      map.removeLayer(leafletRef.current.routeLayer);
      leafletRef.current.routeLayer = null;
    }
    if (leafletRef.current.altRouteLayer) {
      map.removeLayer(leafletRef.current.altRouteLayer);
      leafletRef.current.altRouteLayer = null;
    }

    const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&alternatives=true&steps=true`;
    const res = await fetch(url);
    const data = await res.json();

    const routes = Array.isArray(data?.routes) ? data.routes.slice(0, 2) : [];
    if (!routes.length) {
      setBusy((s) => ({ ...s, route: false, pois: false }));
      return;
    }

    let alternatives = routes.map((r, idx) => {
      const cons = n(vehicle?.consumption);
      const price = n(vehicle?.fuelPrice);
      const liters = cons && cons > 0 ? km(r.distance) / cons : null;
      const cost = liters != null && price && price > 0 ? liters * price : null;

      return {
        index: idx,
        distanceM: r.distance,
        durationS: r.duration,
        liters,
        cost,
        ascentM: null,
        tollCount: 0,
        cameraCount: 0,
        fuelCount: 0,
        routeCoords: r.geometry?.coordinates || [],
        label: to.label,
      };
    });

    try {
      const ascentResults = await Promise.all(
        alternatives.map(async (alt) => {
          const samples = sampleRoutePoints(alt.routeCoords, 26);
          const ascent = await estimateAscentM(samples);
          return ascent;
        })
      );
      alternatives = alternatives.map((alt, i) => ({ ...alt, ascentM: ascentResults[i] }));
    } catch {}

    const [fuel, camera, toll] = await Promise.all([
      fetchFuelStationsAround((from.lat + to.lat) / 2, (from.lon + to.lon) / 2, 6000).catch(() => []),
      fetchSpeedCamerasAround((from.lat + to.lat) / 2, (from.lon + to.lon) / 2, 7000).catch(() => []),
      fetchTollsAround((from.lat + to.lat) / 2, (from.lon + to.lon) / 2, 10000).catch(() => []),
    ]);
    setPoiData({ fuel, camera, toll });

    alternatives = alternatives.map((alt) => ({
      ...alt,
      tollCount: countPoiNearRoute(alt.routeCoords, toll, 220),
      cameraCount: countPoiNearRoute(alt.routeCoords, camera, 150),
      fuelCount: countPoiNearRoute(alt.routeCoords, fuel, 180),
    }));

    alternatives = alternatives.map((alt) => {
      const liters = alt.liters ?? km(alt.distanceM) / (n(vehicle?.consumption) || 10);
      const ascentPenalty = (alt.ascentM ?? 0) * 0.00008;
      const tollPenalty = alt.tollCount * 0.12;
      const speedPenalty = alt.cameraCount * 0.04;
      const timeH = alt.durationS / 3600;

      let score = liters + ascentPenalty + tollPenalty + speedPenalty;
      if (routeMode === "fast") score = timeH + speedPenalty * 0.25;
      if (routeMode === "balanced") score = liters * 0.75 + ascentPenalty + tollPenalty * 0.5 + timeH * 0.25;

      return { ...alt, score };
    });

    const best =
      routeMode === "fast"
        ? alternatives.slice().sort((a, b) => a.durationS - b.durationS)[0]
        : alternatives.slice().sort((a, b) => a.score - b.score)[0];

    const bestIdx = best.index;
    setActiveRouteIndex(bestIdx);
    setRouteAlternatives(alternatives);

    const payload = {
      from,
      to,
      distanceM: best.distanceM,
      durationS: best.durationS,
      label: to.label,
      createdAt: new Date().toISOString(),
      litersEst: best.liters ?? undefined,
      costEst: best.cost ?? undefined,
      ascentM: best.ascentM ?? undefined,
      tollCount: best.tollCount,
      cameraCount: best.cameraCount,
      fuelCount: best.fuelCount,
      mode: routeMode,
    };

    setRoute(payload);
    setSheetOpen(true);

    const bestLatLngs = best.routeCoords.map(([lon, lat]) => [lat, lon]);
    const mainLine = L.polyline(bestLatLngs, {
      color: C.accent,
      weight: 7,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round",
      dashArray: "14 10",
    }).addTo(map);

    leafletRef.current.routeLayer = mainLine;

    if (alternatives.length > 1) {
      const altIdx = bestIdx === 0 ? 1 : 0;
      const alt = alternatives[altIdx];
      const altLatLngs = alt.routeCoords.map(([lon, lat]) => [lat, lon]);
      const altLine = L.polyline(altLatLngs, {
        color: "#111827",
        weight: 5,
        opacity: 0.28,
        dashArray: "10 12",
      }).addTo(map);
      leafletRef.current.altRouteLayer = altLine;
    }

    map.fitBounds(mainLine.getBounds(), { padding: [30, 30] });
    setBusy((s) => ({ ...s, route: false, pois: false }));
  }

  async function handleSearch(e) {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;

    try {
      setBusy((s) => ({ ...s, route: true }));
      const found = await geocodeOne(q);
      if (!found) return;
      setDestination(found);
      setSearch("");
    } catch (err) {
      console.error(err);
    } finally {
      setBusy((s) => ({ ...s, route: false }));
    }
  }

  function recenter() {
    const { map } = leafletRef.current;
    if (!map || gps.lat == null || gps.lon == null) return;
    map.flyTo([gps.lat, gps.lon], Math.max(map.getZoom(), 17), { duration: 0.5 });
  }

  function zoomIn() {
    const { map } = leafletRef.current;
    if (!map) return;
    map.zoomIn();
  }

  function zoomOut() {
    const { map } = leafletRef.current;
    if (!map) return;
    map.zoomOut();
  }

  function alignNorth() {
    const { map } = leafletRef.current;
    if (!map || gps.lat == null || gps.lon == null) return;
    setNavMode(false);
    map.flyTo([gps.lat, gps.lon], Math.max(map.getZoom(), 16), { duration: 0.45 });
  }

  function onTankClick() {
    if (clickTimer.current) {
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

  function startTrip() {
    setTripActive(true);
    setNavMode(true);
    setShowSearchBar(false);
    if (route) addHistory(route);
  }

  function stopTrip() {
    setTripActive(false);
    setNavMode(false);
    setShowSearchBar(true);
  }

  const fuelCalc = useMemo(() => {
    if (!route) return null;

    const cons = n(vehicle?.consumption);
    const price = n(vehicle?.fuelPrice);
    const distKm = route.distanceM / 1000;

    if (!cons || cons <= 0) {
      return { distKm, liters: null, cost: null, needsVehicle: true };
    }

    const liters = distKm / cons;

    if (!price || price <= 0) {
      return { distKm, liters, cost: null, needsVehicle: true };
    }

    const cost = liters * price;

    let otherCost = null;
    if (routeAlternatives.length > 1) {
      const other = routeAlternatives.find((r, idx) => idx !== activeRouteIndex);
      otherCost = other?.cost ?? null;
    }

    return {
      distKm,
      liters,
      cost,
      advantage: otherCost != null ? otherCost - cost : cost * 0.08,
      needsVehicle: false,
    };
  }, [route, vehicle?.consumption, vehicle?.fuelPrice, routeAlternatives, activeRouteIndex]);

  const percent = tank.capacityL > 0 ? clamp(tank.levelL / tank.capacityL, 0, 1) : 0;

  const activeStats = useMemo(() => {
    const current = routeAlternatives[activeRouteIndex];
    if (!current) return { tolls: 0, cameras: 0, fuel: 0 };
    return {
      tolls: current.tollCount || 0,
      cameras: current.cameraCount || 0,
      fuel: current.fuelCount || 0,
    };
  }, [routeAlternatives, activeRouteIndex]);

  return (
    <div style={styles.wrap}>
      {showSearchBar && (
        <div style={styles.topBar}>
          <form onSubmit={handleSearch} style={styles.searchForm}>
            <div style={styles.searchIcon}>{uiIcon("search", 18)}</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por CEP, endereço ou coordenada"
              style={styles.searchInput}
            />
            <button type="submit" style={styles.searchBtn}>
              {busy.route ? "..." : "Ir"}
            </button>
          </form>

          <div style={styles.infoPills}>
            <div style={styles.pill}>{uiIcon("camera", 14)}<span>{activeStats.cameras}</span></div>
            <div style={styles.pill}>{uiIcon("toll", 14)}<span>{activeStats.tolls}</span></div>
            <div style={styles.pill}>{uiIcon("fuel", 14)}<span>{activeStats.fuel}</span></div>
          </div>
        </div>
      )}

      <div ref={mapDivRef} style={styles.mapCanvas} />

      {!ready && (
        <div style={styles.loading}>
          <div style={styles.loadingCard}>
            <b>Carregando mapa</b>
            <div style={{ marginTop: 6, opacity: 0.75 }}>aguarde alguns segundos</div>
          </div>
        </div>
      )}

      <div style={styles.rightControls}>
        <button style={styles.ctrlBtn} onClick={zoomIn} title="Aproximar">
          {uiIcon("plus", 18)}
        </button>
        <button style={styles.ctrlBtn} onClick={zoomOut} title="Afastar">
          {uiIcon("minus", 18)}
        </button>
        <button style={styles.ctrlBtn} onClick={recenter} title="Centralizar">
          {uiIcon("locate", 18)}
        </button>
        <button style={styles.ctrlBtn} onClick={alignNorth} title="Norte">
          {uiIcon("compass", 18)}
        </button>
      </div>

      <div style={styles.poiControls}>
        <button
          style={{ ...styles.poiBtn, ...(poiVisible.camera ? styles.poiBtnActive : null) }}
          onClick={() => setPoiVisible((p) => ({ ...p, camera: !p.camera }))}
          title="Radares"
        >
          {uiIcon("camera", 16)}
        </button>
        <button
          style={{ ...styles.poiBtn, ...(poiVisible.toll ? styles.poiBtnActive : null) }}
          onClick={() => setPoiVisible((p) => ({ ...p, toll: !p.toll }))}
          title="Pedágios"
        >
          {uiIcon("toll", 16)}
        </button>
        <button
          style={{ ...styles.poiBtn, ...(poiVisible.fuel ? styles.poiBtnActive : null) }}
          onClick={() => setPoiVisible((p) => ({ ...p, fuel: !p.fuel }))}
          title="Postos"
        >
          {uiIcon("fuel", 16)}
        </button>
      </div>

      <div style={styles.tankWrap} onClick={onTankClick}>
        <div style={styles.tankLabelTop}>F</div>

        <div style={styles.dotsCol}>
          {Array.from({ length: 14 }).map((_, i) => {
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

      <AnimatePresence>
        {sheetOpen && route && (
          <motion.div
            initial={{ y: 260, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 260, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            style={styles.sheet}
          >
            <motion.div
              drag="y"
              dragConstraints={{ top: -140, bottom: 0 }}
              onDragEnd={(_, info) => {
                if (info.offset.y < -90) startTrip();
              }}
              style={styles.dragHandleWrap}
            >
              <div style={styles.sheetHandle} />
              <div style={styles.dragLabel}>
                {uiIcon("sheet", 14)}
                <span>Arraste para cima para iniciar</span>
              </div>
            </motion.div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={styles.sheetTitle}>Rota</div>
                <div style={styles.sheetSub}>
                  {route.to?.label ? truncate(route.to.label, 62) : "Destino"}
                </div>
              </div>

              <div style={styles.modeTabs}>
                {["eco", "balanced", "fast"].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setRouteMode(mode)}
                    style={{
                      ...styles.modeBtn,
                      ...(routeMode === mode ? styles.modeBtnActive : null),
                    }}
                  >
                    {mode === "eco" ? "Eco" : mode === "balanced" ? "Equil." : "Rápida"}
                  </button>
                ))}
              </div>
            </div>

            <div style={styles.metricsRow}>
              <div style={styles.metric}>
                <span style={styles.metricK}>DIST</span>
                <b style={styles.metricV}>{formatKm(route.distanceM)}</b>
              </div>
              <div style={styles.metric}>
                <span style={styles.metricK}>TEMPO</span>
                <b style={styles.metricV}>{formatMin(route.durationS)}</b>
              </div>
              <div style={styles.metricStrong}>
                <span style={styles.metricK}>LITROS</span>
                <b style={styles.metricBig}>
                  {fuelCalc?.liters != null ? fuelCalc.liters.toFixed(2) : "--"} L
                </b>
              </div>
            </div>

            <div style={styles.routeDetails}>
              <div style={styles.detailItem}>
                <div style={styles.detailLabel}>Radares</div>
                <div style={styles.detailValue}>{activeStats.cameras}</div>
              </div>
              <div style={styles.detailItem}>
                <div style={styles.detailLabel}>Pedágios</div>
                <div style={styles.detailValue}>{activeStats.tolls}</div>
              </div>
              <div style={styles.detailItem}>
                <div style={styles.detailLabel}>Postos</div>
                <div style={styles.detailValue}>{activeStats.fuel}</div>
              </div>
            </div>

            <div style={styles.moneyCard}>
              {fuelCalc?.needsVehicle ? (
                <div>
                  <b style={{ color: C.text }}>Cadastre consumo e preço</b>
                  <div style={{ marginTop: 4, fontSize: 12, color: C.sub }}>
                    Vá em <b>CarBase</b> para liberar custo e economia.
                  </div>
                </div>
              ) : (
                <div style={{ width: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 12, color: C.sub }}>Custo estimado</div>
                      <div style={{ fontSize: 18, fontWeight: 900 }}>
                        R$ {fuelCalc.cost.toFixed(2)}
                      </div>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, color: C.sub }}>Vantagem</div>
                      <div
                        style={{
                          fontSize: 18,
                          fontWeight: 900,
                          color: fuelCalc.advantage >= 0 ? C.success : C.danger,
                          animation: "ecoPulse 1.25s ease-in-out infinite",
                        }}
                      >
                        {fuelCalc.advantage >= 0 ? "+" : "-"} R$ {Math.abs(fuelCalc.advantage).toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      onClick={() => (tripActive ? stopTrip() : startTrip())}
                      style={{
                        ...styles.actionBtn,
                        background: tripActive ? C.dark : C.accent,
                      }}
                    >
                      {tripActive ? (
                        <>
                          <span style={{ display: "inline-flex", marginRight: 8 }}>{uiIcon("stop", 14)}</span>
                          Parar
                        </>
                      ) : (
                        <>
                          <span style={{ display: "inline-flex", marginRight: 8 }}>{uiIcon("start", 14)}</span>
                          Iniciar
                        </>
                      )}
                    </button>

                    <div style={{ fontSize: 12, color: C.sub }}>
                      Tanque: <b style={{ color: C.text }}>{tank.levelL.toFixed(1)}L</b> / {tank.capacityL.toFixed(0)}L
                    </div>
                  </div>

                  {fuelCalc?.liters != null && tank.levelL < fuelCalc.liters && (
                    <div style={styles.warningBox}>
                      Combustível insuficiente para essa rota.
                    </div>
                  )}
                </div>
              )}
            </div>

            {tripActive && (
              <div style={styles.navBanner}>
                <div style={styles.navBannerTitle}>Navegação ativa</div>
                <div style={styles.navBannerSub}>Câmera mais estável e contagem em tempo real.</div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const styles = {
  wrap: {
    position: "fixed",
    inset: 0,
    width: "100dvw",
    height: "100dvh",
    overflow: "hidden",
    background: C.bg,
    touchAction: "pan-x pan-y",
    WebkitOverflowScrolling: "touch",
  },

  mapCanvas: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
  },

  topBar: {
    position: "absolute",
    top: "max(12px, env(safe-area-inset-top))",
    left: "max(12px, env(safe-area-inset-left))",
    right: "max(12px, env(safe-area-inset-right))",
    zIndex: 9999,
    display: "grid",
    gap: 10,
  },

  searchForm: {
    display: "flex",
    alignItems: "center",
    background: "rgba(255,255,255,0.76)",
    border: "1px solid rgba(255,255,255,0.55)",
    borderRadius: 999,
    overflow: "hidden",
    backdropFilter: "blur(22px)",
    WebkitBackdropFilter: "blur(22px)",
    boxShadow: "0 12px 28px rgba(15,23,42,0.10)",
  },

  searchIcon: {
    display: "grid",
    placeItems: "center",
    width: 48,
    color: C.sub,
  },

  searchInput: {
    flex: 1,
    border: "none",
    outline: "none",
    padding: "13px 2px",
    fontSize: 16,
    background: "transparent",
    color: C.text,
    fontWeight: 800,
    minWidth: 0,
  },

  searchBtn: {
    border: "none",
    background: C.dark,
    color: "#fff",
    padding: "0 18px",
    height: 44,
    marginRight: 6,
    borderRadius: 999,
    cursor: "pointer",
    fontWeight: 900,
  },

  infoPills: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },

  pill: {
    height: 38,
    padding: "0 14px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.55)",
    background: "rgba(255,255,255,0.72)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    color: C.text,
    boxShadow: "0 12px 28px rgba(15,23,42,0.08)",
    fontWeight: 900,
    fontSize: 12,
  },

  loading: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    zIndex: 9998,
    pointerEvents: "none",
  },

  loadingCard: {
    background: C.cardStrong,
    border: `1px solid ${C.lineDark}`,
    borderRadius: 18,
    padding: "14px 16px",
    boxShadow: "0 10px 26px rgba(15,23,42,0.10)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
  },

  rightControls: {
    position: "absolute",
    right: "max(14px, env(safe-area-inset-right))",
    top: "max(120px, calc(env(safe-area-inset-top) + 108px))",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    zIndex: 9999,
  },

  ctrlBtn: {
    width: 54,
    height: 54,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.55)",
    background: "rgba(255,255,255,0.72)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    boxShadow: "0 14px 34px rgba(15,23,42,0.12)",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
  },

  poiControls: {
    position: "absolute",
    right: "max(14px, env(safe-area-inset-right))",
    top: "max(360px, calc(env(safe-area-inset-top) + 348px))",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    zIndex: 9999,
  },

  poiBtn: {
    width: 54,
    height: 54,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.55)",
    background: "rgba(255,255,255,0.70)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    boxShadow: "0 14px 34px rgba(15,23,42,0.10)",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
  },

  poiBtnActive: {
    background: "rgba(255,255,255,0.88)",
    boxShadow: "0 14px 34px rgba(0,122,255,0.14)",
  },

  tankWrap: {
    position: "absolute",
    left: 12,
    top: "34%",
    transform: "translateY(-50%)",
    zIndex: 9999,
    width: 34,
    padding: "8px 6px",
    borderRadius: 16,
    background: C.cardStrong,
    border: `1px solid ${C.lineDark}`,
    boxShadow: "0 10px 26px rgba(15,23,42,0.12)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 7,
    cursor: "pointer",
    userSelect: "none",
  },

  tankLabelTop: { fontSize: 9, fontWeight: 900, color: C.text, opacity: 0.7 },
  tankLabelBottom: { fontSize: 9, fontWeight: 900, color: C.text, opacity: 0.7 },

  dotsCol: { display: "flex", flexDirection: "column", gap: 4 },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: C.success,
  },

  litersToast: {
    position: "absolute",
    left: 42,
    top: "50%",
    transform: "translateY(-50%)",
    background: "rgba(15,23,42,0.94)",
    color: "#fff",
    borderRadius: 14,
    padding: "10px 12px",
    boxShadow: "0 10px 26px rgba(15,23,42,0.25)",
    minWidth: 90,
    textAlign: "center",
  },

  sheet: {
    position: "absolute",
    left: "max(12px, env(safe-area-inset-left))",
    right: "max(12px, env(safe-area-inset-right))",
    bottom: "max(84px, calc(env(safe-area-inset-bottom) + 72px))",
    zIndex: 9999,
    borderRadius: 24,
    padding: 14,
    background: "rgba(255,255,255,0.86)",
    border: "1px solid rgba(255,255,255,0.55)",
    boxShadow: "0 18px 50px rgba(15,23,42,0.16)",
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
  },

  dragHandleWrap: {
    marginBottom: 10,
    cursor: "grab",
  },

  sheetHandle: {
    width: 52,
    height: 5,
    borderRadius: 999,
    background: "rgba(15,23,42,0.14)",
    margin: "0 auto 8px",
  },

  dragLabel: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontSize: 12,
    color: C.sub,
    fontWeight: 800,
  },

  sheetTitle: { fontSize: 12, fontWeight: 900, letterSpacing: 0.5, color: C.sub },
  sheetSub: { fontSize: 14, fontWeight: 900, color: C.text, marginTop: 2 },

  modeTabs: { display: "flex", gap: 6, flexShrink: 0 },

  modeBtn: {
    height: 32,
    padding: "0 10px",
    borderRadius: 12,
    border: `1px solid ${C.lineDark}`,
    background: "rgba(255,255,255,0.58)",
    color: C.sub,
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 12,
  },

  modeBtnActive: {
    background: C.text,
    color: "#fff",
  },

  metricsRow: {
    marginTop: 10,
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1.25fr",
    gap: 10,
  },

  metric: {
    borderRadius: 16,
    padding: 10,
    background: "rgba(248,250,252,0.88)",
    border: "1px solid rgba(15,23,42,0.06)",
  },

  metricStrong: {
    borderRadius: 16,
    padding: 10,
    background: "rgba(0,122,255,0.10)",
    border: "1px solid rgba(0,122,255,0.16)",
  },

  metricK: { fontSize: 10, fontWeight: 900, color: C.sub, letterSpacing: 0.7 },
  metricV: { display: "block", marginTop: 4, fontSize: 14, fontWeight: 900, color: C.text },
  metricBig: { display: "block", marginTop: 2, fontSize: 18, fontWeight: 1000, color: C.accent },

  routeDetails: {
    marginTop: 10,
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 10,
  },

  detailItem: {
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.06)",
    background: "rgba(248,250,252,0.86)",
    padding: "10px 12px",
  },

  detailLabel: { fontSize: 11, color: C.sub, fontWeight: 800 },
  detailValue: { marginTop: 4, fontSize: 14, color: C.text, fontWeight: 1000 },

  moneyCard: {
    marginTop: 10,
    borderRadius: 18,
    padding: 12,
    background: "rgba(255,255,255,0.82)",
    border: "1px solid rgba(15,23,42,0.06)",
  },

  actionBtn: {
    padding: "10px 12px",
    borderRadius: 14,
    border: "none",
    color: "#fff",
    fontWeight: 1000,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
  },

  warningBox: {
    marginTop: 10,
    padding: "8px 10px",
    borderRadius: 12,
    background: "rgba(239,68,68,.12)",
    color: "#991b1b",
    fontWeight: 800,
  },

  navBanner: {
    marginTop: 10,
    borderRadius: 16,
    padding: 12,
    background: "rgba(0,122,255,0.08)",
    border: "1px solid rgba(0,122,255,0.14)",
  },

  navBannerTitle: { fontSize: 13, color: C.text, fontWeight: 1000 },
  navBannerSub: { marginTop: 4, fontSize: 12, color: C.sub, fontWeight: 700 },
};
