import "server-only";
import { getTranslations } from "next-intl/server";
import { buildDistanceReport, buildFuelReport } from "@/lib/reports";
import { loadRangeShifts, persNrHaritasi } from "@/lib/report-shifts";
import { FUEL_MIN_KM, FUEL_MIN_CONSUMED_PCT } from "@/lib/metric-thresholds";
import { PACKAGES_ENABLED } from "@/lib/tenant";
import { DEFAULT_LOCALE } from "@/i18n/request";

/**
 * RAPOR DİLİ (21.08.2026) — `?dil=` verilmezse kiracı varsayılanı.
 *
 * Volkan kararı: rapor dili panel dilinden TÜRETİLMEZ, kullanıcıya sorulur.
 * Dil gelmediğinde `DEFAULT_LOCALE`e düşmek eski davranışı birebir korur —
 * yani bu değişiklik mevcut istemcilerin çıktısını DEĞİŞTİRMEZ.
 */
function csvDili(dil?: string | null): string {
  return dil === "tr" || dil === "de" || dil === "en" ? dil : DEFAULT_LOCALE;
}
import {
  workedMs,
  kmDiff,
  formatDate,
  formatTime,
  formatDurationShort,
} from "@/lib/format";
import type { DateRange } from "@/lib/analytics-shared";

/**
 * MOBİL CSV RAPORLARI — panelin İSTEMCİDE ürettiği üç dışa aktarımın sunucu
 * karşılığı.
 *
 * ── NEDEN SUNUCUYA TAŞINDI ────────────────────────────────────────────────
 * Panelde üçü de tarayıcıda, EKRANDAKİ diziden kuruluyor (AdminClient.tsx,
 * DistanceClient.tsx, FuelClient.tsx). Mobilin ekranı yok; aynı dosyayı
 * üretmesi için mantığın sunucuda olması gerekiyor. Emsal zaten vardı:
 * `generatePayrollExpenseCSV` (app/actions/expenses.ts) düz bir dize döndüren
 * bir server action.
 *
 * ── BİÇİM PANELDEN KOPYALANIR, "DÜZELTİLMEZ" ──────────────────────────────
 * Üç dosyanın biçimi BİRBİRİNDEN FARKLI ve bu fark KORUNUYOR:
 *
 *   shifts    TAB ayraç · UTF-16LE + BOM (FF FE) · CRLF
 *   distance  ;   ayraç · UTF-8    + BOM (EF BB BF) · CRLF
 *   fuel      ;   ayraç · UTF-8    + BOM (EF BB BF) · CRLF
 *
 * Üçünü tek biçime çekmek CAZİPTİ ve YAPILMADI: bu dosyalar yıllardır
 * muhasebeye/bordroya gidiyor ve karşı taraftaki şablon TAB bekliyorsa `;`
 * onu sessizce bozar. Mobilin işi aynı dosyayı üretmek, daha iyisini icat
 * etmek değil. Biçimi değiştirmek AYRI bir karardır ve paneli de kapsamalıdır.
 *
 * ⚠️ UTF-16LE NEDEN: Excel'in Türkçe/Almanca yerelinde UTF-8 TAB'lı dosyayı
 * doğru açtırmak güvenilmez; UTF-16LE + BOM'da Excel kodlamayı BOM'dan okur ve
 * ş/ğ/İ/ö/ü/ß bozulmaz. `;` ayraçlı iki dosyada UTF-8 + BOM yeterli çünkü
 * Excel `sep`i noktalı virgülde yerelden çözüyor (Avusturya/Türkiye yereli).
 *
 * ── DİL ───────────────────────────────────────────────────────────────────
 * Başlıklar panelin i18n sözlüğünden gelir; mobilde istemcinin dili yok, bu
 * yüzden kurulumun varsayılan dili kullanılır — `lib/mobile-labels.ts`teki
 * kuralın aynısı, aynı gerekçe (HAK61 → tr, Sendigo → de).
 *
 * ── ELEMELER ──────────────────────────────────────────────────────────────
 * `shifts` sorgusu panelin panosuyla AYNI üç elemeyi uygular: test verisi,
 * şoför kapsamı ve km ölçüm bayrağı. FİLO kapsamı UYGULANMAZ — bu uçlar
 * `requireMobileAdmin` arkasında ve patronun kapsamı zaten kısıtsız (şef
 * giremiyor). distance/fuel elemeleri kendi rapor kurucularının içinde.
 *
 * ⚠️ PANELİN CSV'Sİ EKRANDAKİ FİLTREYİ TAŞIR (şoför/durum seçicisi), bu uç
 * TAŞIMAZ: dönem neyse tamamını verir. Karşılaştırırken panel "tümü/tümü"
 * olmalı, yoksa satır sayıları haklı olarak ayrışır.
 */

