"use client";

import { useLocale, useTranslations } from "next-intl";
import { DataTable, StatCard, EmptyState, type Column } from "@/components/ui-v2";
import { HelpTip } from "@/components/help/HelpTip";
import { SPEED_MIN_KM } from "@/lib/metric-thresholds";
import type { SpeedReport, SpeedRow } from "@/lib/reports";

/**
 * Hız raporu. İhlaller `vehicle_events`'ten gelir — cihazın aşırı hız OLAYI ve
 * o anda bildirdiği hız. Analiz sayfasının "aşırı hız" sayacıyla aynı kaynak,
 * aynı aralık → iki ekran çelişmez.
 *
 * "100 km'de ihlal" kolonu, çok km yapan şoförün doğal olarak çok ihlal
 * üretmesini dengeler (güvenlik skorunun km-normalizasyonuyla aynı fikir).
 * Km bilinmiyorsa oran BOŞ bırakılır — 0'a bölüp "temiz" göstermeyiz.
 *
 * ORTALAMA HIZ BİLİNÇLİ OLARAK YOK: satır satır telemetri toplulaştırması
 * ister (aralıkta 49 bin–258 bin satır) ve bu projede PostgREST aggregate
 * kapalı. Uydurma ortalama koymaktansa kolonu hiç açmıyoruz.
 */
export function SpeedClient({ report }: { report: SpeedReport }) {
  const t = useTranslations("reports");
  const locale = useLocale();
  const nf = locale === "de" ? "de-AT" : "tr-TR";

  const columns: Column<SpeedRow>[] = [
    {
      key: "plate",
      header: t("col_plate"),
      cell: (r) => <span className="nums font-medium uppercase">{r.plate}</span>,
      sortable: true,
      sortValue: (r) => r.plate,
    },
    {
      key: "driver",
      header: t("col_driver"),
      cell: (r) => r.driverName ?? "—",
      hideBelow: "sm",
      sortable: true,
      sortValue: (r) => r.driverName ?? "",
    },
    {
      key: "violations",
      header: t("col_violations"),
      align: "right",
      nums: true,
      cell: (r) =>
        r.violations === 0 ? (
          <span className="text-muted-foreground">0</span>
        ) : (
          <span className="font-semibold text-accent-gold">{r.violations}</span>
        ),
      sortable: true,
      sortValue: (r) => r.violations,
    },
    {
      key: "max",
      header: t("col_max_speed"),
      align: "right",
      nums: true,
      cell: (r) =>
        r.maxSpeedKmh === null ? (
          "—"
        ) : (
          <span className={r.maxSpeedKmh >= 131 ? "font-semibold text-status-critical" : ""}>
            {r.maxSpeedKmh} km/s
          </span>
        ),
      sortable: true,
      sortValue: (r) => r.maxSpeedKmh ?? -1,
    },
    {
      key: "per100",
      header: t("col_per_100km"),
      align: "right",
      nums: true,
      hideBelow: "md",
      // SEBEBİ YAZILAN BOŞLUK (22.07.2026): eskiden üç farklı durum da tek bir
      // "Veri yok" ile gösteriliyordu; yönetici hangi aracı kontrol ettireceğini
      // bilemiyordu. Sebebi yazılmayan boşluk "panel bozuk" dedirtir, sebebi
      // yazılan boşluk iş verir (cihazı kontrol ettir / bekle).
      cell: (r) =>
        r.per100Km === null ? (
          <span className="text-[11px] leading-tight text-muted-foreground">
            {t(`ratio_reason_${r.per100Reason ?? "no_odometer"}`, {
              min: SPEED_MIN_KM,
            })}
          </span>
        ) : (
          r.per100Km.toLocaleString(nf, { maximumFractionDigits: 1 })
        ),
      sortable: true,
      sortValue: (r) => r.per100Km ?? -1,
    },
  ];

  return (
    <div className="space-y-4 pt-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={t("stat_violations")}
          value={report.totalViolations}
          scope={t("scope_range")}
          tone={report.totalViolations > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label={t("stat_max_speed")}
          value={report.maxSpeedKmh === null ? "—" : `${report.maxSpeedKmh} km/s`}
          scope={t("scope_range")}
        />
        <StatCard
          label={t("stat_vehicles_flagged")}
          value={`${report.vehiclesWithViolations}/${report.vehicleCount}`}
          scope={t("stat_vehicles_flagged_scope")}
        />
      </div>

      {report.rows.length === 0 ? (
        <EmptyState kind="none" title={t("empty_title")} hint={t("empty_hint")} />
      ) : (
        <>
          <div className="flex items-center gap-1">
            <span className="text-[13px] font-medium">{t("speed_table_title")}</span>
            <HelpTip tkey="rep_speed_table" />
          </div>
          <DataTable
            rows={report.rows}
            columns={columns}
            rowKey={(r) => r.vehicleId}
            totalLabel={t("total_vehicles")}
          />
        </>
      )}

      <p className="text-xs text-muted-foreground">
        {t("speed_note")} {t("speed_min_km_note", { min: SPEED_MIN_KM })}
      </p>
    </div>
  );
}
