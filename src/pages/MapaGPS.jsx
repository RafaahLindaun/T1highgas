import React, { useEffect, useMemo, useRef, useState } from "react";

const C = {
  bg: "#F2F2F7",
  surface: "#FFFFFF",
  line: "rgba(60,60,67,0.18)",
  text: "#111111",
  sub: "rgba(60,60,67,0.72)",
  sub2: "rgba(60,60,67,0.55)",
  accent: "#007AFF",
  danger: "#FF3B30",
  shadow: "rgba(0,0,0,0.08)",
};

const loadLeaflet = () => {
  if (window.L) return Promise.resolve(window.L);

  return new Promise((resolve, reject) => {
    const existingCss = document.querySelector('link[data-leaflet="true"]');
    const existingJs = document.querySelector('script[data-leaflet="true"]');

    if (!existingCss) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      link.setAttribute("data-leaflet", "true");
      document.head.appendChild(link);
    }

    if (existingJs && window.L) {
      resolve(window.L);
      return;
    }

    if (!existingJs) {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.async = true;
      script.setAttribute("data-leaflet", "true");
      script.onload = () => resolve(window.L);
      script.onerror = reject;
      document.head.appendChild(script);
      return;
    }

    existingJs.addEventListener("load", () => resolve(window.L));
    existingJs.addEventListener("error", reject);
  });
};

function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function SearchIcon({ size = 18, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 21L16.65 16.65M19 11C19 15.4183 15.4183 19 11 19C6.58172 19 3 15.4183 3 11C3 6.58172 6.58172 3 11 3C15.4183 3 19 6.58172 19 11Z"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 21C12 21 5 14.5 5 10A7 7 0 1 1 19 10C19 14.5 12 21 12 21Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.9" />
    </svg>
  );
}

function formatMoneyBRL(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));
}

function fitMapToRoutes(map, L, routes) {
  const bounds = L.latLngBounds([]);

  routes.forEach((route) => {
    (route.polylineCoords || []).forEach((point) => bounds.extend(point));
  });

  if (bounds.isValid()) {
    map.fitBounds(bounds, {
      paddingTopLeft: [20, 210],
      paddingBottomRight: [20, 110],
    });
  }
}

