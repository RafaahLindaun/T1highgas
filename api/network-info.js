const firstHeader = (value) => {
  if (Array.isArray(value)) return value[0] || null;
  if (typeof value !== "string") return null;
  return value.split(",")[0]?.trim() || null;
};

const decodeHeader = (value) => {
  const raw = firstHeader(value);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");

  const ip =
    firstHeader(req.headers["x-forwarded-for"]) ||
    firstHeader(req.headers["x-real-ip"]) ||
    null;

  const country =
    firstHeader(req.headers["x-vercel-ip-country"]) ||
    firstHeader(req.headers["cf-ipcountry"]) ||
    null;

  const city =
    decodeHeader(req.headers["x-vercel-ip-city"]) ||
    decodeHeader(req.headers["cf-ipcity"]) ||
    null;

  return res.status(200).json({
    ip,
    country,
    city,
    source: country || city ? "edge" : "request",
    checkedAt: new Date().toISOString(),
  });
}
