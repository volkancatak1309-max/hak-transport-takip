"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ExternalLink, MapPin, Truck } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  SubTabs,
  StatusChip,
  DataTable,
  DensityToggle,
  DetailDrawer,
  EmptyState,
  MiniTrend,
  type Column,
} from "@/components/ui-v2";
import { EpochWarning } from "@/components/admin/EpochWarning";
import { HelpTip } from "@/components/help/HelpTip";
import { cn } from "@/lib/utils";
import { eventTone, EVENT_STRIPE, EVENT_TONE_RANK } from "@/lib/event-ui";
import { formatDateTime, formatIdleShort } from "@/lib/format";
import type { VehicleEventWithPlate } from "@/lib/telemetry";
import type { AlarmRange, AlarmTrend } from "./page";

/**
 * ALARMLAR — Genel Bakış (olay tipi tile'ları) + Alarm Kaydı (tablo + çekmece).
 *
 * ═══ 27.07.2026 — YAPI TURU GERİ ALINDI (Volkan kararı) ═══
 *
 * Zendesk şeridi + Linear gruplu listesi + Stripe açılır satırı (f160074,
 * a21e9eb, c5c206f) TAMAMEN İPTAL. Sayfa bu üç dönüşümden ÖNCEKİ yapısına
 * döndü: alt sekmeler, tip tile'ları, filtreli DataTable, DetailDrawer.
 * Eski hâl `d9aa92f`'ten çıkarıldı; iptal edilen dosyalar (AlarmStrip.tsx,
 * gruplu liste) git geçmişinde duruyor, gerekirse oradan alınır.
 *
 * YAPI ESKİ, CİLT YENİ. `d9aa92f` aynı zamanda iptal edilmiş "Ui (shadcn)
 * DESTEK F" cildini taşıyordu (beyaz kanvas + halka yüzey); o cilt fcf8e49'da
 * Authkit DNA ile değiştirildi. Bu yüzden markup geri gelirken kabuk yeniden
 * giydirildi: koyu cam bölüm paneli (tablo konteyneri), token'lı yüzey kartları,
 * pill filtreler. Cam YALNIZ bölüm panelinde — tile ızgarası `surface-card`,
 * çünkü 8-10 bulanık katman hem anlamı hem kaydırmayı öldürür (globals §3.3).
 *
 * YAPIDAN BAĞIMSIZ DÜZELTMELER KORUNDU (geri gitmedi):
 *   • epoch varsayılan aralığı + eşik sınırı uyarısı (8bd6b81) — page.tsx
 *   • fetchAllRows sayfalaması (lib/telemetry) — PostgREST 1000 satır tavanı
 *   • rölanti EPİZOD modeli + süre rozeti (dec71d2 / migration 024)
 *   • ŞOFÖR ADI — eski yapıda HİÇ yoktu, buraya EKLENDİ: plaka tek başına
 *     kimlik değil. Tabloda plakanın altında, fırtına grubunda ve çekmecede.
 *     Kaynak raporlarla aynı (vehicles.driver_name); araç el değiştirdiyse
 *     geçmiş olay bugünkü şoförle etiketlenir — ipucu metni bunu söyler.
 */

/**
 * Alarm satırı = nokta-olay (vehicle_events) VEYA rölanti epizodu (idle_episodes,
 * migration 024). Epizod satırları süre taşır (duration_ms) ve açıksa ongoing.
 */
export type AlarmRow = VehicleEventWithPlate & {
  duration_ms?: number | null;
  ongoing?: boolean;
};

const EventMiniMap = dynamic(() => import("@/components/admin/EventMiniMap"), {
  ssr: false,
  loading: () => <div className="h-40 w-full animate-pulse rounded-[12px] bg-surface-2" />,
});

const STORM_WINDOW_MS = 10 * 60 * 1000;
const SPEED_EVENTS = new Set([
  "overspeeding",
  "harsh_acceleration",
  "harsh_braking",
  "harsh_cornering",
  "crash",
]);

