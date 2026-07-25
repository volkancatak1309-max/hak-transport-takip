"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Fuel,
} from "lucide-react";
import {
  RankingTile,
  StatCard,
  StatusChip,
  SegmentedControl,
  DataTable,
  EmptyState,
  PageHeader,
  MiniTrend,
  useUrlFilters,
  type Column,
  type RankRow,
  type TrendBucket,
} from "@/components/ui-v2";
import { Input } from "@/components/ui/input";
import { EpochWarning } from "@/components/admin/EpochWarning";
import { HelpTip } from "@/components/help/HelpTip";
import { SAFETY_SCORE_CALIBRATED } from "@/lib/metric-thresholds";
import { formatDate, formatEur, formatIdleShort, formatNumber } from "@/lib/format";
import type {
  AnalyticsRangeKey,
  EventTypeAgg,
  IdleWasteSummary,
  SafetyScoreRow,
  Top10EventType,
} from "@/lib/analytics-shared";
import { TOP10_EVENT_TYPES } from "@/lib/analytics-shared";

// TILE_COLOR KALDIRILDI (26.07.2026 — DESIGN.md §2.2/§2.5). Her kartın barı
// olay TÜRÜNE göre mavi/altın/kritik boyanıyordu; ama kartın başlığı zaten o
// türü yazıyor, yani renk bilgi taşımıyordu ve tek-aksan disiplinini kırıyordu.
// Bar rengi artık RankingTile'ın kilitli varsayılanı: tek aksan mercan.

