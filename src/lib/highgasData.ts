export type VpnServer = {
  id: number;
  code: string;
  country_code: string;
  country_name: string;
  city: string;
  protocol: "wireguard" | "openvpn";
  status: "online" | "maintenance" | "offline";
  is_recommended: boolean;
  sort_order: number;
};

export const fallbackServers: VpnServer[] = [
  {
    id: 1,
    code: "br-sao-01",
    country_code: "BR",
    country_name: "Brasil",
    city: "São Paulo",
    protocol: "wireguard",
    status: "online",
    is_recommended: true,
    sort_order: 10,
  },
  {
    id: 2,
    code: "us-mia-01",
    country_code: "US",
    country_name: "Estados Unidos",
    city: "Miami",
    protocol: "wireguard",
    status: "online",
    is_recommended: false,
    sort_order: 20,
  },
  {
    id: 3,
    code: "nl-ams-01",
    country_code: "NL",
    country_name: "Países Baixos",
    city: "Amsterdam",
    protocol: "wireguard",
    status: "online",
    is_recommended: false,
    sort_order: 30,
  },
  {
    id: 4,
    code: "de-fra-01",
    country_code: "DE",
    country_name: "Alemanha",
    city: "Frankfurt",
    protocol: "wireguard",
    status: "online",
    is_recommended: false,
    sort_order: 40,
  },
  {
    id: 5,
    code: "gb-lon-01",
    country_code: "GB",
    country_name: "Reino Unido",
    city: "Londres",
    protocol: "wireguard",
    status: "online",
    is_recommended: false,
    sort_order: 50,
  },
];

export async function loadVpnServers(): Promise<{
  servers: VpnServer[];
  source: "supabase" | "fallback";
}> {
  try {
    const response = await fetch("/api/servers", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`HighGAS catalog respondeu ${response.status}`);
    }

    const data = (await response.json()) as VpnServer[];
    const usable = data.filter(
      (server) =>
        server.status !== "offline" &&
        typeof server.country_code === "string" &&
        typeof server.country_name === "string" &&
        typeof server.code === "string"
    );

    // Kept only as a backwards-compatible internal "cloud" flag for App.tsx.
    return usable.length
      ? { servers: usable, source: "supabase" }
      : { servers: fallbackServers, source: "fallback" };
  } catch {
    return { servers: fallbackServers, source: "fallback" };
  }
}
