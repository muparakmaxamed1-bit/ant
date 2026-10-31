import { getServiceClient, HttpError, requestBody, requiredString, requireVisit, serve } from "../_shared/http.ts";

const permissions = new Set(["location", "camera", "microphone", "written_statement"]);

Deno.serve((request) => serve(request, async (req) => {
  const service = await getServiceClient();
  const body = await requestBody(req);
  const { visit } = await requireVisit(service, req, body, 60);
  const permissionType = requiredString(body, "permission_type", 40);
  const status = requiredString(body, "consent_status", 20);
  const purpose = requiredString(body, "purpose", 500);
  if (!permissions.has(permissionType)) throw new HttpError(400, "The permission type is not supported.");
  if (!["granted", "denied", "revoked"].includes(status)) throw new HttpError(400, "The consent status is invalid.");
  const { data: consent, error } = await service.from("consent_records").insert({
    visit_id: visit.id,
    permission_type: permissionType,
    consent_status: status,
    purpose,
    revoked_at: status === "revoked" ? new Date().toISOString() : null
  }).select("id,permission_type,consent_status,consent_timestamp").single();
  if (error || !consent) throw new HttpError(503, "The consent record could not be saved.");
  return { consent_id: consent.id, consent_status: consent.consent_status };
}));
