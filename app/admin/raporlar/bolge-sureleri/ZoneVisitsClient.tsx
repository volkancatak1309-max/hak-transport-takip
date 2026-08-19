"use client";

import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Download } from "lucide-react";
import { EXPORT_ENABLED } from "@/lib/tenant";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, StatusChip, type Column } from "@/components/ui-v2";
import { ReportStatBand } from "@/components/admin/ReportStatBand";
import { ReportTableHeader } from "@/components/admin/ReportTableHeader";
import { formatDateTime, formatIdleShort, formatTime } from "@/lib/format";
import type { ZoneVisitReport, ZoneVisitRow } from "@/lib/zone-visit-report";
import { noteExport } from "@/lib/audit-export-client";

/**
 * BÖLGE SÜRELERİ — müşteri faturasına EK olarak giden rapor (FAZ C).
 *
 * ═══ İKİ DÜRÜSTLÜK KURALI EKRANDA GÖRÜNÜR ═══
 *  1. AÇIK ziyaretin süresi YOKTUR → "—". "Şu an − başlangıç" diye bir sayı
 *     üretmiyoruz; araç hâlâ içerideyken süre henüz ölçülmemiştir.
 *  2. Sinyal kesintisiyle kapanan ziyaret İŞARETLİ (`gap_timeout`): cihaz
 *     sustuğu için ziyaret son doğrulanmış anda kapandı, GERÇEK süre daha uzun
 *     olabilir. Rozet olmasa bu satır tam ölçülmüş gibi faturaya girerdi —
 *     yakıt raporundaki `fuel_reason_*` deseninin aynısı.
 *
 * MOBİL DÜZEN: dar ekranda tek yığılmış kolon (`hideAbove:"md"`), geniş ekranda
 * beş ayrı kolon (`hideBelow:"md"`). Alarmlar ekranıyla aynı desen; ikisi
 * hiçbir genişlikte aynı anda görünmez, veri tekrarlanmaz.
 */
