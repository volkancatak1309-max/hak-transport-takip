import "server-only";
import { supabaseAdmin } from "@/lib/supabase";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export type UploadResult = { ok: true; path: string } | { ok: false; error: string };

function ext(type: string): string {
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("heic")) return "heic";
  return "jpg";
}

/**
 * Upload a receipt photo to a private bucket via the service-role client
 * (bypasses RLS). Path: {workerId}/{yyyy}/{mm}/{uuid}.{ext}
 */
export async function uploadReceipt(
  bucket: string,
  workerId: string,
  file: File
): Promise<UploadResult> {
  if (!file || file.size === 0) return { ok: false, error: "no_file" };
  if (file.size > MAX_BYTES) return { ok: false, error: "too_large" };
  const type = file.type || "image/jpeg";
  if (!ALLOWED.includes(type)) return { ok: false, error: "bad_type" };

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const path = `${workerId}/${yyyy}/${mm}/${crypto.randomUUID()}.${ext(type)}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, buffer, { contentType: type, upsert: false });

  if (error) return { ok: false, error: error.message };
  return { ok: true, path };
}

/** Short-lived signed URL for viewing a private receipt. */
export async function signedReceiptUrl(
  bucket: string,
  path: string,
  expiresIn = 3600
): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}

/**
 * Batch-sign many receipt paths in a single request. Returns a Map keyed by the
 * original path so callers can attach a signed URL to each row. Used to render
 * receipt thumbnails for a whole list (e.g. the admin approvals table) without
 * one round-trip per row. Paths that fail to sign are simply absent from the map.
 */
export async function signedReceiptUrls(
  bucket: string,
  paths: string[],
  expiresIn = 3600
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;

  const { data } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrls(unique, expiresIn);

  for (const item of data ?? []) {
    if (item.path && item.signedUrl) out.set(item.path, item.signedUrl);
  }
  return out;
}
