import { getServiceClient, HttpError, requestBody, requireConsent, requireVisit, serve } from "../_shared/http.ts";

Deno.serve((request) => serve(request, async (req) => {
  const service = await getServiceClient();
  const body = await requestBody(req);
  const { visit } = await requireVisit(service, req, body, 60);
  const consent = await requireConsent(service, body.consent_id, visit.id, "location");
  const { data: session, error } = await service.from("location_sessions")
    .insert({ visit_id: visit.id, consent_id: consent.id, status: "active" })
    .select("id,started_at")
    .single();
  if (error || !session) throw new HttpError(503, "The location session could not be started.");
  return { session_id: session.id, started_at: session.started_at };
}));