export function ZoneVisitsClient({ report }: { report: ZoneVisitReport }) {
  const t = useTranslations("reports");
  const locale = useLocale();

  /** Açık ziyaret = süre yok. Tek yerden geçsin ki hiçbir sütun "0 dk" basmasın. */
  const sure = (ms: number | null) => (ms === null ? "—" : formatIdleShort(ms, locale));

  async function exportCsv() {
    const header = [
      t("zone_col_customer"),
      t("zone_col_zone"),
      t("col_plate"),
      t("col_driver"),
      t("zone_col_in"),
      t("zone_col_out"),
      t("zone_col_minutes"),
      t("zone_col_note"),
    ];
    const lines = report.rows.map((r) =>
      [
        r.customerName ?? "",
        r.zoneName,
        r.plate,
        r.driverName ?? "",
        formatDateTime(r.startedAt, locale),
        r.endedAt ? formatDateTime(r.endedAt, locale) : "",
        // Açık ziyaret CSV'de de BOŞ kalır — Excel'de 0 görünmesin.
        r.durationMs === null ? "" : Math.round(r.durationMs / 60000),
        // Belirsizlik CSV'ye de taşınır: fatura ekini açan kişi ekranı görmüyor.
        r.belirsiz ? t("zone_uncertain") : "",
      ].join(";")
    );
    // BOM + ";" ayraç: Excel'in Avusturya yerelinde doğrudan açılır (diğer
    // raporlarla aynı biçim).
    const csv = "﻿" + [header.join(";"), ...lines].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `hak-bolge-sureleri-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    await noteExport("csv", "zone_visits");
  }

  const belirsizRozet = (
    <StatusChip tone="warning">
      <AlertTriangle className="size-3" aria-hidden />
      {t("zone_uncertain_short")}
    </StatusChip>
  );

  const columns: Column<ZoneVisitRow>[] = [
    {
      // ── MOBİL: tek kolon, üç kademe ───────────────────────────────────────
      key: "mobil",
      header: t("zone_col_visit"),
      hideAbove: "md",
      cell: (r) => (
        <div className="min-w-0 space-y-1 py-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-medium">{r.customerName ?? r.zoneName}</span>
            <span className="nums shrink-0 font-medium">{sure(r.durationMs)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="truncate">
              <span className="nums uppercase">{r.plate}</span>
              {r.driverName && ` · ${r.driverName}`}
            </span>
            <span className="nums shrink-0">
              {formatTime(r.startedAt, locale)} → {r.endedAt ? formatTime(r.endedAt, locale) : "—"}
            </span>
          </div>
          {r.belirsiz && <div>{belirsizRozet}</div>}
        </div>
      ),
      sortable: true,
      sortValue: (r) => r.startedAt,
    },
    {
      key: "customer",
      header: t("zone_col_customer"),
      hideBelow: "md",
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block font-medium">{r.customerName ?? r.zoneName}</span>
          {r.customerName && (
            <span className="block text-xs text-muted-foreground">{r.zoneName}</span>
          )}
        </span>
      ),
      sortable: true,
      sortValue: (r) => r.customerName ?? r.zoneName,
    },
    {
      key: "vehicle",
      header: t("col_plate"),
      hideBelow: "md",
      cell: (r) => (
        <span className="block min-w-0">
          <span className="nums block font-medium uppercase">{r.plate}</span>
          <span className="block text-xs text-muted-foreground">{r.driverName ?? "—"}</span>
        </span>
      ),
      sortable: true,
      sortValue: (r) => r.plate,
    },
    {
      key: "in",
      header: t("zone_col_in"),
      hideBelow: "md",
      nums: true,
      cell: (r) => formatDateTime(r.startedAt, locale),
      sortable: true,
      sortValue: (r) => r.startedAt,
    },
    {
      key: "out",
      header: t("zone_col_out"),
      hideBelow: "md",
      nums: true,
      // Açık ziyaret: çıkış yok, "devam ediyor" denmez — henüz ölçülmedi.
      cell: (r) => (r.endedAt ? formatDateTime(r.endedAt, locale) : "—"),
    },
    {
      key: "duration",
      header: t("zone_col_duration"),
      help: "rep_zone_duration",
      hideBelow: "md",
      align: "right",
      nums: true,
      cell: (r) => (
        <span className="inline-flex items-center justify-end gap-1.5">
          <span className="nums font-medium">{sure(r.durationMs)}</span>
          {r.belirsiz && belirsizRozet}
        </span>
      ),
      sortable: true,
      sortValue: (r) => r.durationMs ?? -1,
    },
  ];

  // "Hiç müşteri bölgesi tanımlı değil" ile "bölge var ama bu aralıkta ziyaret
  // yok" AYRI durumlar. İkisini aynı boş ekrana düşürmek yöneticiyi yanlış yere
  // bakmaya gönderirdi: birinde tarih aralığı, diğerinde Bölgeler ekranı.
  if (!report.bolgeTanimliMi) {
    return (
      <EmptyState kind="none" title={t("zone_empty_nozone")} hint={t("zone_empty_nozone_hint")} />
    );
  }

  return (
    <div className="space-y-6">
      <ReportStatBand
        stats={[
          {
            label: t("zone_stat_total"),
            value: formatIdleShort(report.totalMs, locale),
            scope: t("scope_range"),
          },
          {
            label: t("zone_stat_visits"),
            value: String(report.visits),
            scope: t("zone_stat_visits_scope"),
          },
          {
            label: t("zone_stat_customers"),
            value: String(report.summary.length),
            scope: t("zone_stat_customers_scope"),
          },
          {
            // Belirsiz sayısı ROZET DEĞİL BAŞLI BAŞINA ÖLÇÜM: fatura ekindeki
            // kaç satırın eksik olabileceğini yönetici tabloya inmeden görür.
            label: t("zone_stat_uncertain"),
            value: String(report.belirsizVisits),
            scope: t("zone_stat_uncertain_scope"),
            tone: report.belirsizVisits > 0 ? "warning" : "neutral",
          },
        ]}
      />

      {report.rows.length === 0 ? (
        <EmptyState kind="filtered" title={t("empty_title")} hint={t("empty_hint")} />
      ) : (
        <>
          {/* Müşteri özeti — faturanın satır başları buradan çıkar. */}
          <div className="space-y-3">
            <ReportTableHeader
              label={t("zone_summary_title")}
              tkey="rep_zone_summary"
              actions={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportCsv}
                  hidden={!EXPORT_ENABLED}
                  disabled={!EXPORT_ENABLED}
                >
                  <Download className="size-4" />
                  {t("export_csv")}
                </Button>
              }
            />
            <ul className="surface-card divide-y divide-border/60 overflow-hidden rounded-[14px]">
              {report.summary.map((s) => (
                <li
                  key={s.zoneId}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {s.customerName ?? s.zoneName}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t("zone_summary_visits", { n: s.visits })}
                      {s.belirsizVisits > 0 &&
                        ` · ${t("zone_summary_uncertain", { n: s.belirsizVisits })}`}
                    </span>
                  </span>
                  <span className="nums shrink-0 font-medium">
                    {formatIdleShort(s.totalMs, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            <ReportTableHeader label={t("zone_table_title")} tkey="rep_zone_table" />
            <DataTable
              rows={report.rows}
              columns={columns}
              rowKey={(r) => r.id}
              totalLabel={t("zone_total_visits")}
            />
          </div>
        </>
      )}
    </div>
  );
}
