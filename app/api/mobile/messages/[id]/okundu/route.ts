import type { NextRequest } from "next/server";
import { requireMobileWorkerScoped } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { erisimCoz, hedefSoforMu, konusmaGetir, makbuzYaz } from "@/lib/messaging";
import { READ_RECEIPTS_ENABLED } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/messages/[id]/okundu — konuşmayı okundu işaretle.
 *
 * `[id]` = şoförün kimliği (bkz. lib/messaging.ts). Çağıran, o konuşmadaki
 * KENDİSİNE AİT OLMAYAN tüm mesajları okumuş sayılır.
 *
 * ── BAYRAK KAPALIYKEN SATIR YAZILMAZ ────────────────────────────────────────
 * READ_RECEIPTS_ENABLED=false ise uç 200 döner ama `message_receipts`'e
 * HİÇBİR SATIR yazılmaz ve yanıt `okunduBilgisi:false` der. Kapıyı arayüze
 * koymak yetmezdi: veri yine birikir, "okundu bilgisi tutmuyoruz" beyanı
 * yanlış olurdu (Avusturya §96(1)3 ArbVG / Almanya §87 BetrVG).
 *
 * 403 DÖNMEZ, çünkü bu bir yetki reddi değil bir kurulum tercihidir; istemci
 * ekranı bozulmadan çalışmaya devam etmeli.
 *
 * ── TEKRAR ÇAĞRI ZARARSIZ ───────────────────────────────────────────────────
 * `ignoreDuplicates` — aynı konuşmayı ikinci kez açmak ilk okuma anını EZMEZ.
 * "Ne zaman okudu" sorusunun cevabı ilk açılıştır; her açılışta tazelemek o
 * cevabı yok ederdi.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const guard = await requireMobileWorkerScoped(req);
  if (!guard.ok) return guard.response;

  const erisim = await erisimCoz(guard.actor, id);
  if (!erisim.ok) return mobileError(erisim.status, erisim.code);

  const hedefOk = await hedefSoforMu(id);
  if (!hedefOk.ok) return mobileError(hedefOk.status, hedefOk.code);

  // Okundu işaretlemek konuşma YARATMAZ: okunacak mesaj yoksa yapacak iş yok.
  const konusma = await konusmaGetir(id, false);
  if (!konusma.ok) return mobileError(503, konusma.code);
  if (konusma.id === null) {
    return Response.json({
      ok: true,
      konusmaId: null,
      yeniOkundu: 0,
      okunduBilgisi: READ_RECEIPTS_ENABLED,
    });
  }

  const sonuc = await makbuzYaz(konusma.id, guard.actor.worker.id);

  return Response.json({
    ok: true,
    konusmaId: konusma.id,
    /** Bu çağrıda YENİ yazılan makbuz sayısı. Kapalıyken daima 0. */
    yeniOkundu: sonuc.yazildi,
    okunduBilgisi: !sonuc.kapali && READ_RECEIPTS_ENABLED,
  });
}
