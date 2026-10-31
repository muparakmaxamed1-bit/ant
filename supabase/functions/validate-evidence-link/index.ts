import { getServiceClient, rateLimit, requestBody, requiredString, serve, validateLink } from "../_shared/http.ts";

Deno.serve((request) => serve(request, async (req) => {
  const service = await getServiceClient();
  const body = await requestBody(req);
  const token = requiredString(body, "token", 128);
  const link = await validateLink(service, token);
  await rateLimit(service, link.token_hash, req, 60, 60);
  return {
    valid: true,
    description: link.description,
    case_title: link.cases?.title ?? null
  };
}));
