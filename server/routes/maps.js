import express from "express";

const router = express.Router();

function toRad(value) {
  return (value * Math.PI) / 180;
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const aa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

function formatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}min`;
}

function buildFuelEstimate({ distanceKm, durationSeconds, vehicle, routeIndex }) {
  const avgSpeedKmh = distanceKm / Math.max(durationSeconds / 3600, 0.1);

  let kmPerLiter;

  if (vehicle?.city_km_l && vehicle?.hwy_km_l) {
    const urbanFactor = avgSpeedKmh < 35 ? 0.78 : avgSpeedKmh < 60 ? 0.5 : 0.22;
    kmPerLiter = vehicle.city_km_l * urbanFactor + vehicle.hwy_km_l * (1 - urbanFactor);
  } else {
    if (avgSpeedKmh < 25) kmPerLiter = 8.5;
    else if (avgSpeedKmh < 40) kmPerLiter = 10.5;
    else if (avgSpeedKmh < 70) kmPerLiter = 12.8;
    else kmPerLiter = 14.2;
  }

  const ascentMeters = Math.round(distanceKm * (routeIndex === 0 ? 9 : routeIndex === 1 ? 13 : 7));
  const descentMeters = Math.round(distanceKm * (routeIndex === 0 ? 7 : routeIndex === 1 ? 9 : 8));

  const ascentPenalty = 1 + Math.min(ascentMeters / 1000, 0.2);
  const trafficPenalty = avgSpeedKmh < 30 ? 1.14 : avgSpeedKmh < 45 ? 1.08 : 1.02;

  const adjustedKmPerLiter = kmPerLiter / (ascentPenalty * trafficPenalty);
  const fuelLiters = distanceKm / Math.max(adjustedKmPerLiter, 3.5);
  const fuelPrice = Number(vehicle?.fuel_price || 5.89);
  const fuelCost = fuelLiters * fuelPrice;

  let ecoScore = 100;
  ecoScore -= fuelLiters * 6;
  ecoScore -= ascentMeters / 140;
  ecoScore -= avgSpeedKmh < 30 ? 7 : avgSpeedKmh < 45 ? 3 : 0;
  ecoScore = Math.max(1, Math.round(ecoScore));

  return {
    ascentMeters,
    descentMeters,
    fuelLiters: Number(fuelLiters.toFixed(2)),
    fuelCost: Number(fuelCost.toFixed(2)),
    ecoScore,
  };
}

function buildMockAlternativeRoutes(origin, destination, vehicle) {
  const distanceKm = haversineKm(origin, destination);

  const baseDurationSec = Math.round((distanceKm / 38) * 3600);
  const alt1DurationSec = Math.round(baseDurationSec * 1.12);
  const alt2DurationSec = Math.round(baseDurationSec * 0.95);

  const polylineA = [
    [origin.lat, origin.lng],
    [(origin.lat + destination.lat) / 2 + 0.01, (origin.lng + destination.lng) / 2 - 0.01],
    [destination.lat, destination.lng],
  ];

  const polylineB = [
    [origin.lat, origin.lng],
    [(origin.lat + destination.lat) / 2 - 0.015, (origin.lng + destination.lng) / 2 + 0.008],
    [destination.lat, destination.lng],
  ];

  const polylineC = [
    [origin.lat, origin.lng],
    [(origin.lat + destination.lat) / 2 + 0.005, (origin.lng + destination.lng) / 2 + 0.018],
    [destination.lat, destination.lng],
  ];

  const routeDefs = [
    {
      id: "route-1",
      label: "Melhor rota",
      distanceKm: Number(distanceKm.toFixed(1)),
      durationSeconds: baseDurationSec,
      polylineCoords: polylineA,
    },
    {
      id: "route-2",
      label: "Menos trânsito",
      distanceKm: Number((distanceKm * 1.06).toFixed(1)),
      durationSeconds: alt1DurationSec,
      polylineCoords: polylineB,
    },
    {
      id: "route-3",
      label: "Mais rápida",
      distanceKm: Number((distanceKm * 1.12).toFixed(1)),
      durationSeconds: alt2DurationSec,
      polylineCoords: polylineC,
    },
  ];

  return routeDefs.map((route, index) => {
    const fuel = buildFuelEstimate({
      distanceKm: route.distanceKm,
      durationSeconds: route.durationSeconds,
      vehicle,
      routeIndex: index,
    });

    return {
      id: route.id,
      label: route.label,
      polylineCoords: route.polylineCoords,
      distanceMeters: Math.round(route.distanceKm * 1000),
      durationSeconds: route.durationSeconds,
      distanceText: `${route.distanceKm.toFixed(1)} km`,
      durationText: formatDuration(route.durationSeconds),
      ascentMeters: fuel.ascentMeters,
      descentMeters: fuel.descentMeters,
      ascentText: `${fuel.ascentMeters} m`,
      descentText: `${fuel.descentMeters} m`,
      fuelLiters: fuel.fuelLiters,
      fuelLitersText: `${fuel.fuelLiters.toFixed(2)} L`,
      fuelCost: fuel.fuelCost,
      fuelCostText: `R$ ${fuel.fuelCost.toFixed(2).replace(".", ",")}`,
      ecoScore: fuel.ecoScore,
    };
  });
}

router.post("/route-analysis", async (req, res) => {
  try {
    const { origin, destination, vehicle } = req.body || {};

    if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
      return res.status(400).json({ error: "Origem e destino são obrigatórios." });
    }

    // MVP inicial:
    // aqui está mockado de forma consistente para você testar a interface.
    // Depois trocamos esse bloco por Google Routes / OSRM / Mapbox.
    const routes = buildMockAlternativeRoutes(origin, destination, vehicle);

    return res.json({ routes });
  } catch (error) {
    console.error("route-analysis error:", error);
    return res.status(500).json({ error: "Erro interno ao analisar rotas." });
  }
});

export default router;
