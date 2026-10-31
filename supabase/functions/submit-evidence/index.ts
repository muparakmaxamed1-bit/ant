import { getServiceClient, HttpError, requestBody, requiredString, requireConsent, requireVisit, serve } from "../_shared/http.ts";

const imageTypes = new Map([
  ["image/jpeg", { bucket: "evidence-images", extension: "jpg", limit: 10 * 1024 * 1024 }],
  ["image/png", { bucket: "evidence-images", extension: "png", limit: 10 * 1024 * 1024 }],
  ["image/webp", { bucket: "evidence-images", extension: "webp", limit: 10 * 1024 * 1024 }]
]);
const audioTypes = new Map([
  ["audio/webm", { bucket: "evidence-audio", extension: "webm", limit: 20 * 1024 * 1024 }],
  ["audio/ogg", { bucket: "evidence-audio", extension: "ogg", limit: 20 * 1024 * 1024 }],
  ["audio/mp4", { bucket: "evidence-audio", extension: "mp4", limit: 20 * 1024 * 1024 }],
  ["audio/wav", { bucket: "evidence-audio", extension: "wav", limit: 20 * 1024 * 1024 }],
  ["audio/mpeg", { bucket: "evidence-audio", extension: "mp3", limit: 20 * 1024 * 1024 }]
]);

Deno.serve((request) => serve(request, async (req) => {
  const service = await getServiceClient();
  const body = await requestBody(req);
  const { link, visit } = await requireVisit(service, req, body, 12);
  const evidenceType = requiredString(body, "evidence_type", 16);
  const mimeType = requiredString(body, "mime_type", 100).split(";")[0].trim().toLowerCase();
  const fileSize = Number(body.file_size);
  if (evidenceType !== "image" && evidenceType !== "audio") throw new HttpError(400, "The evidence type is invalid.");
  const consentType = evidenceType === "image" ? "camera" : "microphone";
  await requireConsent(service, body.consent_id, visit.id, consentType);
  const rule = evidenceType === "image" ? imageTypes.get(mimeType) : audioTypes.get(mimeType);
  if (!rule) throw new HttpError(415, "This evidence file type is not supported.");
  if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > rule.limit) {
    throw new HttpError(413, "The evidence file exceeds the allowed size.");
  }
  const storagePath = `${link.case_id}/${visit.id}/${crypto.randomUUID()}.${rule.extension}`;
  const { data, error } = await service.storage.from(rule.bucket).createSignedUploadUrl(storagePath, { upsert: false });
  if (error || !data?.token) throw new HttpError(503, "A secure upload session could not be created.");
  return {
    storage_path: storagePath,
    storage_bucket: rule.bucket,
    upload_token: data.token,
    mime_type: mimeType,
    file_size_limit: rule.limit
  };
}));