/**
 * Şoför adı — atanmamışsa SEBEBİ yazılır, boş bırakılmaz.
 * MODÜL SEVİYESİNDE: render içinde tanımlanan bileşen her render'da yeniden
 * yaratılır ve durumunu sıfırlar (react-hooks/static-components). Metinler
 * prop olarak geçer, `t` çağıranda çözülür.
 */
function DriverName({
  name,
  hint,
  fallback,
  className,
}: {
  name: string | null;
  hint: string;
  fallback: string;
  className?: string;
}) {
  return name ? (
    <span className={cn("truncate", className)} title={hint}>
      {name}
    </span>
  ) : (
    <span className={cn("truncate text-text-tertiary", className)}>{fallback}</span>
  );
}

/** Authkit pill filtresi — etiketli Reveal bandının yerine (cilt kararı). */
function PillSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const active = value !== "";
  const current = options.find((o) => o.value === value)?.label;
  return (
    <Select value={value} onValueChange={(v) => v && onChange(String(v) === "__all" ? "" : String(v))}>
      <SelectTrigger
        className={cn(
          "h-8 w-auto gap-1.5 rounded-full px-3 text-[13px]",
          active && "border-accent-coral/60 text-foreground"
        )}
        aria-label={label}
      >
        {/* Etiket seçili değilken filtrenin ADINI, seçiliyken DEĞERİNİ taşır —
            görünmeyen filtre en pahalı hatadır. */}
        <span>{active && current ? current : label}</span>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value || "__all"} value={o.value || "__all"}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AlarmsClient({
  events,
  vehicles,
  range,
  trend,
  epochISO,
  showEpochWarning,
}: {
  events: AlarmRow[];
  /** Şoför adı için araç künyesi (raporlarla aynı kaynak). */
  vehicles: { id: string; plate: string; driverName: string | null }[];
  range: AlarmRange;
  /** Gün gün alarm trendi + önceki dönem karşılaştırması. */
  trend: AlarmTrend;
  /** Alarm eşiklerinin değiştiği an (ISO); kayıt yoksa null. */
  epochISO: string | null;
  /** Görüntülenen aralık sınırdan önce başlıyor → üstte uyarı. */
  showEpochWarning: boolean;
}) {
  const t = useTranslations("alarms");
  const locale = useLocale();
  const router = useRouter();
  const [, startNav] = useTransition();

  const [tab, setTab] = useState<"overview" | "log">("overview");
  const [sort, setSort] = useState<"most" | "newest">("most");
  // Alarm Kaydı filtreleri
  const [fVehicle, setFVehicle] = useState("");
  const [fType, setFType] = useState("");
  const [fSev, setFSev] = useState("");
  const [selected, setSelected] = useState<AlarmRow | null>(null);

  const driverByVehicleId = useMemo(
    () => new Map(vehicles.map((v) => [v.id, v.driverName])),
    [vehicles]
  );
  const driverOf = (e: AlarmRow) => driverByVehicleId.get(e.vehicle_id) ?? null;
  /** DriverName'in metin proplarını tek yerden ver — üç kullanım yeri var. */
  const driverText = { hint: t("driver_source_hint"), fallback: t("no_driver") };

  // Rölanti epizodu süresi rozeti (migration 024): "· 25 dk" / açıksa
  // "· 12 dk (devam ediyor)". Süre epizoddan geliyor (ham gözlemlenen span);
  // diğer olay tiplerinde gösterilmez.
  const idleBadge = (e: AlarmRow): string | null => {
    if (e.event_type !== "idling" || e.duration_ms == null) return null;
    const d = formatIdleShort(e.duration_ms, locale);
    return e.ongoing ? `· ${d} (${t("ongoing")})` : `· ${d}`;
  };

  const toneCat = (ty: string) => {
    const tone = eventTone(ty);
    return tone === "critical"
      ? t("sev_critical")
      : tone === "warning"
        ? t("sev_warning")
        : t("sev_neutral");
  };

  // ── Genel Bakış: olay TİPİ tile'ları ─────────────────────────────────────
  const typeTiles = useMemo(() => {
    const byType = new Map<string, { count: number; crit: number; last: string }>();
    for (const e of events) {
      const cur = byType.get(e.event_type) ?? { count: 0, crit: 0, last: e.occurred_at };
      cur.count++;
      if (eventTone(e.event_type) === "critical") cur.crit++;
      if (e.occurred_at > cur.last) cur.last = e.occurred_at;
      byType.set(e.event_type, cur);
    }
    const arr = [...byType.entries()].map(([ty, v]) => ({ type: ty, ...v }));
    arr.sort((a, b) => (sort === "newest" ? b.last.localeCompare(a.last) : b.count - a.count));
    return arr;
  }, [events, sort]);

  // ── Alarm Kaydı: filtreli + sıralı liste ─────────────────────────────────
  const logRows = useMemo(() => {
    let rows = events.filter((e) => {
      if (fVehicle && e.plate !== fVehicle) return false;
      if (fType && e.event_type !== fType) return false;
      if (fSev && eventTone(e.event_type) !== fSev) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      if (sort === "newest") return b.occurred_at.localeCompare(a.occurred_at);
      const d =
        EVENT_TONE_RANK[eventTone(b.event_type)] - EVENT_TONE_RANK[eventTone(a.event_type)];
      return d !== 0 ? d : b.occurred_at.localeCompare(a.occurred_at);
    });
    return rows;
  }, [events, fVehicle, fType, fSev, sort]);

  const plateOptions = useMemo(
    () => [...new Set(events.map((e) => e.plate))].sort().map((p) => ({ value: p, label: p })),
    [events]
  );
  const typeOptions = useMemo(
    () =>
      [...new Set(events.map((e) => e.event_type))]
        .map((ty) => ({ value: ty, label: t(`type.${ty}`) }))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [events, t, locale]
  );

  const columns: Column<AlarmRow>[] = [
    /**
     * MOBİL SATIR — 18.08.2026, referans: Jobber "Activity Feed" +
     * Squarespace "Activity Log".
     *
     * SORUN (ölçüldü, 393 px): dört kolonluk tablo 362 px'lik kaba sıkışıyordu
     * — plaka+şoför 139 px, olay 139 px, tarih+saat 108 px; hepsi eşit
     * ağırlıkta ve satırda 5 veri yan yana. Hiyerarşi yoktu: yönetici neye
     * bakacağını bilemiyordu.
     *
     * ÇÖZÜM: mobilde tek kolon, ÜÇ KADEME halinde yığılmış —
     *   ① kalın: OLAY + varsa değeri (Aşırı Hız · 96 km/h / Uzun Rölanti · 8 dk)
     *   ② gri:   PLAKA + şoför  (kim/hangi araç)
     *   ③ küçük: SAAT
     * Neden olay en üstte: liste "alarm kaydı", yani birinci soru "ne oldu".
     * Plaka masaüstünde ilk kolondu çünkü orada göz yatay tarıyor; dikey
     * kartta ise en üst satır en güçlü konumdur.
     *
     * VERİ TEKRARI YOK: bu kolon `hideAbove:"md"`, aşağıdaki üç kolon
     * `hideBelow:"md"` → hiçbir genişlikte ikisi birden görünmez.
     * MASAÜSTÜ (md+) BİREBİR AYNI KALIR.
     *
     * Sıralama: zamana göre sıralanabilir bırakıldı (kayıtta en değerli sıra).
     * Plakaya/şiddete göre sıralama mobilde YOK — bilinçli: dört sıralama
     * düğmesi 393 px'te başlığı yeniden kalabalıklaştırırdı.
     */
    {
      key: "mobil",
      header: t("col_time"),
      hideAbove: "md",
      sortable: true,
      sortValue: (e) => e.occurred_at,
      cell: (e) => {
        const badge = idleBadge(e);
        return (
          <span className="block min-w-0 py-0.5">
            <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              <StatusChip tone={eventTone(e.event_type)}>
                {t(`type.${e.event_type}`)}
              </StatusChip>
              {badge && <span className="nums text-xs text-muted-foreground">{badge}</span>}
              {e.event_type !== "idling" &&
                SPEED_EVENTS.has(e.event_type) &&
                e.speed_kmh !== null && (
                  <span className="nums text-xs font-medium">
                    {Math.round(e.speed_kmh)} km/h
                  </span>
                )}
            </span>
            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              <Link
                href={`/admin/araclar/${e.vehicle_id}`}
                onClick={(ev) => ev.stopPropagation()}
                className="nums font-medium uppercase tracking-wide text-foreground hover:underline"
              >
                {e.plate}
              </Link>
              <DriverName name={driverOf(e)} {...driverText} />
            </span>
            <span className="nums mt-0.5 block text-[11px] text-text-tertiary">
              {formatDateTime(e.occurred_at, locale)}
            </span>
          </span>
        );
      },
    },
    {
      key: "plate",
      header: t("col_vehicle"),
      help: "alarms_col_vehicle",
      hideBelow: "md",
      // KİMLİK: plaka + ŞOFÖR. Yönetici "DO-945HL" değil "Ümit" diye düşünür;
      // ad ayrı kolon değil, plakanın altında — dar ekranda da kaybolmasın.
      cell: (e) => (
        <span className="block min-w-0">
          <Link
            href={`/admin/araclar/${e.vehicle_id}`}
            onClick={(ev) => ev.stopPropagation()}
            className="nums font-medium uppercase tracking-wide hover:underline"
          >
            {e.plate}
          </Link>
          <DriverName
            name={driverOf(e)}
            {...driverText}
            className="mt-0.5 block text-xs text-muted-foreground"
          />
        </span>
      ),
      nums: true,
      sortable: true,
      sortValue: (e) => e.plate,
    },
    {
      key: "type",
      header: t("col_type"),
      help: "alarms_col_type",
      hideBelow: "md",
      // Rozetin YANINDA süre (migration 024) — chip'in içine gömülmez.
      cell: (e) => {
        const badge = idleBadge(e);
        return (
          <span className="flex items-center gap-1.5">
            <StatusChip tone={eventTone(e.event_type)}>{t(`type.${e.event_type}`)}</StatusChip>
            {badge && <span className="nums text-xs text-muted-foreground">{badge}</span>}
          </span>
        );
      },
      sortable: true,
      sortValue: (e) => EVENT_TONE_RANK[eventTone(e.event_type)],
    },
    {
      key: "time",
      header: t("col_time"),
      help: "alarms_col_time",
      hideBelow: "md",
      cell: (e) => formatDateTime(e.occurred_at, locale),
      nums: true,
      sortable: true,
      sortValue: (e) => e.occurred_at,
    },
    {
      key: "speed",
      header: t("drawer_speed"),
      help: "alarms_col_speed",
      cell: (e) =>
        e.event_type === "idling" ? (
          <span className="text-muted-foreground">{t("context_idle")}</span>
        ) : SPEED_EVENTS.has(e.event_type) && e.speed_kmh !== null ? (
          `${Math.round(e.speed_kmh)} km/h`
        ) : (
          "—"
        ),
      align: "right",
      nums: true,
      // "sm" değil "md" (18.08.2026): mobil yığılmış kolon `md`nin ALTINDA
      // görünüyor ve hızı kendi içinde taşıyor. "sm" bırakılsaydı 640–767 px
      // arasında ikisi birden görünür, hız iki yerde yazardı.
      hideBelow: "md",
    },
  ];

  const selIndex = selected ? logRows.findIndex((e) => e.id === selected.id) : -1;

  function openType(ty: string) {
    setFType(ty);
    setTab("log");
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-1">
          <h1 className="text-[28px] font-semibold leading-tight">{t("title")}</h1>
          <HelpTip tkey="alarms_page" />
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Sekmelerin yanında (i): "Genel Bakış" ile "Alarm Kaydı" farkı ilk
          bakışta anlaşılmıyor — biri sayar, diğeri tek tek listeler. */}
      <div className="flex items-end gap-1">
        <SubTabs
          className="min-w-0 flex-1"
          tabs={[
            { key: "overview", label: t("tab_overview") },
            { key: "log", label: t("tab_log") },
          ]}
          value={tab}
          onChange={(k) => setTab(k as "overview" | "log")}
        />
        <span className="pb-2">
          <HelpTip tkey={tab === "overview" ? "alarms_tab_overview" : "alarms_tab_log"} />
        </span>
      </div>

      {/* Eşik sınırı uyarısı — İKİ sekmede de görünür: sayılar hem Genel Bakış
          tile'larında hem Alarm Kaydı'nda aynı karışık veriden geliyor. */}
      <EpochWarning epochISO={epochISO} show={showEpochWarning} />

      {tab === "overview" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <PillSelect
              label={t("filter_shown")}
              value={range}
              onChange={(v) =>
                startNav(() =>
                  router.replace(`/admin/alarmlar?range=${v}`, { scroll: false })
                )
              }
              // "Yeni eşiklerden beri" EN ÜSTTE ve varsayılan (sunucuda seçilir).
              // Sınır kaydı yoksa seçenek hiç listelenmez — tıklanınca 7 güne
              // düşen ölü bir seçenek göstermeyiz.
              options={[
                ...(epochISO ? [{ value: "epoch", label: t("range_epoch") }] : []),
                { value: "today", label: t("range_today") },
                { value: "7d", label: t("range_7d") },
                { value: "30d", label: t("range_30d") },
              ]}
            />
            <PillSelect
              label={t("filter_sort")}
              value={sort}
              onChange={(v) => setSort(v as "most" | "newest")}
              options={[
                { value: "most", label: t("sort_most") },
                { value: "newest", label: t("sort_newest") },
              ]}
            />
          </div>

          {typeTiles.length === 0 ? (
            <EmptyState kind="none" title={t("empty_none")} hint={t("empty_hint_none")} />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {typeTiles.map((tile) => {
                const tone = eventTone(tile.type);
                return (
                  <button
                    key={tile.type}
                    type="button"
                    onClick={() => openType(tile.type)}
                    // CAM DEĞİL: tile ızgarası bölüm paneli değil, içeriktir
                    // (globals §3.2/§3.3 — ekranda azami 3 bulanık katman).
                    className="surface-card group flex min-h-[120px] flex-col rounded-[16px] p-5 text-left transition-colors hover:bg-surface-hover"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ background: EVENT_STRIPE[tone] }}
                          />
                          <span className="truncate text-base font-semibold">
                            {t(`type.${tile.type}`)}
                          </span>
                        </div>
                        <span className="mt-0.5 block text-[13px] text-muted-foreground">
                          {toneCat(tile.type)}
                        </span>
                      </div>
                      {tile.crit > 0 && (
                        <span className="nums grid size-[22px] shrink-0 place-items-center rounded-full bg-status-critical-fill text-[11px] font-medium text-white">
                          {tile.crit}
                        </span>
                      )}
                    </div>
                    <div className="mt-auto flex items-end justify-between gap-3 pt-4">
                      <div>
                        <div className="text-xs text-muted-foreground">{t("tile_last")}</div>
                        <div className="nums mt-0.5 text-[13px]">
                          {formatDateTime(tile.last, locale)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">{t("tile_alerts")}</div>
                        <div className="nums mt-0.5 text-sm font-semibold">
                          {tile.count.toLocaleString(locale)}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── DÖNEM TRENDİ (27.07.2026) — tile'ların ALTINDA ────────────
              Analiz'in tip-dağılımı grafiğine DOKUNULMADI (Volkan kararı);
              trend buraya kondu çünkü Alarmlar'ın yapabildiği ama Analiz'in
              yapamadığı şey bu: "zaman içinde ne oldu". Tile'lar NE olduğunu
              sayar, trend NE ZAMAN olduğunu gösterir. */}
          {trend.buckets.length > 0 && (
            <div className="glass-panel rounded-[16px] p-5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="flex items-center gap-1 text-[15px] font-semibold">
                  {t("trend_title")}
                  <HelpTip tkey="alarms_trend" />
                </h2>
                {trend.comparisonBlocked ? (
                  <span className="text-[12px] text-accent-gold-text">
                    {t("trend_blocked")}
                  </span>
                ) : trend.prevTotal !== null ? (
                  <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                    {t("trend_vs_prev", {
                      now: trend.total,
                      prev: trend.prevTotal,
                      // Delta NÖTR renkte: "az alarm iyi" sezgisi doğru ama
                      // eşik/araç sayısı değiştiyse yanıltır. Sayıyı gösterir,
                      // yorumu yöneticiye bırakırız.
                      delta:
                        trend.prevTotal === 0
                          ? "—"
                          : `${trend.total >= trend.prevTotal ? "+" : ""}${Math.round(
                              ((trend.total - trend.prevTotal) / trend.prevTotal) * 100
                            )}%`,
                    })}
                  </span>
                ) : null}
              </div>
              <MiniTrend
                data={trend.buckets}
                height={150}
                criticalLabel={t("sev_critical")}
                totalLabel={t("count")}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {/* ARALIK SEÇİCİ — Alarm Kaydı'na da eklendi (27.07.2026).
                Eskiden yalnız Genel Bakış'ta vardı: kayıt tablosu sayfanın
                yüklendiği aralığa bakıyordu ama bunu gösteren ya da
                değiştiren hiçbir kontrol yoktu. */}
            <PillSelect
              label={t("filter_shown")}
              value={range}
              onChange={(v) =>
                startNav(() =>
                  router.replace(`/admin/alarmlar?range=${v}`, { scroll: false })
                )
              }
              options={[
                ...(epochISO ? [{ value: "epoch", label: t("range_epoch") }] : []),
                { value: "today", label: t("range_today") },
                { value: "7d", label: t("range_7d") },
                { value: "30d", label: t("range_30d") },
              ]}
            />
            <PillSelect
              label={t("col_vehicle")}
              value={fVehicle}
              onChange={setFVehicle}
              options={[{ value: "", label: t("all") }, ...plateOptions]}
            />
            <PillSelect
              label={t("filter_type")}
              value={fType}
              onChange={setFType}
              options={[{ value: "", label: t("all") }, ...typeOptions]}
            />
            <PillSelect
              label={t("filter_severity")}
              value={fSev}
              onChange={setFSev}
              options={[
                { value: "", label: t("all") },
                { value: "critical", label: t("sev_critical") },
                { value: "warning", label: t("sev_warning") },
                { value: "neutral", label: t("sev_neutral") },
              ]}
            />
            <div className="ml-auto flex items-center gap-2">
              <DensityToggle />
              <span className="nums text-xs text-muted-foreground">
                {logRows.length !== events.length
                  ? `${logRows.length} / ${events.length}`
                  : logRows.length}{" "}
                {t("count")}
              </span>
            </div>
          </div>

          {logRows.length === 0 ? (
            <EmptyState
              kind={events.length === 0 ? "none" : "filtered"}
              title={events.length === 0 ? t("empty_none") : t("empty_filtered")}
              hint={events.length === 0 ? t("empty_hint_none") : t("empty_hint_filtered")}
            />
          ) : (
            // KABUK YOK: DataTable'ın KENDİSİ zaten `glass-panel overflow-hidden
            // rounded-[14px]` bölüm paneli (DataTable.tsx:173) + iç
            // `overflow-auto`. Etrafına ikinci bir cam sarmak üst üste iki
            // bulanık katman ve çift halka/köşe demekti (globals §3.2/§3.3) —
            // ayrıca dış padding tablonun kendi yatay kaydırmasını bozuyordu.
            <DataTable
              rows={logRows}
              columns={columns}
              rowKey={(e) => e.id}
              onRowClick={(e) => setSelected(e)}
              stripe={(e) => EVENT_STRIPE[eventTone(e.event_type)]}
              grouping={{
                // idling ARTIK epizod (bir rölanti = tek satır + süre) → storm
                // grouping'DEN HARİÇ: her idling satırına benzersiz anahtar ver,
                // asla "×N" altında gruplanmasın. Diğer tipler burst'lerde aynen
                // gruplanır (ani fren/aşırı hız vb. bozulmaz).
                getKey: (e) =>
                  e.event_type === "idling" ? `idle:${e.id}` : `${e.vehicle_id}:${e.event_type}`,
                getTime: (e) => new Date(e.occurred_at).getTime(),
                windowMs: STORM_WINDOW_MS,
                renderLabel: (rows) => (
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <span className="nums font-medium uppercase tracking-wide">
                      {rows[0].plate}
                    </span>
                    <DriverName
                      name={driverOf(rows[0])}
                      {...driverText}
                      className="text-xs text-muted-foreground"
                    />
                    <StatusChip tone={eventTone(rows[0].event_type)}>
                      {t(`type.${rows[0].event_type}`)} ×{rows.length}
                    </StatusChip>
                  </span>
                ),
              }}
              totalLabel={t("count")}
            />
          )}
        </>
      )}

      <DetailDrawer
        open={selected !== null}
        onOpenChange={(v) => !v && setSelected(null)}
        title={selected?.plate ?? ""}
        subtitle={selected ? formatDateTime(selected.occurred_at, locale) : undefined}
        onPrev={selIndex > 0 ? () => setSelected(logRows[selIndex - 1]) : null}
        onNext={
          selIndex >= 0 && selIndex < logRows.length - 1
            ? () => setSelected(logRows[selIndex + 1])
            : null
        }
      >
        {selected && (
          <div className="space-y-4 text-sm">
            <div>
              <StatusChip tone={eventTone(selected.event_type)}>
                {t(`type.${selected.event_type}`)}
              </StatusChip>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              {/* ŞOFÖR — çekmecenin başlığı plaka, ama karar veren kişi adı arar. */}
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("col_driver")}
                </dt>
                <dd className="mt-0.5">
                  <DriverName name={driverOf(selected)} {...driverText} />
                </dd>
              </div>
              {selected.event_type === "idling" && selected.duration_ms != null && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t("drawer_duration")}
                  </dt>
                  <dd className="nums mt-0.5">
                    {formatIdleShort(selected.duration_ms, locale)}
                    {selected.ongoing ? ` (${t("ongoing")})` : ""}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("drawer_speed")}
                </dt>
                <dd className="nums mt-0.5">
                  {SPEED_EVENTS.has(selected.event_type) && selected.speed_kmh !== null
                    ? `${Math.round(selected.speed_kmh)} km/h`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("drawer_location")}
                </dt>
                <dd className="nums mt-0.5">
                  {selected.latitude !== null && selected.longitude !== null
                    ? `${selected.latitude.toFixed(4)}, ${selected.longitude.toFixed(4)}`
                    : t("no_location")}
                </dd>
              </div>
            </dl>
            {selected.latitude !== null && selected.longitude !== null && (
              <div>
                <p className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                  {t("drawer_address")}
                </p>
                <EventMiniMap lat={selected.latitude} lng={selected.longitude} />
              </div>
            )}
            <div className="flex flex-col gap-2 pt-1">
              {selected.latitude !== null && selected.longitude !== null && (
                <a
                  href={`https://www.google.com/maps?q=${selected.latitude},${selected.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-accent-sky-text hover:underline"
                >
                  <MapPin className="size-4" />
                  {t("open_maps")}
                  <ExternalLink className="size-3" />
                </a>
              )}
              <Link
                href={`/admin/araclar/${selected.vehicle_id}`}
                className="inline-flex items-center gap-2 text-sm text-accent-sky-text hover:underline"
              >
                <Truck className="size-4" />
                {t("go_vehicle")}
              </Link>
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