export default function MapaGPS() {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const userMarkerRef = useRef(null);
  const destinationMarkerRef = useRef(null);
  const routeLayersRef = useRef([]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const [currentLocation, setCurrentLocation] = useState(null);
  const [selectedPlace, setSelectedPlace] = useState(null);

  const [routes, setRoutes] = useState([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [loadingRoutes, setLoadingRoutes] = useState(false);

  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    loadLeaflet()
      .then((L) => {
        if (cancelled || !mapRef.current || mapInstanceRef.current) return;

        const defaultCenter = [-23.55052, -46.633308];

        const map = L.map(mapRef.current, {
          zoomControl: false,
          preferCanvas: true,
          attributionControl: false,
          tap: false,
        }).setView(defaultCenter, 13);

        L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
          maxZoom: 20,
        }).addTo(map);

        mapInstanceRef.current = map;

        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              if (cancelled || !mapInstanceRef.current) return;

              const coords = {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
              };

              setCurrentLocation(coords);
              setStatusText("Localização atual encontrada");

              map.setView([coords.lat, coords.lng], 16);

              if (userMarkerRef.current) {
                userMarkerRef.current.remove();
              }

              userMarkerRef.current = L.circleMarker([coords.lat, coords.lng], {
                radius: 8,
                fillColor: C.accent,
                fillOpacity: 1,
                color: "#FFFFFF",
                weight: 3,
              }).addTo(map);
            },
            () => {
              setStatusText("Usando mapa padrão");
            },
            {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 5000,
            }
          );
        }
      })
      .catch(() => {
        setError("Não foi possível carregar o mapa.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const requestSuggestions = useMemo(
    () =>
      debounce(async (text) => {
        const clean = text.trim();

        if (!clean) {
          setSuggestions([]);
          setLoadingSuggestions(false);
          return;
        }

        try {
          setError("");
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&countrycodes=br&q=${encodeURIComponent(clean)}`,
            { headers: { Accept: "application/json" } }
          );

          if (!response.ok) throw new Error("Falha ao buscar endereço.");

          const data = await response.json();
          const parsed = Array.isArray(data)
            ? data.map((item) => ({
                id: item.place_id,
                label: item.display_name,
                lat: Number(item.lat),
                lon: Number(item.lon),
              }))
            : [];

          setSuggestions(parsed);
        } catch (err) {
          setSuggestions([]);
          setError(err.message || "Erro ao buscar sugestões.");
        } finally {
          setLoadingSuggestions(false);
        }
      }, 250),
    []
  );

  const handleChangeQuery = (value) => {
    setQuery(value);
    setSelectedPlace(null);

    if (!value.trim()) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }

    setLoadingSuggestions(true);
    requestSuggestions(value);
  };

  const clearRoutesFromMap = () => {
    routeLayersRef.current.forEach((layer) => layer.remove());
    routeLayersRef.current = [];
  };

  const renderRoutes = (routeList, activeIndex = 0) => {
    const L = window.L;
    const map = mapInstanceRef.current;
    if (!L || !map) return;

    clearRoutesFromMap();

    routeList.forEach((route, index) => {
      const points = route.polylineCoords || [];
      if (!points.length) return;

      const polyline = L.polyline(points, {
        color: index === activeIndex ? C.accent : "rgba(60,60,67,0.40)",
        weight: index === activeIndex ? 6 : 4,
        opacity: index === activeIndex ? 0.95 : 0.85,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);

      polyline.on("click", () => setSelectedRouteIndex(index));
      routeLayersRef.current.push(polyline);
    });

    fitMapToRoutes(map, L, routeList);
  };

  useEffect(() => {
    if (routes.length > 0) {
      renderRoutes(routes, selectedRouteIndex);
    }
  }, [routes, selectedRouteIndex]);

  const handleSelectSuggestion = async (item) => {
    setSelectedPlace(item);
    setQuery(item.label);
    setSuggestions([]);
    setSearchOpen(false);
    setStatusText("Destino selecionado");

    const map = mapInstanceRef.current;
    const L = window.L;

    if (map && L) {
      if (destinationMarkerRef.current) destinationMarkerRef.current.remove();

      destinationMarkerRef.current = L.marker([item.lat, item.lon]).addTo(map);
      map.setView([item.lat, item.lon], 16);
    }

    if (!currentLocation) {
      setError("Ainda não consegui sua localização atual.");
      return;
    }

    try {
      setLoadingRoutes(true);
      setError("");
      setStatusText("Calculando rotas...");

      const savedVehicle = JSON.parse(localStorage.getItem("lowgas_vehicle") || "null");

      const response = await fetch("/api/maps/route-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          origin: currentLocation,
          destination: {
            lat: item.lat,
            lng: item.lon,
            label: item.label,
          },
          vehicle: savedVehicle,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao buscar rotas.");
      }

      const normalizedRoutes = (data.routes || []).map((route, index) => ({
        ...route,
        id: route.id || `route-${index + 1}`,
      }));

      setRoutes(normalizedRoutes);
      setSelectedRouteIndex(0);
      setStatusText(`${normalizedRoutes.length || 0} rota(s) encontradas`);
    } catch (err) {
      setRoutes([]);
      clearRoutesFromMap();
      setError(err.message || "Falha ao calcular rotas.");
      setStatusText("Erro ao calcular rotas");
    } finally {
      setLoadingRoutes(false);
    }
  };

  const recenterOnUser = () => {
    const map = mapInstanceRef.current;
    if (!map || !currentLocation) return;
    map.setView([currentLocation.lat, currentLocation.lng], 16);
  };

  const activeRoute = routes[selectedRouteIndex] || null;

  return (
    <div style={styles.mainContainer}>
      <div ref={mapRef} style={styles.map} />

      <div style={styles.topWrap}>
        <div
          style={{
            ...styles.searchShell,
            width: searchOpen ? "min(92vw, 560px)" : 56,
            borderRadius: searchOpen ? 22 : 28,
          }}
        >
          {!searchOpen ? (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              style={styles.searchButtonOnly}
              aria-label="Abrir busca"
            >
              <SearchIcon color={C.text} />
            </button>
          ) : (
            <>
              <div style={styles.searchRow}>
                <div style={styles.leftIconWrap}>
                  <SearchIcon color={C.text} />
                </div>

                <input
                  value={query}
                  onChange={(e) => handleChangeQuery(e.target.value)}
                  placeholder="Para onde?"
                  autoFocus
                  autoCapitalize="sentences"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  style={styles.input}
                />

                <button
                  type="button"
                  onClick={() => {
                    setSearchOpen(false);
                    setSuggestions([]);
                  }}
                  style={styles.closeButton}
                  aria-label="Fechar busca"
                >
                  ×
                </button>
              </div>

              {(loadingSuggestions || suggestions.length > 0) && (
                <div style={styles.suggestionBox}>
                  {loadingSuggestions && <div style={styles.loadingItem}>Buscando...</div>}

                  {!loadingSuggestions &&
                    suggestions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectSuggestion(item)}
                        style={styles.suggestionItem}
                      >
                        <div style={styles.suggestionIcon}>
                          <PinIcon />
                        </div>

                        <div style={styles.suggestionTexts}>
                          <div style={styles.suggestionMain}>{item.label.split(",")[0]}</div>
                          <div style={styles.suggestionSub}>{item.label}</div>
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </>
          )}
        </div>

        <div style={styles.topInfoStack}>
          <div style={styles.statusCard}>
            <div style={styles.statusLine}>
              <span style={styles.statusLabel}>Status</span>
              <span style={styles.statusValue}>
                {loadingRoutes ? "Analisando..." : statusText || "Pronto"}
              </span>
            </div>

            <div style={styles.statusActions}>
              <button type="button" onClick={() => setSearchOpen(true)} style={styles.primaryButton}>
                Buscar destino
              </button>
              <button type="button" onClick={recenterOnUser} style={styles.secondaryButton}>
                Minha localização
              </button>
            </div>
          </div>

          {routes.length > 0 && (
            <div style={styles.routeScroller}>
              {routes.map((route, index) => {
                const active = index === selectedRouteIndex;

                return (
                  <button
                    key={route.id || index}
                    type="button"
                    onClick={() => setSelectedRouteIndex(index)}
                    style={{
                      ...styles.routeCard,
                      borderColor: active ? C.accent : C.line,
                      boxShadow: active ? `0 10px 28px ${C.shadow}` : "0 4px 14px rgba(0,0,0,0.04)",
                    }}
                  >
                    <div style={styles.routeTopRow}>
                      <div style={styles.routeTitle}>{route.label || `Rota ${index + 1}`}</div>
                      <div
                        style={{
                          ...styles.routeBadge,
                          background: active ? C.accent : C.bg,
                          color: active ? "#fff" : C.sub,
                        }}
                      >
                        {active ? "Ativa" : "Ver"}
                      </div>
                    </div>

                    <div style={styles.routeMainMetrics}>
                      <div style={styles.metricBig}>{route.durationText || "-"}</div>
                      <div style={styles.metricSmall}>{route.distanceText || "-"}</div>
                    </div>

                    <div style={styles.routeMiniGrid}>
                      <div style={styles.routeMiniItem}>
                        <span style={styles.routeMiniLabel}>Comb.</span>
                        <span style={styles.routeMiniValue}>{route.fuelLitersText || "-"}</span>
                      </div>
                      <div style={styles.routeMiniItem}>
                        <span style={styles.routeMiniLabel}>Custo</span>
                        <span style={styles.routeMiniValue}>
                          {route.fuelCostText || formatMoneyBRL(route.fuelCost)}
                        </span>
                      </div>
                      <div style={styles.routeMiniItem}>
                        <span style={styles.routeMiniLabel}>Subida</span>
                        <span style={styles.routeMiniValue}>{route.ascentText || "-"}</span>
                      </div>
                      <div style={styles.routeMiniItem}>
                        <span style={styles.routeMiniLabel}>Eco</span>
                        <span style={styles.routeMiniValue}>{route.ecoScore ?? "-"}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {activeRoute && (
            <div style={styles.activeRouteCard}>
              <div style={styles.activeRouteTitle}>Resumo da rota ativa</div>

              <div style={styles.activeGrid}>
                <Info title="Tempo" value={activeRoute.durationText || "-"} />
                <Info title="Distância" value={activeRoute.distanceText || "-"} />
                <Info title="Combustível" value={activeRoute.fuelLitersText || "-"} />
                <Info
                  title="Custo"
                  value={activeRoute.fuelCostText || formatMoneyBRL(activeRoute.fuelCost)}
                />
                <Info title="Altimetria +" value={activeRoute.ascentText || "-"} />
                <Info title="Altimetria -" value={activeRoute.descentText || "-"} />
              </div>
            </div>
          )}
        </div>
      </div>

      {error ? <div style={styles.errorToast}>{error}</div> : null}
    </div>
  );
}

function Info({ title, value }) {
  return (
    <div style={styles.infoCell}>
      <div style={styles.infoCellTitle}>{title}</div>
      <div style={styles.infoCellValue}>{value}</div>
    </div>
  );
}

const styles = {
  mainContainer: {
    position: "relative",
    width: "100%",
    height: "100dvh",
    minHeight: "100dvh",
    background: C.bg,
    overflow: "hidden",
    WebkitTapHighlightColor: "transparent",
  },

  map: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
  },

  topWrap: {
    position: "absolute",
    top: "max(12px, env(safe-area-inset-top))",
    left: 0,
    right: 0,
    zIndex: 1000,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    padding: "0 12px",
    pointerEvents: "none",
  },

  searchShell: {
    minHeight: 56,
    background: "rgba(255,255,255,0.94)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    border: `1px solid ${C.line}`,
    boxShadow: `0 10px 30px ${C.shadow}`,
    overflow: "hidden",
    transition: "width 220ms ease, border-radius 220ms ease",
    pointerEvents: "auto",
  },

  searchButtonOnly: {
    width: 56,
    height: 56,
    border: "none",
    background: "transparent",
    color: C.text,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
  },

  searchRow: {
    display: "flex",
    alignItems: "center",
    minHeight: 56,
    padding: "0 8px",
  },

  leftIconWrap: {
    width: 40,
    height: 40,
    display: "grid",
    placeItems: "center",
    color: C.text,
    flexShrink: 0,
  },

  input: {
    flex: 1,
    height: 44,
    border: "none",
    outline: "none",
    background: "transparent",
    color: C.text,
    fontSize: 16,
    fontWeight: 600,
  },

  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    border: "none",
    background: C.bg,
    color: C.text,
    fontSize: 24,
    lineHeight: 1,
    cursor: "pointer",
    flexShrink: 0,
  },

  suggestionBox: {
    borderTop: `1px solid ${C.line}`,
    background: "rgba(255,255,255,0.98)",
    maxHeight: "38dvh",
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
  },

  loadingItem: {
    padding: "14px 16px",
    fontSize: 14,
    color: C.sub,
  },

  suggestionItem: {
    width: "100%",
    border: "none",
    background: "transparent",
    padding: "12px 14px",
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    textAlign: "left",
    cursor: "pointer",
  },

  suggestionIcon: {
    marginTop: 2,
    color: C.accent,
    flexShrink: 0,
  },

  suggestionTexts: {
    minWidth: 0,
    flex: 1,
  },

  suggestionMain: {
    color: C.text,
    fontSize: 14,
    fontWeight: 800,
    lineHeight: 1.2,
  },

  suggestionSub: {
    marginTop: 3,
    color: C.sub2,
    fontSize: 12,
    lineHeight: 1.35,
  },

  topInfoStack: {
    width: "min(92vw, 560px)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    pointerEvents: "auto",
  },

  statusCard: {
    background: "rgba(255,255,255,0.94)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    border: `1px solid ${C.line}`,
    borderRadius: 22,
    boxShadow: `0 10px 30px ${C.shadow}`,
    padding: 12,
  },

  statusLine: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  },

  statusLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: C.sub,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },

  statusValue: {
    fontSize: 14,
    fontWeight: 800,
    color: C.text,
    textAlign: "right",
  },

  statusActions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },

  primaryButton: {
    height: 40,
    border: "none",
    borderRadius: 999,
    background: C.accent,
    color: "#fff",
    padding: "0 16px",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
  },

  secondaryButton: {
    height: 40,
    borderRadius: 999,
    border: `1px solid ${C.line}`,
    background: C.surface,
    color: C.text,
    padding: "0 16px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  },

  routeScroller: {
    display: "flex",
    gap: 10,
    overflowX: "auto",
    paddingBottom: 2,
    WebkitOverflowScrolling: "touch",
  },

  routeCard: {
    minWidth: 220,
    maxWidth: 220,
    borderRadius: 22,
    border: "1.5px solid",
    background: "rgba(255,255,255,0.96)",
    padding: 12,
    textAlign: "left",
    cursor: "pointer",
  },

  routeTopRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },

  routeTitle: {
    fontSize: 14,
    fontWeight: 800,
    color: C.text,
  },

  routeBadge: {
    height: 24,
    minWidth: 46,
    padding: "0 10px",
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: 800,
  },

  routeMainMetrics: {
    marginTop: 10,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },

  metricBig: {
    fontSize: 22,
    fontWeight: 900,
    color: C.text,
    lineHeight: 1,
  },

  metricSmall: {
    fontSize: 13,
    fontWeight: 700,
    color: C.sub,
  },

  routeMiniGrid: {
    marginTop: 12,
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0,1fr))",
    gap: 8,
  },

  routeMiniItem: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    padding: 8,
    borderRadius: 14,
    background: C.bg,
  },

  routeMiniLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: C.sub2,
  },

  routeMiniValue: {
    fontSize: 13,
    fontWeight: 800,
    color: C.text,
  },

  activeRouteCard: {
    background: "rgba(255,255,255,0.96)",
    border: `1px solid ${C.line}`,
    borderRadius: 22,
    boxShadow: `0 10px 30px ${C.shadow}`,
    padding: 12,
  },

  activeRouteTitle: {
    fontSize: 14,
    fontWeight: 800,
    color: C.text,
    marginBottom: 10,
  },

  activeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0,1fr))",
    gap: 8,
  },

  infoCell: {
    background: C.bg,
    borderRadius: 14,
    padding: 10,
  },

  infoCellTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: C.sub2,
    marginBottom: 4,
  },

  infoCellValue: {
    fontSize: 14,
    fontWeight: 800,
    color: C.text,
  },

  errorToast: {
    position: "absolute",
    left: 12,
    right: 12,
    top: "calc(max(12px, env(safe-area-inset-top)) + 430px)",
    zIndex: 1200,
    background: C.danger,
    color: "#fff",
    padding: "12px 14px",
    borderRadius: 14,
    fontSize: 13,
    fontWeight: 700,
  },
};
