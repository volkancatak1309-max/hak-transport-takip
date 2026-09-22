import { createElement } from "react";
import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { getTranslations } from "next-intl/server";
import { co2PanosuOzet } from "@/lib/co2-db";
import { registerServerPdfFont, renderPdfToBuffer } from "@/lib/pdf-server";
import { CO2Doc, type PdfDil } from "@/components/pdf/server/CO2Doc";
import { FILE_PREFIX_UPPER } from "@/lib/report-de";
import { aralikCoz, aralikHataAlanlari } from "../../_rapor/aralik";
import { dilCoz, dilHataAlanlari } from "../../_rapor/dil";
import { isaretUret, pdfIziYaz, pdfYaniti, uretimAniDamgasi } from "../../_rapor/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/reports/co2.pdf?range=…&from=&to=&dil=tr|de|en
 *
 * Raporlar › CO₂ ekranının (`/admin/co2`) üç dil düğmesinin sunucu karşılığı.
 * Üç sayfa: kapak (esas + dört sayı) · araç tablosu · METODOLOJİ.
 *
 * ═══ KAPI: requireMobileAdmin ═══
 * Panelde sayfa `requireFleetView()` arkasında, yani ŞEF de görüyor. Buna
 * rağmen uç `requireMobileAdmin`: `co2PanosuOzet(bas, bit)` filo kapsamı
 * ALMIYOR (lib/co2-db.ts:212) ve belge filonun TAMAMINI basıyor. Şefe açmak,
 * kendi filosu dışındaki araçların plakalarını ve tüketimini PDF olarak eline
 * vermek olurdu. Beş kardeş rapor ucu da aynı sebeple yönetici arkasında;
 * şefe açmak önce kapsamlı bir pano kurucusu ister.
 *
 * ═══ EXPORT_ENABLED OKUNMUYOR — VE BU ÖLÇÜLMÜŞ BİR KARAR ═══
 * Görevde "EXPORT_ENABLED kapısı" isteniyordu; PDF uçlarında o kapı BİLEREK
 * yok. Ölçüldü (22.09.2026): `app/admin/co2/CO2Client.tsx` içinde
 * `EXPORT_ENABLED` hiç geçmiyor — panelin üç PDF düğmesi bayrağa bakmıyor,
 * bayrak yalnız CSV düğmelerini kapatıyor. Aynı tespit 18.08.2026'da yapılmış
 * ve `app/api/mobile/_rapor/pdf.ts` başlığına yazılmış: kapı eklenmişti,
 * KALDIRILDI. Mobilin panelden katı olması, panelde açık olan bir belgeyi
 * telefonda "kapalı" göstermek demekti. Kardeş CSV uçları (`speed`,
 * `zone-durations`, `distance`, `fuel`, `shifts`) kapıyı uyguluyor.
 *
 * ═══ DİL VARSAYILANI `de` — PANELİN İMZASIYLA AYNI ═══
 * `downloadCO2Report(..., dil: PdfDil = "de", ...)`. Bu belge Avusturya'da
 * müşteriye/ihaleye gidiyor; parametresiz çağrıda panelin varsayılanı korunur.
 * `?dil=` verilirse tr/de/en. Geçersiz değer SESSİZCE yutulmaz: 400.
 *
 * ⚠️ ÖLÇÜLEMEYEN ARAÇ TABLOYA GİRMEZ ama KAPSAMA bloğunda plakasıyla listelenir
 * — panelin kuralının aynısı. "23/29 araç ölçüldü" yazmayan belge beyan olarak
 * kullanılamaz.
 *
 * ⚠️ `aylik` seri hesaplanmaz (`co2PanosuOzet`): belgede 6 aylık trend yok ve
 * o hesap HAK61'de 1.112 sorgu / 23,58 sn ölçülmüştü.
 *
 * HATA KODLARI:
 *   401 missing_token / invalid_token / revoked / inactive
 *   403 admin_required
 *   400 invalid_range · invalid_tarih · invalid_dil
 *   409 yakit_yok — dönemde ölçülebilir tüketim yok (belge üretilmez)
 *   500 pdf_font_missing
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);

  const dilSonucu = dilCoz(url);
  if (!dilSonucu.ok) return mobileError(400, dilSonucu.kod, dilHataAlanlari());
  const dil = (dilSonucu.dil ?? "de") as PdfDil;

  const cozum = aralikCoz(url);
  if (!cozum.ok) return mobileError(400, cozum.kod, aralikHataAlanlari(cozum.kod));
  const { range } = cozum.cozum;

  const pano = await co2PanosuOzet(range.start, range.end);

  /**
   * BOŞ BELGE ÜRETİLMEZ. `yakitYok` "bu dönemde ölçülebilir tüketim yok"
   * demektir; üç sayfalık, her hücresi "—" olan bir beyan belgesi üretmek
   * kullanıcıya boş kâğıt satmak olurdu. Sebep gövdede taşınır.
   */
  if (pano.yakitYok) {
    return mobileError(409, "yakit_yok", { sebep: pano.yakitYok });
  }

  try {
    registerServerPdfFont();
  } catch {
    return mobileError(500, "pdf_font_missing");
  }

  const t = await getTranslations({ locale: dil, namespace: "co2" });

  /** Panelin `indir()` fonksiyonunun BİREBİR aynı süzgeci ve alan eşlemesi. */
  const olculen = pano.araclar.filter((a) => a.kg !== null && a.km !== null);

  const an = new Date();
  const damga = uretimAniDamgasi(an);
  const isaret = await isaretUret(guard.actor.worker.id, "co2");

  const buf = await renderPdfToBuffer(
    createElement(CO2Doc, {
      data: {
        monthLabel: `${pano.bas.slice(0, 10)} → ${pano.bit.slice(0, 10)}`,
        generatedAt: an.toISOString(),
        totalLiters: pano.toplam.litre ?? 0,
        totalCo2: pano.toplam.kg ?? 0,
        totalKm: pano.toplam.km ?? 0,
        avgGPerKm: pano.toplam.gKm,
        esas: pano.ayar.esas,
        katsayiSurum: pano.katsayiSurum,
        vehicles: olculen.map((a) => ({
          plate: a.plate,
          liters: a.litre ?? 0,
          km: a.km ?? 0,
          lPer100: a.km && a.litre ? (a.litre / a.km) * 100 : null,
          co2Kg: a.kg ?? 0,
          gPerKm: a.gKm,
        })),
      },
      title: t("title"),
      dil,
      kapsama: {
        esas: pano.ayar.esas,
        olculenArac: pano.toplam.olculenArac,
        toplamArac: pano.toplam.toplamArac,
        olculemeyenPlakalar: pano.toplam.olculemeyenPlakalar,
      },
      uretimAni: damga,
      // Filigran: belgeyi İSTEYEN kişi.
      kullanici: guard.actor.worker.name,
      isaret,
    })
  );

  await pdfIziYaz(guard.actor.worker.id, "co2", {
    range: cozum.cozum.tur,
    bas: pano.bas.slice(0, 10),
    bit: pano.bit.slice(0, 10),
    dil,
  });

  return pdfYaniti(
    buf,
    `${FILE_PREFIX_UPPER}_CO2_${dil.toUpperCase()}_${pano.bas.slice(0, 10)}_${pano.bit.slice(0, 10)}.pdf`,
    {
      /** İstemci indirmeden kapsamı görebilsin. */
      "x-rapor-satir": String(olculen.length),
      "x-rapor-kapsama": `${pano.toplam.olculenArac}/${pano.toplam.toplamArac}`,
    }
  );
}
