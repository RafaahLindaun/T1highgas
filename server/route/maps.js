import express from "express";

const router = express.Router();
const GOOGLE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

function formatDuration(durationStr) {
  const totalSeconds = Number(String(durationStr || "0s").replace("s", ""));
  const mins = Math.round(totalSeconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

function formatDistance(meters) {
  const km = Number(meters || 0) / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

function formatLiters(value) {
  return `${Number(value || 0).toFixed(2)} L`;
}

function formatMoneyBRL(value) {
  return `R$ ${Number(value || 0).toFixed(2).replace(".", ",")}`;
}

function decodePolyline(encoded) {
  let index = 0;
  const coordinates = [];
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b;
    let shift = 0;
    let result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;

    shift = 0;
    result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;

    coordinates.push([lat / 1e5, lng / 1e5]);
  }

  return coordinates;
}

function estimateFuelAndEco({ distanceMeters, durationStr, stepsCount, vehicle, routeIndex }) {
  const distanceKm = Number(distanceMeters || 0) / 1000;
  const durationSeconds = Number(String(durationStr || "0s").replace("s", ""));
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

  const ascentMeters = Math.round(distanceKm * (routeIndex === 0 ? 8 : routeIndex === 1 ? 12 : 6));
  const descentMeters = Math.round(ascentMeters * 0.82);

  let ecoScore = 100;
  ecoScore -= fuelLiters * 6;
  ecoScore -= avgSpeedKmh < 30 ? 7 : avgSpeedKmh < 45 ? 3 : 0;
  ecoScore -= Math.min(stepDensity * 0.35, 10);
  ecoScore = Math.max(1, Math.round(ecoScore));

  return {
    fuelLiters: Number(fuelLiters.toFixed(2)),
    fuelCost: Number(fuelCost.toFixed(2)),
    ecoScore,
    ascentMeters,
    descentMeters,
  };
}

function normalizeRoute(route, index, vehicle) {
  const encodedPolyline = route?.polyline?.encodedPolyline || "";
  const polylineCoords = encodedPolyline ? decodePolyline(encodedPolyline) : [];

  const stepsCount =
    Array.isArray(route?.legs) && route.legs.length > 0
      ? route.legs.reduce((acc, leg) => acc + ((leg.steps || []).length || 0), 0)
      : 0;

  const fuel = estimateFuelAndEco({
    distanceMeters: route.distanceMeters,
    durationStr: route.duration,
    stepsCount,
    vehicle,
    routeIndex: index,
  });

  return {
    id: `route-${index + 1}`,
    label:
      index === 0
        ? "Melhor rota"
        : route.routeLabels?.includes("DEFAULT_ROUTE_ALTERNATE")
        ? `Alternativa ${index}`
        : `Rota ${index + 1}`,
    distanceMeters: route.distanceMeters || 0,
    duration: route.duration || "0s",
    distanceText: formatDistance(route.distanceMeters || 0),
    durationText: formatDuration(route.duration || "0s"),
    polyline: encodedPolyline,
    polylineCoords,
    fuelLiters: fuel.fuelLiters,
    fuelLitersText: formatLiters(fuel.fuelLiters),
    fuelCost: fuel.fuelCost,
    fuelCostText: formatMoneyBRL(fuel.fuelCost),
    ecoScore: fuel.ecoScore,
    ascentMeters: fuel.ascentMeters,
    descentMeters: fuel.descentMeters,
    ascentText: `${fuel.ascentMeters} m`,
    descentText: `${fuel.descentMeters} m`,
  };
}

router.post("/route-analysis", async (req, res) => {
  try {
    const { origin, destination, vehicle } = req.body || {};

    if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
      return res.status(400).json({ error: "Origem e destino são obrigatórios." });
    }

    if (!process.env.GOOGLE_MAPS_API_KEY) {
      return res.status(500).json({ error: "Falta GOOGLE_MAPS_API_KEY no backend." });
    }

    const body = {
      origin: {
        location: {
          latLng: {
            latitude: origin.lat,
            longitude: origin.lng,
          },
        },
      },
      destination: {
        location: {
          latLng: {
            latitude: destination.lat,
            longitude: destination.lng,
          },
        },
      },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      computeAlternativeRoutes: true,
      languageCode: "pt-BR",
      units: "METRIC",
    };

    const response = await fetch(GOOGLE_ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask":
          "routes.duration,routes.distanceMeters,routes.routeLabels,routes.polyline.encodedPolyline,routes.legs.steps",
      },
      body: JSON.stringify(body),
    });

    const raw = await response.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: `Resposta inválida do Google Routes: ${raw.slice(0, 180)}` });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data?.error?.message ||
          "Falha ao consultar Google Routes API.",
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
    return res.status(500).json({
      error: error?.message || "Erro interno ao analisar rotas.",
    });
  }
});

export default router;
