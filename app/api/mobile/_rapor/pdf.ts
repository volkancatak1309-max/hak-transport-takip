import "server-only";
import { headers } from "next/headers";
import { mintFingerprint } from "@/lib/pdf-fingerprint";
import { audit } from "@/lib/security-log";
import { clientIpFromHeaders } from "@/lib/auth-core";
import { TENANT_TZ } from "@/lib/tz";

/**
 * MOBİL PDF RAPORLARININ ORTAK YANIT + İZ KATMANI.
 *
 * ⚠️ BU DOSYA ROUTE DEĞİLDİR (`_` ön eki — Next yönlendirmeden muaf tutar).
 *
 * ── BAYRAK KAPISI BURADAN YENİDEN DIŞA VERİLİYOR ──────────────────────────
 * `disaAktarimKapali()` CSV turunda `./csv.ts` içinde doğdu ama işi BİÇİMDEN
 * BAĞIMSIZ: `EXPORT_ENABLED` bayrağını denetliyor. PDF uçlarının `./csv`
 * import etmek zorunda kalmaması için buradan geçiriliyor; tek uygulama, tek
 * kapı.
 *
 * ⚠️ ÖLÇÜM NOTU (18.08.2026): panelde `EXPORT_ENABLED` YALNIZ CSV düğmelerini
 * kapatıyor (AdminClient.tsx:606, FuelClient.tsx:489); PDF düğmelerinde bu
 * bayrak HİÇ okunmuyor. Yani bu kapı mobili panelden BİR TIK KATI yapıyor —
 * Volkan'ın açık isteği (Tur 3). Varsayılan `true` olduğu için HAK61 ve
 * Sendigo'da bugün hiçbir davranış değişmiyor. Panel paritesi tercih edilirse
 * uçlardaki iki satır silinir.
 * ⚠️ Tur 1'in `/workers/[id]/rapor.pdf` ucu bu kapıyı TAŞIMIYOR — bilinçli
 * tutarsızlık, hizalanması ayrı karar.
 */
export { disaAktarimKapali } from "./csv";

/** Belgenin TEK üretim anı, de-AT + kiracı dilimi. */
export function uretimAniDamgasi(an: Date): string {
  return an.toLocaleString("de-AT", { timeZone: TENANT_TZ });
}

/**
 * Parmak izi + denetim izi (045/047) — iki PDF ucunun ortak zinciri.
 *
 * Parmak izi belgeden ÖNCE alınır: render başladıktan sonra gelseydi ilk
 * sayfaya yetişmezdi (panelin `download*` girişlerindeki notun aynısı).
 * Katman kapalıysa `null` döner ve TEK SORGU atılmaz.
 *
 * ⚠️ 045/047 CANLIDA YOK (ölçüldü 18.08.2026: `audit_log` ve
 * `pdf_fingerprints` tabloları PGRST205). `mintFingerprint` kendi
 * try/catch'inde null'a düşüyor, `audit` no-op — belge işaretsiz üretilir ve
 * uç 200 döner. Tablolar geldiğinde zincir kendiliğinden çalışır.
 */
export async function isaretUret(
  isteyenId: string,
  reportType: "azg" | "shift" | "performance" | "fuel" | "co2"
): Promise<string | null> {
  return mintFingerprint(isteyenId, reportType, clientIpFromHeaders(await headers()));
}

/** İz: raporu kim, hangi dönem için dışa çıkardı. Belge ÜRETİLDİKTEN sonra. */
export async function pdfIziYaz(
  isteyenId: string,
  hedef: string,
  meta: Record<string, unknown>
): Promise<void> {
  // İz yazımı indirmeyi ne bekletir ne düşürür (app/actions/audit.ts kuralı).
  await audit(isteyenId, "export_pdf", hedef, { ...meta, kaynak: "mobil" });
}

/**
 * Buffer → indirilebilir PDF yanıtı.
 *
 * `content-disposition`da ASCII ad + RFC 5987 ikilisi: eski istemci ilkini,
 * yenisi ikincisini okur. Ham UTF-8 bir başlıkta bozulur.
 */
export function pdfYaniti(buf: Buffer, dosyaAdi: string, ekBaslik?: Record<string, string>): Response {
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-length": String(buf.length),
      "content-disposition": `attachment; filename="${dosyaAdi}"; filename*=UTF-8''${encodeURIComponent(dosyaAdi)}`,
      // Belge kişi/araç verisi ve parmak izi taşıyor — hiçbir katmanda saklanmaz.
      "cache-control": "no-store, private",
      ...(ekBaslik ?? {}),
    },
  });
}
