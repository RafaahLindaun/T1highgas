// src/pages/CarBase.jsx
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

export default function CarBase() {
  const [hasCar, setHasCar] = useState(false); // Simulação de banco de dados vazio
  const navigate = useNavigate();

  return (
    <div style={styles.container}>
      {!hasCar ? (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          style={styles.emptyState}
        >
          <div style={styles.ghostIcon}>⎈</div>
          <h1 style={styles.title}>SEM CARROS<br/>SALVOS AINDA.</h1>
          <p style={styles.subtitle}>“NÃO TEM PROBLEMA”</p>
          
          <div style={styles.infoBox}>
            O APP ESTÁ OPERANDO EM <b>MODO NAVEGAÇÃO</b> (ESTILO WAZE). 
            PARA ATIVAR A <b>ECONOMIA PREDITIVA</b>, PRECISAMOS CONHECER SEU MOTOR.
          </div>

          <motion.button 
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate('/ia')}
            style={styles.btnPrimary}
          >
            VOLTAR PARA IA
          </motion.button>
        </motion.div>
      ) : (
        <div style={styles.hasCarState}>
          {/* Aqui apareceria o carro já salvo no futuro */}
          <h1 style={styles.title}>GARAGEM ATIVA.</h1>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    height: '100vh',
    background: '#FFF',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '30px',
    textAlign: 'center'
  },
  emptyState: {
    maxWidth: '350px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  },
  ghostIcon: {
    fontSize: '60px',
    color: '#000',
    marginBottom: '20px',
    opacity: 0.1
  },
  title: {
    fontSize: '32px',
    fontWeight: 900, // ULTRA BOLD
    letterSpacing: '-1.5px',
    lineHeight: '0.9',
    color: '#000',
    marginBottom: '10px'
  },
  subtitle: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#000',
    opacity: 0.4,
    marginBottom: '40px',
    letterSpacing: '2px'
  },
  infoBox: {
    fontSize: '11px',
    lineHeight: '1.6',
    color: '#000',
    background: 'rgba(0,0,0,0.03)',
    padding: '20px',
    borderRadius: '25px',
    marginBottom: '40px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  btnPrimary: {
    background: '#000',
    color: '#FFF',
    border: 'none',
    padding: '18px 40px',
    borderRadius: '35px',
    fontSize: '12px',
    fontWeight: 900,
    letterSpacing: '2px',
    cursor: 'pointer',
    boxShadow: '0 20px 40px rgba(0,0,0,0.1)'
  }
};