import "server-only";
import { getTranslations } from "next-intl/server";
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers, dropNonDrivers } from "@/lib/driver-scope";
import { markKmMeasured } from "@/lib/km-quality";
import { buildDistanceReport, buildFuelReport } from "@/lib/reports";
import { FUEL_MIN_KM, FUEL_MIN_CONSUMED_PCT } from "@/lib/metric-thresholds";
import { PACKAGES_ENABLED } from "@/lib/tenant";
import { DEFAULT_LOCALE } from "@/i18n/request";
import {
  workedMs,
  kmDiff,
  formatDate,
  formatTime,
  formatDurationShort,
} from "@/lib/format";
import {
  WORKER_PUBLIC_COLUMNS,
  type TimeEntry,
  type WorkerPublic,
} from "@/lib/types";
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
export async function buildShiftsCsv(range: DateRange): Promise<CsvCikti> {
  const t = await getTranslations({ locale: DEFAULT_LOCALE, namespace: "admin" });
  const scope = await getTestScope();
  const driverScope = await getDriverScope();

  const [entriesRes, workersRes] = await Promise.all([
    // SAYFALI: uzun aralıklar 1000 satır tavanını aşar ve dışa aktarım sessizce
    // eksik kalırdı (panelin kendi notu, app/admin/page.tsx).
    fetchAllRows<TimeEntry>((from, to) =>
      // test-filtered + driver-scoped: panonun uyguladığı iki eleme. Yönetici
      // hesabından açılmış iki demo vardiya tek başına 20.100 km taşıyordu.
      onlyDrivers(
        withoutTestRows(
          supabaseAdmin
            .from("time_entries")
            .select("*")
            .gte("started_at", range.start.toISOString())
            .lte("started_at", range.end.toISOString())
            .order("started_at", { ascending: false })
            .order("id")
            .range(from, to),
          "worker_id",
          scope.workerIds
        ),
        "worker_id",
        driverScope
      ),
    "buildShiftsCsv/time_entries"
    ),
    // test-filtered: İSİM HARİTASI bilerek GENİŞ kalır — daraltılırsa eski bir
    // vardiyanın adı "—" olur (satır düşmez, kimlik kaybolur). Şoför evreni
    // aşağıda dropNonDrivers ile ayrıca türetiliyor.
    withoutTestRows(
      supabaseAdmin.from("workers").select(WORKER_PUBLIC_COLUMNS).order("name"),
      "id",
      scope.workerIds
    ),
  ]);

  const workersData = (workersRes.data ?? []) as WorkerPublic[];
  const workerMap = new Map(workersData.map((w) => [w.id, w]));

  // driver-scoped: YALNIZ Pers.-Nr numaralandırması için. Yöneticiler sırada
  // yer kaplarsa employee_number'ı boş olan şoförlerin yedek numaraları kayar.
  const soforler = dropNonDrivers(workersData, (w) => w.id, driverScope);
  const harman = DEFAULT_LOCALE === "de" ? "de" : "tr";
  const sirali = [...soforler].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? "", harman)
  );
  const persNr = new Map<string, string>();
  sirali.forEach((w, i) =>
    persNr.set(w.id, (w.employee_number ?? "").trim() || String(i + 1))
  );

  // km_measured: cihazı sessiz vardiyanın 0 km'si ÖLÇÜM DEĞİL → kmDiff null
  // döner ve hücre BOŞ kalır (lib/km-quality.ts). Panelin Excel'i de öyle.
  const entries = await markKmMeasured((entriesRes.data ?? []) as TimeEntry[]);

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
      formatDate(e.started_at, DEFAULT_LOCALE),
      formatTime(e.started_at, DEFAULT_LOCALE),
      e.ended_at ? formatTime(e.ended_at, DEFAULT_LOCALE) : t("statusActive"),
      formatDurationShort(workedMs(e), DEFAULT_LOCALE),
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
export async function buildDistanceCsv(range: DateRange): Promise<CsvCikti> {
  const t = await getTranslations({ locale: DEFAULT_LOCALE, namespace: "reports" });
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
export async function buildFuelCsv(range: DateRange): Promise<CsvCikti> {
  const t = await getTranslations({ locale: DEFAULT_LOCALE, namespace: "reports" });
  const rapor = await buildFuelReport(range);
  const nf = DEFAULT_LOCALE === "de" ? "de-AT" : "tr-TR";
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
