import type { NextRequest } from "next/server";
import { requireMobileWorkerScoped } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { hedefCoz, erisimCozKonusma, makbuzYaz } from "@/lib/messaging";
import { READ_RECEIPTS_ENABLED } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/messages/[id]/okundu — konuşmayı okundu işaretle.
 *
 * `[id]` konuşma kimliği ya da şoför kimliği (bkz. `hedefCoz`). Grup da olur.
 * Çağıran, o konuşmadaki KENDİSİNE AİT OLMAYAN tüm mesajları okumuş sayılır.
 *
 * ── ARŞİVDE DE OKUNABİLİR ───────────────────────────────────────────────────
 * Kilit yalnız YAZMAYA. Arşivlenmiş grubun geçmişi okunabilir olmalı — yoksa
 * arşivlemek silmekle aynı şey olurdu. Aynı gerekçe çıkarılmış üye için de:
 * okur, makbuzu düşer, yazamaz.
 *
 * ── BAYRAK KAPALIYKEN SATIR YAZILMAZ ────────────────────────────────────────
 * READ_RECEIPTS_ENABLED=false ise uç 200 döner ama `message_receipts`'e HİÇBİR
 * SATIR yazılmaz. Kapıyı arayüze koymak yetmezdi: veri yine birikir, "okundu
 * bilgisi tutmuyoruz" beyanı yanlış olurdu (Avusturya §96(1)3 ArbVG / Almanya
 * §87 BetrVG). 403 DÖNMEZ — bu bir yetki reddi değil, kurulum tercihi.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const guard = await requireMobileWorkerScoped(req);
  if (!guard.ok) return guard.response;

  const h = await hedefCoz(id, guard.actor.worker.id);
  if (!h.ok) return mobileError(h.status, h.code);

  const e = await erisimCozKonusma(guard.actor, h.hedef);
  if (!e.ok) return mobileError(e.status, e.code);

  // Konuşma henüz yok (birebir, hiç mesaj yazılmamış) → okunacak şey de yok.
  if (h.hedef.konusmaId === null) {
    return Response.json({
      ok: true,
      konusmaId: null,
      yeniOkundu: 0,
      okunduBilgisi: READ_RECEIPTS_ENABLED,
    });
  }

  const sonuc = await makbuzYaz(h.hedef.konusmaId, guard.actor.worker.id);

  return Response.json({
    ok: true,
    konusmaId: h.hedef.konusmaId,
    /** Bu çağrıda YENİ yazılan makbuz sayısı. Bayrak kapalıyken daima 0. */
    yeniOkundu: sonuc.yazildi,
    okunduBilgisi: !sonuc.kapali && READ_RECEIPTS_ENABLED,
  });
}