export type CsvCikti = {
  /** Dosyanın ham baytları — kodlama biçime göre değişir. */
  govde: Buffer;
  /** `Content-Type` başlığı (charset dahil). */
  contentType: string;
  /** Önerilen dosya adı. */
  dosyaAdi: string;
  /** Kaç veri satırı (başlık hariç) — ölçüm ve iz için. */
  satir: number;
};

const bugun = () => new Date().toISOString().slice(0, 10);

/** Hücreyi ayraç/satır sonu kırmayacak hâle getirir — panelin kuralıyla aynı. */
function hucre(v: unknown, ayrac: string): string {
  const s = String(v ?? "");
  // Panel TAB dosyasında \t\r\n'i boşluğa çeviriyor, `;` dosyalarında hiç
  // temizlemiyor (alanlar sayı/plaka/ad). Aynı davranışı sürdürüyoruz ama
  // `;` için de ayracı temizliyoruz: bir şoför adında noktalı virgül varsa
  // panelin dosyası BOZULUR, bizimki bozulmasın.
  return s.replace(/[\r\n]+/g, " ").split(ayrac).join(" ");
}

function satirlariBirlestir(satirlar: string[][], ayrac: string): string {
  return satirlar.map((r) => r.map((c) => hucre(c, ayrac)).join(ayrac)).join("\r\n");
}

/** UTF-16LE + BOM — panelin `shifts` dosyasının kodlaması. */
function utf16leBom(metin: string): Buffer {
  const govde = Buffer.from(metin, "utf16le");
  return Buffer.concat([Buffer.from([0xff, 0xfe]), govde]);
}

/** UTF-8 + BOM — panelin `distance`/`fuel` dosyalarının kodlaması. */
function utf8Bom(metin: string): Buffer {
  return Buffer.from("﻿" + metin, "utf8");
}

// ── 1) VARDİYALAR ───────────────────────────────────────────────────────────

/**
 * Panelin "Excel" düğmesinin (AdminClient.tsx `exportCsv`) sunucu ikizi.
 *
 * Pers.-Nr numaralandırması panelin kuralının BİREBİR aynısı: şoför evreni
 * (yönetici/test elenmiş) ada göre yerel harmanlamayla sıralanır, boş
 * `employee_number` yerine 1'den başlayan sıra numarası konur. Sıralama
 * dilden etkilendiği için (tr'de "Ç" ile "C" ayrı) dil de aynı kaynaktan.
 */
export async function buildShiftsCsv(range: DateRange, dil?: string | null): Promise<CsvCikti> {
  const t = await getTranslations({ locale: csvDili(dil), namespace: "admin" });
  // Sorgu + elemeler + km_measured + isim sözlüğü ORTAK yükleyicide
  // (lib/report-shifts.ts) — Schichtbericht PDF'i de aynı satırları okuyor ve
  // iki resmî çıktının ayrışmaması için sorgu tek yerde durur.
  const { entries, workerMap, soforler, harman } = await loadRangeShifts(range);
  const persNr = persNrHaritasi(soforler, harman);

  const baslik = [
    t("tblPersNr"), t("tblWorker"), t("tblDate"), t("tblStart"), t("tblEnd"),
    t("tblWorked"), t("tblBreak"), t("tblKm"),
    // Paket sütunları kiracı ayarına bağlı — paket sayacı kullanmayan filoda
    // üç boş sütun kalmaz (panelin kuralı).
    ...(PACKAGES_ENABLED ? [t("tblLoaded"), t("tblCargo"), t("tblUndelivered")] : []),
    t("tblPlate"), t("tblNote"),
  ];

  const satirlar = entries.map((e) => {
    const w = workerMap.get(e.worker_id);
    const km = kmDiff(e);
    return [
      persNr.get(e.worker_id) ?? "—",
      w?.name ?? "",
      // ⚠️ BİÇİM DE SEÇİLEN DİLDE: başlıklar Türkçe, tarihler Almanca olsaydı
      // düzeltmeye çalıştığımız KARMA çıktının aynısını üretirdik.
      formatDate(e.started_at, csvDili(dil)),
      formatTime(e.started_at, csvDili(dil)),
      e.ended_at ? formatTime(e.ended_at, csvDili(dil)) : t("statusActive"),
      formatDurationShort(workedMs(e), csvDili(dil)),
      String(e.break_minutes ?? 0),
      km !== null ? String(km) : "",
      ...(PACKAGES_ENABLED
        ? [
            e.start_package_count !== null ? String(e.start_package_count) : "",
            e.ended_at && e.cargo_count !== null ? String(e.cargo_count) : "",
            e.undelivered_count !== null ? String(e.undelivered_count) : "",
          ]
        : []),
      e.plate ?? "",
      e.notes ?? "",
    ];
  });

  const metin = satirlariBirlestir([baslik, ...satirlar], "\t");
  return {
    govde: utf16leBom(metin),
    contentType: "text/csv;charset=utf-16le",
    dosyaAdi: `hak-vardiyalar-${bugun()}.csv`,
    satir: satirlar.length,
  };
}

