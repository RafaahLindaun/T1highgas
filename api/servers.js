const NEON_DATA_API =
  "https://ep-misty-truth-acysx2u9.apirest.sa-east-1.aws.neon.tech/highgas/rest/v1";

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

    if (!response.ok) {
      const detail = await response.text();
      return res.status(502).json({
        error: "Catalog unavailable",
        upstreamStatus: response.status,
        upstreamDetail: detail.slice(0, 1000),
      });
    }

    const servers = await response.json();

    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(Array.isArray(servers) ? servers : []);
  } catch (error) {
    return res.status(502).json({
      error: "Catalog unavailable",
      requestError: error instanceof Error ? error.message : String(error),
    });
  }
}
