import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new HttpError(503, "Backend service is not configured.");
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function allowedOrigins(): Set<string> {
  return new Set((Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean));
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  });
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins().has(origin.replace(/\/$/, ""))) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

export function serve(
  request: Request,
  handler: (request: Request) => Promise<Response | Record<string, unknown>>
): Promise<Response> {
  const headers = corsHeaders(request);
  const origin = request.headers.get("origin");
  if (origin && !headers.has("Access-Control-Allow-Origin")) {
    return Promise.resolve(new Response(JSON.stringify({ error: "Origin is not allowed." }), {
      status: 403,
      headers: new Headers({ "Content-Type": "application/json", "Vary": "Origin" })
    }));
  }
  if (request.method === "OPTIONS") return Promise.resolve(new Response(null, { status: 204, headers }));
  if (request.method !== "POST") {
    headers.set("Content-Type", "application/json");
    return Promise.resolve(new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers }));
  }
  return handler(request)
    .then((result) => {
      if (result instanceof Response) {
        const responseHeaders = new Headers(result.headers);
        for (const [key, value] of headers) responseHeaders.set(key, value);
        return new Response(result.body, { status: result.status, statusText: result.statusText, headers: responseHeaders });
      }
      headers.set("Content-Type", "application/json");
      headers.set("Cache-Control", "no-store");
      return new Response(JSON.stringify(result), { status: 200, headers });
    })
    .catch((error: unknown) => {
      const known = error instanceof HttpError;
      const status = known ? error.status : 500;
      const message = known ? error.message : "The request could not be completed.";
      console.error(JSON.stringify({ functionError: message, status }));
      headers.set("Content-Type", "application/json");
      headers.set("Cache-Control", "no-store");
      return new Response(JSON.stringify({ error: message }), { status, headers });
    });
}

export async function requestBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Expected an object.");
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "A valid JSON request body is required.");
  }
}

export function requiredString(body: Record<string, unknown>, key: string, maximum = 500): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new HttpError(400, `${key} is required and must be no more than ${maximum} characters.`);
  }
  return value.trim();
}

export function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function requireAdmin(request: Request): Promise<{ service: SupabaseClient; user: User }> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!token || !url || !anonKey) throw new HttpError(401, "Administrator authentication is required.");
  const authClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: { user }, error } = await authClient.auth.getUser(token);
  if (error || !user) throw new HttpError(401, "Administrator authentication is invalid or expired.");
  const service = serviceClient();
  const { data: profile, error: profileError } = await service.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profileError) throw new HttpError(503, "Administrator access could not be verified.");
  if (profile?.role !== "admin") throw new HttpError(403, "Administrator access is required.");
  return { service, user };
}

export async function tokenHash(token: unknown): Promise<string> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new HttpError(404, "This evidence link is invalid, inactive, or expired.");
  }
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function validateLink(
  service: SupabaseClient,
  token: unknown,
  options: { allowInactive?: boolean; allowExpired?: boolean } = {}
) {
  const hash = await tokenHash(token);
  const { data, error } = await service.from("generated_links")
    .select("id,case_id,token_hash,description,is_active,expires_at,cases(title,case_reference)")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error) throw new HttpError(503, "Evidence link validation is temporarily unavailable.");
  if (!data || (!options.allowInactive && !data.is_active) ||
      (!options.allowExpired && data.expires_at && new Date(data.expires_at).getTime() <= Date.now())) {
    throw new HttpError(404, "This evidence link is invalid, inactive, or expired.");
  }
  return data;
}

export function clientIp(request: Request): string | null {
  const direct = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip");
  const value = direct || request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  if (!value || value.length > 64 || !/^[0-9a-fA-F:.]+$/.test(value)) return null;
  return value;
}

