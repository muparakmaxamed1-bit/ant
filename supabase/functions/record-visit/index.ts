import { clientIp, getServiceClient, HttpError, lookupIp, parseUserAgent, rateLimit, requestBody, requiredString, serve, validateLink } from "../_shared/http.ts";

Deno.serve((request) => serve(request, async (req) => {
  const requestId = crypto.randomUUID();
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
  if (error) {
    let safeMessage = error.message;
    for (const value of [token, userAgent, clientAddress ?? ""]) {
      if (value) safeMessage = safeMessage.replaceAll(value, "[redacted]");
    }
    safeMessage = safeMessage
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted-ip]")
      .replace(/\b(?:[a-f0-9]{1,4}:){2,}[a-f0-9:.]*/gi, "[redacted-ip]")
      .slice(0, 500);
    console.error(JSON.stringify({
      operation: "visits.insert_returning",
      request_id: requestId,
      success: false,
      code: error.code || null,
      message: safeMessage
    }));
    throw new HttpError(
      503,
      "Visit recording is temporarily unavailable. Please try again.",
      "VISIT_RECORDING_FAILED",
      requestId
    );
  }
  if (!visit) {
    console.error(JSON.stringify({
      operation: "visits.insert_returning",
      request_id: requestId,
      success: false,
      code: "NO_ROW_RETURNED",
      message: "The insert operation returned no visit row."
    }));
    throw new HttpError(
      503,
      "Visit recording is temporarily unavailable. Please try again.",
      "VISIT_RECORDING_FAILED",
      requestId
    );
  }
  console.info(JSON.stringify({
    operation: "visits.insert_returning",
    request_id: requestId,
    success: true
  }));
  return { visit_id: visit.id, visited_at: visit.visited_at };
}));
