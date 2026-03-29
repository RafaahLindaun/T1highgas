import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useScroll, useMotionValue, useTransform } from "framer-motion";

// --- CARREGAMENTO DO LEAFLET (CDN) ---
const loadLeaflet = () => {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => resolve(window.L);
    document.head.appendChild(script);
  });
};

export default function MapaGPS() {
  const mapRef = useRef(null);
  const [showTopBar, setShowTopBar] = useState(false);
  const lastScrollY = useRef(0);

  // Funções da Barra (As "Bolas")
  const tools = [
    { id: 1, label: "ECO", icon: "🌱" },
    { id: 2, label: "ROUTE", icon: "⫸" },
    { id: 3, label: "RADAR", icon: "⦿" },
    { id: 4, label: "SAVE", icon: "⤓" },
    { id: 5, label: "VOICE", icon: "◈" },
  ];

  useEffect(() => {
    loadLeaflet().then((L) => {
      if (!mapRef.current) return;
      const map = L.map(mapRef.current, { zoomControl: false }).setView([-23.55, -46.63], 13);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png").addTo(map);

      // Gesto de detecção: Arrastar para cima no mapa mostra a barra
      map.on('dragend', () => {
        const center = map.getCenter();
        // Lógica simples: qualquer interação "acorda" a interface iOS
        setShowTopBar(true);
        setTimeout(() => setShowTopBar(false), 5000); // Esconde após 5s de inatividade
      });
    });
  }, []);

  return (
    <div style={styles.mainContainer}>
      
      {/* BARRA ESTILO iOS 26.0 */}
      <AnimatePresence>
        {showTopBar && (
          <motion.div
            initial={{ y: -150, opacity: 0, scale: 0.9 }}
            animate={{ y: 20, opacity: 1, scale: 1 }}
            exit={{ y: -150, opacity: 0, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            style={styles.topIsland}
          >
            <motion.div 
              drag="x" 
              dragConstraints={{ left: -200, right: 0 }}
              style={styles.scrollWrapper}
            >
              {tools.map((tool) => (
                <div key={tool.id} style={styles.toolGroup}>
                  <div style={styles.ball}>{tool.icon}</div>
                  <span style={styles.ballLabel}>{tool.label}</span>
                </div>
              ))}
            </motion.div>
            
            {/* Barra de arraste inferior da ilha */}
            <div style={styles.dragHandle} />
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={mapRef} style={styles.map} />

      {/* Trigger Invisível de deslize (Área inferior) */}
      <div 
        onTouchStart={(e) => {
          lastScrollY.current = e.touches[0].clientY;
        }}
        onTouchMove={(e) => {
          const currentY = e.touches[0].clientY;
          if (lastScrollY.current - currentY > 50) { // Deslizou para cima
            setShowTopBar(true);
          }
        }}
        style={styles.gestureTrigger} 
      />
    </div>
  );
}

const styles = {
  mainContainer: { 
    position: 'relative', 
    width: '100vw', 
    height: '100vh', 
    background: '#000', 
    overflow: 'hidden' 
  },
  map: { width: '100%', height: '100%', zIndex: 1 },
  
  // A "ILHA" iOS
  topIsland: {
    position: 'absolute',
    top: 0,
    left: '5%',
    width: '90%',
    height: '100px',
    background: 'rgba(255, 255, 255, 0.8)',
    backdropFilter: 'blur(30px)',
    WebkitBackdropFilter: 'blur(30px)',
    borderRadius: '40px',
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 20px 40px rgba(0,0,0,0.1)',
    border: '1px solid rgba(255,255,255,0.4)',
    overflow: 'hidden'
  },
  scrollWrapper: {
    display: 'flex',
    gap: '25px',
    padding: '0 40px',
    cursor: 'grab',
  },
  toolGroup: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px'
  },
  ball: {
    width: '50px',
    height: '50px',
    borderRadius: '25px',
    background: '#000',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
    boxShadow: '0 10px 20px rgba(0,0,0,0.2)'
  },
  ballLabel: {
    fontSize: '10px',
    fontWeight: '900', // BOLD EXTREMO
    color: '#000',
    letterSpacing: '1px',
    textTransform: 'uppercase'
  },
  dragHandle: {
    width: '40px',
    height: '4px',
    background: 'rgba(0,0,0,0.1)',
    borderRadius: '2px',
    marginTop: '10px'
  },
  // Área invisível no rodapé para detectar o "Swipe Up"
  gestureTrigger: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '150px',
    zIndex: 9998,
  }
};