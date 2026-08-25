import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/secure-compare";
import { haftalikTuruUret, bildirimSonucuYaz } from "@/lib/haftalik-aksiyon-db";
import { haftalikAksiyonBildir } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Yedi kural, üç rapor koşumu (skor için üç haftalık pencere) — varsayılan
 * 60 sn'lik uç ömrü yetmeyebilir. Vercel'de üst sınır 300 sn (Fluid Compute).
 */
export const maxDuration = 300;

/**
 * HAFTALIK AKSİYON ÜRETİMİ — haftalık cron (migration 084).
 *
 * ═══ NEDEN CRON, SAYFA AÇILIŞINDA DEĞİL ═══
 *
 * Üretim yedi kural + üç performans raporu koşturuyor ve SONUCU YAZIYOR.
 * Sayfa açılışında üretmek üç şeyi bozardı:
 *   1. İlk açan kişi 10-20 saniye bekler (rapor koşumları).
 *   2. Aynı hafta iki kişi aynı anda açarsa iki tur yarışır — `hafta_basi`
 *      tekilliği ikincisini reddeder ama biri hata görür.
 *   3. Bildirim SAYFA AÇILINCA giderdi; oysa vaat "her hafta haber ver".
 *
 * ═══ HAFTADA TAM 1 ═══
 *
 * `haftalikTuruUret` haftanın turu varsa hiçbir şey yazmaz ve `zatenVardi`
 * döner. Zamanlayıcı iki kez tetiklerse ikinci koşum panelin içeriğini
 * DEĞİŞTİRMEZ — kapatılmış kalemler geri gelmez. (bakim-alerts'in "günde tam
 * 1" deseninin haftalık karşılığı.)
 *
 * ═══ BİLDİRİM SONUCU KAYDA GEÇER ═══
 *
 * `haftalikAksiyonBildir` bu modülde bir istisna olarak SONUÇ döndürüyor
 * (gerekçesi lib/push.ts'te): panel "kaç yöneticiye, kaç cihaza gitti"
 * sorusunu cevaplayabilmeli. Ölçüldü ki HAK61'de push jetonu SIFIR — gönderim
 * yolu çalışsa bile hiçbir cihaz çalmaz ve bunu "gitti" saymak yalan olurdu.
 *
 * ═══ BİLDİRİM TURU DÜŞÜRMEZ ═══
 *
 * Bildirim başarısız olsa da tur YAZILMIŞ olur ve panelde görünür. Tersi
 * kabul edilemezdi: Expo yavaşladığı için haftanın aksiyonlarının kaybolması.
 *
 * Kimlik: `CRON_SECRET` — `?secret=` (dış zamanlayıcı) ya da
 * `Authorization: Bearer` (Vercel cron). Karşılaştırma zaman-sabit.
 */
function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const url = new URL(req.url);
  const q = url.searchParams.get("secret");
  if (q && safeEqual(q, expected)) return true;
  const h = req.headers.get("authorization") ?? "";
  const bearer = h.toLowerCase().startsWith("bearer ") ? h.slice(7) : "";
  return bearer.length > 0 && safeEqual(bearer, expected);
}

async function calistir(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, sebep: "yetkisiz" }, { status: 401 });
  }

  /**
   * KURU KOŞUM — `?kuru=1`. Üretir, YAZMAZ, bildirmez.
   * Yeni kiracıda "kural ne çıkarıyor" sorusu, canlıya satır yazmadan
   * cevaplanabilsin (bakim-alerts'teki aynı ihtiyaç).
   */
  const kuru = new URL(req.url).searchParams.get("kuru") === "1";
  if (kuru) {
    const { haftalikKuruKosum } = await import("@/lib/haftalik-aksiyon-db");
    const r = await haftalikKuruKosum();
    return NextResponse.json({ ok: true, kuru: true, ...r });
  }

  const sonuc = await haftalikTuruUret();
  if (!sonuc.ok) {
    return NextResponse.json(
      { ok: false, sebep: sonuc.sebep, mesaj: sonuc.mesaj },
      { status: sonuc.sebep === "tablo_yok" ? 503 : 500 }
    );
  }

  if (sonuc.zatenVardi) {
    return NextResponse.json({
      ok: true,
      haftaBasi: sonuc.haftaBasi,
      zatenVardi: true,
      aciklama: "Bu haftanın turu zaten üretilmiş; hiçbir şey yazılmadı.",
    });
  }

  // ── BİLDİRİM — turu asla düşürmez.
  const bildirim = await haftalikAksiyonBildir({
    haftaBasi: sonuc.haftaBasi,
    aksiyonSayisi: sonuc.secilen.length,
    ilkBaslik: sonuc.secilen[0]?.baslik ?? null,
  });
  await bildirimSonucuYaz(sonuc.turId, bildirim);

  return NextResponse.json({
    ok: true,
    haftaBasi: sonuc.haftaBasi,
    turId: sonuc.turId,
    aksiyon: sonuc.secilen.length,
    elenen: sonuc.elenen,
    tarama: sonuc.tarama,
    bildirim,
    kalemler: sonuc.secilen.map((a) => ({
      kural: a.kural,
      oncelik: a.oncelik,
      baslik: a.baslik,
    })),
  });
}

export async function POST(req: NextRequest) {
  return calistir(req);
}

/** Bazı zamanlayıcılar yalnız GET atıyor — ikisi de aynı işi yapar. */
export async function GET(req: NextRequest) {
  return calistir(req);
}
