import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { co2Panosu, co2PanosuOzet, co2PanosuAylik } from "@/lib/co2-db";
import { aralikCoz, aralikHataAlanlari } from "../../_rapor/aralik";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/analytics/co2 — CO₂ PANOSU, KENDİ UCUNDA.
 *
 * `?range=gun|hafta|ay|tumzaman|ozel` (+ `?from=&to=` YYYY-MM-DD, yalnız `ozel`)
 * — `/api/mobile/analytics` ile BİREBİR aynı aralık dili, aynı `aralikCoz`.
 *
 * ═══ 🔴 NEDEN AYRILDI — ÖLÇÜMLE ═══════════════════════════════════════════
 *
 * `co2Panosu()` 28.08.2026'ya kadar `/api/mobile/analytics` içinde, ekranın
 * AÇILIŞ yolunda çağrılıyordu. Ölçüldü (HAK61 canlı, salt okuma):
 *
 *     /api/mobile/analytics TOPLAM     1.301 çağrı · 41,8 sn
 *       └─ co2Panosu()                 1.115 çağrı · 36,7 sn   ← %86
 *
 * Mobil istemci 14 sn ve 30 sn'de vazgeçti, yani Analiz ekranı veriye
 * HİÇBİR ZAMAN ulaşamıyordu — CO₂ tek satırlık bir özet olduğu hâlde bütün
 * ekranı rehin alıyordu. Ayrıntı: `docs/ANALIZ-YAVASLIK.md`.
 *
 * ═══ ⚠️ BU UÇ HÂLÂ YAVAŞ — VE BU BİLİNÇLİ ════════════════════════════════
 *
 * Ayırma işlemi CO₂'yi hızlandırmadı, yalnız Analiz ekranını KURTARDI. Bu uç
 * bugün de ~37 sn sürer, çünkü `co2Panosu` → `aylikSeri()` son 6 ayı
 * `for` döngüsünde SIRAYLA tam `buildFuelReport` ile hesaplıyor
 * (`lib/co2-db.ts:415`): 1 + 6 = 7 tam yakıt raporu, ardışık. Tek rapor
 * ölçüldü: 171 çağrı / 11,0 sn.
 *
 * 🔴 İSTEMCİ BU UCU BUGÜN AÇILIŞTA ÇAĞIRMAMALI. Kullanıcı CO₂ sekmesine
 * dokununca, kendi yükleniyor durumuyla ve uzun timeout'la çağırmalı.
 *
 * ═══ `?bolum=` — KISMİ SONUÇ (Ö2, 31.08.2026) ════════════════════════════
 *
 * Uç iki PAHALI ve bağımsız iş yapıyor (HAK61 canlı, ölçüldü):
 *     gövde (seçilen pencere raporu)  8,78 sn
 *     aylık seri (son 6 ay)           8,85 sn
 * Ekranın ilk göstereceği sayı yalnız GÖVDEYE bağlı, ama bugün ikisi tek
 * yanıtta bekletiliyor. `?bolum=` bekleyişi bölüyor:
 *
 *   (yok)          → BUGÜNKÜ TAM GÖVDE — eski istemci hiç değişmeden çalışır
 *   ?bolum=ozet    → `ozet` + `pano` (aylik alanı YOK) · ~9 sn
 *   ?bolum=aylik   → yalnız `aylik` · ~9 sn
 *
 * İki çağrı PARALEL atılabilir; toplam duvar saati ~18 sn'den ~9 sn'ye iner
 * ve ekrandaki ilk sayı ~9 sn'de görünür.
 *
 * ⚠️ Neden ayrı uç değil: yetki (`requireMobileAdmin`) ve aralık dili
 * (`aralikCoz`) ikinci kez kurulurdu; "son 30 gün" iki yüzeyde iki pencereye
 * ayrılırsa yönetici sayıyı bulamaz — `_rapor/aralik.ts` başlığındaki aynı
 * gerekçe. Neden akış (streaming) değil: RN istemcisinde kısmi JSON ayrıştırma
 * ve ayrı hata yolu gerekir, kazanç aynı.
 *
 * Kalıcı çözüm bu dosyada DEĞİL, iki yerde:
 *   S2 — `report_fuel_volume_stats` araç eksenine çevrilecek (rapor başına
 *        ~5 sn'lik kapsamsız tek gövde; `docs/HAK61-SAGLIK.md` § 8.2)
 *   S4 — aylık seri `vehicle_month_metrics`ten okunacak (migration 090 o
 *        tabloyu kurdu, canlıda 0 satır — 6 rapor → 1 sorgu)
 * İkisi de ayrı turda; bu tur onlara DOKUNMADI.
 *
 * ═══ SÖZLEŞME ═════════════════════════════════════════════════════════════
 *
 * `ozet` alanı, `/api/mobile/analytics`in eskiden döndürdüğü `co2` nesnesinin
 * BİREBİR aynısıdır — istemcinin mevcut çizim kodu değiştirilmeden çalışır.
 * `pano` ise web CO₂ ekranının gördüğü tam kırılımdır (araç/şoför/müşteri/
 * aylık); mobilde karşılığı yoksa okunmaz.
 *
 * ⚠️ `ozet.kg` null olabilir ve bu SIFIR DEĞİLDİR: aralıkta hiçbir aracın
 * tüketimi ölçülemediyse emisyon bilinmiyordur. `kapsama` kaç araçtan kaçının
 * ölçüldüğünü söyler; istemci sayıyı kapsamasız göstermemeli. `esas` TTW/WTW —
 * hangi cetvelle ölçüldüğü sayının yanında durmalı.
 *
 * Yetki `/api/mobile/analytics` ile aynı: yalnız yönetici (`requireMobileAdmin`).
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const cozum = aralikCoz(url);
  if (!cozum.ok) {
    return mobileError(400, cozum.kod, aralikHataAlanlari(cozum.kod));
  }
  const c = cozum.cozum;

  const bolumHam = url.searchParams.get("bolum");
  if (bolumHam !== null && bolumHam !== "ozet" && bolumHam !== "aylik") {
    return mobileError(400, "invalid_bolum", { alan: "bolum", gecerli: ["ozet", "aylik"] });
  }
  const bolum: "ozet" | "aylik" | "tam" = bolumHam ?? "tam";

  const donem = {
    tur: c.tur,
    baslangic: c.range.start.toISOString(),
    bitis: c.range.end.toISOString(),
    from: c.from,
    to: c.to,
  };

  /**
   * 🔴 AYLIK SERİ YALNIZ KENDİ ÇAĞRISINDA. `ozet`/`pano` YOK — kasıtlı:
   * boş bir `ozet` göndermek, istemcinin onu "0 kg" diye çizmesine davetiye
   * olurdu. Alan yoksa okunamaz.
   */
  if (bolum === "aylik") {
    const p = await co2PanosuAylik(c.range.start, c.range.end);
    return Response.json({
      ok: true,
      bolum,
      donem,
      aylik: p.aylik,
      katsayiSurum: p.katsayiSurum,
      tabloYok: p.tabloYok,
    });
  }

  const pano = bolum === "ozet"
    ? await co2PanosuOzet(c.range.start, c.range.end)
    : await co2Panosu(c.range.start, c.range.end);

  return Response.json({
    ok: true,
    /**
     * Hangi parçanın döndüğü GÖVDEDE yazar. `bolum:"ozet"` iken `pano.aylik`
     * alanı **hiç yoktur** — boş dizi olarak gönderilseydi "trend boş" diye
     * çizilebilirdi; sessiz eksik yasağı.
     */
    bolum,
    donem,
    /** `/api/mobile/analytics`in eski `co2` alanıyla BİREBİR aynı şekil. */
    ozet: {
      kg: pano.toplam.kg,
      gKm: pano.toplam.gKm,
      litre: pano.toplam.litre,
      esas: pano.ayar.esas,
      kapsama: {
        olculen: pano.toplam.olculenArac,
        toplam: pano.toplam.toplamArac,
        olculemeyenPlakalar: pano.toplam.olculemeyenPlakalar,
      },
      hedefGKm: pano.ayar.hedefGKm,
      hedefTuttu: pano.hedef ? pano.hedef.tuttu : null,
    },
    /** Tam kırılım — web CO₂ ekranının gördüğü. Mobilde karşılığı yoksa okunmaz. */
    pano: {
      tabloYok: pano.tabloYok,
      yakitYok: pano.yakitYok,
      katsayiSurum: pano.katsayiSurum,
      araclar: pano.araclar,
      soforler: pano.soforler,
      musteriler: pano.musteriler,
      ...(bolum === "tam" ? { aylik: pano.aylik } : {}),
    },
  });
}
