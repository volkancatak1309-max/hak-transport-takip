import type { NextRequest } from "next/server";
import { createElement } from "react";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { buildAZGReport } from "@/lib/azg-report";
import { registerServerPdfFont, renderPdfToBuffer } from "@/lib/pdf-server";
import { AZGDoc } from "@/components/pdf/server/AZGDoc";
import { FILE_PREFIX_UPPER } from "@/lib/report-de";
import {
  isaretUret,
  pdfIziYaz,
  pdfYaniti,
  uretimAniDamgasi,
} from "../../_rapor/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/reports/azg.pdf?ay=YYYY-MM
 *
 * § 26 AZG ihlal raporu — Avusturya Arbeitsinspektorat'ına ibraz edilen resmî
 * belge. Panelin ürettiğinin BİREBİR aynısı (metin katmanı karşılaştırmalı
 * doğrulandı: scripts/verify-rapor-pdf-tur3.mjs).
 *
 * ═══ NEDEN `?ay=` VE NEDEN `?range=` DEĞİL ═══
 *
 * Diğer rapor uçları `_rapor/aralik.ts`in beş anahtarlı pencere dilini
 * konuşuyor. BU UÇ KONUŞAMAZ ve konuşmamalı:
 *
 *  · § 26 AZG belgesi TAKVİM AYINA aittir. "01–10.08 arası AZG raporu" diye
 *    bir hukuki nesne yoktur; öyle bir belge üretmek denetimde savunulamaz.
 *  · Hesabın kendisi (lib/azg-report.ts) ay alıyor ve ay sınırlarını kendi
 *    kuruyor. Bir aralığı aya "yaklaştırmak" (ör. bitiş tarihinin ayını almak)
 *    istenen pencereyle ÜRETİLEN pencerenin sessizce ayrışması demekti — resmî
 *    bir belgede en kötü hata türü: çıktı var ve yanlış.
 *
 * Bu yüzden `range`/`from`/`to` verilirse 400 `range_not_supported` döner ve
 * beklenen biçimi söyler. Sessizce yok saymak, istemcinin istediği pencereye
 * baktığını sanmasına yol açardı.
 *
 * ── VERİ: TEK KAYNAK ──────────────────────────────────────────────────────
 * `buildAZGReport` — panelin `getAZGReportData` action'ının çağırdığı
 * fonksiyonun ta kendisi. Hesap 18.08.2026'da action'dan lib'e TAŞINDI (mobil
 * route'ta çerez yok, `requireAdmin()` yönlendirme fırlatıyor); tek bayt hesap
 * değişmedi ve bu ölçüldü. Yeni mantık YAZILMADI.
 *
 * ── KAPI ──────────────────────────────────────────────────────────────────
 * requireMobileAdmin — panelde AZG düğmesi `/admin` panosunda ve orası şefe
 * açık olsa da şefin CSV'si kendi filosuyla sınırlı; burada filo kapsamı
 * uygulanmadığı için şefe açmak karşı filonun çalışma sürelerini sızdırırdı.
 * Şoför ve şef 403.
 *
 * ⚠️ HACİM: araştırmada ölçüldü, ölçek SÜPERDOĞRUSAL. Gerçek en yoğun ay ve
 * süre/boyut/sayfa ölçümü raporda; 300 sn tavanına yaklaşan senaryo yok.
 */

const AY = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);

  // Pencere dili KARIŞTIRILMASIN: aralık parametresiyle gelen istek sessizce
  // bir aya yuvarlanmaz, açıkça reddedilir (bkz. başlık).
  for (const yanlis of ["range", "from", "to"]) {
    if (url.searchParams.has(yanlis)) {
      return mobileError(400, "range_not_supported", {
        alan: yanlis,
        beklenen: "ay",
        bicim: "YYYY-MM",
        aciklama:
          "§ 26 AZG raporu takvim ayına aittir; aralık penceresi kabul edilmez.",
      });
    }
  }

  const ay = url.searchParams.get("ay");
  if (!ay || !AY.test(ay)) {
    return mobileError(400, "invalid_ay", { alan: "ay", bicim: "YYYY-MM" });
  }

  const sonuc = await buildAZGReport(ay);
  if (!sonuc.ok) {
    // Hesabın kendi hata kanalı — yutulmaz, sebebiyle taşınır.
    return mobileError(502, "azg_build_failed", { sebep: sonuc.error });
  }

  try {
    registerServerPdfFont();
  } catch {
    return mobileError(500, "pdf_font_missing");
  }

  const isaret = await isaretUret(guard.actor.worker.id, "azg");
  const damga = uretimAniDamgasi(new Date(sonuc.data.generatedAt));

  const buf = await renderPdfToBuffer(
    createElement(AZGDoc, {
      data: sonuc.data,
      uretimAni: damga,
      // Filigran: belgeyi İSTEYEN kişi (belgenin konusu olan şoförler değil).
      kullanici: guard.actor.worker.name,
      isaret,
    })
  );

  await pdfIziYaz(guard.actor.worker.id, "azg", { ay });

  return pdfYaniti(buf, `${FILE_PREFIX_UPPER}_AZG_${sonuc.data.monthLabel}.pdf`, {
    /** İstemci indirmeden hacmi görebilsin (10+ sayfalık belge olabilir). */
    "x-rapor-sayfa-veri": String(
      sonuc.data.perWorker.length + sonuc.data.violations.length + sonuc.data.suspicious.length
    ),
  });
}
