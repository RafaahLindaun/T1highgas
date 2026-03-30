import express from "express";

const router = express.Router();

const OSRM_BASE = "https://router.project-osrm.org";

function formatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;

  const h = Math.floor(mins / 60);
  const m = mins % 60;

  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

function formatDistance(meters) {
  const km = meters / 1000;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

function formatLiters(value) {
  return `${Number(value || 0).toFixed(2)} L`;
}

function formatMoneyBRL(value) {
  return `R$ ${Number(value || 0).toFixed(2).replace(".", ",")}`;
}

function estimateFuelAndEco({ distanceMeters, durationSeconds, stepsCount, vehicle }) {
  const distanceKm = distanceMeters / 1000;
  const avgSpeedKmh = distanceKm / Math.max(durationSeconds / 3600, 0.1);

  let kmPerLiter;

  if (
    vehicle &&
    Number.isFinite(Number(vehicle.city_km_l)) &&
    Number.isFinite(Number(vehicle.hwy_km_l))
  ) {
    const city = Number(vehicle.city_km_l);
    const hwy = Number(vehicle.hwy_km_l);

    const urbanFactor = avgSpeedKmh < 30 ? 0.82 : avgSpeedKmh < 55 ? 0.5 : 0.2;
    kmPerLiter = city * urbanFactor + hwy * (1 - urbanFactor);
  } else {
    if (avgSpeedKmh < 25) kmPerLiter = 8.5;
    else if (avgSpeedKmh < 40) kmPerLiter = 10.5;
    else if (avgSpeedKmh < 70) kmPerLiter = 12.8;
    else kmPerLiter = 14.2;
  }

  const stepDensity = stepsCount / Math.max(distanceKm, 1);
  const stopGoPenalty = 1 + Math.min(stepDensity / 90, 0.16);

  const adjustedKmPerLiter = kmPerLiter / stopGoPenalty;
  const fuelLiters = distanceKm / Math.max(adjustedKmPerLiter, 3.5);

  const fuelPrice = Number(vehicle?.fuel_price || 5.89);
  const fuelCost = fuelLiters * fuelPrice;

  let ecoScore = 100;
  ecoScore -= fuelLiters * 6;
  ecoScore -= avgSpeedKmh < 30 ? 7 : avgSpeedKmh < 45 ? 3 : 0;
  ecoScore -= Math.min(stepDensity * 0.35, 10);
  ecoScore = Math.max(1, Math.round(ecoScore));

  const estimatedLights = Math.max(0, Math.round(stepDensity * 0.35));

  return {
    avgSpeedKmh: Number(avgSpeedKmh.toFixed(1)),
    fuelLiters: Number(fuelLiters.toFixed(2)),
    fuelCost: Number(fuelCost.toFixed(2)),
    ecoScore,
    estimatedLights,
  };
}

function estimateElevationHeuristic(routeIndex, distanceMeters, durationSeconds) {
  const distanceKm = distanceMeters / 1000;
  const avgSpeedKmh = distanceKm / Math.max(durationSeconds / 3600, 0.1);

  const baseAscent =
    routeIndex === 0 ? distanceKm * 8 : routeIndex === 1 ? distanceKm * 12 : distanceKm * 6;

  const trafficFactor = avgSpeedKmh < 30 ? 1.15 : avgSpeedKmh < 50 ? 1.05 : 0.95;

  const ascentMeters = Math.round(baseAscent * trafficFactor);
  const descentMeters = Math.round(ascentMeters * 0.82);

  return {
    ascentMeters,
    descentMeters,
    ascentText: `${ascentMeters} m`,
    descentText: `${descentMeters} m`,
  };
}

function normalizeRoute(route, index, vehicle) {
  const distanceMeters = Number(route.distance || 0);
  const durationSeconds = Number(route.duration || 0);

  const stepsCount =
    Array.isArray(route.legs) && route.legs.length > 0
      ? route.legs.reduce((acc, leg) => acc + ((leg.steps || []).length || 0), 0)
      : 0;

  const fuel = estimateFuelAndEco({
    distanceMeters,
    durationSeconds,
    stepsCount,
    vehicle,
  });

  const elevation = estimateElevationHeuristic(index, distanceMeters, durationSeconds);

  return {
    id: `route-${index + 1}`,
    label: index === 0 ? "Melhor rota" : index === 1 ? "Alternativa 1" : "Alternativa 2",
    polylineCoords: route.geometry?.coordinates?.map(([lng, lat]) => [lat, lng]) || [],
    distanceMeters,
    durationSeconds,
    distanceText: formatDistance(distanceMeters),
    durationText: formatDuration(durationSeconds),
    ascentMeters: elevation.ascentMeters,
    descentMeters: elevation.descentMeters,
    ascentText: elevation.ascentText,
    descentText: elevation.descentText,
    fuelLiters: fuel.fuelLiters,
    fuelLitersText: formatLiters(fuel.fuelLiters),
    fuelCost: fuel.fuelCost,
    fuelCostText: formatMoneyBRL(fuel.fuelCost),
    ecoScore: fuel.ecoScore,
    estimatedLights: fuel.estimatedLights,
    avgSpeedKmh: fuel.avgSpeedKmh,
  };
}

router.post("/route-analysis", async (req, res) => {
  try {
    const { origin, destination, vehicle } = req.body || {};

    if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
      return res.status(400).json({ error: "Origem e destino são obrigatórios." });
    }

    const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;

    const url =
      `${OSRM_BASE}/route/v1/driving/${coordinates}` +
      `?alternatives=2` +
      `&steps=true` +
      `&annotations=distance,duration,speed` +
      `&overview=full` +
      `&geometries=geojson`;

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || data.code !== "Ok") {
      return res.status(502).json({
        error: data?.message || "Falha ao buscar rota real no OSRM.",
      });
    }

    const routes = (data.routes || [])
      .slice(0, 3)
      .map((route, index) => normalizeRoute(route, index, vehicle))
      .filter((route) => route.polylineCoords.length > 1);

    if (!routes.length) {
      return res.status(404).json({ error: "Nenhuma rota encontrada." });
    }

    return res.json({ routes });
  } catch (error) {
    console.error("route-analysis error:", error);
    return res.status(500).json({ error: "Erro interno ao analisar rotas." });
  }
});

export default router;