export async function rateLimit(
  service: SupabaseClient,
  key: string,
  request: Request,
  limit = 30,
  windowSeconds = 60
): Promise<void> {
  const source = clientIp(request) || "unknown";
  const bytes = new TextEncoder().encode(`${key}:${source}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const rateKey = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const { data, error } = await service.rpc("consume_public_rate_limit", {
    p_rate_key: rateKey,
    p_limit: limit,
    p_window_seconds: windowSeconds
  });
  if (error) throw new HttpError(503, "Request protection is temporarily unavailable.");
  if (data !== true) throw new HttpError(429, "Too many requests. Please wait and try again.");
}

export async function requireVisit(
  service: SupabaseClient,
  request: Request,
  body: Record<string, unknown>,
  limit = 60,
  allowInactiveOrExpired = false
) {
  const token = requiredString(body, "token", 128);
  const link = await validateLink(service, token, {
    allowInactive: allowInactiveOrExpired,
    allowExpired: allowInactiveOrExpired
  });
  await rateLimit(service, link.token_hash, request, limit);
  const visitId = body.visit_id;
  if (!validUuid(visitId)) throw new HttpError(400, "A valid visit identifier is required.");
  const { data: visit, error } = await service.from("visits").select("id,link_id,case_id")
    .eq("id", visitId).eq("link_id", link.id).eq("case_id", link.case_id).maybeSingle();
  if (error) throw new HttpError(503, "The visit could not be verified.");
  if (!visit) throw new HttpError(403, "The visit is not authorized for this evidence link.");
  return { link, visit };
}

export async function requireConsent(
  service: SupabaseClient,
  consentId: unknown,
  visitId: string,
  permissionType: string
) {
  if (!validUuid(consentId)) throw new HttpError(400, "A valid consent record is required.");
  const { data, error } = await service.from("consent_records")
    .select("id,visit_id,permission_type,consent_status,revoked_at")
    .eq("id", consentId).eq("visit_id", visitId).maybeSingle();
  if (error) throw new HttpError(503, "Consent could not be verified.");
  if (!data || data.permission_type !== permissionType || data.consent_status !== "granted" || data.revoked_at) {
    throw new HttpError(403, "A valid, active consent record is required.");
  }
  return data;
}

export async function audit(
  service: SupabaseClient,
  action: string,
  entityType: string,
  entityId: string | null,
  adminId: string | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await service.from("audit_logs").insert({
    admin_id: adminId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata
  });
  if (error) throw new HttpError(503, "The operation could not be audited.");
}

export function parseUserAgent(userAgent: string) {
  const ua = userAgent.toLowerCase();
  const browser = ua.includes("edg/") ? "Edge" : ua.includes("firefox/") ? "Firefox" :
    ua.includes("opr/") ? "Opera" : ua.includes("chrome/") ? "Chrome" :
    ua.includes("safari/") ? "Safari" : "Unknown";
  const operatingSystem = ua.includes("windows") ? "Windows" :
    ua.includes("android") ? "Android" : ua.includes("iphone") || ua.includes("ipad") ? "iOS" :
    ua.includes("mac os") || ua.includes("macintosh") ? "macOS" :
    ua.includes("linux") ? "Linux" : "Unknown";
  const deviceCategory = /ipad|tablet/.test(ua) ? "Tablet" :
    /mobile|iphone|android/.test(ua) ? "Mobile" : "Desktop";
  return { browser, operatingSystem, deviceCategory };
}

export async function lookupIp(ip: string | null) {
  const endpoint = Deno.env.get("IP_GEOLOCATION_URL");
  const apiKey = Deno.env.get("IP_GEOLOCATION_API_KEY");
  if (!endpoint || !apiKey || !ip) return {};
  const url = new URL(endpoint);
  url.searchParams.set("ip", ip);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new HttpError(502, "IP location lookup failed.");
  const result: unknown = await response.json();
  if (!result || typeof result !== "object") throw new HttpError(502, "IP location provider returned invalid data.");
  const value = result as Record<string, unknown>;
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  return {
    estimated_country: typeof value.country === "string" ? value.country.slice(0, 100) : null,
    estimated_region: typeof value.region === "string" ? value.region.slice(0, 100) : null,
    estimated_city: typeof value.city === "string" ? value.city.slice(0, 100) : null,
    estimated_latitude: Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 ? latitude : null,
    estimated_longitude: Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? longitude : null
  };
}

export async function getServiceClient(): Promise<SupabaseClient> {
  return serviceClient();
}
