import type { NextRequest } from "next/server";
import { requireMobileWorkerScoped } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { engelle, engelleriGetir } from "@/lib/mesaj-moderasyon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/mobile/messages/engeller — ENGEL LİSTEM (111).
 *
 *   GET  → engellediğim kişiler `{ engeller: [{ workerId, adSoyad, an }] }`
 *   POST → engelle `{ workerId }` (zaten engelliyse 200 + `zatenEngelli`)
 *
 * ── NE YAPAR ───────────────────────────────────────────────────────────────
 * Engellenen kişinin GRUP mesajları bana bir daha gösterilmez (sunucu
 * süzer: geçmiş, okunmamış sayacı, liste önizlemesi) ve o kişinin grup
 * mesajları için bana bildirim gitmez. Karşı taraf bundan haberdar edilmez.
 *
 * ── BİREBİRDE YOK ──────────────────────────────────────────────────────────
 * Birebir kanal işveren kanalı (şoför ↔ yönetim): engel orada uygulanmaz.
 * Şoförün elinde BİLDİR var; yöneticinin elinde "Hesabı pasife al".
 *
 * ── KİMİ ENGELLEYEBİLİRİM ──────────────────────────────────────────────────
 * Ortak bir grupta bulunduğum herkesi (çıkarılmış olsa da). Yönetici her
 * grubu zaten gördüğü için bu şart ona uygulanmaz. Kendimi: 400 `self_block`.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileWorkerScoped(req);
  if (!guard.ok) return guard.response;

  const r = await engelleriGetir(guard.actor);
  if (!r.ok) return mobileError(r.status, r.code);
  return Response.json({ ok: true, ...r.data });
}

export async function POST(req: NextRequest) {
  const guard = await requireMobileWorkerScoped(req);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }
  const inp = (body ?? {}) as Record<string, unknown>;

  const r = await engelle(guard.actor, inp.workerId);
  if (!r.ok) return mobileError(r.status, r.code);
  return Response.json({ ok: true, engel: r.data });
}
