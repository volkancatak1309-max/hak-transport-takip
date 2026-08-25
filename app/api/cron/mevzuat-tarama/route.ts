import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/secure-compare";
import { mevzuatTara } from "@/lib/mevzuat-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Açık vardiya başına en çok bir telemetri turu (yalnız EU_561 + sürüş
 * tahmini açıkken). 30 açık vardiyada bile 60 sn yetmeyebilir.
 */
export const maxDuration = 300;

/**
 * MEVZUAT ERKEN UYARI TARAMASI — SIK cron (migration 086).
 *
 * ═══ NEDEN SIK, GÜNDE BİR DEĞİL ═══
 *
 * Bu modülün tek vaadi "ihlal OLMADAN ÖNCE haber ver". En dar kademe 15
 * dakika; tarama 15 dakikada bir koşmazsa o kademe hiç yakalanmaz ve ürün
 * kendi vaadini tutamaz. Önerilen sıklık **15 dakika**.
 *
 * ═══ SIK KOŞMAK NEDEN SPAM ÜRETMİYOR ═══
 *
 * `mevzuat_uyari_tekil` indeksi (worker_id, gun, kural, kademe) tekil.
 * Kademe koşulu 15 dakika boyunca sağlanmaya devam etse de ikinci insert
 * 23505 ile reddedilir ve GÖNDERİM YAPILMAZ. Yanıttaki `tekrar` sayacı
 * kaç tetiklemenin böyle engellendiğini söyler — sıfır olması gerekmez,
 * tersine: sağlıklı bir turda pozitiftir.
 *
 * ═══ KURU KOŞUM ═══
 *
 * `?kuru=1` — kimin hangi kademede olduğunu YAZMADAN ve BİLDİRMEDEN gösterir.
 * Yeni kiracıda eşikleri görmek ve "bu ayarla kaç kişi uyarı alırdı"
 * sorusunu cevaplamak için.
 *
 * Kimlik: `CRON_SECRET` — `?secret=` ya da `Authorization: Bearer`.
 */

function yetkili(req: NextRequest): boolean {
  const sir = process.env.CRON_SECRET;
  if (!sir) return false; // fail-closed: env yoksa uç KAPALI
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

  const kuru = req.nextUrl.searchParams.get("kuru") === "1";

  try {
    const r = await mevzuatTara(new Date(), kuru);

    // migration 086 yok → modül o kiracıda KAPALI. 503, çünkü bu bir istek
    // hatası değil kurulum eksiği; zamanlayıcı kaydı kurulmamalı.
    if (r.tabloYok) {
      return NextResponse.json(
        { ok: false, sebep: "migration_086_yok" },
        { status: 503 }
      );
    }

    return NextResponse.json({
      ok: true,
      kuru,
      taranan: r.taranan,
      aday: r.aday,
      yazilan: r.yazilan,
      /** Tekil indekse takılan tetikleme — SPAM ENGELLENDİ demektir. */
      tekrar: r.tekrar,
      gonderilenler: r.gonderilenler,
      hata: r.hata,
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
