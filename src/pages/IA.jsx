// src/pages/IA.jsx
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

const carDatabase = {
  brands: [
    { id: 'vw', name: 'VOLKSWAGEN', logo: '/marcas/vw.svg' },
    { id: 'toyota', name: 'TOYOTA', logo: '/marcas/toyota.svg' },
    { id: 'fiat', name: 'FIAT', logo: '/marcas/fiat.svg' },
    { id: 'chevy', name: 'CHEVROLET', logo: '/marcas/chevy.svg' },
  ],
  models: {
    vw: [
      { id: 'gol', name: 'GOL', img: '/carros/gol.png', engines: ['1.0 MPI', '1.6 MSI'] },
      { id: 'polo', name: 'POLO', img: '/carros/polo.png', engines: ['1.0 TSI', '1.4 GTS TSI'] },
    ],
    toyota: [
      { id: 'corolla', name: 'COROLLA', img: '/carros/corolla.png', engines: ['2.0 Dynamic Force', '1.8 Hybrid'] },
    ],
  },
};

export default function IA_Command() {
  const navigate = useNavigate();
  const [step, setStep] = useState('BRAND'); 
  const [vehicle, setVehicle] = useState({ brand: null, model: null, engine: null });

  const goBack = () => {
    if (step === 'MODEL') setStep('BRAND');
    else if (step === 'ENGINE') setStep('MODEL');
    else if (step === 'MODIFICATION') setStep('ENGINE');
    else navigate(-1);
  };

  const saveAndExit = (mod) => {
    const finalData = {
      brand: vehicle.brand.name,
      model: vehicle.model.name,
      engine: vehicle.engine,
      modification: mod,
      active: true
    };
    localStorage.setItem('@EcoRoute:Vehicle', JSON.stringify(finalData));
    navigate('/mapa');
  };

  return (
    <div style={styles.container}>
      <motion.button onClick={goBack} whileTap={{ scale: 0.8 }} style={styles.backBtn}>‹</motion.button>

      <header style={styles.header}>
        <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 3 }} style={styles.iaWave} />
        <h1 style={styles.title}>ECO.IA</h1>
        <p style={styles.subtitle}>
          {step === 'BRAND' && 'QUAL A MARCA?'}
          {step === 'MODEL' && 'QUAL O MODELO?'}
          {step === 'ENGINE' && 'QUAL O MOTOR?'}
          {step === 'MODIFICATION' && 'TEM MODIFICAÇÃO?'}
        </p>
      </header>

      <div style={styles.content}>
        <AnimatePresence mode="wait">
          {step === 'BRAND' && (
            <motion.div key="b" style={styles.grid} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {carDatabase.brands.map(b => (
                <button key={b.id} onClick={() => { setVehicle({...vehicle, brand: b}); setStep('MODEL'); }} style={styles.card}>
                  <div style={styles.logoCircle}><img src={b.logo} style={styles.logoImg} onError={e => e.target.style.display='none'} /></div>
                  <span style={styles.boldLabel}>{b.name}</span>
                </button>
              ))}
            </motion.div>
          )}

          {step === 'MODEL' && (
            <motion.div key="m" style={styles.list} initial={{ x: 50 }} animate={{ x: 0 }}>
              {carDatabase.models[vehicle.brand.id]?.map(m => (
                <button key={m.id} onClick={() => { setVehicle({...vehicle, model: m}); setStep('ENGINE'); }} style={styles.modelCard}>
                  <div style={styles.carImgWrap}><img src={m.img} style={styles.carImg} /></div>
                  <span style={styles.boldLabel}>{m.name}</span>
                </button>
              ))}
            </motion.div>
          )}

          {step === 'ENGINE' && (
            <div style={styles.list}>
              {vehicle.model.engines.map(e => (
                <button key={e} onClick={() => { setVehicle({...vehicle, engine: e}); setStep('MODIFICATION'); }} style={styles.engineCard}>
                  <span style={styles.boldLabel}>{e}</span>
                  <span>→</span>
                </button>
              ))}
            </div>
          )}

          {step === 'MODIFICATION' && (
            <div style={styles.modWrap}>
              <button style={styles.btnFull} onClick={() => saveAndExit('Original')}>NÃO, ORIGINAL</button>
              <button style={styles.btnBlack} onClick={() => saveAndExit('Modificado')}>SIM, POSSUI</button>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const styles = {
  container: { height: '100vh', background: '#FFF', padding: '0 25px', display: 'flex', flexDirection: 'column' },
  backBtn: { position: 'absolute', top: '40px', left: '15px', background: 'none', border: 'none', fontSize: '45px', fontWeight: '200', cursor: 'pointer', zIndex: 10 },
  header: { marginTop: '80px', textAlign: 'center', alignItems: 'center', display: 'flex', flexDirection: 'column' },
  iaWave: { width: '12px', height: '12px', background: '#000', borderRadius: '50%', marginBottom: '20px' },
  title: { fontSize: '10px', fontWeight: 900, letterSpacing: '3px', opacity: 0.3 },
  subtitle: { fontSize: '26px', fontWeight: 900, letterSpacing: '-1.5px', marginTop: '10px' },
  content: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: '100px' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', width: '100%' },
  card: { background: '#F9F9F9', border: '1px solid #EEE', borderRadius: '30px', padding: '20px', cursor: 'pointer' },
  logoCircle: { width: '40px', height: '40px', background: '#EEE', borderRadius: '20px', marginBottom: '10px', margin: '0 auto', overflow: 'hidden' },
  logoImg: { width: '100%', filter: 'grayscale(100%)' },
  boldLabel: { fontSize: '12px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '1px' },
  list: { width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' },
  modelCard: { background: '#FFF', border: '1px solid #EEE', borderRadius: '25px', padding: '15px', display: 'flex', alignItems: 'center', gap: '20px', textAlign: 'left' },
  carImgWrap: { width: '80px', height: '50px', background: '#F5F5F5', borderRadius: '15px', overflow: 'hidden' },
  carImg: { width: '100%', filter: 'grayscale(100%)' },
  engineCard: { padding: '20px 25px', background: '#F9F9F9', borderRadius: '20px', border: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  modWrap: { display: 'flex', flexDirection: 'column', gap: '15px', width: '100%' },
  btnFull: { padding: '20px', borderRadius: '30px', border: '1px solid #EEE', background: '#FFF', fontWeight: 900, fontSize: '12px' },
  btnBlack: { padding: '20px', borderRadius: '30px', border: 'none', background: '#000', color: '#FFF', fontWeight: 900, fontSize: '12px' }
};