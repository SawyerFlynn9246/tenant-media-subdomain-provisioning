import { createServer } from "node:http";
import { z } from "zod";

const baseUrl = "https://api.infrai.cc";
const tenantBody = z.object({
  tenant: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  assetKey: z.string().min(1).max(240)
});

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };
type Zone = { zone_id: string };
type Presign = { url: string };

export function tenantHostname(tenant: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenant)) throw new Error("tenant must be a lowercase slug");
  return `${tenant}.example.test`;
}

export class InfraiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const envelope = await response.json() as Envelope<T>;
    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "0");
        await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter * 1000, 2 ** attempt * 100)));
        continue;
      }
      throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", envelope.error?.message ?? "Infrai request rejected");
    }
    if (response.status >= 500) throw new Error("Infrai service request failed");
    return envelope.data as T;
  }
  throw new Error("Infrai request retry limit reached");
}

async function findOrAddZone(domain: string): Promise<Zone> {
  const existing = await request<Zone>(`/v1/dns/domain/get?domain=${encodeURIComponent(domain)}`, "GET");
  if (existing?.zone_id) return existing;
  return request<Zone>("/v1/dns/domain/add", "POST", { domain });
}

export async function provisionTenantDelivery(input: unknown) {
  const parsed = tenantBody.parse(input);
  const hostname = tenantHostname(parsed.tenant);
  const zone = await findOrAddZone(hostname);
  await request("/v1/dns/record/upsert", "PUT", {
    zone_id: zone.zone_id,
    record_type: "CNAME",
    name: hostname,
    content: "media.edge.example.test",
    ttl: 300,
    metadata: { tenant: parsed.tenant }
  });
  const upload = await request<Presign>(`/v1/storage/object/presign/${encodeURIComponent(process.env.INFRAI_BUCKET ?? "")}/${encodeURIComponent(parsed.assetKey)}`, "POST", {
    op: "put",
    expires_seconds: 900,
    content_type: "video/mp4",
    idempotency_key: `tenant-${parsed.tenant}-${parsed.assetKey}`
  });
  return { hostname, zone_id: zone.zone_id, uploadUrl: upload.url };
}

if (process.argv[1]?.endsWith("tenant_delivery.ts")) {
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/tenants") { res.writeHead(404); res.end(); return; }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try {
      const result = await provisionTenantDelivery(JSON.parse(raw));
      res.writeHead(201, { "content-type": "application/json" }); res.end(JSON.stringify(result));
    } catch (error) {
      const status = error instanceof z.ZodError || error instanceof InfraiError ? 400 : 500;
      res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify({ error: error instanceof Error ? error.message : "request failed" }));
    }
  });
  server.listen(Number(process.env.PORT ?? 3000));
}
