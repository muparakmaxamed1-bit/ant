import { getServiceClient, HttpError, requestBody, requiredString, requireConsent, requireVisit, serve } from "../_shared/http.ts";

Deno.serve((request) => serve(request, async (req) => {
  const service = await getServiceClient();
  const body = await requestBody(req);
  const { link, visit } = await requireVisit(service, req, body, 15);
  const statement = requiredString(body, "statement", 5000);
  await requireConsent(service, body.consent_id, visit.id, "written_statement");
  const { data: record, error } = await service.from("evidence").insert({
    case_id: link.case_id,
    visit_id: visit.id,
    consent_id: body.consent_id,
    evidence_type: "written_statement",
    statement_text: statement,
    collected_at: new Date().toISOString()
  }).select("id,collected_at").single();
  if (error || !record) throw new HttpError(503, "The written statement could not be saved.");
  return { evidence_id: record.id, collected_at: record.collected_at };
}));
