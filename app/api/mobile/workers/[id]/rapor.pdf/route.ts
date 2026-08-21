import type { NextRequest } from "next/server";
import { createElement } from "react";
import { headers } from "next/headers";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getOwnerScope } from "@/lib/owner-scope";
import { getDriverScope } from "@/lib/driver-scope";
import { buildPerformanceReport, type PerformanceRow } from "@/lib/reports";
import { SCORE_MIN_KM_COVERAGE } from "@/lib/analytics";
import { SAFETY_SCORE_CALIBRATED } from "@/lib/tenant";
import { registerServerPdfFont, renderPdfToBuffer } from "@/lib/pdf-server";
import { PerformanceDoc } from "@/components/pdf/server/PerformanceDoc";
import { mintFingerprint } from "@/lib/pdf-fingerprint";
import { audit } from "@/lib/security-log";
import { clientIpFromHeaders } from "@/lib/auth-core";
import { FILE_PREFIX_LOWER, REPORT_EMPTY } from "@/lib/report-de";
import { formatDurationShort } from "@/lib/format";
import { TENANT_TZ } from "@/lib/tz";
import { DONEMLER, donemCoz } from "../../../_performans/donem";
import { dilCoz, dilHataAlanlari } from "../../../_rapor/dil";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/workers/[id]/rapor.pdf?donem=gun|hafta|ay&tarih=YYYY-MM-DD
 *
 * Tek şoförün Fahrerleistungsbericht'i — SUNUCUDA üretilir, `application/pdf`
 * döner. Mobilin ilk ikili (binary) yanıt veren ucu.
 *
 * ── MOBİL NEDEN İMZALI URL KULLANMIYOR ────────────────────────────────────
 * Araştırma turunda (18.08.2026) açık soru şuydu: RN'in indirme yolu
 * `Authorization` başlığı taşıyabiliyor mu. ÖLÇÜLDÜ — taşıyor
 * (`downloadAsync`/`downloadFileAsync`, canlı cihazda 401→200). Dolayısıyla
 * kısa ömürlü imzalı URL'e, ayrı bir depolama kovasına ve saklama politikasına
 * GEREK KALMADI: uç diğer 34 mobil uçla aynı `Bearer` kapısının arkasında.
 * Belge hiçbir yere YAZILMAZ, istekte üretilip gövdede gider — sızacak kalıcı
 * bir kopya yok.
 *
 * ── VERİ: TEK KAYNAK ──────────────────────────────────────────────────────
 * `buildPerformanceReport` — `/driver-scores` ve `/workers/[id]/performans` ne
 * okuyorsa o. Dönem dili de ORTAK çekirdekten (`_performans/donem.ts`). Kâğıt,
 * ekranla aynı satırdan beslenmezse bir gün ikisi ayrışır ve hangisinin doğru
 * olduğunu kimse söyleyemez.
 *
 * ── ÖNCEKİ DÖNEM ÇEKİLMİYOR (bilinçli) ────────────────────────────────────
 * Kardeş uç sıra DEĞİŞİMİNİ gösterdiği için raporu iki kez kuruyor. Bu belge
 * sıra değişimi basmıyor, dolayısıyla ikinci rapor saf maliyet olurdu —
 * `loadBase` araç başına iki sorgu demek. Belgeye bir gün trend eklenirse
 * ikinci çağrı da eklenmeli (ARDIŞIK, paralel değil: mapBounded tavanı).
 *
 * ── KİMLİK: FİLİGRAN + PARMAK İZİ ─────────────────────────────────────────
 * İkisi de PROP olarak geçer, modül globalinden OKUNMAZ — sunucuda global
 * eşzamanlı istekler arasında sızar (gerekçe components/pdf/server/Chrome.tsx
 * başlığında ölçümle yazılı).
 *
 * Filigrandaki kişi BELGEYİ İSTEYEN yöneticidir, raporu YAZILAN şoför değil:
 * filigranın sorusu "bu kopya kimden çıktı", "bu kimin hakkında" değil.
 * `pdf_fingerprints` satırı da aynı kişiye yazılır ve `audit_log`a `export_pdf`
 * izi düşer — 047 zinciri sunucu yolunda da tam.
 *
 * ── ÜÇ "SATIR YOK" DURUMU ─────────────────────────────────────────────────
 *   • şoför değil (yönetici/test)  → 409 `not_a_driver`, BELGE ÜRETİLMEZ.
 *     Bir yönetici için "performans raporu" basmak, olmayan bir ölçümü resmî
 *     bir belgeye dönüştürmek olurdu.
 *   • kişi yok / patron kapsamı dışı → 404 (403 DEĞİL: 403 kaydın var
 *     olduğunu doğrulardı — kardeş uçtaki kuralın aynısı).
 *   • dönemde veri yok             → BELGE ÜRETİLİR ve üstünde "Keine Daten im
 *     gewählten Zeitraum." yazar. Boş dönem bir cevaptır; hata değil.
 *
 * ── FONT YOKSA SESSİZ HELVETICA DÜŞÜŞÜ YOK ────────────────────────────────
 * `registerServerPdfFont` fırlatır, uç 500 `pdf_font_missing` döner. Düşseydi
 * belge üretilir ama ş/ğ/İ/ö/ü/ß glifleri kaybolurdu — resmî evrakta bu,
 * hatanın en kötü türü: çıktı var ve yanlış.
 */

