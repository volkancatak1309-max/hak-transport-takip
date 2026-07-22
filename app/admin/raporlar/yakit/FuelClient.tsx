"use client";

import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download, FileText, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  StatCard,
  StatusChip,
  EmptyState,
  type Column,
} from "@/components/ui-v2";
import type { FuelReport, FuelRow } from "@/lib/reports";

/**
 * Yakıt raporu. Yüzde okumaları device_telemetry.fuel_level_pct'ten
 * (report_fuel_stats RPC ile toplulaştırılır); litre/L100km çevrimi
 * vehicles.tank_capacity_l ile yapılır. Kapasitesi olmayan araçta (DO-671GY)
 * yalnız % gösterilir — UYDURMA litre yoktur.
 *
 * "Şüpheli düşüş" = yakıt seviyesi araç HAREKET ETMEDEN düştü (odometre
 * ilerlemedi): olası kaçak/hırsızlık. Suçlama değil, kırmızı bir dikkat sinyali.
 */
export function FuelClient({
  report,
  period,
}: {
  report: FuelReport;
  period: { from: string; to: string; days: number };
}) {
  const t = useTranslations("reports");
  const locale = useLocale();
  const nf = locale === "de" ? "de-AT" : "tr-TR";
  const num = (v: number, d = 0) =>
    v.toLocaleString(nf, { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (v: number) => `%${Math.round(v)}`;

  // Rapor hesaplanamadıysa SEBEBİ söylenir (22.07.2026). Eskiden her hata
  // "migration bekliyor" diye gösteriliyordu; migration uygulanmışken zaman
  // aşımına düşen sorgu yöneticiyi olmayan bir soruna yönlendiriyordu.
  if (!report.available) {
    const timedOut = report.unavailableReason === "timeout";
    return (
      <div className="pt-4">
        <EmptyState
          kind="none"
          title={timedOut ? t("fuel_timeout_title") : t("fuel_unavailable_title")}
          hint={timedOut ? t("fuel_timeout_hint") : t("fuel_unavailable_hint")}
        />
      </div>
    );
  }

  function exportCsv() {
    const header = [
      t("col_plate"),
      t("col_driver"),
      t("col_tank"),
      t("col_avg_fuel"),
      t("col_consumed"),
      t("col_l_100km"),
      t("col_refills"),
      t("col_leak"),
    ];
    // Dışa aktarım ekranla AYNI kuralı uygular: güvenilmez sensörün türetilmiş
    // sayıları CSV'ye de yazılmaz, yerine sebebi yazılır. Aksi hâlde ekranda
    // gizlenen sayı Excel'e sızıp karar tablosuna girerdi.
    const lines = report.rows.map((r) =>
      [
        r.plate,
        r.driverName ?? "",
        r.tankCapacityL ?? "",
        r.avgPct === null ? "" : Math.round(r.avgPct),
        r.dataUnreliable
          ? t("fuel_unreliable_badge")
          : r.consumedLiters !== null
            ? Math.round(r.consumedLiters)
            : r.hasData
              ? `${Math.round(r.consumedPct)}%`
              : "",
        r.dataUnreliable || r.lPer100Km === null ? "" : num(r.lPer100Km, 1),
        r.dataUnreliable ? "" : r.refillCount,
        r.dataUnreliable ? "" : r.suspiciousDropCount,
      ].join(";")
    );
    const csv = "﻿" + [header.join(";"), ...lines].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `hak-yakit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function exportPdf() {
    try {
      const { downloadFuelPdf } = await import("@/components/pdf/FuelReport");
      await downloadFuelPdf({
        period: `${period.from} – ${period.to}`,
        totalLiters: Math.round(report.totalConsumedLiters),
        fleetL100: report.fleetLPer100Km === null ? "—" : num(report.fleetLPer100Km, 1),
        rows: report.rows.map((r) => ({
          plate: r.plate,
          driver: r.driverName ?? "—",
          tank: r.tankCapacityL === null ? "—" : `${r.tankCapacityL} L`,
          avg: r.avgPct === null ? "—" : `${Math.round(r.avgPct)}%`,
          consumed: r.dataUnreliable
            ? t("fuel_unreliable_badge")
            : r.consumedLiters !== null
              ? `${Math.round(r.consumedLiters)} L`
              : r.hasData
                ? `${Math.round(r.consumedPct)}%`
                : "—",
          l100: r.dataUnreliable || r.lPer100Km === null ? "—" : num(r.lPer100Km, 1),
          refills:
            r.dataUnreliable || r.refillCount === 0
              ? "—"
              : r.refillLiters !== null
                ? `${r.refillCount} · ${Math.round(r.refillLiters)} L`
                : String(r.refillCount),
          leak:
            r.dataUnreliable || r.suspiciousDropCount === 0
              ? "—"
              : String(r.suspiciousDropCount),
        })),
      });
    } catch {
      toast.error(t("export_error"));
    }
  }

  const columns: Column<FuelRow>[] = [
    {
      key: "plate",
      header: t("col_plate"),
      // Güvenilmez sensör rozeti plakanın yanında durur: satırdaki tirelerin
      // SEBEBİ burada okunur, yoksa "veri yok" ile karışır.
      cell: (r) => (
        <span className="flex items-center gap-1.5">
          <span className="nums font-medium uppercase">{r.plate}</span>
          {r.dataUnreliable && (
            <span title={t("fuel_unreliable_tooltip", { pct: Math.round(r.zeroRatio * 100) })}>
              <AlertTriangle
                className="size-3.5 shrink-0 text-accent-gold"
                aria-label={t("fuel_unreliable_badge")}
              />
            </span>
          )}
        </span>
      ),
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
      key: "tank",
      header: t("col_tank"),
      align: "right",
      nums: true,
      hideBelow: "md",
      cell: (r) =>
        r.tankCapacityL === null ? (
          <StatusChip tone="neutral">{t("tank_missing")}</StatusChip>
        ) : (
          `${r.tankCapacityL} L`
        ),
      sortable: true,
      sortValue: (r) => r.tankCapacityL ?? -1,
    },
    {
      key: "avg",
      header: t("col_avg_fuel"),
      align: "right",
      nums: true,
      hideBelow: "sm",
      cell: (r) => (r.avgPct === null ? "—" : pct(r.avgPct)),
      sortable: true,
      sortValue: (r) => r.avgPct ?? -1,
    },
    {
      key: "consumed",
      header: t("col_consumed"),
      align: "right",
      nums: true,
      // Güvenilmez sensörde SAYI GÖSTERİLMEZ. Sıfır serisinin bitişi "dolum"
      // gibi göründüğü için tüketim de dolum da anlamsız; yarım doğru sayı
      // yokluktan daha zararlıdır (yönetici ona göre karar verir).
      cell: (r) =>
        r.dataUnreliable ? (
          <span className="text-muted-foreground">—</span>
        ) : r.consumedLiters !== null ? (
          <span className="font-semibold">{`${num(r.consumedLiters)} L`}</span>
        ) : r.hasData ? (
          <span className="font-semibold">{pct(r.consumedPct)}</span>
        ) : (
          <span className="text-muted-foreground">{t("no_data")}</span>
        ),
      sortable: true,
      sortValue: (r) => (r.dataUnreliable ? -1 : r.consumedLiters ?? r.consumedPct),
    },
    {
      key: "l100",
      header: t("col_l_100km"),
      align: "right",
      nums: true,
      cell: (r) =>
        r.dataUnreliable || r.lPer100Km === null ? "—" : num(r.lPer100Km, 1),
      sortable: true,
      sortValue: (r) => (r.dataUnreliable ? -1 : r.lPer100Km ?? -1),
    },
    {
      key: "refills",
      header: t("col_refills"),
      align: "right",
      nums: true,
      hideBelow: "md",
      cell: (r) =>
        r.dataUnreliable || r.refillCount === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="whitespace-nowrap">
            {r.refillCount}
            {r.refillLiters !== null && (
              <span className="ml-1.5 text-[11px] text-muted-foreground">
                {num(r.refillLiters)} L
              </span>
            )}
          </span>
        ),
      sortable: true,
      sortValue: (r) => r.refillCount,
    },
    {
      key: "leak",
      header: t("col_leak"),
      align: "right",
      // Kaçak sinyali de gizlenir: %0'a düşüp geri dönen ölü bir sensör, "araç
      // hareketsizken yakıt düştü" desenini birebir taklit eder. Arızalı
      // sensörden gelen kırmızı bir hırsızlık rozeti, şoför için haksız bir
      // suçlamadır — önce sensör onarılmalı.
      cell: (r) =>
        r.dataUnreliable || r.suspiciousDropCount === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <StatusChip tone="critical">{r.suspiciousDropCount}</StatusChip>
        ),
      sortable: true,
      sortValue: (r) => (r.dataUnreliable ? -1 : r.suspiciousDropCount),
    },
  ];

  // "En çok yakan" güvenilmez sensörden seçilemez — sayısı gösterilmeyen bir
  // aracı filo birincisi ilan etmek yanıltıcı olurdu.
  const top = report.rows.find((r) => r.hasData && !r.dataUnreliable);

  return (
    <div className="space-y-4 pt-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("stat_total_fuel")}
          value={`${num(report.totalConsumedLiters)} L`}
          scope={t("scope_range")}
        />
        <StatCard
          label={t("stat_fleet_l100")}
          value={report.fleetLPer100Km === null ? "—" : num(report.fleetLPer100Km, 1)}
          scope={t("scope_range")}
        />
        <StatCard
          label={t("stat_thirstiest")}
          value={top ? top.plate : "—"}
          scope={
            top && top.lPer100Km !== null
              ? t("stat_thirstiest_scope", { n: num(top.lPer100Km, 1) })
              : top && top.consumedLiters !== null
                ? `${num(top.consumedLiters)} L`
                : t("no_data")
          }
        />
        <StatCard
          label={t("stat_leak_vehicles")}
          value={report.suspiciousVehicles}
          scope={t("stat_leak_scope")}
          tone={report.suspiciousVehicles > 0 ? "critical" : "neutral"}
        />
      </div>

      {/* Kapasitesi girilmemiş araçlar %-bazlı gösterilir — yönetici forma girip
          litre metriklerini açabilir. Uydurma litre üretilmez. */}
      {report.capacityMissing > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="size-3.5 shrink-0 text-accent-gold" />
          {t("fuel_capacity_note", { n: report.capacityMissing })}
        </p>
      )}

      {/* Arızalı sensör uyarısı: bu araçların türetilmiş sayıları hem tabloda
          hem filo toplamlarında YOK — yönetici eksikliğin sebebini bilmeli. */}
      {report.unreliableVehicles > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="size-3.5 shrink-0 text-accent-gold" />
          {t("fuel_unreliable_note", { n: report.unreliableVehicles })}
        </p>
      )}

      {report.rows.length === 0 ? (
        <EmptyState kind="none" title={t("empty_title")} hint={t("empty_hint")} />
      ) : (
        <>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="size-4" />
              {t("export_csv")}
            </Button>
            <Button variant="outline" size="sm" onClick={exportPdf}>
              <FileText className="size-4" />
              {t("export_pdf")}
            </Button>
          </div>
          <DataTable
            rows={report.rows}
            columns={columns}
            rowKey={(r) => r.vehicleId}
            totalLabel={t("total_vehicles")}
          />
        </>
      )}

      {/* Tüketim = dolumlar + net düşüş (ilk − son), kapasiteyle litreye çevrilir
          — bir tahmindir. Kaçak sinyali odometre ilerlemeden düşen yakıttır. */}
      <p className="text-xs text-muted-foreground">{t("fuel_note")}</p>
    </div>
  );
}
