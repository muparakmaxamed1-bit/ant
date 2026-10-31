import { audit, HttpError, requestBody, requireAdmin, serve, validUuid } from "../_shared/http.ts";

Deno.serve((request) => serve(request, async (req) => {
  const { service, user } = await requireAdmin(req);
  const body = await requestBody(req);
  if (!validUuid(body.case_id)) throw new HttpError(400, "A valid case identifier is required.");
  const { data: caseRecord, error: caseError } = await service.from("cases")
    .select("id,case_reference,title,description,incident_date,status,created_at,created_by")
    .eq("id", body.case_id).maybeSingle();
  if (caseError) throw new HttpError(503, "The case report could not be loaded.");
  if (!caseRecord) throw new HttpError(404, "The case was not found.");
  const [visits, links, evidence, creator] = await Promise.all([
    service.from("visits").select("id,visited_at,ip_address,browser,operating_system,device_category,estimated_country,estimated_region,estimated_city,estimated_latitude,estimated_longitude").eq("case_id", caseRecord.id).order("visited_at").limit(5000),
    service.from("generated_links").select("id,description,is_active,expires_at,created_at").eq("case_id", caseRecord.id).order("created_at").limit(5000),
    service.from("evidence").select("id,visit_id,evidence_type,mime_type,file_size,integrity_hash,statement_text,collected_at,storage_path").eq("case_id", caseRecord.id).order("collected_at").limit(5000),
    service.from("profiles").select("full_name").eq("id", caseRecord.created_by).maybeSingle()
  ]);
  for (const result of [visits, links, evidence, creator]) {
    if (result.error) throw new HttpError(503, "A case report section could not be loaded.");
  }
  const visitIds = new Set((visits.data ?? []).map((item) => item.id));
  const ids = [...visitIds];
  const [consents, sessions] = await Promise.all([
    ids.length ? service.from("consent_records").select("id,visit_id,permission_type,consent_status,purpose,consent_timestamp,revoked_at").in("visit_id", ids).order("consent_timestamp").limit(5000) : Promise.resolve({ data: [], error: null }),
    ids.length ? service.from("location_sessions").select("id,visit_id,status,started_at,ended_at").in("visit_id", ids).order("started_at").limit(5000) : Promise.resolve({ data: [], error: null })
  ]);
  if (consents.error || sessions.error) throw new HttpError(503, "A case report section could not be loaded.");
  const sessionIds = (sessions.data ?? []).map((item) => item.id);
  const locations = sessionIds.length
    ? await service.from("location_records").select("id,session_id,latitude,longitude,accuracy,recorded_at").in("session_id", sessionIds).order("recorded_at").limit(5000)
    : { data: [], error: null };
  if (locations.error) throw new HttpError(503, "Location records could not be loaded.");
  const report = {
    generated_at: new Date().toISOString(),
    case: { ...caseRecord, creator_name: creator.data?.full_name ?? null },
    links: links.data,
    visits: visits.data,
    consents: (consents.data ?? []).filter((item) => visitIds.has(item.visit_id)),
    location_sessions: (sessions.data ?? []).filter((item) => visitIds.has(item.visit_id)),
    locations: (locations.data ?? []).filter((item) => sessionIds.has(item.session_id)),
    evidence: evidence.data,
    limitations: [
      "IP-derived locations are estimates and may be inaccurate.",
      "Browser and network metadata do not independently identify a person.",
      "GPS coordinates are collected only after browser permission and are user-submitted technical records.",
      "Allegations and submitted statements are not verified findings."
    ]
  };
  await audit(service, "police_report_generated", "case", caseRecord.id, user.id);
  return report;
}));
