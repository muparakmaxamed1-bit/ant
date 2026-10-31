import { getServiceClient, HttpError, requestBody, requiredString, requireConsent, requireVisit, serve } from "../_shared/http.ts";

function hasExpectedSignature(mimeType: string, bytes: Uint8Array): boolean {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const text = (start: number, length: number) => new TextDecoder().decode(bytes.slice(start, start + length));
  if (mimeType === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (mimeType === "image/png") return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (mimeType === "image/webp") return text(0, 4) === "RIFF" && text(8, 4) === "WEBP";
  if (mimeType === "audio/webm") return starts(0x1a, 0x45, 0xdf, 0xa3);
  if (mimeType === "audio/ogg") return text(0, 4) === "OggS";
  if (mimeType === "audio/mp4") return text(4, 4) === "ftyp";
  if (mimeType === "audio/wav") return text(0, 4) === "RIFF" && text(8, 4) === "WAVE";
  if (mimeType === "audio/mpeg") return text(0, 3) === "ID3" || starts(0xff, 0xfb) || starts(0xff, 0xf3) || starts(0xff, 0xf2);
  return false;
}

Deno.serve((request) => serve(request, async (req) => {
  const service = await getServiceClient();
  const body = await requestBody(req);
  const { link, visit } = await requireVisit(service, req, body, 12);
  const evidenceType = requiredString(body, "evidence_type", 16);
  const bucket = evidenceType === "image" ? "evidence-images" : evidenceType === "audio" ? "evidence-audio" : null;
  const permissionType = evidenceType === "image" ? "camera" : "microphone";
  if (!bucket || body.storage_bucket !== bucket) throw new HttpError(400, "The evidence type and storage bucket do not match.");
  await requireConsent(service, body.consent_id, visit.id, permissionType);
  const storagePath = requiredString(body, "storage_path", 500);
  if (!storagePath.startsWith(`${link.case_id}/${visit.id}/`)) throw new HttpError(403, "The uploaded file does not belong to this visit.");
  const { data: duplicate, error: existingError } = await service.from("evidence").select("id")
    .eq("storage_bucket", bucket).eq("storage_path", storagePath).maybeSingle();
  if (existingError) throw new HttpError(503, "The evidence upload could not be verified.");
  if (duplicate) throw new HttpError(409, "This evidence upload has already been submitted.");
  const { data: file, error: downloadError } = await service.storage.from(bucket).download(storagePath);
  if (downloadError || !file) throw new HttpError(404, "The uploaded file could not be found.");
  const maximumSize = evidenceType === "image" ? 10 * 1024 * 1024 : 20 * 1024 * 1024;
  if (file.size < 1 || file.size > maximumSize) throw new HttpError(413, "The evidence file exceeds the allowed size.");
  const { data: fileInfo, error: infoError } = await service.storage.from(bucket).list(storagePath.slice(0, storagePath.lastIndexOf("/")), {
    search: storagePath.slice(storagePath.lastIndexOf("/") + 1),
    limit: 2
  });
  if (infoError) throw new HttpError(503, "The uploaded file type could not be verified.");
  const fileMetadata = fileInfo?.find((item) => item.name === storagePath.slice(storagePath.lastIndexOf("/") + 1));
  const mimeType = (fileMetadata?.metadata?.mimetype || "").split(";")[0].toLowerCase();
  const permitted = evidenceType === "image"
    ? new Set(["image/jpeg", "image/png", "image/webp"])
    : new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/mpeg"]);
  if (!permitted.has(mimeType)) throw new HttpError(415, "The uploaded file type is not supported.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasExpectedSignature(mimeType, bytes)) throw new HttpError(415, "The uploaded file does not match its declared format.");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const integrityHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const { data: record, error } = await service.from("evidence").insert({
    case_id: link.case_id,
    visit_id: visit.id,
    consent_id: body.consent_id,
    evidence_type: evidenceType,
    storage_path: storagePath,
    storage_bucket: bucket,
    mime_type: mimeType,
    file_size: bytes.byteLength,
    integrity_hash: integrityHash
  }).select("id,collected_at").single();
  if (error || !record) {
    const { error: cleanupError } = await service.storage.from(bucket).remove([storagePath]);
    if (cleanupError) console.error(JSON.stringify({ cleanupError: cleanupError.message, storagePath }));
    throw new HttpError(503, "Evidence metadata could not be saved.");
  }
  return { evidence_id: record.id, collected_at: record.collected_at, integrity_hash: integrityHash };
}));
