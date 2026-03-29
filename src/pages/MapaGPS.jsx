import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useEco } from "../context/EcoContext";

const DEFAULT_CENTER = { lat: -23.5505, lon: -46.6333 };
const TANK_KEY = "@EcoRoute:Tank:v1";
const ROUTE_MODE_KEY = "@EcoRoute:RouteMode:v1";
const VISITED_KEY = "@EcoRoute:VisitedRoads:v1";

const C = {
  bg: "#E8EDF5",
  glass: "rgba(255,255,255,0.78)",
  glassStrong: "rgba(255,255,255,0.90)",
  line: "rgba(255,255,255,0.58)",
  lineDark: "rgba(15,23,42,0.10)",
  text: "#0F172A",
  sub: "#64748B",
  accent: "#0A84FF",
  accentSoft: "rgba(10,132,255,0.12)",
  success: "#16A34A",
  danger: "#EF4444",
  dark: "#0F172A",
  route: "#0A84FF",
  routeAlt: "rgba(15,23,42,0.28)",
  roadVisited: "#F8FAFC",
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
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const λ1 = (lon1 * Math.PI) / 180;
  const λ2 = (lon2 * Math.PI) / 180;
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
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
    const url = `https://api.opentopodata.org/v1/srtm90m?locations=${encodeURIComponent(
      locations
    )}`;

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
      if (
        distancePointToSegmentMeters({ lat: poi.lat, lon: poi.lon }, a, b) <=
        thresholdMeters
      ) {
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

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    q
  )}`;
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

  if (type === "search")
    return `<svg ${common}><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>`;
  if (type === "locate")
    return `<svg ${common}><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3"></path><path d="M12 19v3"></path><path d="M2 12h3"></path><path d="M19 12h3"></path></svg>`;
  if (type === "plus")
    return `<svg ${common}><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>`;
  if (type === "minus")
    return `<svg ${common}><path d="M5 12h14"></path></svg>`;
  if (type === "compass")
    return `<svg ${common}><circle cx="12" cy="12" r="9"></circle><path d="m15.5 8.5-2.4 6.4-4.6 1.6 2.4-6.4 4.6-1.6Z"></path></svg>`;
  if (type === "camera")
    return `<svg ${common}><rect x="4" y="7" width="16" height="12" rx="2"></rect><path d="M9 7 10.5 5h3L15 7"></path><circle cx="12" cy="13" r="3"></circle></svg>`;
  if (type === "toll")
    return `<svg ${common}><path d="M4 20V10l4-4 4 4v10"></path><path d="M12 20V8l4-4 4 4v12"></path></svg>`;
  if (type === "fuel")
    return `<svg ${common}><path d="M8 20h8"></path><path d="M9 20V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14"></path><path d="M15 8h2.5a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 0 1.5 1.5H21"></path></svg>`;
  if (type === "start")
    return `<svg ${common}><path d="M8 5l10 7-10 7V5Z"></path></svg>`;
  if (type === "stop")
    return `<svg ${common}><rect x="7" y="7" width="10" height="10" rx="1"></rect></svg>`;
  if (type === "sheet")
    return `<svg ${common}><path d="M12 3v18"></path><path d="m6 9 6-6 6 6"></path></svg>`;
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
    userHeadingMarker: null,
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
  const clickTimer = useRef(null);

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
        color: C.roadVisited,
        weight: 5,
        opacity: 0.94,
        lineCap: "round",
        lineJoin: "round",
      }
    ).addTo(map);

    leafletRef.current.passedLayer = layer;
  }

  function renderUserMarker(L, heading = 0) {
    return L.divIcon({
      className: "eco-user-heading",
      html: `
        <div style="position:relative;width:44px;height:44px;display:grid;place-items:center;">
          <div style="
            position:absolute;
            top:4px;
            width:0;height:0;
            border-left:7px solid transparent;
            border-right:7px solid transparent;
            border-bottom:14px solid ${C.accent};
            transform: rotate(${heading}deg);
            transform-origin: center 18px;
            filter: drop-shadow(0 8px 10px rgba(10,132,255,.25));
          "></div>
          <div style="
            width:18px;height:18px;border-radius:999px;
            background:${C.accent};
            border:4px solid #fff;
            box-shadow:0 14px 28px rgba(15,23,42,.18);
            position:absolute;
            z-index:2;
          "></div>
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });
  }

  function updateThirdPersonCamera(pos) {
    const { map } = leafletRef.current;
    if (!map || !navMode) return;

    const latlng = [pos.lat, pos.lon];
    const p = map.project(latlng, map.getZoom());

    const centerPoint = { x: p.x, y: p.y + 170 };
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

        const userMarker = L.marker(
          [DEFAULT_CENTER.lat, DEFAULT_CENTER.lon],
          { icon: renderUserMarker(L, 0) }
        ).addTo(map);

        map.on("click", (e) => {
          const { lat, lng } = e.latlng;
          setDestination({ lat, lon: lng, label: "Destino selecionado no mapa" });
        });

        leafletRef.current.map = map;
        leafletRef.current.userMarker = userMarker;

        setTimeout(() => map.invalidateSize(), 250);

        resizeMap = () => {
          setTimeout(() => map.invalidateSize(), 120);
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
              userMarker.setIcon(renderUserMarker(L, computedHeading));

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

      if (watchId != null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchId);
      }

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
      html: `<div style="width:20px;height:20px;border-radius:999px;background:#111827;border:4px solid #fff;box-shadow:0 14px 28px rgba(15,23,42,.18)"></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
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

      alternatives = alternatives.map((alt, i) => ({
        ...alt,
        ascentM: ascentResults[i],
      }));
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
      if (routeMode === "balanced") {
        score = liters * 0.75 + ascentPenalty + tollPenalty * 0.5 + timeH * 0.25;
      }

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
      color: C.route,
      weight: 8,
      opacity: 0.98,
      lineCap: "round",
      lineJoin: "round",
      dashArray: "12 10",
    }).addTo(map);

    leafletRef.current.routeLayer = mainLine;

    if (alternatives.length > 1) {
      const altIdx = bestIdx === 0 ? 1 : 0;
      const alt = alternatives[altIdx];
      const altLatLngs = alt.routeCoords.map(([lon, lat]) => [lat, lon]);

      const altLine = L.polyline(altLatLngs, {
        color: "#111827",
        weight: 5,
        opacity: 0.26,
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
        <div style={styles.topShell}>
          <div style={styles.searchRow}>
            <form onSubmit={handleSearch} style={styles.searchForm}>
              <div style={styles.searchIcon}>{uiIcon("search", 18)}</div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Para onde você quer ir?"
                style={styles.searchInput}
              />
            </form>

            <button type="button" onClick={handleSearch} style={styles.goButton}>
              Ir
            </button>
          </div>

          <div style={styles.chipsRow}>
            <div style={styles.chip}>
              {uiIcon("camera", 14)}
              <span>{activeStats.cameras}</span>
            </div>
            <div style={styles.chip}>
              {uiIcon("toll", 14)}
              <span>{activeStats.tolls}</span>
            </div>
            <div style={styles.chip}>
              {uiIcon("fuel", 14)}
              <span>{activeStats.fuel}</span>
            </div>
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

      {!tripActive && (
        <div style={styles.sideLeft}>
          <button type="button" style={styles.sideBubble} onClick={onTankClick}>
            <div style={styles.tankTitle}>F</div>
            <div style={styles.tankDots}>
              {Array.from({ length: 12 }).map((_, i) => {
                const levelIndex = 11 - i;
                const filledDots = Math.round(percent * 12);
                const filled = levelIndex < filledDots;

                return (
                  <div
                    key={i}
                    style={{
                      ...styles.tankDot,
                      opacity: filled ? 1 : 0.18,
                    }}
                  />
                );
              })}
            </div>
            <div style={styles.tankTitle}>E</div>
          </button>

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
      )}

      <div style={styles.sideRightTop}>
        <button type="button" style={styles.fab} onClick={zoomIn}>
          {uiIcon("plus", 18)}
        </button>
        <button type="button" style={styles.fab} onClick={zoomOut}>
          {uiIcon("minus", 18)}
        </button>
      </div>

      <div style={styles.sideRightMid}>
        <button type="button" style={styles.fab} onClick={recenter}>
          {uiIcon("locate", 18)}
        </button>
        <button type="button" style={styles.fab} onClick={alignNorth}>
          {uiIcon("compass", 18)}
        </button>
      </div>

      <div style={styles.sideRightBottom}>
        <button
          type="button"
          style={{ ...styles.fabSmall, ...(poiVisible.camera ? styles.fabActive : null) }}
          onClick={() => setPoiVisible((p) => ({ ...p, camera: !p.camera }))}
        >
          {uiIcon("camera", 15)}
        </button>
        <button
          type="button"
          style={{ ...styles.fabSmall, ...(poiVisible.toll ? styles.fabActive : null) }}
          onClick={() => setPoiVisible((p) => ({ ...p, toll: !p.toll }))}
        >
          {uiIcon("toll", 15)}
        </button>
        <button
          type="button"
          style={{ ...styles.fabSmall, ...(poiVisible.fuel ? styles.fabActive : null) }}
          onClick={() => setPoiVisible((p) => ({ ...p, fuel: !p.fuel }))}
        >
          {uiIcon("fuel", 15)}
        </button>
      </div>

      <AnimatePresence>
        {sheetOpen && route && (
          <motion.div
            initial={{ y: 280, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 280, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            style={styles.sheet}
          >
            {!tripActive && (
              <motion.div
                drag="y"
                dragConstraints={{ top: -140, bottom: 0 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y < -90) startTrip();
                }}
                style={styles.dragZone}
              >
                <div style={styles.sheetHandle} />
                <div style={styles.dragLabel}>
                  {uiIcon("sheet", 14)}
                  <span>Arraste para cima para iniciar</span>
                </div>
              </motion.div>
            )}

            <div style={styles.sheetHeader}>
              <div style={{ minWidth: 0 }}>
                <div style={styles.sheetTitle}>Destino</div>
                <div style={styles.sheetSubtitle}>
                  {route.to?.label ? truncate(route.to.label, 68) : "Destino"}
                </div>
              </div>

              <div style={styles.modeTabs}>
                {["eco", "balanced", "fast"].map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setRouteMode(mode)}
                    style={{
                      ...styles.modeBtn,
                      ...(routeMode === mode ? styles.modeBtnActive : null),
                    }}
                  >
                    {mode === "eco" ? "Eco" : mode === "balanced" ? "Balanced" : "Fast"}
                  </button>
                ))}
              </div>
            </div>

            <div style={styles.mainInfoRow}>
              <div style={styles.mainInfoCard}>
                <div style={styles.mainInfoLabel}>Distância</div>
                <div style={styles.mainInfoValue}>{formatKm(route.distanceM)}</div>
              </div>

              <div style={styles.mainInfoCard}>
                <div style={styles.mainInfoLabel}>Tempo</div>
                <div style={styles.mainInfoValue}>{formatMin(route.durationS)}</div>
              </div>

              <div style={styles.mainInfoCardStrong}>
                <div style={styles.mainInfoLabel}>Combustível</div>
                <div style={styles.mainInfoValueStrong}>
                  {fuelCalc?.liters != null ? `${fuelCalc.liters.toFixed(2)} L` : "--"}
                </div>
              </div>
            </div>

            <div style={styles.secondaryInfoRow}>
              <div style={styles.secondaryCard}>
                <div style={styles.secondaryLabel}>Radares</div>
                <div style={styles.secondaryValue}>{activeStats.cameras}</div>
              </div>
              <div style={styles.secondaryCard}>
                <div style={styles.secondaryLabel}>Pedágios</div>
                <div style={styles.secondaryValue}>{activeStats.tolls}</div>
              </div>
              <div style={styles.secondaryCard}>
                <div style={styles.secondaryLabel}>Postos</div>
                <div style={styles.secondaryValue}>{activeStats.fuel}</div>
              </div>
            </div>

            <div style={styles.costBlock}>
              {fuelCalc?.needsVehicle ? (
                <div>
                  <b style={{ color: C.text }}>Cadastre consumo e preço</b>
                  <div style={{ marginTop: 4, fontSize: 12, color: C.sub }}>
                    Vá em <b>CarBase</b> para liberar custo e economia.
                  </div>
                </div>
              ) : (
                <>
                  <div style={styles.costHeader}>
                    <div>
                      <div style={styles.costLabel}>Custo estimado</div>
                      <div style={styles.costValue}>R$ {fuelCalc.cost.toFixed(2)}</div>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <div style={styles.costLabel}>Vantagem</div>
                      <div
                        style={{
                          ...styles.costAdvantage,
                          color: fuelCalc.advantage >= 0 ? C.success : C.danger,
                        }}
                      >
                        {fuelCalc.advantage >= 0 ? "+" : "-"} R$ {Math.abs(fuelCalc.advantage).toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div style={styles.actionRow}>
                    <button
                      type="button"
                      onClick={() => (tripActive ? stopTrip() : startTrip())}
                      style={{
                        ...styles.primaryAction,
                        background: tripActive ? C.dark : C.accent,
                      }}
                    >
                      <span style={{ display: "inline-flex", marginRight: 8 }}>
                        {uiIcon(tripActive ? "stop" : "start", 14)}
                      </span>
                      {tripActive ? "Parar rota" : "Iniciar rota"}
                    </button>

                    <div style={styles.tankMeta}>
                      <b>{tank.levelL.toFixed(1)}L</b> / {tank.capacityL.toFixed(0)}L
                    </div>
                  </div>

                  {fuelCalc?.liters != null && tank.levelL < fuelCalc.liters && (
                    <div style={styles.warningBox}>Combustível insuficiente para essa rota.</div>
                  )}
                </>
              )}
            </div>

            {tripActive && (
              <div style={styles.tripBanner}>
                <div style={styles.tripBannerTitle}>Navegação ativa</div>
                <div style={styles.tripBannerSub}>
                  Visão avançada, rota em destaque e consumo em tempo real.
                </div>
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

  topShell: {
    position: "absolute",
    top: "max(12px, env(safe-area-inset-top))",
    left: "max(12px, env(safe-area-inset-left))",
    right: "max(12px, env(safe-area-inset-right))",
    zIndex: 9999,
    display: "grid",
    gap: 10,
  },

  searchRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 10,
    alignItems: "center",
  },

  searchForm: {
    display: "flex",
    alignItems: "center",
    background: C.glass,
    border: `1px solid ${C.line}`,
    borderRadius: 999,
    overflow: "hidden",
    backdropFilter: "blur(22px)",
    WebkitBackdropFilter: "blur(22px)",
    boxShadow: "0 12px 28px rgba(15,23,42,0.10)",
    minHeight: 52,
  },

  searchIcon: {
    width: 48,
    display: "grid",
    placeItems: "center",
    color: C.sub,
    flexShrink: 0,
  },

  searchInput: {
    flex: 1,
    border: "none",
    outline: "none",
    background: "transparent",
    color: C.text,
    fontSize: 16,
    fontWeight: 800,
    minWidth: 0,
    paddingRight: 12,
  },

  goButton: {
    height: 52,
    padding: "0 18px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.58)",
    background: C.glassStrong,
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    color: C.text,
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 12px 28px rgba(15,23,42,0.10)",
  },

  chipsRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },

  chip: {
    height: 38,
    padding: "0 14px",
    borderRadius: 999,
    border: `1px solid ${C.line}`,
    background: C.glass,
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
    background: C.glassStrong,
    border: `1px solid ${C.lineDark}`,
    borderRadius: 18,
    padding: "14px 16px",
    boxShadow: "0 10px 26px rgba(15,23,42,0.10)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
  },

  sideLeft: {
    position: "absolute",
    left: "max(12px, env(safe-area-inset-left))",
    top: "33%",
    transform: "translateY(-50%)",
    zIndex: 9999,
  },

  sideBubble: {
    width: 36,
    padding: "8px 6px",
    borderRadius: 18,
    border: `1px solid ${C.line}`,
    background: C.glass,
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    boxShadow: "0 14px 34px rgba(15,23,42,0.12)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 7,
    cursor: "pointer",
  },

  tankTitle: {
    fontSize: 9,
    fontWeight: 900,
    color: C.text,
    opacity: 0.72,
  },

  tankDots: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },

  tankDot: {
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

  sideRightTop: {
    position: "absolute",
    right: "max(14px, env(safe-area-inset-right))",
    top: "max(124px, calc(env(safe-area-inset-top) + 112px))",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    zIndex: 9999,
  },

  sideRightMid: {
    position: "absolute",
    right: "max(14px, env(safe-area-inset-right))",
    top: "max(252px, calc(env(safe-area-inset-top) + 240px))",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    zIndex: 9999,
  },

  sideRightBottom: {
    position: "absolute",
    right: "max(14px, env(safe-area-inset-right))",
    top: "max(382px, calc(env(safe-area-inset-top) + 370px))",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    zIndex: 9999,
  },

  fab: {
    width: 56,
    height: 56,
    borderRadius: 999,
    border: `1px solid ${C.line}`,
    background: C.glass,
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    boxShadow: "0 14px 34px rgba(15,23,42,0.12)",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
  },

  fabSmall: {
    width: 52,
    height: 52,
    borderRadius: 999,
    border: `1px solid ${C.line}`,
    background: C.glass,
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    boxShadow: "0 14px 34px rgba(15,23,42,0.10)",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
  },

  fabActive: {
    background: C.glassStrong,
    boxShadow: "0 14px 34px rgba(10,132,255,0.14)",
  },

  sheet: {
    position: "absolute",
    left: "max(12px, env(safe-area-inset-left))",
    right: "max(12px, env(safe-area-inset-right))",
    bottom: "max(34px, calc(env(safe-area-inset-bottom) + 18px))",
    zIndex: 9999,
    borderRadius: 26,
    padding: 14,
    background: "rgba(255,255,255,0.86)",
    border: `1px solid ${C.line}`,
    boxShadow: "0 18px 50px rgba(15,23,42,0.16)",
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
  },

  dragZone: {
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

  sheetHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
  },

  sheetTitle: {
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: 0.5,
    color: C.sub,
  },

  sheetSubtitle: {
    fontSize: 15,
    fontWeight: 900,
    color: C.text,
    marginTop: 2,
  },

  modeTabs: {
    display: "flex",
    gap: 6,
    flexShrink: 0,
  },

  modeBtn: {
    height: 34,
    padding: "0 12px",
    borderRadius: 999,
    border: `1px solid ${C.lineDark}`,
    background: "rgba(255,255,255,0.60)",
    color: C.sub,
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 12,
  },

  modeBtnActive: {
    background: C.dark,
    color: "#fff",
  },

  mainInfoRow: {
    marginTop: 12,
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1.3fr",
    gap: 10,
  },

  mainInfoCard: {
    borderRadius: 18,
    padding: 12,
    background: "rgba(248,250,252,0.88)",
    border: "1px solid rgba(15,23,42,0.06)",
  },

  mainInfoCardStrong: {
    borderRadius: 18,
    padding: 12,
    background: C.accentSoft,
    border: "1px solid rgba(10,132,255,0.16)",
  },

  mainInfoLabel: {
    fontSize: 10,
    fontWeight: 900,
    color: C.sub,
    letterSpacing: 0.7,
  },

  mainInfoValue: {
    marginTop: 4,
    fontSize: 15,
    fontWeight: 900,
    color: C.text,
  },

  mainInfoValueStrong: {
    marginTop: 4,
    fontSize: 18,
    fontWeight: 1000,
    color: C.accent,
  },

  secondaryInfoRow: {
    marginTop: 10,
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 10,
  },

  secondaryCard: {
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.06)",
    background: "rgba(248,250,252,0.86)",
    padding: "10px 12px",
  },

  secondaryLabel: {
    fontSize: 11,
    color: C.sub,
    fontWeight: 800,
  },

  secondaryValue: {
    marginTop: 4,
    fontSize: 14,
    color: C.text,
    fontWeight: 1000,
  },

  costBlock: {
    marginTop: 10,
    borderRadius: 18,
    padding: 12,
    background: "rgba(255,255,255,0.82)",
    border: "1px solid rgba(15,23,42,0.06)",
  },

  costHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
  },

  costLabel: {
    fontSize: 12,
    color: C.sub,
  },

  costValue: {
    fontSize: 20,
    fontWeight: 1000,
    color: C.text,
    marginTop: 2,
  },

  costAdvantage: {
    fontSize: 18,
    fontWeight: 1000,
    marginTop: 2,
    animation: "ecoPulse 1.25s ease-in-out infinite",
  },

  actionRow: {
    marginTop: 12,
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  },

  primaryAction: {
    padding: "11px 14px",
    borderRadius: 16,
    border: "none",
    color: "#fff",
    fontWeight: 1000,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
  },

  tankMeta: {
    fontSize: 12,
    color: C.sub,
  },

  warningBox: {
    marginTop: 10,
    padding: "8px 10px",
    borderRadius: 12,
    background: "rgba(239,68,68,.12)",
    color: "#991b1b",
    fontWeight: 800,
  },

  tripBanner: {
    marginTop: 10,
    borderRadius: 16,
    padding: 12,
    background: "rgba(10,132,255,0.08)",
    border: "1px solid rgba(10,132,255,0.14)",
  },

  tripBannerTitle: {
    fontSize: 13,
    color: C.text,
    fontWeight: 1000,
  },

  tripBannerSub: {
    marginTop: 4,
    fontSize: 12,
    color: C.sub,
    fontWeight: 700,
  },
};
