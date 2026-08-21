#!/usr/bin/env node
/**
 * RAPOR DİLİ — CANLIDA KANIT. HİÇBİR ŞEY YAZMAZ.
 *
 * Üç şeyi ölçer:
 *   1. `getRequestConfig` düzeltmesi GERÇEKTEN uygulanıyor mu — aynı çağrı
 *      `{locale:"de"}` ve `{locale:"tr"}` ile FARKLI metin döndürmeli.
 *      (Düzeltmeden önce ikisi de çereze düşüyordu, yani AYNI metin gelirdi.)
 *   2. Altı ucun ORTAK dil kapısı (`dilCoz`) — geçersiz dil reddediliyor.
 *   3. AYNI rapor iki dilde üretildiğinde her biri KENDİ İÇİNDE tutarlı —
 *      çevrilen tüm metin alanlarında karşı dilin sözcükleri aranıyor.
 *
 * ⚠️ UÇLARIN KENDİSİ BURADA ÇAĞRILAMAZ: PDF rotaları `.tsx` belge
 * bileşenlerini import ediyor, bu koşum JSX yükleyemiyor. Uçtan uca
 * HTTP ölçümü: scripts/verify-rapor-dil-http.mjs
 *
 * ── ⚠️ PANEL DAVRANIŞI ────────────────────────────────────────────────────
 * Panel dili AÇIKÇA vermiyor; `getTranslations()` argümansız çağrıldığında
 * çerez/varsayılan yolunun korunduğu ayrıca denetleniyor.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/verify-rapor-dil.mjs
 */
import { getTranslations } from "next-intl/server";
import { DEFAULT_LOCALE } from "@/i18n/request";
import { buildAZGReport } from "@/lib/azg-report";
import { buildShiftsCsv, buildDistanceCsv } from "@/lib/report-csv";
import { computeAnalyticsRange } from "@/lib/analytics";
import { shiftReportEtiketleri, reportPeriod } from "@/lib/report-de";
import { dilCoz, dilHataAlanlari } from "@/app/api/mobile/_rapor/dil";

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const bilgi = (s) => console.log(`     ${s}`);



console.log(`\n╔══ RAPOR DİLİ · CANLIDA KANIT ════════════════════════════════════`);
console.log(`║ an  ${new Date().toISOString()}  ·  kiracı varsayılanı: ${DEFAULT_LOCALE}`);