// ── 2) MESAFE ───────────────────────────────────────────────────────────────

/** Panelin Raporlar › Mesafe CSV'sinin (DistanceClient.tsx) sunucu ikizi. */
export async function buildDistanceCsv(range: DateRange, dil?: string | null): Promise<CsvCikti> {
  const t = await getTranslations({ locale: csvDili(dil), namespace: "reports" });
  const rapor = await buildDistanceReport(range);

  const baslik = [t("col_plate"), t("col_driver"), t("col_km"), t("col_km_day")];
  const satirlar = rapor.rows.map((r) => [
    r.plate,
    r.driverName ?? "",
    // null = ölçülemedi. BOŞ bırakılır, 0 YAZILMAZ — Excel'de 0 "hiç gitmedi"
    // diye okunur ve o iddia ölçülmedi (panelin kuralı).
    r.km === null ? "" : String(Math.round(r.km)),
    r.kmPerDay === null ? "" : String(Math.round(r.kmPerDay)),
  ]);

  const metin = satirlariBirlestir([baslik, ...satirlar], ";");
  return {
    govde: utf8Bom(metin),
    contentType: "text/csv;charset=utf-8",
    dosyaAdi: `hak-mesafe-${bugun()}.csv`,
    satir: satirlar.length,
  };
}

// ── 3) YAKIT ────────────────────────────────────────────────────────────────

/**
 * Panelin Raporlar › Yakıt CSV'sinin (FuelClient.tsx) sunucu ikizi.
 *
 * ⚠️ EKRANDA GİZLENEN SAYI CSV'YE DE GİRMEZ. Güvenilmez sensörün türetilmiş
 * değerleri yerine SEBEBİ yazılır; boş hücre Excel'de "sıfır" diye okunur,
 * sebep okunamaz (panelin kendi notu).
 */
export async function buildFuelCsv(range: DateRange, dil?: string | null): Promise<CsvCikti> {
  const t = await getTranslations({ locale: csvDili(dil), namespace: "reports" });
  const rapor = await buildFuelReport(range);
  const nf = csvDili(dil) === "de" ? "de-AT" : csvDili(dil) === "en" ? "en-GB" : "tr-TR";
  const num = (v: number, d = 0) =>
    v.toLocaleString(nf, { minimumFractionDigits: d, maximumFractionDigits: d });

  const baslik = [
    t("col_plate"), t("col_driver"), t("col_tank"), t("col_avg_fuel"),
    t("col_consumed"), t("col_km"), t("col_samples"), t("col_l_100km"),
    t("col_refills"), t("col_leak"),
  ];

  const satirlar = rapor.rows.map((r) => [
    r.plate,
    r.driverName ?? "",
    r.tankCapacityL === null ? "" : String(r.tankCapacityL),
    r.avgPct === null ? "" : String(Math.round(r.avgPct)),
    r.dataUnreliable
      ? t("fuel_unreliable_badge")
      : r.consumedLiters !== null
        ? String(Math.round(r.consumedLiters))
        : r.hasData
          ? `${Math.round(r.consumedPct)}%`
          : "",
    r.km === null ? "" : String(Math.round(r.km)),
    String(r.sampleCount),
    r.lPer100Km === null
      ? t(`fuel_reason_${r.lPer100Reason ?? "no_odometer"}`, {
          minKm: FUEL_MIN_KM,
          minPct: FUEL_MIN_CONSUMED_PCT,
        })
      : num(r.lPer100Km, 1),
    r.dataUnreliable ? "" : String(r.refillCount),
    r.dataUnreliable ? "" : String(r.suspiciousDropCount),
  ]);

  const metin = satirlariBirlestir([baslik, ...satirlar], ";");
  return {
    govde: utf8Bom(metin),
    contentType: "text/csv;charset=utf-8",
    dosyaAdi: `hak-yakit-${bugun()}.csv`,
    satir: satirlar.length,
  };
}
