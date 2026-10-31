import { clientIp, getServiceClient, HttpError, lookupIp, parseUserAgent, rateLimit, requestBody, requiredString, serve, validateLink } from "../_shared/http.ts";

Deno.serve((request) => serve(request, async (req) => {
  const service = await getServiceClient();
  const body = await requestBody(req);
  const token = requiredString(body, "token", 128);
  const link = await validateLink(service, token);
  await rateLimit(service, link.token_hash, req, 20, 60);
  const userAgent = typeof body.user_agent === "string" ? body.user_agent.slice(0, 2048) : "";
  const clientAddress = clientIp(req);
  const ipMetadata = clientAddress ? await lookupIp(clientAddress) : {};
  const browser = parseUserAgent(userAgent);
  const { data: visit, error } = await service.from("visits").insert({
    link_id: link.id,
    case_id: link.case_id,
    ip_address: clientAddress,
    user_agent: userAgent || null,
    ...browser,
    ...ipMetadata
  }).select("id,visited_at").single();
  if (error || !visit) throw new HttpError(503, "The visit could not be recorded.");
  return { visit_id: visit.id, visited_at: visit.visited_at };
}));
