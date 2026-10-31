import { audit, clientIp, HttpError, lookupIp, requestBody, requireAdmin, serve, validUuid } from "../_shared/http.ts";

Deno.serve((request) => serve(request, async (req) => {
  const { service, user } = await requireAdmin(req);
  const body = await requestBody(req);
  if (!validUuid(body.visit_id)) throw new HttpError(400, "A valid visit identifier is required.");
  const { data: visit, error } = await service.from("visits").select("id,ip_address")
    .eq("id", body.visit_id).maybeSingle();
  if (error) throw new HttpError(503, "Visit details could not be loaded.");
  if (!visit) throw new HttpError(404, "Visit was not found.");
  const address = typeof visit.ip_address === "string" ? visit.ip_address : clientIp(req);
  const location = await lookupIp(address);
  const { error: updateError } = await service.from("visits").update(location).eq("id", visit.id);
  if (updateError) throw new HttpError(503, "IP intelligence could not be saved.");
  await audit(service, "ip_intelligence_refreshed", "visit", visit.id, user.id);
  return { updated: true, estimated_location: location };
}));
