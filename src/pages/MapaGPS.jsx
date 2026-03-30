import React, { useEffect, useRef, useState } from "react";

const DEFAULT_CENTER = { lat: -23.5505, lon: -46.6333 };

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
      const timer = setInterval(() => {
        if (window.L) {
          clearInterval(timer);
          resolve(window.L);
        }
      }, 50);

      setTimeout(() => {
        clearInterval(timer);
        reject(new Error("Leaflet demorou para carregar."));
      }, 8000);

      return;
    }

    const script = document.createElement("script");
    script.id = jsId;
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("Falha ao carregar Leaflet."));
    document.body.appendChild(script);
  });
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

async function geocodeOne(query) {
  const coords = parseCoordinates(query);
  if (coords) return coords;

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

export default function MapaGPS() {
  const mapRef = useRef(null);
  const leafletRef = useRef({
    L: null,
    map: null,
    userMarker: null,
    destMarker: null,
    routeLayer: null,
    watchId: null,
  });

  const [search, setSearch] = useState("");
  const [gps, setGps] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let resizeHandler = null;

    (async () => {
      try {
        const L = await loadLeaflet();
        if (!mounted) return;

        leafletRef.current.L = L;

        const map = L.map(mapRef.current, {
          zoomControl: true,
          attributionControl: false,
          preferCanvas: true,
        }).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lon], 14);

        L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
          maxZoom: 20,
        }).addTo(map);

        const userIcon = L.divIcon({
          className: "user-dot",
          html: `
            <div style="
              width:18px;
              height:18px;
              border-radius:999px;
              background:#0A84FF;
              border:4px solid #fff;
              box-shadow:0 8px 18px rgba(0,0,0,.18);
            "></div>
          `,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });

        const userMarker = L.marker([DEFAULT_CENTER.lat, DEFAULT_CENTER.lon], {
          icon: userIcon,
        }).addTo(map);

        leafletRef.current.map = map;
        leafletRef.current.userMarker = userMarker;

        resizeHandler = () => {
          setTimeout(() => {
            map.invalidateSize();
          }, 120);
        };

        window.addEventListener("resize", resizeHandler);
        window.addEventListener("orientationchange", resizeHandler);

        setLoading(false);
      } catch (err) {
        console.error(err);
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;

      if (resizeHandler) {
        window.removeEventListener("resize", resizeHandler);
        window.removeEventListener("orientationchange", resizeHandler);
      }

      const { map, watchId } = leafletRef.current;

      if (watchId != null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchId);
      }

      if (map) {
        map.off();
        map.remove();
      }
    };
  }, []);

  useEffect(() => {
    const { map, userMarker } = leafletRef.current;
    if (!map || !userMarker) return;
    if (!("geolocation" in navigator)) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;

        setGps({ lat, lon });

        userMarker.setLatLng([lat, lon]);
        map.setView([lat, lon], Math.max(map.getZoom(), 16), { animate: true });
      },
      (err) => {
        console.error("Erro GPS:", err);
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 1000,
      }
    );

    leafletRef.current.watchId = watchId;

    return () => {
      if (watchId != null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, []);

  async function handleSearch(e) {
    e.preventDefault();

    const query = search.trim();
    if (!query || !gps) return;

    const { L, map } = leafletRef.current;
    if (!L || !map) return;

    const found = await geocodeOne(query);
    if (!found) return;

    if (leafletRef.current.destMarker) {
      map.removeLayer(leafletRef.current.destMarker);
      leafletRef.current.destMarker = null;
    }

    if (leafletRef.current.routeLayer) {
      map.removeLayer(leafletRef.current.routeLayer);
      leafletRef.current.routeLayer = null;
    }

    const destIcon = L.divIcon({
      className: "dest-dot",
      html: `
        <div style="
          width:18px;
          height:18px;
          border-radius:999px;
          background:#111827;
          border:4px solid #fff;
          box-shadow:0 8px 18px rgba(0,0,0,.18);
        "></div>
      `,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });

    const destMarker = L.marker([found.lat, found.lon], { icon: destIcon }).addTo(map);
    leafletRef.current.destMarker = destMarker;

    const url = `https://router.project-osrm.org/route/v1/driving/${gps.lon},${gps.lat};${found.lon},${found.lat}?overview=full&geometries=geojson`;

    const res = await fetch(url);
    const data = await res.json();
    const route = data?.routes?.[0];

    if (!route?.geometry?.coordinates?.length) return;

    const latLngs = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);

    const routeLayer = L.polyline(latLngs, {
      color: "#0A84FF",
      weight: 7,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(map);

    leafletRef.current.routeLayer = routeLayer;
    map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
  }

  return (
    <div style={styles.page}>
      <form onSubmit={handleSearch} style={styles.searchWrap}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Digite endereço, CEP ou coordenada"
          style={styles.input}
        />
        <button type="submit" style={styles.button}>
          Ir
        </button>
      </form>

      <div ref={mapRef} style={styles.map} />

      {loading && (
        <div style={styles.loadingBox}>
          Carregando mapa...
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    position: "fixed",
    inset: 0,
    width: "100dvw",
    height: "100dvh",
    background: "#E8EDF5",
    overflow: "hidden",
  },

  searchWrap: {
    position: "absolute",
    top: "max(12px, env(safe-area-inset-top))",
    left: "max(12px, env(safe-area-inset-left))",
    right: "max(12px, env(safe-area-inset-right))",
    zIndex: 9999,
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 10,
  },

  input: {
    height: 52,
    border: "1px solid rgba(255,255,255,0.58)",
    borderRadius: 999,
    padding: "0 16px",
    outline: "none",
    background: "rgba(255,255,255,0.88)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    color: "#0F172A",
    fontSize: 16,
    fontWeight: 700,
    boxShadow: "0 10px 24px rgba(15,23,42,0.10)",
  },

  button: {
    height: 52,
    padding: "0 18px",
    border: "none",
    borderRadius: 999,
    background: "#0F172A",
    color: "#fff",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
  },

  map: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
  },

  loadingBox: {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: 9999,
    background: "rgba(255,255,255,0.90)",
    border: "1px solid rgba(15,23,42,0.10)",
    borderRadius: 16,
    padding: "12px 16px",
    color: "#0F172A",
    fontWeight: 700,
    boxShadow: "0 10px 24px rgba(15,23,42,0.10)",
  },
};
