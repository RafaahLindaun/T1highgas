const servers = [
  {
    id: 1,
    code: "de-fra-01",
    country_code: "DE",
    country_name: "Alemanha",
    city: "Rede Tor",
    protocol: "tor",
    status: "online",
    is_recommended: true,
    sort_order: 10,
  },
  {
    id: 2,
    code: "us-mia-01",
    country_code: "US",
    country_name: "Estados Unidos",
    city: "Rede Tor",
    protocol: "tor",
    status: "online",
    is_recommended: false,
    sort_order: 20,
  },
];

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("X-HighGAS-Source", "tor-local");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res.status(200).json(servers);
}
