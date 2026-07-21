"use client";

import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, StatCard, EmptyState, type Column } from "@/components/ui-v2";
import { formatDurationShort } from "@/lib/format";
import type { PerformanceReport, PerformanceRow } from "@/lib/reports";

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
          ? "text-accent-gold"
          : "text-status-critical";
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
    {
      key: "score",
      header: t("col_score"),
      align: "right",
      nums: true,
      cell: scoreCell,
      sortable: true,
      sortValue: (r) => r.safetyScore ?? -1,
    },
    {
      key: "shifts",
      header: t("col_shifts"),
      align: "right",
      nums: true,
      cell: (r) => r.shifts,
      sortable: true,
      sortValue: (r) => r.shifts,
    },
    {
      key: "worked",
      header: t("col_worked"),
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

  const best = report.rows.find((r) => r.safetyScore !== null);

  return (
    <div className="space-y-4 pt-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard
          label={t("stat_avg_score")}
          value={report.avgScore === null ? "—" : report.avgScore}
          scope={t("stat_scored", { n: report.scoredCount })}
        />
        <StatCard
          label={t("stat_top_driver")}
          value={best ? best.name : "—"}
          scope={best ? t("stat_top_scope", { n: best.safetyScore ?? 0 }) : t("no_data")}
        />
        <StatCard
          label={t("stat_shifts")}
          value={report.totalShifts}
          scope={t("scope_range")}
        />
        <StatCard
          label={t("stat_worked")}
          value={formatDurationShort(report.totalWorkedMs, locale)}
          scope={t("scope_range")}
        />
      </div>

      {report.rows.length === 0 ? (
        <EmptyState kind="none" title={t("empty_title")} hint={t("empty_hint")} />
      ) : (
        <>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={exportPdf}>
              <FileText className="size-4" />
              {t("export_pdf")}
            </Button>
          </div>
          <DataTable
            rows={report.rows}
            columns={columns}
            rowKey={(r) => r.workerId}
            totalLabel={t("total_drivers")}
          />
        </>
      )}

      {/* Olay kolonunun kısaltması ve skorun anlamı — tablo altında tek satır. */}
      <p className="text-xs text-muted-foreground">{t("perf_note")}</p>
    </div>
  );
}
