"use client";

import { useLocale, useTranslations } from "next-intl";
import { EXPORT_ENABLED } from "@/lib/tenant";
import { toast } from "sonner";
import { Download, FileText, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, StatusChip, EmptyState, type Column } from "@/components/ui-v2";
import { ReportStatBand } from "@/components/admin/ReportStatBand";
import { ReportTableHeader } from "@/components/admin/ReportTableHeader";
import {
  FUEL_L100_MIN_DAYS,
  THIRSTIEST_MIN_KM,
  FUEL_MIN_CONSUMED_PCT,
  FUEL_MIN_KM,
} from "@/lib/metric-thresholds";
import type { FuelReport, FuelRow } from "@/lib/reports";
import { noteExport } from "@/lib/audit-export-client";

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
  /** Para birimi hep EUR: firma Avusturya'da, yakıt kartı da EUR kesiyor. */
  const eur = (v: number) =>
    v.toLocaleString(nf, {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    });

  // Rapor hesaplanamadıysa SEBEBİ söylenir (22.07.2026). Eskiden her hata
  // "migration bekliyor" diye gösteriliyordu; migration uygulanmışken zaman
  // aşımına düşen sorgu yöneticiyi olmayan bir soruna yönlendiriyordu.
  if (!report.available) {
    const timedOut = report.unavailableReason === "timeout";
    return (
      <div>
        <EmptyState
          kind="none"
          title={timedOut ? t("fuel_timeout_title") : t("fuel_unavailable_title")}
          hint={timedOut ? t("fuel_timeout_hint") : t("fuel_unavailable_hint")}
        />
      </div>
    );
  }

  async function exportCsv() {
    const header = [
      t("col_plate"),
      t("col_driver"),
      t("col_tank"),
      t("col_avg_fuel"),
      t("col_consumed"),
      t("col_km"),
      t("col_samples"),
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
        r.km === null ? "" : Math.round(r.km),
        r.sampleCount,
        // Ekranda sebebi yazılan boşluk CSV'ye de sebebiyle gider — Excel'e
        // düşen boş hücre "sıfır" diye okunabilir, sebep okunamaz.
        r.lPer100Km === null
          ? t(`fuel_reason_${r.lPer100Reason ?? "no_odometer"}`, {
              minKm: FUEL_MIN_KM,
              minPct: FUEL_MIN_CONSUMED_PCT,
            })
          : num(r.lPer100Km, 1),
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
    // İz: CSV'yi kim dışa çıkardı (045). Katman kapalıysa no-op.
    await noteExport("csv", "fuel");
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
          // PDF kolonu dar (11%) — uzun sebep metni satırı sarar ve tabloyu
          // bozar. Kâğıtta KISA sebep kullanılır; uzun hâli ekranda ve CSV'de.
          l100:
            r.lPer100Km === null
              ? t(`fuel_reason_short_${r.lPer100Reason ?? "no_odometer"}`)
              : num(r.lPer100Km, 1),
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
                className="size-3.5 shrink-0 text-accent-gold-text"
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
      help: "rep_fuel_tank",
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
      help: "rep_fuel_avg",
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
      help: "rep_fuel_consumed",
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
    // KM (payda) ve OKUMA (örneklem) kolonları 22.07.2026'da EKLENDİ. Yönetici
    // "80,0 L/100km" görüyordu ama onu doğuran 2,5 km'yi göremiyordu — sayının
    // nereden geldiği ekranda olmalı ki güvenilirliği tartışılabilsin.
    {
      key: "km",
      header: t("col_km"),
      help: "rep_fuel_km",
      align: "right",
      nums: true,
      hideBelow: "md",
      cell: (r) =>
        r.km === null ? <span className="text-muted-foreground">—</span> : `${num(r.km)} km`,
      sortable: true,
      sortValue: (r) => r.km ?? -1,
    },
    {
      key: "samples",
      header: t("col_samples"),
      help: "rep_fuel_samples",
      align: "right",
      nums: true,
      hideBelow: "lg",
      cell: (r) =>
        r.sampleCount === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          num(r.sampleCount)
        ),
      sortable: true,
      sortValue: (r) => r.sampleCount,
    },
    // L/100km — ÜÇ KAPI (payda ≥50 km · pay ≥15 puan · pencere örtüşmesi ≥%80).
    // Kapı kapalıysa boş "—" değil SEBEP yazılır. Kolonun kendisi de yalnız
    // yeterince uzun aralıkta var: tam sayı yüzde sensörüyle GÜNLÜK araç bazlı
    // tüketim ölçülemez, ölçülemeyeni kolon olarak açmayız.
    ...(report.l100Available
      ? [
          {
            key: "l100",
            header: t("col_l_100km"),
      help: "rep_fuel_l100",
            align: "right" as const,
            nums: true,
            cell: (r: FuelRow) =>
              r.lPer100Km === null ? (
                <span className="text-[11px] leading-tight text-muted-foreground">
                  {t(`fuel_reason_${r.lPer100Reason ?? "no_odometer"}`, {
                    minKm: FUEL_MIN_KM,
                    minPct: FUEL_MIN_CONSUMED_PCT,
                  })}
                </span>
              ) : (
                num(r.lPer100Km, 1)
              ),
            sortable: true,
            sortValue: (r: FuelRow) => r.lPer100Km ?? -1,
          },
        ]
      : []),
    {
      key: "refills",
      header: t("col_refills"),
      help: "rep_fuel_refills",
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
      help: "rep_fuel_leak",
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

  // "EN ÇOK YAKAN" — ORAN, TOPLAM DEĞİL (09.08.2026, Volkan).
  //
  // Eskiden listenin ilk uygun satırı alınıyordu; liste toplam litreye göre
  // sıralı olduğu için kart fiilen "en çok YOL GİDEN aracı" gösteriyordu —
  // çok giden doğal olarak çok yakar, bilgi değeri sıfır. Doğru soru "hangi
  // araç birim mesafede daha çok yakıyor", cevabı L/100km.
  //
  // Üç kapı: (1) güvenilmez sensör seçilemez, (2) oranı hesaplanamayanlar
  // (lPer100Km === null) yarışmaz, (3) mesafe THIRSTIEST_MIN_KM altındaysa
  // oran ölçüm gürültüsüyle aynı büyüklükte olur ve sıralama kura çekmeye
  // döner — gerekçesi lib/metric-thresholds.ts'te.
  const top = report.rows
    .filter(
      (r) =>
        r.hasData &&
        !r.dataUnreliable &&
        r.lPer100Km !== null &&
        (r.km ?? 0) >= THIRSTIEST_MIN_KM
    )
    .reduce<(typeof report.rows)[number] | undefined>(
      (best, r) => (!best || r.lPer100Km! > best.lPer100Km! ? r : best),
      undefined
    );

  return (
    <div className="space-y-6">
      <ReportStatBand
        stats={[
          {
            label: t("stat_total_fuel"),
            value: `${num(report.totalConsumedLiters)} L`,
            // PARASAL KARŞILIK: çarpım sunucuda yapıldı, buraya hazır iniyor.
            // Fiyatın kaynağı/tarihi ve "kendi fiyatını girebilirsin" bilgisi
            // bandın altındaki notta (tek yerde, her karta tekrarlanmadan).
            scope: `${t("scope_range")} · ${eur(report.totalCostEur)}`,
          },
          // FİLO ORTALAMASI — yalnız üç kapıyı geçen araçlardan (22.07.2026).
          // Eskiden satırda gizlediğimiz saçma değerlerin km'si ve litresi yine
          // de bu toplamın içindeydi. Kapsam etiketi artık kaç araçtan
          // hesaplandığını söylüyor: ortalama filonun tamamı değildir.
          {
            label: t("stat_fleet_l100"),
            value: report.fleetLPer100Km === null ? "—" : num(report.fleetLPer100Km, 1),
            scope: !report.l100Available
              ? t("l100_needs_days", { days: FUEL_L100_MIN_DAYS })
              : report.fleetLPer100Km === null
                ? t("l100_no_vehicle")
                : t("stat_fleet_l100_scope", {
                    n: report.l100VehicleCount,
                    total: report.vehicleCount,
                  }),
          },
          {
            label: t("stat_thirstiest"),
            value: top ? top.plate : "—",
            scope: top
              ? t("stat_thirstiest_scope", { n: num(top.lPer100Km!, 1) })
              : t("stat_thirstiest_none", { km: THIRSTIEST_MIN_KM }),
          },
          {
            label: t("stat_leak_vehicles"),
            value: report.suspiciousVehicles,
            scope: t("stat_leak_scope"),
            tone: report.suspiciousVehicles > 0 ? "critical" : "neutral",
          },
        ]}
      />

      {/* FİYAT KÜNYESİ — bandın altında TEK yerde. Kartın içine sıkıştırmak
          "2.051" sayısını KPI sanılacak kadar öne çıkarırdı; buradaki asıl iş
          sayının NEREDEN geldiğini ve DEĞİŞTİRİLEBİLİR olduğunu söylemek. */}
      <p className="-mt-3 text-xs text-muted-foreground">
        {report.fuelPriceIsCustom
          ? t("fuel_price_note_custom", {
              price: num(report.fuelPriceEurPerL, 3),
            })
          : t("fuel_price_note", {
              price: num(report.fuelPriceEurPerL, 3),
              source: report.fuelPriceSource,
              date: report.fuelPriceAsOf,
            })}
      </p>

      {/* UYARILAR TEK KÜMEDE: üçü de "eksik sayının sebebi" ailesindendir ve
          band ile tablo arasındaki aynı boşluğu paylaşır; ayrı ayrı 24px arayla
          dizilince üç bağımsız duyuru gibi okunuyorlardı. */}
      <div className="space-y-2">
      {/* KISMİ RAPOR UYARISI (09.08.2026) — diğer üçüyle AYNI kümede ama AYNI
          ağırlıkta DEĞİL: ötekiler "şu sayı neden yok" diyor, bu "gördüğün sayı
          eksik" diyor. Canlı olayda 30 aracın 12'si zaman aşımına düşmüş, rapor
          18 araçlık toplamı tam gibi basmıştı. Sessiz eksik, görünür hatadan
          kötüdür — bu yüzden mercan çerçeveli, kısık değil. */}
      {report.partialVehicles.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg border border-accent-coral/60 bg-accent-coral-soft px-3 py-2 text-xs font-medium text-accent-coral-text">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>
            {t("fuel_partial_note", {
              n: report.partialVehicles.length,
              plates: report.partialVehicles.join(", "),
            })}
          </span>
        </p>
      )}

      {/* Kapasitesi girilmemiş araçlar %-bazlı gösterilir — yönetici forma girip
          litre metriklerini açabilir. Uydurma litre üretilmez. */}
      {report.capacityMissing > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="size-3.5 shrink-0 text-accent-gold-text" />
          {t("fuel_capacity_note", { n: report.capacityMissing })}
        </p>
      )}

      {/* Arızalı sensör uyarısı: bu araçların türetilmiş sayıları hem tabloda
          hem filo toplamlarında YOK — yönetici eksikliğin sebebini bilmeli. */}
      {report.unreliableVehicles > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="size-3.5 shrink-0 text-accent-gold-text" />
          {t("fuel_unreliable_note", { n: report.unreliableVehicles })}
        </p>
      )}

      {/* L/100km kolonu bu aralıkta HİÇ YOK — sebebi yazılmazsa yönetici kolonu
          arar. Tam sayı yüzde sensörüyle günlük araç bazlı tüketim ölçülemez. */}
      {!report.l100Available && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="size-3.5 shrink-0 text-accent-gold-text" />
          {t("fuel_l100_hidden_note", {
            days: FUEL_L100_MIN_DAYS,
            current: report.rangeDays,
          })}
        </p>
      )}
      </div>

      {report.rows.length === 0 ? (
        <EmptyState kind="none" title={t("empty_title")} hint={t("empty_hint")} />
      ) : (
        <div className="space-y-3">
          <ReportTableHeader
            label={t("fuel_table_title")}
            tkey="rep_fuel_table"
            actions={
              <>
                <Button variant="outline" size="sm" onClick={exportCsv} hidden={!EXPORT_ENABLED} disabled={!EXPORT_ENABLED}>
                  <Download className="size-4" />
                  {t("export_csv")}
                </Button>
                <Button variant="outline" size="sm" onClick={exportPdf}>
                  <FileText className="size-4" />
                  {t("export_pdf")}
                </Button>
              </>
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

      {/* Tüketim = dolumlar + net düşüş (ilk − son), kapasiteyle litreye çevrilir
          — bir tahmindir. Kaçak sinyali odometre ilerlemeden düşen yakıttır. */}
      <p className="text-xs text-muted-foreground">{t("fuel_note")}</p>
    </div>
  );
}
