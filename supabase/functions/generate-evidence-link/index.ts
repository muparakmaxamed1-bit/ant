import { audit, getServiceClient, HttpError, rateLimit, requestBody, requiredString, requireAdmin, serve, validUuid } from "../_shared/http.ts";

Deno.serve((request) => serve(request, async (req) => {
  const { service, user } = await requireAdmin(req);
  const body = await requestBody(req);
  const caseId = body.case_id;
  if (!validUuid(caseId)) throw new HttpError(400, "A valid case identifier is required.");
  const description = requiredString(body, "description", 240);
  let expiresAt: string | null = null;
  if (body.expires_at !== undefined && body.expires_at !== null && body.expires_at !== "") {
    if (typeof body.expires_at !== "string" || !Number.isFinite(Date.parse(body.expires_at))) {
      throw new HttpError(400, "The expiration date is invalid.");
    }
    if (Date.parse(body.expires_at) <= Date.now()) throw new HttpError(400, "The expiration date must be in the future.");
    expiresAt = new Date(body.expires_at).toISOString();
  }
  const { data: caseRecord, error: caseError } = await service.from("cases")
    .select("id").eq("id", caseId).is("archived_at", null).maybeSingle();
  if (caseError) throw new HttpError(503, "The selected case could not be verified.");
  if (!caseRecord) throw new HttpError(404, "The selected case does not exist or is archived.");
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...tokenBytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const { data: link, error } = await service.from("generated_links")
    .insert({
      case_id: caseId,
      token_hash: tokenHash,
      description,
      expires_at: expiresAt,
      created_by: user.id
    })
    .select("id,case_id,description,expires_at,created_at")
    .single();
  if (error || !link) throw new HttpError(503, "The evidence link could not be created.");
  await audit(service, "generated", "generated_link", link.id, user.id, { case_id: caseId });
  return { link, token };
}));