/** Dosya adı için ASCII'ye indirgenmiş ad. */
function asciiSlug(ad: string): string {
  const tr: Record<string, string> = {
    ş: "s", Ş: "S", ğ: "g", Ğ: "G", ı: "i", İ: "I",
    ö: "o", Ö: "O", ü: "u", Ü: "U", ç: "c", Ç: "C",
    ä: "a", Ä: "A", ß: "ss",
  };
  return (
    ad
      .replace(/[şŞğĞıİöÖüÜçÇäÄß]/g, (c) => tr[c] ?? c)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "mitarbeiter"
  );
}

/**
 * Belge tarih biçimi. ⚠️ DİLE BAĞLI (21.08.2026): başlıklar Türkçe, tarihler
 * Almanca olsaydı düzeltmeye çalıştığımız KARMA çıktının aynısını üretirdik.
 * Dil verilmezse Avusturya biçimi — eski davranış birebir.
 */
const belgeTarihi = (d: Date, dil?: string | null) =>
  d.toLocaleDateString(dil === "tr" ? "tr-TR" : "de-AT", { timeZone: TENANT_TZ });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const url = new URL(req.url);

  // RAPOR DİLİ (21.08.2026): panel dilinden türetilmez, istemci söyler.
  const dilSonucu = dilCoz(url);
  if (!dilSonucu.ok) return mobileError(400, dilSonucu.kod, dilHataAlanlari());
  const dil = dilSonucu.dil;

  const cozum = donemCoz(url);
  if (!cozum.ok) {
    return mobileError(400, cozum.kod, {
      ...(cozum.kod === "invalid_donem"
        ? { alan: "donem", gecerli: DONEMLER }
        : { alan: "tarih", bicim: "YYYY-MM-DD" }),
    });
  }
  const { cozum: d } = cozum;

  const { data: w } = await supabaseAdmin
    .from("workers")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (!w) return mobileError(404, "not_found");

  const ownerScope = await getOwnerScope(guard.actor.worker.id);
  if (!ownerScope.isVisible(id)) return mobileError(404, "not_found");

  const driverScope = await getDriverScope();
  if (!driverScope.isDriver(id)) {
    return mobileError(409, "not_a_driver", {
      aciklama: "Yönetici/test hesabı için performans belgesi üretilmez.",
    });
  }

  const rapor = await buildPerformanceReport(d.range);
  const idx = rapor.rows.findIndex((r) => r.workerId === id);
  const row: PerformanceRow | null = idx === -1 ? null : rapor.rows[idx];

  /**
   * SKOR NOTU — "—" tek başına yöneticiye hiçbir iş vermiyor. Sebep kodu
   * `PerformanceRow.scoreGate`ten, yani kararın VERİLDİĞİ yerden gelir
   * (lib/reports.ts); burada yalnız Almancaya çevrilir.
   */
  let skorNotu: string | null = null;
  if (row && row.safetyScore === null) {
    const esik = Math.round(row.scoreMinKm);
    const olculen = row.scoreKm === null ? null : Math.round(row.scoreKm);
    const kapsama =
      row.scoreCoverage === null ? null : Math.round(row.scoreCoverage * 100);
    const gerekli = Math.round(SCORE_MIN_KM_COVERAGE * 100);
    skorNotu =
      row.scoreGate === "km_yetersiz"
        ? `Sicherheitsscore nicht berechenbar: gemessene Strecke ${olculen ?? REPORT_EMPTY} km liegt unter der Schwelle von ${esik} km.`
        : row.scoreGate === "kapsama_dusuk"
          ? `Sicherheitsscore nicht berechenbar: Messabdeckung ${kapsama ?? REPORT_EMPTY} % der Schichten (mindestens ${gerekli} % erforderlich).`
          : row.scoreGate === "vardiya_yok"
            ? "Sicherheitsscore nicht berechenbar: keine Schichten im Zeitraum."
            : null;
  }

  const simdi = new Date();
  const ip = clientIpFromHeaders(await headers());

  /**
   * Parmak izi belgeden ÖNCE alınır — render başladıktan sonra gelseydi ilk
   * sayfaya yetişmezdi (panelin `download*` girişlerindeki notun aynısı).
   * Katman kapalıysa `null` döner ve tek sorgu bile atılmaz.
   */
  const isaret = await mintFingerprint(guard.actor.worker.id, "performance", ip);

  try {
    registerServerPdfFont();
  } catch {
    return mobileError(500, "pdf_font_missing");
  }

  const buf = await renderPdfToBuffer(
    createElement(PerformanceDoc, {
      dil,
      adSoyad: w.name as string,
      donem: `${belgeTarihi(d.range.start, dil)} – ${belgeTarihi(d.range.end, dil)}`,
      uretimAni: simdi.toLocaleString(dil === "tr" ? "tr-TR" : "de-AT", { timeZone: TENANT_TZ }),
      showScore: SAFETY_SCORE_CALIBRATED,
      satir:
        row === null
          ? null
          : {
              sira: idx + 1,
              skor: row.safetyScore === null ? REPORT_EMPTY : String(row.safetyScore),
              vardiya: String(row.shifts),
              calisma: formatDurationShort(row.workedMs, dil ?? "de"),
              km: row.km === null ? REPORT_EMPTY : String(Math.round(row.km)),
              teslim: String(row.delivered),
              teslimEdilemeyen: String(row.undelivered),
              ihlal: String(row.events),
              sertFren: String(row.harshBraking),
              aniHizlanma: String(row.harshAcceleration),
              asiriHiz: String(row.overspeeding),
            },
      filo: {
        soforSayisi: String(rapor.rows.length),
        ortalamaSkor: rapor.avgScore === null ? REPORT_EMPTY : String(rapor.avgScore),
        skorlanan: String(rapor.scoredCount),
        yetersizVeri: String(rapor.rows.filter((r) => r.safetyScore === null).length),
      },
      skorNotu,
      // Filigran: belgeyi İSTEYEN kişi (raporu yazılan şoför değil).
      kullanici: guard.actor.worker.name,
      isaret,
    })
  );

  // İz: raporu kim, kimin hakkında, hangi dönem için dışa çıkardı (045).
  // Katman kapalıysa no-op. Belge ÜRETİLDİKTEN sonra yazılır: iz yazımı
  // indirmeyi ne bekletir ne düşürür (app/actions/audit.ts ile aynı kural).
  await audit(guard.actor.worker.id, "export_pdf", "performance", {
    hedefSofor: id,
    donem: d.donem,
    tarih: d.tarih,
    kaynak: "mobil",
  });

  const dosyaAdi = `${FILE_PREFIX_LOWER}-fahrerleistung-${asciiSlug(w.name as string)}-${simdi.toISOString().slice(0, 10)}.pdf`;

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-length": String(buf.length),
      // ASCII ad + RFC 5987 ikilisi: eski istemci ilkini, yenisi ikincisini
      // okur. Şoför adında ş/ğ olduğunda ham UTF-8 başlığı bozar.
      "content-disposition": `attachment; filename="${dosyaAdi}"; filename*=UTF-8''${encodeURIComponent(dosyaAdi)}`,
      // Belge kişiye özel ve parmak izli — hiçbir katmanda saklanmamalı.
      "cache-control": "no-store, private",
    },
  });
}
