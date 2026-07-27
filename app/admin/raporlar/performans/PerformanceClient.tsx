"use client";

import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, type Column } from "@/components/ui-v2";
import { ReportStatBand, type ReportStat } from "@/components/admin/ReportStatBand";
import { ReportTableHeader } from "@/components/admin/ReportTableHeader";
import { formatDurationShort } from "@/lib/format";
import type { PerformanceReport, PerformanceRow } from "@/lib/reports";
import {
  SAFETY_SCORE_CALIBRATED,
  TOP_DRIVER_MIN_SCORED,
} from "@/lib/metric-thresholds";

/**
 * Sürücü performans raporu.
 *
 * Güvenlik skoru Analiz sayfasının computeSafetyScores çıktısının AYNISIDIR
 * (aynı ağırlıklar, aynı km-normalizasyonu, aynı eşik) — burada yeniden
 * hesaplanmaz. `null` skor "yeterli sürüş verisi yok" demektir; 0 ile
 * karıştırılmaması için ayrı gösterilir.
 *
 * Olay kolonları (sert fren / ani hızlanma / aşırı hız) şoföre ARACI
 * üzerinden bağlanır — skorun kullandığı eşlemenin aynısı.
 */
export function PerformanceClient({
  report,
  period,
}: {
  report: PerformanceReport;
  period: { from: string; to: string; days: number };
}) {
  const t = useTranslations("reports");
  const locale = useLocale();
  const nf = locale === "de" ? "de-AT" : "tr-TR";

  async function exportPdf() {
    try {
      const { downloadPerformancePdf } = await import(
        "@/components/pdf/PerformanceReport"
      );
      await downloadPerformancePdf({
        period: `${period.from} – ${period.to}`,
        // Skor kalibre edilene kadar PDF'e de BASILMAZ — kâğıda basılmış yanlış
        // bir sayı ekrandakinden daha uzun yaşar (22.07.2026).
        showScore: SAFETY_SCORE_CALIBRATED,
        rows: report.rows.map((r) => ({
          name: r.name,
          score: r.safetyScore === null ? "—" : String(r.safetyScore),
          shifts: String(r.shifts),
          worked: formatDurationShort(r.workedMs, "de"),
          km: r.km === null ? "—" : String(Math.round(r.km)),
          delivered: String(r.delivered),
          events: String(r.events),
          braking: String(r.harshBraking),
          accel: String(r.harshAcceleration),
          speeding: String(r.overspeeding),
        })),
      });
    } catch {
      toast.error(t("export_error"));
    }
  }

  const scoreCell = (r: PerformanceRow) => {
    if (r.safetyScore === null)
      return <span className="text-muted-foreground">{t("no_score")}</span>;
    const tone =
      r.safetyScore >= 80
        ? "text-accent-green"
        : r.safetyScore >= 50
          ? "text-accent-gold-text"
          : "text-status-critical-text";
    return <span className={`font-semibold ${tone}`}>{r.safetyScore}</span>;
  };

  const columns: Column<PerformanceRow>[] = [
    {
      key: "name",
      header: t("col_driver"),
      cell: (r) => <span className="font-medium">{r.name}</span>,
      sortable: true,
      sortValue: (r) => r.name,
    },
    // SKOR KOLONU — kalibrasyona kadar YOK (22.07.2026). Yürürlükteki doğrusal
    // formül herkesi 0'a çakıyordu; sıfır bir ölçüm değil taban çarpmasıydı ve
    // bu sayı bir İNSAN hakkında. Gerekçe: lib/metric-thresholds.ts.
    ...(SAFETY_SCORE_CALIBRATED
      ? [
          {
            key: "score",
            header: t("col_score"),
      help: "rep_perf_score",
            align: "right" as const,
            nums: true,
            cell: scoreCell,
            sortable: true,
            sortValue: (r: PerformanceRow) => r.safetyScore ?? -1,
          },
        ]
      : []),
    {
      key: "shifts",
      header: t("col_shifts"),
      help: "rep_perf_shifts",
      align: "right",
      nums: true,
      cell: (r) => r.shifts,
      sortable: true,
      sortValue: (r) => r.shifts,
    },
    {
      key: "worked",
      header: t("col_worked"),
      help: "rep_perf_worked",
      align: "right",
      nums: true,
      hideBelow: "sm",
      cell: (r) => formatDurationShort(r.workedMs, locale),
      sortable: true,
      sortValue: (r) => r.workedMs,
    },
    {
      key: "km",
      header: t("col_km"),
      help: "rep_perf_km",
      align: "right",
      nums: true,
      hideBelow: "md",
      cell: (r) =>
        r.km === null ? "—" : `${Math.round(r.km).toLocaleString(nf)} km`,
      sortable: true,
      sortValue: (r) => r.km ?? -1,
    },
    {
      key: "delivered",
      header: t("col_delivered"),
      help: "rep_perf_delivered",
      align: "right",
      nums: true,
      hideBelow: "md",
      cell: (r) => r.delivered,
      sortable: true,
      sortValue: (r) => r.delivered,
    },
    {
      key: "events",
      header: t("col_events"),
      help: "rep_perf_events",
      align: "right",
      nums: true,
      cell: (r) => (
        <span className="whitespace-nowrap">
          {r.events}
          {r.events > 0 && (
            <span className="ml-1.5 text-[11px] text-muted-foreground">
              {r.harshBraking}/{r.harshAcceleration}/{r.overspeeding}
            </span>
          )}
        </span>
      ),
      sortable: true,
      sortValue: (r) => r.events,
    },
  ];

  /**
   * "EN İYİ ŞOFÖR" KARTI — üç şart birden (22.07.2026).
   *
   * Eski kod `rows.find(r => r.safetyScore !== null)` idi: en yükseği DEĞİL,
   * sıralı listedeki ilk null-olmayanı alıyordu. Herkes 0 olunca sıralama
   * ikincil ölçüte düşüyor ve rastgele biri "En iyi şoför — skor 0" ilan
   * ediliyordu. Müşteri önünde utanç, o personele haksızlık.
   *
   *   1. en az TOP_DRIVER_MIN_SCORED şoför skorlanmış olmalı
   *   2. en yüksek skor ikinciden KESİN büyük olmalı (beraberlik varsa iddia yok)
   *   3. en yüksek skor 0'dan büyük olmalı
   * Sağlanmazsa kart HİÇ render edilmez — boş kart da soru işareti doğurur.
   */
  const scored = report.rows
    .filter((r): r is PerformanceRow & { safetyScore: number } => r.safetyScore !== null)
    .sort((a, b) => b.safetyScore - a.safetyScore);
  const best =
    SAFETY_SCORE_CALIBRATED &&
    scored.length >= TOP_DRIVER_MIN_SCORED &&
    scored[0].safetyScore > 0 &&
    scored[0].safetyScore > scored[1].safetyScore
      ? scored[0]
      : null;

  // Ölçüm bandı — skor kalibre değilse ortalama-skor ve "en iyi şoför" hücreleri
  // hiç girmez; band kolon sayısını kalan hücrelere göre kendi ayarlar.
  const stats: ReportStat[] = [
    ...(SAFETY_SCORE_CALIBRATED
      ? [
          {
            label: t("stat_avg_score"),
            value: report.avgScore === null ? "—" : report.avgScore,
            scope: t("stat_scored", { n: report.scoredCount }),
          },
        ]
      : []),
    ...(best
      ? [
          {
            label: t("stat_top_driver"),
            value: best.name,
            scope: t("stat_top_scope", { n: best.safetyScore }),
          },
        ]
      : []),
    { label: t("stat_shifts"), value: report.totalShifts, scope: t("scope_range") },
    {
      label: t("stat_worked"),
      value: formatDurationShort(report.totalWorkedMs, locale),
      scope: t("scope_range"),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Skor kalibrasyon notu — kolonun NEDEN olmadığı ekranda yazar. Boş bir
          kolon ya da "—" yöneticiye "panel bozuk" dedirtir; sebep ona bilgi verir. */}
      {!SAFETY_SCORE_CALIBRATED && (
        <p className="rounded-[12px] border border-border/60 px-3.5 py-2.5 text-xs text-muted-foreground">
          {t("score_calibrating")}
        </p>
      )}

      <ReportStatBand stats={stats} />

      {report.rows.length === 0 ? (
        <EmptyState kind="none" title={t("empty_title")} hint={t("empty_hint")} />
      ) : (
        <div className="space-y-3">
          <ReportTableHeader
            label={t("perf_table_title")}
            tkey="rep_perf_table"
            actions={
              <Button variant="outline" size="sm" onClick={exportPdf}>
                <FileText className="size-4" />
                {t("export_pdf")}
              </Button>
            }
          />
          <DataTable
            rows={report.rows}
            columns={columns}
            rowKey={(r) => r.workerId}
            totalLabel={t("total_drivers")}
          />
        </div>
      )}

      {/* Olay kolonunun kısaltması ve skorun anlamı — tablo altında tek satır. */}
      <p className="text-xs text-muted-foreground">
        {SAFETY_SCORE_CALIBRATED ? t("perf_note") : t("perf_note_no_score")}
      </p>
    </div>
  );
}
