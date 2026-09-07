import { neon } from "@neondatabase/serverless";

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

  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (databaseUrl) {
    try {
      const sql = neon(databaseUrl);
      const servers = await sql`
        select
          id,
          code,
          country_code,
          country_name,
          city,
          protocol,
          status,
          is_recommended,
          sort_order
        from public.highgas_servers
        where is_active = true
          and status <> 'offline'
        order by sort_order asc, id asc
      `;

      if (Array.isArray(servers) && servers.length > 0) {
        res.setHeader("X-HighGAS-Source", "neon");
        res.setHeader(
          "Cache-Control",
          "public, s-maxage=60, stale-while-revalidate=300"
        );
        return res.status(200).json(servers);
      }
    } catch (error) {
      console.error(
        "HighGAS Neon query failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  res.setHeader("X-HighGAS-Source", "fallback");
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=60, stale-while-revalidate=300"
  );
  return res.status(200).json(fallbackServers);
}
