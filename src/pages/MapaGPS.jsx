import React, { useEffect, useMemo, useRef, useState } from "react";

/* ---------------- CONFIG VISUAL ---------------- */
const BLACK = "#000000";
const WHITE = "#FFFFFF";
const ORANGE = "#FF6A00";
const GLASS = "rgba(255,255,255,0.92)";
const BORDER = "rgba(255,255,255,0.42)";
const SHADOW = "0 12px 30px rgba(0,0,0,0.18)";

/* ---------------- LEAFLET CDN ---------------- */
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

/* ---------------- HELPERS ---------------- */
function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function SearchIcon({ size = 18, color = "currentColor" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
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

export default function MapaGPS() {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const userMarkerRef = useRef(null);
  const destinationMarkerRef = useRef(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
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
          tap: false
        }).setView(defaultCenter, 13);

        L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
          maxZoom: 20
        }).addTo(map);

        mapInstanceRef.current = map;

        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              if (cancelled || !mapInstanceRef.current) return;

              const coords = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
              };

              setCurrentLocation(coords);
              setStatusText("Localização atual encontrada");

              map.setView([coords.lat, coords.lng], 16);

              if (userMarkerRef.current) {
                userMarkerRef.current.remove();
              }

              userMarkerRef.current = L.circleMarker([coords.lat, coords.lng], {
                radius: 8,
                fillColor: ORANGE,
                fillOpacity: 1,
                color: WHITE,
                weight: 3
              }).addTo(map);
            },
            () => {
              setStatusText("Usando mapa padrão");
            },
            {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 5000
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
            `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&countrycodes=br&q=${encodeURIComponent(
              clean
            )}`,
            {
              headers: {
                Accept: "application/json"
              }
            }
          );

          if (!response.ok) {
            throw new Error("Falha ao buscar endereço.");
          }

          const data = await response.json();

          const parsed = Array.isArray(data)
            ? data.map((item) => ({
                id: item.place_id,
                label: item.display_name,
                lat: Number(item.lat),
                lon: Number(item.lon)
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

  const handleSelectSuggestion = (item) => {
    setSelectedPlace(item);
    setQuery(item.label);
    setSuggestions([]);
    setSearchOpen(false);
    setStatusText("Destino selecionado");

    const map = mapInstanceRef.current;
    const L = window.L;

    if (!map || !L) return;

    if (destinationMarkerRef.current) {
      destinationMarkerRef.current.remove();
    }

    destinationMarkerRef.current = L.marker([item.lat, item.lon]).addTo(map);
    map.setView([item.lat, item.lon], 16);
  };

  const recenterOnUser = () => {
    const map = mapInstanceRef.current;
    if (!map || !currentLocation) return;

    map.setView([currentLocation.lat, currentLocation.lng], 16);
  };

  return (
    <div style={styles.mainContainer}>
      <div ref={mapRef} style={styles.map} />

      {/* TOPO */}
      <div style={styles.topSafeArea}>
        <div
          style={{
            ...styles.searchShell,
            width: searchOpen ? "min(92vw, 520px)" : 56,
            borderRadius: searchOpen ? 22 : 28
          }}
        >
          {!searchOpen ? (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              style={styles.searchButtonOnly}
              aria-label="Abrir busca"
            >
              <SearchIcon />
            </button>
          ) : (
            <>
              <div style={styles.searchRow}>
                <div style={styles.leftIconWrap}>
                  <SearchIcon />
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
                  {loadingSuggestions && (
                    <div style={styles.loadingItem}>Buscando...</div>
                  )}

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
                          <div style={styles.suggestionMain}>
                            {item.label.split(",")[0]}
                          </div>
                          <div style={styles.suggestionSub}>{item.label}</div>
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* BOTTOM MINI CARD */}
      <div style={styles.bottomWrap}>
        <div style={styles.bottomCard}>
          <div style={styles.bottomTopLine} />

          <div style={styles.bottomContent}>
            <div style={styles.infoBlock}>
              <div style={styles.infoLabel}>Status</div>
              <div style={styles.infoValue}>{statusText || "Pronto para buscar"}</div>
            </div>

            {selectedPlace && (
              <div style={styles.infoBlock}>
                <div style={styles.infoLabel}>Destino</div>
                <div style={styles.infoValueEllipsis}>{selectedPlace.label}</div>
              </div>
            )}

            <div style={styles.actionsRow}>
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                style={styles.primaryButton}
              >
                Buscar destino
              </button>

              <button
                type="button"
                onClick={recenterOnUser}
                style={styles.secondaryButton}
              >
                Minha localização
              </button>
            </div>
          </div>
        </div>
      </div>

      {error ? <div style={styles.errorToast}>{error}</div> : null}
    </div>
  );
}

const styles = {
  mainContainer: {
    position: "relative",
    width: "100%",
    height: "100dvh",
    minHeight: "100dvh",
    background: BLACK,
    overflow: "hidden",
    WebkitTapHighlightColor: "transparent"
  },

  map: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%"
  },

  topSafeArea: {
    position: "absolute",
    top: "max(12px, env(safe-area-inset-top))",
    left: 0,
    right: 0,
    zIndex: 1000,
    display: "flex",
    justifyContent: "center",
    pointerEvents: "none",
    padding: "0 12px"
  },

  searchShell: {
    minHeight: 56,
    background: GLASS,
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    border: `1px solid ${BORDER}`,
    boxShadow: SHADOW,
    overflow: "hidden",
    transition: "width 220ms ease, border-radius 220ms ease",
    pointerEvents: "auto"
  },

  searchButtonOnly: {
    width: 56,
    height: 56,
    border: "none",
    background: "transparent",
    color: BLACK,
    display: "grid",
    placeItems: "center",
    cursor: "pointer"
  },

  searchRow: {
    display: "flex",
    alignItems: "center",
    minHeight: 56,
    padding: "0 8px"
  },

  leftIconWrap: {
    width: 40,
    height: 40,
    display: "grid",
    placeItems: "center",
    color: BLACK,
    flexShrink: 0
  },

  input: {
    flex: 1,
    height: 44,
    border: "none",
    outline: "none",
    background: "transparent",
    color: BLACK,
    fontSize: 16,
    fontWeight: 600
  },

  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    border: "none",
    background: "rgba(0,0,0,0.06)",
    color: BLACK,
    fontSize: 24,
    lineHeight: 1,
    cursor: "pointer",
    flexShrink: 0
  },

  suggestionBox: {
    borderTop: "1px solid rgba(0,0,0,0.06)",
    background: "rgba(255,255,255,0.96)",
    maxHeight: "40dvh",
    overflowY: "auto",
    WebkitOverflowScrolling: "touch"
  },

  loadingItem: {
    padding: "14px 16px",
    fontSize: 14,
    color: "#666"
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
    cursor: "pointer"
  },

  suggestionIcon: {
    marginTop: 2,
    color: ORANGE,
    flexShrink: 0
  },

  suggestionTexts: {
    minWidth: 0,
    flex: 1
  },

  suggestionMain: {
    color: BLACK,
    fontSize: 14,
    fontWeight: 800,
    lineHeight: 1.2
  },

  suggestionSub: {
    marginTop: 3,
    color: "#666",
    fontSize: 12,
    lineHeight: 1.35
  },

  bottomWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: "max(12px, env(safe-area-inset-bottom))",
    zIndex: 999
  },

  bottomCard: {
    borderRadius: 24,
    background: "rgba(12,12,12,0.88)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 16px 40px rgba(0,0,0,0.28)",
    padding: 12
  },

  bottomTopLine: {
    width: 42,
    height: 5,
    borderRadius: 999,
    background: "rgba(255,255,255,0.18)",
    margin: "2px auto 12px"
  },

  bottomContent: {
    display: "flex",
    flexDirection: "column",
    gap: 10
  },

  infoBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 4
  },

  infoLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#A3A3A3",
    textTransform: "uppercase",
    letterSpacing: "0.06em"
  },

  infoValue: {
    fontSize: 15,
    fontWeight: 700,
    color: WHITE
  },

  infoValueEllipsis: {
    fontSize: 15,
    fontWeight: 700,
    color: WHITE,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },

  actionsRow: {
    display: "flex",
    gap: 8,
    marginTop: 4,
    flexWrap: "wrap"
  },

  primaryButton: {
    height: 42,
    border: "none",
    borderRadius: 999,
    background: ORANGE,
    color: WHITE,
    padding: "0 16px",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer"
  },

  secondaryButton: {
    height: 42,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: WHITE,
    padding: "0 16px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer"
  },

  errorToast: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: "max(140px, calc(env(safe-area-inset-bottom) + 110px))",
    zIndex: 1200,
    background: "rgba(150, 25, 25, 0.96)",
    color: WHITE,
    padding: "12px 14px",
    borderRadius: 14,
    fontSize: 13,
    fontWeight: 700
  }
};
