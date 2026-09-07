const NEON_DATA_API =
  "https://ep-misty-truth-acysx2u9.apirest.sa-east-1.aws.neon.tech/highgas/rest/v1";

const fallbackServers = [
  { id: 1, code: "br-sao-01", country_code: "BR", country_name: "Brasil", city: "São Paulo", protocol: "wireguard", status: "online", is_recommended: true, sort_order: 10 },
  { id: 2, code: "us-mia-01", country_code: "US", country_name: "Estados Unidos", city: "Miami", protocol: "wireguard", status: "online", is_recommended: false, sort_order: 20 },
  { id: 3, code: "nl-ams-01", country_code: "NL", country_name: "Países Baixos", city: "Amsterdam", protocol: "wireguard", status: "online", is_recommended: false, sort_order: 30 },
  { id: 4, code: "de-fra-01", country_code: "DE", country_name: "Alemanha", city: "Frankfurt", protocol: "wireguard", status: "online", is_recommended: false, sort_order: 40 },
  { id: 5, code: "gb-lon-01", country_code: "GB", country_name: "Reino Unido", city: "Londres", protocol: "wireguard", status: "online", is_recommended: false, sort_order: 50 },
];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const endpoint =
    `${NEON_DATA_API}/highgas_servers` +
    "?select=id,code,country_code,country_name,city,protocol,status,is_recommended,sort_order" +
    "&is_active=eq.true&order=sort_order.asc";

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
    });

    if (response.ok) {
      const servers = await response.json();
      if (Array.isArray(servers) && servers.length > 0) {
        res.setHeader("X-HighGAS-Source", "neon");
        res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
        return res.status(200).json(servers);
      }
    }
  } catch {
    // Fall through to the embedded catalog. Availability is more important
    // than making the UI depend on a remote service for five public rows.
  }

  res.setHeader("X-HighGAS-Source", "fallback");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res.status(200).json(fallbackServers);
}
