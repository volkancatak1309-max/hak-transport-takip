import type { NextRequest } from "next/server";
import { requireMobileWorker } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { liderlikPanosu } from "@/lib/odul-db";
import { ROZET_SKOR_ESIK, SERI_DONEM, DONEM_GUN } from "@/lib/odul";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/odul — ŞOFÖRÜN KENDİ SKORU, SIRASI VE ROZETLERİ (088).
 *
 * ═══ KAPI: `requireMobileWorker` — HER ŞOFÖR ═══
 *
 * Bu uç şoförün KENDİ durumunu gösteriyor; kapsam kısıtı gerekmiyor. Ama
 * liderlik tablosu başkalarının skorunu da taşıyor ve orada kural sert:
 *
 * 🔴 İSİM VARSAYILAN OLARAK GİZLİ. Kapalıyken şoför yalnız KENDİ adını görür;
 * diğerleri "Şoför #N" olarak döner ve `workerId` GÖVDEDEN HİÇ ÇIKMAZ.
 * Kimliği istemcide gizlemek yetmez — sızıntı gövdede olur.
 *
 * Gerekçe: § 87 Abs. 1 Nr. 6 BetrVG — çalışanın performansını izlemeye
 * ELVERİŞLİ teknik düzenek işletme kurulunun ortak kararına tabidir; ölçüt
 * işverenin niyeti değil düzeneğin nesnel elverişliliğidir. İsimli bir
 * liderlik tablosu tam olarak odur. (AT tarafında DSG aynı yöne bakar.)
 */
export async function GET(req: NextRequest) {
  const kapi = await requireMobileWorker(req);
  if (!kapi.ok) return kapi.response;

  const benId = kapi.actor.worker.id;

  try {
    const pano = await liderlikPanosu(benId, (n) => `#${n}`);

    if (pano.tabloYok) {
      return Response.json(
        { ok: false, error: "modul_kapali", mesaj: "Ödül katmanı bu kurulumda kapalı (migration 088)." },
        { status: 503 }
      );
    }

    /**
     * ⚠️ GÖVDE İSİM GİZLİYKEN KİMLİK TAŞIMAZ.
     *
     * `workerId` yalnız şoförün KENDİ satırında ve isim açıkken dışarı
     * çıkar. Aksi hâlde iki dönem karşılaştırılarak takma sıra çözülebilirdi.
     */
    const gizle = !pano.ayar.isimGorunur;
    const satir = (r: (typeof pano.siralı)[number]) => ({
      ...(gizle && !r.ben ? {} : { workerId: r.workerId }),
      ad: r.ad,
      sira: r.sira,
      skor: r.skor,
      /** null = ölçülemedi; sebebi `kapi`. SIFIR DEĞİL. */
      kapi: r.kapi,
      km: r.km,
      esikKm: r.esikKm,
      ben: r.ben,
      yon: r.yon,
      oncekiSkor: r.oncekiSkor,
    });

    return Response.json({
      ok: true,
      donem: { bas: pano.donemBas, bit: pano.donemBit, gun: DONEM_GUN },
      /** Şoförün kendi satırı — listede olmasa da burada. */
      ben: pano.ben ? satir(pano.ben) : null,
      siralama: pano.siralı.map(satir),
      /**
       * SKORSUZLAR AYRI. Sıralamaya girmezler ve 0 puan almazlar —
       * "yeterli veri yok" bir sıra değil, bir sebeptir.
       */
      skorsuz: pano.skorsuz.map(satir),
      rozetler: pano.rozetler.map((r) => ({
        rozet: r.rozet,
        donemBas: r.donemBas,
        kanit: r.kanit,
        kazanildiAt: r.kazanildiAt,
      })),
      /**
       * SERİ ROZETİ HENÜZ KAZANILABİLİR Mİ. Kazanılamıyorsa istemci sebebi
       * yazar — boş göstermek şoföre "kazanamadın" dedirtir, oysa temiz veri
       * henüz o kadar uzun değil (cihaz eşiği 23.07.2026'da değişti).
       */
      seri: {
        gerekenDonem: SERI_DONEM,
        temizDonem: pano.seri.temizDonem,
        kazanilabilir: pano.seri.olur,
        eksikDonem: pano.seri.eksikDonem,
      },
      esik: { rozet: ROZET_SKOR_ESIK },
      isimGorunur: pano.ayar.isimGorunur,
      rozetAcik: pano.ayar.rozetAcik,
      /** Bu dönem kalibrasyon sınırından önce mi başlıyor (karışık cetvel). */
      epokOncesi: pano.epokOncesi,
    });
  } catch (e) {
    return mobileError(500, "hata", { mesaj: String((e as Error).message).slice(0, 200) });
  }
}
