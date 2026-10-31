import { getServiceClient, HttpError, requestBody, requireVisit, serve, validUuid } from "../_shared/http.ts";

Deno.serve((request) => serve(request, async (req) => {
  const service = await getServiceClient();
  const body = await requestBody(req);
  const { visit } = await requireVisit(service, req, body, 60, true);
  if (!validUuid(body.session_id)) throw new HttpError(400, "A valid location session is required.");
  const endedAt = new Date().toISOString();
  const { data: session, error: sessionLookupError } = await service.from("location_sessions")
    .select("id,consent_id,status").eq("id", body.session_id).eq("visit_id", visit.id).maybeSingle();
  if (sessionLookupError) throw new HttpError(503, "The location session could not be checked.");
  if (!session) throw new HttpError(404, "The location session was not found.");
  if (session.status === "active") {
    const { error: endError } = await service.from("location_sessions")
      .update({ status: "ended", ended_at: endedAt })
      .eq("id", session.id).eq("status", "active");
    if (endError) throw new HttpError(503, "The location session could not be ended.");
  }
  const { error: consentError } = await service.from("consent_records")
    .update({ consent_status: "revoked", revoked_at: endedAt })
    .eq("id", session.consent_id).eq("visit_id", visit.id).eq("consent_status", "granted");
  if (consentError) throw new HttpError(503, "The session ended, but consent revocation could not be recorded.");
  return { ended: true, ended_at: endedAt };
}));
