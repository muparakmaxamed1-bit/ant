import { getServiceClient, HttpError, rateLimit, requestBody, requireConsent, requireVisit, serve, validUuid } from "../_shared/http.ts";

Deno.serve((request) => serve(request, async (req) => {
  const service = await getServiceClient();
  const body = await requestBody(req);
  const { visit } = await requireVisit(service, req, body, 120);
  if (!validUuid(body.session_id)) throw new HttpError(400, "A valid location session is required.");
  const { data: session, error: sessionError } = await service.from("location_sessions")
    .select("id,visit_id,consent_id,status")
    .eq("id", body.session_id).eq("visit_id", visit.id).maybeSingle();
  if (sessionError) throw new HttpError(503, "The location session could not be checked.");
  if (!session || session.status !== "active") throw new HttpError(403, "The location session is not active.");
  await requireConsent(service, session.consent_id, visit.id, "location");
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const accuracy = Number(body.accuracy);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100000) {
    throw new HttpError(400, "The location coordinates or accuracy are invalid.");
  }
  await rateLimit(service, session.id, req, 120, 60);
  const { data: record, error } = await service.from("location_records").insert({
    session_id: session.id,
    latitude,
    longitude,
    accuracy,
    recorded_at: new Date().toISOString()
  }).select("id,recorded_at").single();
  if (error || !record) throw new HttpError(503, "The location update could not be stored.");
  return { location_record_id: record.id, recorded_at: record.recorded_at };
}));
