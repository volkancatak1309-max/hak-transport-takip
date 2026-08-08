"use client";

import { useLocale, useTranslations } from "next-intl";
import { EXPORT_ENABLED } from "@/lib/tenant";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, type Column } from "@/components/ui-v2";
import { ReportStatBand } from "@/components/admin/ReportStatBand";
import { ReportTableHeader } from "@/components/admin/ReportTableHeader";
import type { DistanceReport, DistanceRow } from "@/lib/reports";
import { noteExport } from "@/lib/audit-export-client";

/**
 * Filo geneli mesafe raporu. Km, aracın KENDİ odometresinin aralıktaki ilk ve
 * son okuması arasındaki farktır (lib/analytics → getVehicleDistanceKm), yani
 * Analiz sayfasının ve güvenlik skorunun kullandığı sayının aynısı.
 *
 * "Veri yok" satırı BİLİNÇLİ olarak 0 değildir: odometre okuması yoksa ya da
 * fark güvenilmezse (negatif / günlük makul sınırın üstünde) km uydurulmaz.
 */
export function DistanceClient({ report }: { report: DistanceReport }) {
  const t = useTranslations("reports");
  const locale = useLocale();
  const nf = locale === "de" ? "de-AT" : "tr-TR";
  const num = (v: number, d = 0) =>
    v.toLocaleString(nf, { minimumFractionDigits: d, maximumFractionDigits: d });

  async function exportCsv() {
    const header = [t("col_plate"), t("col_driver"), t("col_km"), t("col_km_day")];
    const lines = report.rows.map((r) =>
      [
        r.plate,
        r.driverName ?? "",
        r.km === null ? "" : Math.round(r.km),
        r.kmPerDay === null ? "" : Math.round(r.kmPerDay),
      ].join(";")
    );
    // BOM + ; ayraç: Excel'in Avusturya yerelinde doğrudan açılır (masraf
    // dışa aktarımıyla aynı biçim).
    const csv = "﻿" + [header.join(";"), ...lines].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `hak-mesafe-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    // İz: CSV'yi kim dışa çıkardı (045). Katman kapalıysa no-op.
    await noteExport("csv", "distance");
  }

  const columns: Column<DistanceRow>[] = [
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
      key: "km",
      header: t("col_km"),
      help: "rep_dist_km",
      align: "right",
      nums: true,
      cell: (r) =>
        r.km === null ? (
          <span className="text-muted-foreground">{t("no_data")}</span>
        ) : (
          `${num(r.km)} km`
        ),
      sortable: true,
      sortValue: (r) => r.km ?? -1,
    },
    {
      key: "kmDay",
      header: t("col_km_day"),
      help: "rep_dist_kmday",
      align: "right",
      nums: true,
      cell: (r) => (r.kmPerDay === null ? "—" : `${num(r.kmPerDay)} km`),
      sortable: true,
      sortValue: (r) => r.kmPerDay ?? -1,
    },
  ];

  return (
    <div className="space-y-6">
      <ReportStatBand
        stats={[
          {
            label: t("stat_total_km"),
            value: `${num(report.totalKm)} km`,
            scope: t("scope_range"),
          },
          {
            label: t("stat_avg_day"),
            value: `${num(report.totalKm / report.days)} km`,
            scope: t("stat_days", { n: report.days }),
          },
          {
            label: t("stat_measured"),
            value: `${report.measured}/${report.vehicleCount}`,
            scope: t("stat_measured_scope"),
          },
        ]}
      />

      {report.rows.length === 0 ? (
        <EmptyState kind="none" title={t("empty_title")} hint={t("empty_hint")} />
      ) : (
        <div className="space-y-3">
          <ReportTableHeader
            label={t("distance_table_title")}
            tkey="rep_distance_table"
            actions={
              <Button variant="outline" size="sm" onClick={exportCsv} hidden={!EXPORT_ENABLED} disabled={!EXPORT_ENABLED}>
                <Download className="size-4" />
                {t("export_csv")}
              </Button>
            }
          />
          <DataTable
            rows={report.rows}
            columns={columns}
            rowKey={(r) => r.vehicleId}
            totalLabel={t("total_vehicles")}
          />
        </div>
      )}
    </div>
  );
}
