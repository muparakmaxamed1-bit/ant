import { audit, HttpError, requestBody, requireAdmin, serve, validUuid } from "../_shared/http.ts";

Deno.serve((request) => serve(request, async (req) => {
  const { service, user } = await requireAdmin(req);
  const body = await requestBody(req);
  if (!validUuid(body.link_id) || typeof body.is_active !== "boolean") {
    throw new HttpError(400, "A link identifier and active state are required.");
  }
  const { data: existing, error: existingError } = await service.from("generated_links")
    .select("id,expires_at").eq("id", body.link_id).maybeSingle();
  if (existingError) throw new HttpError(503, "The evidence link could not be checked.");
  if (!existing) throw new HttpError(404, "The evidence link was not found.");
  if (body.is_active && existing.expires_at && new Date(existing.expires_at).getTime() <= Date.now()) {
    throw new HttpError(400, "An expired evidence link cannot be reactivated. Generate a new link instead.");
  }
  const { data, error } = await service.from("generated_links")
    .update({ is_active: body.is_active })
    .eq("id", body.link_id)
    .select("id,case_id,is_active")
    .maybeSingle();
  if (error) throw new HttpError(503, "The evidence link could not be updated.");
  if (!data) throw new HttpError(404, "The evidence link was not found.");
  await audit(service, body.is_active ? "activated" : "deactivated", "generated_link", data.id, user.id, { case_id: data.case_id });
  return { success: true, is_active: data.is_active };
}));