export function AnalizClient({
  rangeKey,
  customFrom,
  customTo,
  topByType,
  safetyRows,
  idleWaste,
  prevIdleWaste,
  configEpochISO,
  showEpochNote,
  trendBlocked,
}: {
  rangeKey: AnalyticsRangeKey;
  customFrom: string | null;
  customTo: string | null;
  topByType: Record<Top10EventType, EventTypeAgg>;
  safetyRows: SafetyScoreRow[];
  idleWaste: IdleWasteSummary;
  prevIdleWaste: { totalMs: number; totalEuro: number } | null;
  /** Alarm eşiklerinin değiştiği an (ISO) — yoksa null. */
  configEpochISO: string | null;
  /** Görüntülenen aralık sınırdan önce başlıyor → açıklama notu göster. */
  showEpochNote: boolean;
  /** Karşılaştırma sınırı aşıyor → trend gösterilmedi, sebebini yaz. */
  trendBlocked: boolean;
}) {
  const t = useTranslations("analiz");
  const locale = useLocale();
  const { set } = useUrlFilters();

  // Filtre geçişi: navigasyonu transition'a alıp segment vurgusunu OPTIMISTIK
  // güncelliyoruz — tık anında segment kayar, mevcut veri isPending ile hafif
  // soluk kalır ve yeni veri arkada gelince değişir (tam sayfa iskelet donması
  // yok). URL senkronu ve doğru veri korunur: yine router.replace, yine sunucu.
  const [isPending, startTransition] = useTransition();
  const [optimisticRange, setOptimisticRange] = useState<string>(rangeKey);
  useEffect(() => setOptimisticRange(rangeKey), [rangeKey]);

  // Özel aralık için LOKAL state — kaynak olarak server'dan gelen customFrom/
  // customTo prop'larını DEĞİL bunu kullanıyoruz. Sebep: iki tarih alanına art
  // arda hızlı girildiğinde ikinci onChange, birinci navigasyonun server'a
  // gidip dönmesini (RSC round-trip) BEKLEMEDEN tetiklenebiliyor — prop'lar o an
  // hâlâ eski değerde olur ve az önce yazılan tarih sessizce URL'den düşer.
  // Lokal state React içinde senkron güncellendiği için bu yarışı önler.
  const [localFrom, setLocalFrom] = useState(customFrom ?? "");
  const [localTo, setLocalTo] = useState(customTo ?? "");

  const rangeOptions = [
    { value: "gun", label: t("range_gun") },
    { value: "hafta", label: t("range_hafta") },
    { value: "ay", label: t("range_ay") },
    { value: "ozel", label: t("range_ozel") },
    { value: "tumzaman", label: t("range_tumzaman") },
  ];

  function onRangeChange(v: string) {
    setOptimisticRange(v); // segment anında kayar
    startTransition(() => {
      if (v === "ozel") {
        set({ aralik: v, baslangic: customFrom ?? "", bitis: customTo ?? "" });
      } else {
        set({ aralik: v === "hafta" ? null : v, baslangic: null, bitis: null });
      }
    });
  }

  // Skorlu şoförler ana tabloda; "veri yok" (null skor) olanlar ayrı kompakt
  // bölümde toplanır — gizlenmez ki günlük görünüm boş kalmasın.
  const scoredRows = useMemo(() => safetyRows.filter((r) => r.score !== null), [safetyRows]);
  const insufficientRows = useMemo(
    () => safetyRows.filter((r) => r.score === null),
    [safetyRows]
  );

  const safetyColumns: Column<SafetyScoreRow>[] = useMemo(
    () => [
      {
        key: "rank",
        header: "#",
        cell: (r) => scoredRows.indexOf(r) + 1,
        nums: true,
        className: "w-10",
      },
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
        cell: (r) => {
          // Ton MUTLAK skora bağlı, sıraya değil: yalnız gerçekten düşük skor
          // (<50) kırmızı; yüksek (≥85) yeşil-bilgi; arası nötr. Böylece "en
          // alttaki 3" otomatik kırmızı sayılmaz.
          const s = r.score as number;
          const tone = s >= 85 ? "info" : s < 50 ? "critical" : "neutral";
          return <StatusChip tone={tone}>{s}</StatusChip>;
        },
        align: "right",
        nums: true,
        sortable: true,
        sortValue: (r) => r.score ?? 0,
      },
      {
        key: "events",
        header: t("col_events"),
        cell: (r) => r.totalEvents,
        align: "right",
        nums: true,
        sortable: true,
        sortValue: (r) => r.totalEvents,
        hideBelow: "sm",
      },
      {
        key: "basis",
        header: t("col_basis"),
        cell: (r) => (
          <span className="text-xs text-muted-foreground">
            {r.basis === "km" ? `${formatNumber(r.distanceKm ?? 0, locale)} km` : t("basis_gun", { n: r.activeDays })}
          </span>
        ),
        hideBelow: "md",
      },
      {
        key: "trend",
        header: t("col_trend"),
        cell: (r) => {
          if (r.trend === null) return <span className="text-muted-foreground">—</span>;
          const Icon = r.trend === "up" ? ArrowUp : r.trend === "down" ? ArrowDown : ArrowRight;
          return <Icon aria-hidden className="size-4 text-muted-foreground" />;
        },
        align: "right",
        hideBelow: "sm",
      },
    ],
    [scoredRows, t, locale]
  );

  const idleColumns: Column<(typeof idleWaste.rows)[number]>[] = useMemo(
    () => [
      {
        key: "name",
        header: t("col_driver"),
        cell: (r) => <span className="font-medium">{r.name}</span>,
        sortable: true,
        sortValue: (r) => r.name,
      },
      {
        key: "duration",
        header: t("col_idle_duration"),
        cell: (r) => formatIdleShort(r.totalMs, locale),
        align: "right",
        nums: true,
        sortable: true,
        sortValue: (r) => r.totalMs,
      },
      {
        key: "episodes",
        header: t("col_idle_episodes"),
        cell: (r) => r.episodeCount,
        align: "right",
        nums: true,
        sortable: true,
        sortValue: (r) => r.episodeCount,
        hideBelow: "sm",
      },
      {
        key: "liters",
        header: t("col_idle_liters"),
        cell: (r) => `${formatNumber(r.liters, locale, 1)} L`,
        align: "right",
        nums: true,
        hideBelow: "sm",
      },
      {
        key: "euro",
        header: t("col_idle_euro"),
        cell: (r) => <span className="font-semibold">{formatEur(r.euro, locale)}</span>,
        align: "right",
        nums: true,
        sortable: true,
        sortValue: (r) => r.euro,
      },
    ],
    [t, locale]
  );

  const idleDeltaPct =
    prevIdleWaste && prevIdleWaste.totalMs > 0
      ? Math.round(((idleWaste.totalMs - prevIdleWaste.totalMs) / prevIdleWaste.totalMs) * 100)
      : null;

  const idleDelta =
    idleDeltaPct !== null
      ? `${idleDeltaPct > 0 ? "▲" : idleDeltaPct < 0 ? "▼" : "→"} ${Math.abs(idleDeltaPct)}%`
      : undefined;

  /* GRAFİK VERİSİ — olay tipine göre toplam (DESIGN.md §0: Runey dizilimindeki
     "tam genişlik grafik kartı"). Yeni sunucu sorgusu YOK: zaten sayfada olan
     topByType toplamları kullanılıyor.
     Bu bir ZAMAN SERİSİ DEĞİL, tip karşılaştırmasıdır — kart başlığı da öyle
     diyor. Zaman serisi için analytics tarafında kova bazlı toplama gerekir;
     uydurma bir eksen çizmektense var olan veriyi dürüstçe göstermek doğru. */
  const typeBuckets: TrendBucket[] = useMemo(
    () =>
      TOP10_EVENT_TYPES.map((ty) => ({
        key: ty,
        label: t(`event.${ty}`),
        value: topByType[ty]?.total ?? 0,
      })),
    [t, topByType]
  );

  const totalEvents = useMemo(
    () => typeBuckets.reduce((a, b) => a + b.value, 0),
    [typeBuckets]
  );
  const driverCount = safetyRows.length;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {/* Ortak filtre çubuğu — tüm bölümleri yönetir, URL'e yazar (?aralik=) */}
      <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-border/60 px-3 py-2.5">
        <SegmentedControl value={optimisticRange} onChange={onRangeChange} options={rangeOptions} ariaLabel={t("range_label")} />
        {optimisticRange === "ozel" && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={localFrom}
              onChange={(e) => {
                setLocalFrom(e.target.value);
                startTransition(() =>
                  set({ aralik: "ozel", baslangic: e.target.value, bitis: localTo })
                );
              }}
              className="h-8 w-[140px]"
              aria-label={t("range_ozel_from")}
            />
            <span className="text-xs text-muted-foreground">—</span>
            <Input
              type="date"
              value={localTo}
              onChange={(e) => {
                setLocalTo(e.target.value);
                startTransition(() =>
                  set({ aralik: "ozel", baslangic: localFrom, bitis: e.target.value })
                );
              }}
              className="h-8 w-[140px]"
              aria-label={t("range_ozel_to")}
            />
          </div>
        )}
      </div>

      {/* Veri bölümleri — geçişte hafif soluk (isPending), filtre çubuğu aktif kalır */}
      <div
        className={
          isPending
            ? "space-y-6 opacity-60 transition-opacity"
            : "space-y-6 transition-opacity"
        }
      >

      {/* ── KPI ŞERİDİ ── Runey dizilimi (DESIGN.md §0): başlık+kontrol → 4'lü
          KPI → tam genişlik grafik → detay kartları → tablo. Rölanti sayıları
          eskiden sayfanın 3. bölümünde gömülüydü; sayfanın ÖZETİ üstte olmalı.
          Dördü de mevcut veriden türer, yeni sunucu sorgusu yok. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={t("kpi_events")}
          value={formatNumber(totalEvents, locale)}
          scope={t(`range_${rangeKey}`)}
        />
        <StatCard
          label={t("stat_idle_hours")}
          value={`${formatNumber(idleWaste.totalMs / 3_600_000, locale, 1)} ${t("unit_hour")}`}
          scope={t(`range_${rangeKey}`)}
          delta={idleDelta}
        />
        <StatCard
          label={t("stat_idle_euro")}
          value={formatEur(idleWaste.totalEuro, locale)}
          scope={t(`range_${rangeKey}`)}
          tone="warning"
          delta={idleDelta}
        />
        <StatCard
          label={t("kpi_drivers")}
          value={formatNumber(driverCount, locale)}
          scope={t(`range_${rangeKey}`)}
        />
      </div>

      {/* ── TAM GENİŞLİK GRAFİK KARTI ── */}
      <div className="surface-card rounded-[16px] p-5">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h2 className="text-[16px] font-semibold">{t("chart_title")}</h2>
          <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
            {formatNumber(totalEvents, locale)}
          </span>
        </div>
        <p className="mb-4 text-[13px] text-muted-foreground">{t("chart_hint")}</p>
        {totalEvents === 0 ? (
          <EmptyState kind="none" title={t("tile_empty")} />
        ) : (
          <MiniTrend data={typeBuckets} height={180} />
        )}
      </div>

      {/* Bölüm 1 — olay tipi bazında top-10 personel */}
      <div>
        {/* Eşik sınırı uyarısı BAŞLIĞIN ÜSTÜNDE: bu bölümün sayıları doğrudan
            vehicle_events'ten geliyor, yani sınırı aşan bir aralıkta iki farklı
            cetvelin toplamı. Uyarı sayfanın dibindeyken tabloyu okuyan kişi onu
            görmeden yorumluyordu. */}
        <EpochWarning
          epochISO={configEpochISO}
          show={showEpochNote}
          className="mb-3"
        />
        <div className="mb-3 flex items-center gap-1">
          <h2 className="text-[15px] font-semibold">{t("section1_title")}</h2>
          <HelpTip tkey="anl_top10" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOP10_EVENT_TYPES.map((ty) => {
            const agg = topByType[ty];
            const rows: RankRow[] = agg.rows.map((d) => ({
              key: d.key,
              label: d.label,
              value: ty === "idling" ? (d.idleMs ?? 0) : d.count,
              display:
                ty === "overspeeding"
                  ? `${d.count} · ${Math.round(d.maxSpeedKmh ?? 0)} km/h`
                  : ty === "idling"
                    ? `${d.count} · ${formatIdleShort(d.idleMs ?? 0, locale)}`
                    : String(d.count),
            }));
            return (
              <RankingTile
                key={ty}
                title={t(`event.${ty}`)}
                icon={<BarChart3 className="size-4" />}
                rows={rows}
                scope={t("tile_scope", { n: agg.total })}
                emptyLabel={t("tile_empty")}
              />
            );
          })}
        </div>
      </div>

      {/* Bölüm 2 — şoför güvenlik skor kartı.
          22.07.2026: skor KALİBRE EDİLENE KADAR bu bölüm hiç hesap göstermez.
          Yürürlükteki doğrusal formül (100 − ceza/(km/1000)) herkesi 0'a
          çakıyordu; sıfır bir ölçüm değil taban çarpmasıydı ve bu sayı bir
          İNSAN hakkında. Bölüm başlığı kalır, yerine SEBEP yazılır — sayfada
          açıklanmadan kaybolan bir bölüm "panel bozuk" izlenimi verir. */}
      <div>
        <div className="mb-3 flex items-center gap-1">
          <h2 className="text-[15px] font-semibold">{t("section2_title")}</h2>
          <HelpTip tkey="anl_safety" />
        </div>
        {!SAFETY_SCORE_CALIBRATED ? (
          <div className="rounded-[12px] border border-border/60 px-3.5 py-3">
            <div className="text-sm font-medium">{t("section2_calibrating_title")}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("section2_calibrating_hint")}
            </p>
          </div>
        ) : safetyRows.length === 0 ? (
          <EmptyState kind="none" title={t("section2_empty")} hint={t("section2_empty_hint")} />
        ) : (
          <>
            {scoredRows.length > 0 && (
              <DataTable
                rows={scoredRows}
                columns={safetyColumns}
                rowKey={(r) => r.workerId}
                totalLabel={t("count_driver")}
              />
            )}
            {/* Yetersiz veri — gizlenmez, ayrı kompakt bölümde toplanır. Bu aralıkta
                skor için yeterli km'si olmayan şoförler; nötr, cezasız. */}
            {insufficientRows.length > 0 && (
              <div className="mt-3 rounded-[12px] border border-border/60 px-3.5 py-3">
                <div className="text-sm font-medium">
                  {t("insufficient_title", { n: insufficientRows.length })}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("insufficient_hint")}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {insufficientRows.map((r) => (
                    <span
                      key={r.workerId}
                      className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {r.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bölüm 3 — rölanti israf panosu */}
      <div>
        <div className="mb-3 flex items-center gap-1">
          <h2 className="text-[15px] font-semibold">{t("section3_title")}</h2>
          <HelpTip tkey="anl_idle" />
        </div>
        {/* Rölanti KPI kartları YUKARI, sayfa başındaki şeride taşındı
            (26.07.2026). Birim değerin yanında kalıyor: "8" tek başına 8 saat mi
            8 epizod mu belli değildi ve birimsiz sayı yanlış sayıdan beterdir —
            yanlış sayı sorgulanır, birimsiz sayı herkes kendi birimini uydurarak
            okur. StatCard'da ⓘ yasak (DESIGN-SYSTEM §7), o yüzden birim metinde. */}
        <p className="mb-2.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Fuel className="size-3.5 shrink-0" />
          {t("idle_estimate_note")}
        </p>
        {/* Cihaz rölantiyi ancak eşiği (5 dk) geçince bildiriyor; o eşik her
            epizoda ekleniyor (lib/analytics.ts idleEpisodeDurationMs). Ekranda
            yazmıyordu — 20 epizodluk bir günde bu +1,7 saat demek. */}
        <p className="mb-2.5 text-xs text-muted-foreground">{t("idle_trigger_note")}</p>
        {idleWaste.rows.length === 0 ? (
          <EmptyState kind="none" title={t("section3_empty")} hint={t("section3_empty_hint")} />
        ) : (
          <DataTable
            rows={idleWaste.rows}
            columns={idleColumns}
            rowKey={(r) => r.key}
            totalLabel={t("count_driver")}
          />
        )}
      </div>

      {/* TREND KAPISI NOTU — yalnız karşılaştırma sınırı aştığında.
          Aralık uyarısı (epoch_note) buradan ALINDI ve Bölüm 1'in üstüne
          taşındı; ikisini birlikte dipte tutmak, tabloyu okuyanın uyarıyı hiç
          görmemesi demekti. Bu not ise güvenlik skoru TRENDİNE ait, yerinde
          kalıyor. */}
      {configEpochISO && trendBlocked && (
        <div className="flex items-start gap-2 rounded-xl bg-accent-gold/12 px-4 py-3 text-xs text-accent-gold">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <p>{t("epoch_trend_blocked", { date: formatDate(configEpochISO, locale) })}</p>
        </div>
      )}
      </div>
    </div>
  );
}
