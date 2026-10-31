import { audit, HttpError, requestBody, requireAdmin, serve, validUuid } from "../_shared/http.ts";

Deno.serve((request) => serve(request, async (req) => {
  const { service, user } = await requireAdmin(req);
  const body = await requestBody(req);
  if (!validUuid(body.case_id)) throw new HttpError(400, "A valid case identifier is required.");
  const { data: caseRecord, error: caseError } = await service.from("cases")
    .select("id,case_reference,title,description,incident_date,status,created_at").eq("id", body.case_id).maybeSingle();
  if (caseError) throw new HttpError(503, "The case could not be loaded.");
  if (!caseRecord) throw new HttpError(404, "The case was not found.");
  const [visits, evidence] = await Promise.all([
    service.from("visits").select("id,visited_at,ip_address,browser,operating_system,device_category,estimated_country,estimated_region,estimated_city,estimated_latitude,estimated_longitude").eq("case_id", caseRecord.id).order("visited_at").limit(5000),
    service.from("evidence").select("id,visit_id,evidence_type,mime_type,file_size,integrity_hash,collected_at,storage_path,storage_bucket,statement_text").eq("case_id", caseRecord.id).order("collected_at").limit(5000)
  ]);
  for (const result of [visits, evidence]) {
    if (result.error) throw new HttpError(503, "An evidence export section could not be loaded.");
  }
  const visitIds = new Set((visits.data ?? []).map((item) => item.id));
  const ids = [...visitIds];
  const [consents, sessions] = await Promise.all([
    ids.length ? service.from("consent_records").select("id,visit_id,permission_type,consent_status,purpose,consent_timestamp,revoked_at").in("visit_id", ids).order("consent_timestamp").limit(5000) : Promise.resolve({ data: [], error: null }),
    ids.length ? service.from("location_sessions").select("id,visit_id,status,started_at,ended_at").in("visit_id", ids).order("started_at").limit(5000) : Promise.resolve({ data: [], error: null })
  ]);
  if (consents.error || sessions.error) throw new HttpError(503, "An evidence export section could not be loaded.");
  const sessionIds = (sessions.data ?? []).map((item) => item.id);
  const locations = sessionIds.length
    ? await service.from("location_records").select("id,session_id,latitude,longitude,accuracy,recorded_at").in("session_id", sessionIds).order("recorded_at").limit(5000)
    : { data: [], error: null };
  if (locations.error) throw new HttpError(503, "Location records could not be loaded.");
  const evidenceWithUrls = await Promise.all((evidence.data ?? []).map(async (item) => {
    if (!item.storage_path || !item.storage_bucket) return { ...item, download_url: null, url_expires_at: null };
    const { data, error } = await service.storage.from(item.storage_bucket).createSignedUrl(item.storage_path, 60);
    if (error || !data?.signedUrl) throw new HttpError(503, "A secure evidence download link could not be created.");
    return { ...item, download_url: data.signedUrl, url_expires_at: new Date(Date.now() + 60_000).toISOString() };
  }));
  await audit(service, "case_evidence_exported", "case", caseRecord.id, user.id);
  return {
    generated_at: new Date().toISOString(),
    case: caseRecord,
    visits: visits.data,
    consents: (consents.data ?? []).filter((item) => visitIds.has(item.visit_id)),
    location_sessions: (sessions.data ?? []).filter((item) => visitIds.has(item.visit_id)),
    locations: (locations.data ?? []).filter((item) => sessionIds.has(item.session_id)),
    evidence: evidenceWithUrls,
    limitations: [
      "IP-derived locations are estimates and may be inaccurate.",
      "Browser and network metadata do not independently identify a person.",
      "Download URLs expire after 60 seconds; generated exports must be handled securely."
    ]
  };
}));
