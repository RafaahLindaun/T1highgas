// src/pages/Routes.jsx
import React from 'react';

export default function RoutesHistory() {
  const routes = [
    { id: 1, name: 'Trabalho (Via Plana)', eco: 'R$ 12,50 economizados' },
    { id: 2, name: 'Supermercado', eco: 'R$ 3,20 economizados' }
  ];

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Histórico Eco</h2>
      {routes.map(r => (
        <div key={r.id} style={styles.item}>
          <div style={styles.dot} />
          <div>
            <div style={styles.name}>{r.name}</div>
            <div style={styles.eco}>{r.eco}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

const styles = {
  container: { padding: '20px', paddingTop: '60px', background: '#f8fafc', height: '100vh' },
  title: { color: '#7c3aed', marginBottom: '20px' },
  item: { display: 'flex', alignItems: 'center', gap: '15px', background: 'white', padding: '15px', borderRadius: '15px', marginBottom: '10px', boxShadow: '0 2px 5px rgba(0,0,0,0.03)' },
  dot: { width: '10px', height: '10px', borderRadius: '50%', background: '#7c3aed' },
  name: { fontWeight: 'bold', color: '#334155' },
  eco: { fontSize: '12px', color: '#22c55e' }
};