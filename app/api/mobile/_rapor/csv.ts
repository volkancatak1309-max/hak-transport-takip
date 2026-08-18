import "server-only";
import { mobileError } from "@/lib/mobile-auth";
import { EXPORT_ENABLED, FUEL_ENABLED } from "@/lib/tenant";
import type { CsvCikti } from "@/lib/report-csv";

/**
 * CSV UÇLARININ ORTAK YANITI + BAYRAK KAPISI.
 *
 * ⚠️ BU DOSYA ROUTE DEĞİLDİR (`_` ön eki — Next yönlendirmeden muaf tutar).
 *
 * ── BAYRAK: EXPORT_ENABLED (FUEL_ENABLED DEĞİL) ───────────────────────────
 * CSV dışa aktarımını yöneten bayrak `EXPORT_ENABLED`tir (lib/tenant.ts,
 * varsayılan açık): panelde üç CSV düğmesinin üçü de ona bakıyor
 * (AdminClient.tsx, DistanceClient.tsx, FuelClient.tsx) ve kendi başlığında
 * "yalnız butonu gizlemek, action doğrudan çağrılınca korumaz" diye yazılı —
 * yani sunucu tarafında da denetlenmesi ZATEN beklenen davranış.
 *
 * `FUEL_ENABLED` BİLEREK KULLANILMIYOR. Ölçüldü (18.08.2026): o bayrak yakıt
 * FİŞİ modülünü kapatıyor (`app/admin/yakit/page.tsx` → kapalıysa
 * `redirect("/admin")`). Raporlar › Yakıt sayfası (`app/admin/raporlar/yakit`)
 * telemetri tabanlıdır ve HİÇBİR bayrağa bağlı değildir — grep ile doğrulandı.
 * Mobili `FUEL_ENABLED`e bağlasaydık panel raporu gösterirken mobil 409
 * derdi; iki yüzey aynı soruya farklı cevap verirdi.
 *
 * Yine de bayrak bir gün o sayfayı da kapatırsa diye `fuelKapali()` burada
 * duruyor ve KAPATMIYOR, yalnız yanıta bilgi olarak taşınıyor — istemci
 * "fiş modülü kapalı" notunu gösterebilsin.
 *
 * ── 409, 404 DEĞİL ────────────────────────────────────────────────────────
 * Kapalı bir özellik 404 dönmemeli: 404 "böyle bir uç yok" der ve istemci
 * geliştiricisi yolunu yanlış yazdığını sanır. 409 + `feature_disabled` ise
 * "uç var, kurulumunuzda kapalı" der — sessiz kaybolma yok.
 */

export function disaAktarimKapali(): Response | null {
  if (EXPORT_ENABLED) return null;
  return mobileError(409, "feature_disabled", {
    bayrak: "EXPORT_ENABLED",
    aciklama: "CSV dışa aktarımı bu kurulumda kapalı.",
  });
}

/** Yakıt FİŞİ modülü kapalı mı — yalnız bilgi, kapı DEĞİL (bkz. başlık). */
export function fuelFisModuluKapali(): boolean {
  return !FUEL_ENABLED;
}

/**
 * `CsvCikti` → indirilebilir yanıt.
 *
 * `content-disposition` PDF ucundaki desenin aynısı: ASCII ad + RFC 5987
 * ikilisi. Dosya adları bugün saf ASCII ama kural aynı kalsın — bir gün
 * kiracı öneki (`FILE_PREFIX_LOWER`) Türkçe harf taşırsa başlık bozulmasın.
 */
export function csvYaniti(cikti: CsvCikti): Response {
  return new Response(new Uint8Array(cikti.govde), {
    status: 200,
    headers: {
      "content-type": cikti.contentType,
      "content-length": String(cikti.govde.length),
      "content-disposition": `attachment; filename="${cikti.dosyaAdi}"; filename*=UTF-8''${encodeURIComponent(cikti.dosyaAdi)}`,
      /** Kaç veri satırı çıktı — istemci indirmeden boş dosyayı ayırt edebilsin. */
      "x-rapor-satir": String(cikti.satir),
      // Kişi/araç verisi taşıyor; hiçbir katmanda saklanmamalı.
      "cache-control": "no-store, private",
    },
  });
}
