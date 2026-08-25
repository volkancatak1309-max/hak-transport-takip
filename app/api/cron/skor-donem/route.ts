import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/secure-compare";
import { donemiHesaplaVeYaz, rozetleriDegerlendir } from "@/lib/odul-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 30 günlük performans raporu + rozet değerlendirmesi — 60 sn yetmez. */
export const maxDuration = 300;

/**
 * DÖNEM SKORU ANLIK GÖRÜNTÜSÜ + ROZET — HAFTALIK cron (migration 088).
 *
 * ═══ NEDEN CRON, EKRAN AÇILIŞINDA DEĞİL ═══
 *
 * `buildPerformanceReport` 30 günlük olay + telemetri + vardiya taraması
 * yapıyor. Liderlik tablosu HER ŞOFÖRÜN telefonunda açılıyor; her açılışta bu
 * raporu koşturmak hem yavaş hem gereksiz — sıralama saatlik değişmiyor.
 *
 * ═══ NEDEN GEÇMİŞ SAKLANIYOR ═══
 *
 * ÖLÇÜLDÜ: skor geçmişi hiçbir yerde tutulmuyordu (surucu_skorlari /
 * driver_scores / skor_gecmisi → tablo yok). "Üst üste N dönem" diyen bir
 * rozet geçmiş olmadan kurulamaz.
 *
 * ═══ NEDEN HAFTALIK, AYLIK DEĞİL ═══
 *
 * Dönem 30 GÜNLÜK KAYAN pencere; haftada bir yazmak sıralamayı makul tazelikte
 * tutar. Aylık koşsaydı şoför üç hafta boyunca eski sırayı görürdü.
 *
 * ⚠️ Aynı dönemi ikinci kez yazmak ZARARSIZ: `(worker_id, donem_bas)` tekil ve
 * yazma UPSERT. Rozet tarafında da `(worker_id, rozet, donem_bas)` tekil —
 * ikinci koşum 23505 alır ve `tekrar` sayacına düşer.
 *
 * ═══ GERİYE DÖNÜK DOLDURMA ═══
 *
 * `?geri=N` — N dönem geriye kadar hesaplar (en fazla 6). Yeni kurulumda
 * geçmişi bir kerede doldurmak için; her dönem kendi kalibrasyon damgasını
 * alır ve epok öncesi dönemler `epok_oncesi=true` işaretlenir.
 *
 * Kimlik: `CRON_SECRET` — `?secret=` ya da `Authorization: Bearer`.
 */

function yetkili(req: NextRequest): boolean {
  const sir = process.env.CRON_SECRET;
  if (!sir) return false; // fail-closed
  const q = req.nextUrl.searchParams.get("secret");
  if (q && safeEqual(q, sir)) return true;
  const h = req.headers.get("authorization");
  if (h?.startsWith("Bearer ") && safeEqual(h.slice(7).trim(), sir)) return true;
  return false;
}

async function calistir(req: NextRequest) {
  if (!yetkili(req)) {
    return NextResponse.json({ ok: false, sebep: "yetkisiz" }, { status: 401 });
  }

  const geriHam = Number(req.nextUrl.searchParams.get("geri") ?? "0");
  const geri = Number.isFinite(geriHam) ? Math.min(Math.max(0, Math.trunc(geriHam)), 6) : 0;

  try {
    const donemler = [];
    // En eskiden yeniye: rozet değerlendirmesi en son dönemi görsün.
    for (let i = geri; i >= 0; i--) {
      const r = await donemiHesaplaVeYaz(new Date(), i);
      if (r.tabloYok) {
        return NextResponse.json({ ok: false, sebep: "migration_088_yok" }, { status: 503 });
      }
      donemler.push(r);
    }

    const rozet = await rozetleriDegerlendir(new Date());

    return NextResponse.json({
      ok: true,
      donemler,
      rozet: {
        donemBas: rozet.donemBas,
        aday: rozet.aday,
        yazilan: rozet.yazilan,
        /** Tekil indekse takılan — aynı rozet ikinci kez verilmedi. */
        tekrar: rozet.tekrar,
        /**
         * Seri rozeti bugün kazanılabilir mi. false ise sebep TEMİZ DÖNEM
         * AZLIĞI: cihaz eşiği 23.07.2026'da değişti, o sınırdan öncesi
         * karşılaştırılamaz.
         */
        seriKazanilabilir: rozet.seriKazanilabilir,
        temizDonem: rozet.temizDonem,
        hata: rozet.hata,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, sebep: "hata", mesaj: String((e as Error).message).slice(0, 300) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return calistir(req);
}
export async function POST(req: NextRequest) {
  return calistir(req);
}