try {
  // ══ 1. getRequestConfig DÜZELTMESİ ══════════════════════════════════════
  console.log("\n── 1. getRequestConfig · istenen dil UYGULANIYOR mu ──");
  {
    const de = await getTranslations({ locale: "de", namespace: "azg" });
    const tr = await getTranslations({ locale: "tr", namespace: "azg" });
    const mDe = de("report_title");
    const mTr = tr("report_title");
    iddia("aynı anahtar iki dilde FARKLI metin veriyor", mDe !== mTr, `de="${mDe}" · tr="${mTr}"`);
    iddia("de gerçekten Almanca geldi", /bericht|Arbeitszeit|Verstoss|Verstöß/i.test(mDe), `"${mDe}"`);

    // Panel yolu: dil VERİLMEZ → çerez/varsayılan korunur.
    const varsayilan = await getTranslations({ namespace: "azg" });
    const mVars = varsayilan("report_title");
    const beklenen = DEFAULT_LOCALE === "de" ? mDe : mTr;
    iddia("dilsiz çağrı hâlâ kiracı varsayılanına düşüyor (PANEL BOZULMADI)",
      mVars === beklenen, `dilsiz="${mVars}" ≟ ${DEFAULT_LOCALE}="${beklenen}"`);
  }

  // ══ 2. ETİKET İKİZLERİ ══════════════════════════════════════════════════
  console.log("\n── 2. ETİKET KÜMELERİ ──");
  {
    const de = shiftReportEtiketleri("de");
    const tr = shiftReportEtiketleri("tr");
    iddia("vardiya raporu etiketleri iki dilde farklı", de.title !== tr.title, `"${de.title}" / "${tr.title}"`);
    iddia("anahtar kümeleri BİREBİR aynı",
      JSON.stringify(Object.keys(de).sort()) === JSON.stringify(Object.keys(tr).sort()) &&
      JSON.stringify(Object.keys(de.headers).sort()) === JSON.stringify(Object.keys(tr.headers).sort()),
      `${Object.keys(de.headers).length} kolon başlığı`);
    iddia("KÜNYE çevrilmedi (firma/adres/UID hukuki)",
      de.company === tr.company && de.address === tr.address && de.uid === tr.uid, de.company);
    iddia("dilsiz çağrı Almanca veriyor (eski hâl)", shiftReportEtiketleri().title === de.title, null);
    iddia("dönem etiketi iki dilde farklı",
      reportPeriod("week", "de") !== reportPeriod("week", "tr"),
      `"${reportPeriod("week", "de")}" / "${reportPeriod("week", "tr")}"`);
  }

  // ══ 3. dilCoz KAPISI ════════════════════════════════════════════════════
  // ⚠️ Uçların KENDİSİ burada çağrılamıyor: PDF rotaları `.tsx` belge
  // bileşenlerini import ediyor, bu koşum JSX yükleyemiyor (bilinen sınır).
  // Uçtan uca 400/200 ölçümü HTTP betiğinde: verify-rapor-dil-http.mjs
  console.log("\n── 3. dilCoz (altı ucun ORTAK kapısı) ──");
  {
    const u = (q) => new URL(`http://x/r${q}`);
    iddia("?dil yok → null (mevcut davranış korunur)", dilCoz(u("")).ok === true && dilCoz(u("")).dil === null, null);
    iddia("?dil=tr → tr", dilCoz(u("?dil=tr")).dil === "tr", null);
    iddia("?dil=de → de", dilCoz(u("?dil=de")).dil === "de", null);
    for (const kotu of ["fr", "en", "TR", "tr-TR", "xx", "0"]) {
      const r = dilCoz(u(`?dil=${kotu}`));
      iddia(`?dil=${kotu.padEnd(5)} → invalid_dil`, r.ok === false && r.kod === "invalid_dil", null);
    }
    bilgi(`hata gövdesi: ${JSON.stringify(dilHataAlanlari())}`);
  }

  // ══ 4. AZG İÇERİĞİ İKİ DİLDE ═══════════════════════════════════════════
  console.log("\n── 4. AZG · aynı ay, iki dil ──");
  {
    const ALMANCA = ["Verstoß", "Verstoss", "Arbeitszeit", "Mitarbeiter", "Woche", "Bericht"];
    const TURKCE = ["İhlal", "Çalışma", "Personel", "Hafta", "Rapor", "Şoför"];
    const ay = "2026-07";
    const de = await buildAZGReport(ay, "de");
    const tr = await buildAZGReport(ay, "tr");
    iddia("iki dilde de hesap başarılı", de.ok && tr.ok, de.ok && tr.ok ? "ok" : `${de.error ?? ""} ${tr.error ?? ""}`);
    if (de.ok && tr.ok) {
      // Belgenin ÇEVRİLEN tüm metin alanlarını topla (sayılar değil).
      const metin = (d) => JSON.stringify(d).replace(/"[a-zA-Z_]+":/g, " ");
      const mDe = metin(de.data), mTr = metin(tr.data);
      for (const [dil, m, karsi, kendi] of [["de", mDe, TURKCE, ALMANCA], ["tr", mTr, ALMANCA, TURKCE]]) {
        const sizan = karsi.filter((w) => m.includes(w));
        const kendinden = kendi.filter((w) => m.includes(w));
        iddia(`dil=${dil} · KARŞI dilin sözcüğü YOK (karma değil)`, sizan.length === 0,
          sizan.length ? "SIZAN: " + sizan.join(", ") : `${karsi.length} sözcük arandı, 0 bulundu`);
        iddia(`dil=${dil} · KENDİ dilinin sözcükleri VAR`, kendinden.length > 0, kendinden.join(", ") || "hiçbiri");
      }
      bilgi(`başlık de: "${de.data.reportTitle}"`);
      bilgi(`başlık tr: "${tr.data.reportTitle}"`);
    }
  }

  // ══ 5. CSV İKİ DİLDE ════════════════════════════════════════════════════
  console.log("\n── 5. CSV · başlık satırı iki dilde ──");
  {
    const r = computeAnalyticsRange("hafta");
    for (const [ad, f] of [["shifts", buildShiftsCsv], ["distance", buildDistanceCsv]]) {
      const de = await f(r, "de");
      const tr = await f(r, "tr");
      // Kodlamayi ciktinin KENDISI soyluyor: shifts.csv Excel uyumu icin
      // UTF-16LE uretiyor, digerleri UTF-8. Yanlis okumak basligi bos gosterir.
      const LF = String.fromCharCode(10);
      const CR = String.fromCharCode(13);
      const BOM = String.fromCharCode(0xfeff);
      const bas = (c) => {
        const utf16 = /utf-16/i.test(c.contentType);
        const metin = c.govde.toString(utf16 ? "utf16le" : "utf8");
        return metin.split(LF)[0].split(CR)[0].split(BOM).join("").slice(0, 88);
      };
      iddia(`${ad}.csv başlık satırı iki dilde FARKLI`, bas(de) !== bas(tr), null);
      bilgi(`de: ${bas(de)}`);
      bilgi(`tr: ${bas(tr)}`);
    }
  }

  // ══ 6. AZG "her zaman Almanca" KALKTI ═══════════════════════════════════
  console.log("\n── 6. buildAZGReport · dil parametresi ──");
  {
    const de = await buildAZGReport("2026-07", "de");
    const vars_ = await buildAZGReport("2026-07");
    iddia("dilsiz çağrı ALMANCA (eski davranış BİREBİR korundu)",
      vars_.ok && de.ok && vars_.data.reportTitle === de.data.reportTitle,
      vars_.ok ? `"${vars_.data.reportTitle}"` : "hesap başarısız");
  }
} catch (e) {
  console.error("\n✗ BEKLENMEDİK HATA:", e?.message ?? e);
  console.error((e?.stack ?? "").split("\n").slice(0, 6).join("\n"));
  dusen++;
}

console.log(`\n╚══ düşen: ${dusen} ═══════════════════════════════════════════════\n`);
process.exit(dusen > 0 ? 1 : 0);
