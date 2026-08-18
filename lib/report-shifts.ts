import "server-only";
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers, dropNonDrivers } from "@/lib/driver-scope";
import { markKmMeasured, type WithKmMeasured } from "@/lib/km-quality";
import { DEFAULT_LOCALE } from "@/i18n/request";
import {
  WORKER_PUBLIC_COLUMNS,
  type TimeEntry,
  type WorkerPublic,
} from "@/lib/types";
import type { DateRange } from "@/lib/analytics-shared";

/**
 * ARALIK VARDİYALARI — İKİ RAPOR YÜZEYİNİN ORTAK YÜKLEYİCİSİ.
 *
 * Çağıranlar:
 *   · lib/report-csv.ts  buildShiftsCsv     → shifts.csv
 *   · app/api/mobile/reports/schichtbericht.pdf → resmî AZG çalışma kaydı
 *
 * ── NEDEN AYRI DOSYA (18.08.2026) ─────────────────────────────────────────
 * Sorgu ilk olarak `buildShiftsCsv` içinde yazıldı. Schichtbericht PDF'i AYNI
 * satırları istiyor; kopyalamak iki resmî çıktının zamanla ayrışması demekti —
 * biri test filtresini kazanır, öteki kaybeder ve fark yalnız denetimde görünür.
 * Onun için sorgu buraya alındı ve CSV oradan çağırıyor. Davranış aynı;
 * scripts/verify-rapor-csv.mjs kapanmış pencerede bayt bayt doğruluyor.
 *
 * ── ÜÇ ELEME, PANONUN UYGULADIĞININ AYNISI ────────────────────────────────
 * test-filtered  → kalıcı test hesabının vardiyaları hiçbir rapora girmez (028)
 * driver-scoped  → yönetici hesabından açılmış demo vardiyalar elenir; canlıda
 *                  iki satır tek başına 20.100 km taşıyordu
 * km_measured    → cihazı sessiz vardiyanın "0 km"si bir ÖLÇÜM DEĞİL; kmDiff
 *                  null döner ve hücre boş kalır (lib/km-quality.ts)
 *
 * FİLO kapsamı UYGULANMAZ: iki çağıranın ikisi de `requireMobileAdmin`
 * arkasında ve patronun kapsamı kısıtsız (şef bu uçlara giremiyor). Panelde
 * pano şefe de açık ve orada `onlyFleet` var — o kapı ayrı bir karar.
 */

export type AralikVardiyalari = {
  /** Aralıkta BAŞLAYAN vardiyalar, `started_at` azalan (panonun sırası). */
  entries: WithKmMeasured<TimeEntry>[];
  /** İSİM SÖZLÜĞÜ — bilerek GENİŞ (yönetici dahil): eski satırın adı "—" olmasın. */
  workerMap: Map<string, WorkerPublic>;
  /** ŞOFÖR EVRENİ — Pers.-Nr numaralandırması bunun üzerinden yapılır. */
  soforler: WorkerPublic[];
  /** Ada göre yerel harmanlama dili (tr'de Ç ≠ C; numaralandırma buna bağlı). */
  harman: "tr" | "de";
};

export async function loadRangeShifts(range: DateRange): Promise<AralikVardiyalari> {
  const scope = await getTestScope();
  const driverScope = await getDriverScope();

  const [entriesRes, workersRes] = await Promise.all([
    // SAYFALI: uzun aralıklar 1000 satır tavanını aşar ve dışa aktarım sessizce
    // eksik kalırdı (panelin kendi notu, app/admin/page.tsx).
    fetchAllRows<TimeEntry>(
      (from, to) =>
        // test-filtered + driver-scoped
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
      "loadRangeShifts/time_entries"
    ),
    // test-filtered: isim sözlüğü geniş kalır (bkz. tür yorumu).
    withoutTestRows(
      supabaseAdmin.from("workers").select(WORKER_PUBLIC_COLUMNS).order("name"),
      "id",
      scope.workerIds
    ),
  ]);

  const workersData = (workersRes.data ?? []) as WorkerPublic[];
  return {
    entries: await markKmMeasured((entriesRes.data ?? []) as TimeEntry[]),
    workerMap: new Map(workersData.map((w) => [w.id, w])),
    soforler: dropNonDrivers(workersData, (w) => w.id, driverScope),
    harman: DEFAULT_LOCALE === "de" ? "de" : "tr",
  };
}

/**
 * Şoför → Pers.-Nr. Boş `employee_number` yerine 1'den başlayan sıra numarası;
 * sıra ADA göre ve YEREL harmanlamayla kurulur (panelin kuralının aynısı).
 *
 * ⚠️ SIRAYA YALNIZ ŞOFÖRLER GİRER. Yöneticiler listede yer kaplarsa
 * numarasız şoförlerin yedek numaraları kayar (panelin kendi notu).
 */
export function persNrHaritasi(
  soforler: WorkerPublic[],
  harman: "tr" | "de"
): Map<string, string> {
  const sirali = [...soforler].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? "", harman)
  );
  const out = new Map<string, string>();
  sirali.forEach((w, i) =>
    out.set(w.id, (w.employee_number ?? "").trim() || String(i + 1))
  );
  return out;
}
