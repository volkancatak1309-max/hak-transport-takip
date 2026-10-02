import type { NextRequest } from "next/server";
import { requireMobileWorkerScoped } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { bildirimYaz } from "@/lib/mesaj-moderasyon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/messages/mesaj/[mesajId]/bildir — MESAJI BİLDİR (111).
 *
 * Gövde: `{ sebep: "harassment"|"inappropriate"|"spam"|"other", not?: string }`
 *
 * Herkes (şoför, şef, yönetici) OKUYABİLDİĞİ bir mesajı bildirebilir — kendi
 * mesajı hariç (400 `own_message`). Erişim kuralı okuma kuralının kendisi
 * (`erisimCozKonusma`); erişemeyen 403/404 alır.
 *
 *   200 { zatenBildirildi:false } → kayıt yazıldı, yöneticilere push gitti
 *   200 { zatenBildirildi:true }  → bu kişinin AÇIK bir bildirimi zaten var;
 *                                    hata DEĞİL, aynı sonuç (ikinci push yok)
 *   409 message_deleted           → yönetim mesajı zaten kaldırmış
 *   400 invalid_reason · note_too_long · invalid_note · own_message
 *   503 tablo_yok                 → 111 bu kiracıda koşmamış
 *
 * Mesaj metni bu uçta ne okunur ne loglanır; kayıt yalnız kimliği taşır.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ mesajId: string }> }) {
  const guard = await requireMobileWorkerScoped(req);
  if (!guard.ok) return guard.response;
  const { mesajId } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }
  const inp = (body ?? {}) as Record<string, unknown>;

  const r = await bildirimYaz(guard.actor, mesajId, inp.sebep, inp.not ?? inp.notlar);
  if (!r.ok) return mobileError(r.status, r.code);
  return Response.json({ ok: true, mesajId, ...r.data });
}
