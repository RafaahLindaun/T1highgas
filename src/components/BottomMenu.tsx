import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function BottomMenu() {
  const { pathname } = useLocation();

  const items = [
    { to: '/mapa', label: 'MAP', icon: '⌗' },
    { to: '/ia', label: 'ECO.IA', icon: '◈' },
    { to: '/carbase', label: 'GARAGE', icon: '⎈' },
    { to: '/routes', label: 'ROUTES', icon: '☖' },
    { to: '/conta', label: 'ID', icon: '👤' },
  ];

  return (
    <div style={styles.wrapper}>
      <nav style={styles.nav}>
        {items.map((it) => {
          const active = pathname === it.to;

          return (
            <Link key={it.to} to={it.to} style={styles.link}>
              <motion.div
                whileTap={{ scale: 0.9 }} // Efeito de clique físico iOS
                style={styles.item}
              >
                {/* O fundo preto que "corre" entre os botões */}
                {active && (
                  <motion.div
                    layoutId="activePill"
                    style={styles.activeBg}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}

                <span
                  style={{
                    ...styles.icon,
                    color: active ? '#FFF' : '#000',
                    zIndex: 2,
                  }}
                >
                  {it.icon}
                </span>

                <span
                  style={{
                    ...styles.label,
                    color: active ? '#FFF' : '#000',
                    fontWeight: 900, // ULTRA BOLD
                    zIndex: 2,
                    opacity: active ? 1 : 0.5,
                  }}
                >
                  {it.label}
                </span>
              </motion.div>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

const styles = {
  wrapper: {
    position: 'fixed',
    bottom: '25px',
    left: '0',
    right: '0',
    display: 'flex',
    justifyContent: 'center',
    zIndex: 10001,
    padding: '0 15px',
    pointerEvents: 'none', // Garante que não bloqueie o mapa fora da barra
  },
  nav: {
    display: 'flex',
    background: 'rgba(255, 255, 255, 0.75)',
    backdropFilter: 'blur(40px)',
    WebkitBackdropFilter: 'blur(40px)',
    borderRadius: '35px',
    padding: '6px',
    gap: '4px',
    boxShadow: '0 30px 60px rgba(0,0,0,0.12)',
    border: '1px solid rgba(255,255,255,0.4)',
    maxWidth: '400px',
    width: '100%',
    pointerEvents: 'auto',
  },
  link: {
    textDecoration: 'none',
    flex: 1,
    position: 'relative',
  },
  item: {
    height: '60px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '30px',
    position: 'relative',
  },
  activeBg: {
    position: 'absolute',
    inset: 0,
    background: '#000',
    borderRadius: '28px',
    zIndex: 1,
  },
  icon: {
    fontSize: '18px',
    marginBottom: '1px',
    transition: 'color 0.3s ease',
  },
  label: {
    fontSize: '7.5px',
    letterSpacing: '1.2px',
    textTransform: 'uppercase',
    transition: 'color 0.3s ease',
  },
};
