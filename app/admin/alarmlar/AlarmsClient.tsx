"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ListFilter,
  MapPin,
  Route,
  SlidersHorizontal,
  Truck,
  X,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { EmptyState, SpecRow } from "@/components/ui-v2";
import { EpochWarning } from "@/components/admin/EpochWarning";
import { HelpTip } from "@/components/help/HelpTip";
import { AlarmStrip } from "./AlarmStrip";
import { eventTone, EVENT_TONE_RANK } from "@/lib/event-ui";
import type { ChipTone } from "@/components/ui-v2";
import { formatDateTime, formatDate, formatTime, formatIdleShort } from "@/lib/format";
import type { VehicleEventWithPlate, EventDensityCell } from "@/lib/telemetry";
import { cn } from "@/lib/utils";
import type { AlarmRange } from "./page";

export type AlarmRow = VehicleEventWithPlate & {
  duration_ms?: number | null;
  ongoing?: boolean;
};

const EventMiniMap = dynamic(() => import("@/components/admin/EventMiniMap"), {
  ssr: false,
  loading: () => (
    <div className="h-40 w-full animate-pulse rounded-[12px] bg-surface-panel" />
  ),
});

/** Grup başlığı özetinde en fazla kaç tip kalemi yazılır (kalanı "+N"). */
const SUMMARY_MAX = 4;

const SPEED_EVENTS = new Set([
  "overspeeding",
  "harsh_acceleration",
  "harsh_braking",
  "harsh_cornering",
  "crash",
]);

/** Gruplama ekseni — VARSAYILAN araç/şoför. */
type GroupBy = "vehicle" | "severity" | "date";

/**
 * Grup içindeki tekrar kümesi. Kova ekseni DAİMA grubun TAMAMLAYICISIDIR:
 *  • araç ekseninde araç sabittir → kova TİP olur   ("Rölanti ×8")
 *  • önem/tarih ekseninde tip/gün sabittir → kova ARAÇ olur
 *    ("DO-788GS · Sinan Şahinoğlu ×39")
 *
 * İlk denemede her eksende tipe göre katlıyordum; önem ekseninde "Aşırı Hız
 * ×223" çıkıyordu ve KİM sorusu bir seviye aşağı kaçıyordu — 223 ihlalin hangi
 * şoförlere ait olduğu kovayı açmadan görünmüyordu. Kural: gruplama ekseni ne
 * ise, kova öteki eksendir; böylece kimlik hiçbir seviyede kaybolmaz.
 */
type Bucket = {
  key: string;
  /** Kova başlığı — tip adı ya da "plaka · şoför". */
  type?: string;
  plate?: string;
  driver?: string | null;
  tone: ChipTone;
  rows: AlarmRow[];
};

type Group = {
  key: string;
  /** Başlığın birinci satırı — plaka ya da önem/tarih etiketi. */
  label: string;
  /** Yalnız araç ekseninde dolu. */
  driver?: string | null;
  vehicleId?: string;
  rows: AlarmRow[];
  buckets: Bucket[];
  /** Başlıktaki "8 rölanti · 3 aşırı hız" özeti — her eksende TİP bazlıdır:
   *  başlık NE olduğunu söyler, gövdedeki kovalar KİM olduğunu. */
  typeSummary: string;
  /** Gruptaki en ağır ton — sıralama ve nokta rengi. */
  worst: ChipTone;
};

/**
 * ALARMLAR — üç referansın birleşimi:
 *   ① Zendesk `7957c520` → 90 günlük araç şeridi (AlarmStrip)
 *   ② Linear  `2a0adcf3` → kolon başlığı/ayraç/zebra OLMAYAN gruplu liste
 *   ③ Stripe  `4e3c7127` → satır YERİNDE açılır: künye + mini harita + eylem
 *
 * ═══ 27.07.2026 YENİDEN YAZIM — liste reddedildi, şerit kaldı ═══
 *
 * Volkan canlıda: "kimin ne yaptığı belli değil, hiçbir şey araç/sürücü
 * nezdinde kategorize edilmemiş." Üç kusur ve karşılıkları:
 *
 *  1. ŞOFÖR ADI HİÇ YOKTU — yalnız plaka vardı, o da sağda silik. Plaka tek
 *     başına kimlik değil: yönetici "DO-945HL" değil "Ümit" diye düşünür.
 *     Ad artık HER SEVİYEDE var (kritik bant · grup başlığı · olay satırı ·
 *     açılan künye).
 *  2. TEKRARLAR YIĞILIYORDU — aynı aracın 8 rölanti alarmı 8 satırdı, 76 uyarı
 *     okunmaz bir yığındı. Artık tip bazında katlanıyor: "Rölanti ×8" tek
 *     satır, açılınca tekil olaylar. Tek olaylı tipler ARA KATMAN ALMAZ —
 *     "×1" diye bir şey yok, o satır doğrudan olayın kendisidir.
 *  3. TEK EKSEN ÖNEMDİ — operasyonun sorusu "hangi araç/şoför sorunlu".
 *     Varsayılan eksen ARAÇ/ŞOFÖR oldu; önem ve tarih Display'de duruyor.
 *
 * KRİTİK BANT: kritik olaylar gruplamanın DIŞINDA, en üstte, tek tek durur.
 * Sinyal karıştırma bir "×3 tekrarı" değildir; katlanırsa kaybolur. Bant
 * grubun içinden ÇIKARILDIĞI için sayım çift olmaz — aşağıdaki grup özetinde
 * o olaylar yer almaz.
 *
 * VARSAYILAN KATLANMA: araç ekseninde gruplar KAPALI açılır (29 araç × ~n olay
 * yığın demek), önem/tarih ekseninde AÇIK. Eksene bağlı varsayılan + tek
 * "çevrilmişler" kümesi ile tutuluyor; effect içinde setState YOK.
 */
export function AlarmsClient({
  events,
  density,
  stripDays,
  vehicles,
  range,
  epochISO,
  showEpochWarning,
}: {
  events: AlarmRow[];
  density: EventDensityCell[];
  stripDays: number;
  vehicles: {
    id: string;
    plate: string;
    fleet: string;
    driverName: string | null;
  }[];
  range: AlarmRange;
  epochISO: string | null;
  showEpochWarning: boolean;
}) {
  const t = useTranslations("alarms");
  const locale = useLocale();
  const router = useRouter();
  const [, startNav] = useTransition();

  const [fVehicle, setFVehicle] = useState("");
  const [fType, setFType] = useState("");
  const [fSev, setFSev] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("vehicle");
  const [openId, setOpenId] = useState<string | null>(null);
  /** Eksenin VARSAYILANINDAN sapmış grup/kümeler (açık↔kapalı çevrilmişler). */
  const [toggled, setToggled] = useState<Set<string>>(new Set());

  const flip = (key: string) =>
    setToggled((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  /** Araç → şoför adı. Plakayla da aranabilsin diye iki yönlü kurulur. */
  const driverByVehicleId = useMemo(
    () => new Map(vehicles.map((v) => [v.id, v.driverName])),
    [vehicles]
  );
  const driverOf = (e: AlarmRow) => driverByVehicleId.get(e.vehicle_id) ?? null;

  const idleBadge = (e: AlarmRow): string | null => {
    if (e.event_type !== "idling" || e.duration_ms == null) return null;
    const d = formatIdleShort(e.duration_ms, locale);
    return e.ongoing ? `${d} · ${t("ongoing")}` : d;
  };

  const filtered = useMemo(() => {
    const rows = events.filter((e) => {
      if (fVehicle && e.plate !== fVehicle) return false;
      if (fType && e.event_type !== fType) return false;
      if (fSev && eventTone(e.event_type) !== fSev) return false;
      return true;
    });
    return [...rows].sort((a, b) => {
      const d =
        EVENT_TONE_RANK[eventTone(b.event_type)] - EVENT_TONE_RANK[eventTone(a.event_type)];
      return d !== 0 ? d : b.occurred_at.localeCompare(a.occurred_at);
    });
  }, [events, fVehicle, fType, fSev]);

  /**
   * KRİTİK BANT — gruplamadan önce ayrılır. Önem filtresi kritik-dışı bir
   * değere kısıtlandıysa bant boş kalır (filtre bandı da susturur).
   */
  const criticals = useMemo(
    () => filtered.filter((e) => eventTone(e.event_type) === "critical"),
    [filtered]
  );
  const grouped = useMemo(
    () => filtered.filter((e) => eventTone(e.event_type) !== "critical"),
    [filtered]
  );

  // NOT: `bucketize` ve `typeSummaryOf` bilinçli olarak `groups` memo'sunun
  // İÇİNDE yaşıyor. Dışarıda tanımlanırlarsa her render'da yeni referans
  // olurlar; memo'nun bağımlılık listesine girince memo hiç tutmaz, girmezlerse
  // lint haklı olarak "eksik bağımlılık" der. İkisi de yalnız burada kullanılıyor.
  const groups = useMemo<Group[]>(() => {
    /** Kovalama — tek olaylı kova ARA KATMAN ALMAZ ("×1" diye bir şey yok). */
    const bucketize = (rows: AlarmRow[], by: "type" | "vehicle"): Bucket[] => {
      const m = new Map<string, AlarmRow[]>();
      for (const r of rows) {
        const k = by === "type" ? r.event_type : r.vehicle_id;
        const cur = m.get(k);
        if (cur) cur.push(r);
        else m.set(k, [r]);
      }
      return [...m.entries()]
        .map(([k, rs]) => {
          const worst = rs.reduce<ChipTone>(
            (acc, r) =>
              EVENT_TONE_RANK[eventTone(r.event_type)] > EVENT_TONE_RANK[acc]
                ? eventTone(r.event_type)
                : acc,
            "neutral"
          );
          return by === "type"
            ? { key: k, type: k, tone: eventTone(k), rows: rs }
            : {
                key: k,
                plate: rs[0].plate,
                driver: driverByVehicleId.get(k) ?? null,
                tone: worst,
                rows: rs,
              };
        })
        .sort(
          (a, b) =>
            EVENT_TONE_RANK[b.tone] - EVENT_TONE_RANK[a.tone] ||
            b.rows.length - a.rows.length
        );
    };

    /**
     * Tip bazlı özet cümlesi — "8 rölanti · 3 aşırı hız · 1 fren".
     *
     * En fazla SUMMARY_MAX kalem yazılır, kalanı "+N" ile SÖYLENİR (sessizce
     * düşürülmez). Sebep ölçüm: 390px'te beş kalemlik özet satırı üç noktaya
     * düşüyordu ve grubun asıl bilgisi — açmadan neyin sorunlu olduğu — tam da
     * o satırdaydı. Kırpmak yerine kalem sayısı sınırlanır; satır ayrıca SARAR,
     * hiçbir kelime yarıda kesilmez.
     */
    const typeSummaryOf = (rows: AlarmRow[]) => {
      const m = new Map<string, number>();
      for (const r of rows) m.set(r.event_type, (m.get(r.event_type) ?? 0) + 1);
      const parts = [...m.entries()]
        .sort(
          (a, b) =>
            EVENT_TONE_RANK[eventTone(b[0])] - EVENT_TONE_RANK[eventTone(a[0])] ||
            b[1] - a[1]
        )
        .map(([ty, n]) => `${n} ${t(`type.${ty}`).toLocaleLowerCase(locale)}`);
      const shown = parts.slice(0, SUMMARY_MAX);
      const rest = parts.length - shown.length;
      return rest > 0 ? `${shown.join(" · ")} · +${rest}` : shown.join(" · ");
    };

    const m = new Map<
      string,
      {
        label: string;
        driver?: string | null;
        vehicleId?: string;
        rows: AlarmRow[];
      }
    >();
    for (const e of grouped) {
      let key: string;
      let label: string;
      let driver: string | null | undefined;
      let vehicleId: string | undefined;
      if (groupBy === "vehicle") {
        key = e.vehicle_id;
        label = e.plate;
        driver = driverByVehicleId.get(e.vehicle_id) ?? null;
        vehicleId = e.vehicle_id;
      } else if (groupBy === "severity") {
        const tone = eventTone(e.event_type);
        key = tone === "warning" ? "1-warning" : "2-neutral";
        label = tone === "warning" ? t("sev_warning") : t("sev_neutral");
      } else {
        key = e.occurred_at.slice(0, 10);
        label = formatDate(e.occurred_at, locale);
      }
      const cur = m.get(key);
      if (cur) cur.rows.push(e);
      else m.set(key, { label, driver, vehicleId, rows: [e] });
    }

    const out: Group[] = [...m.entries()].map(([key, v]) => {
      const worst = v.rows.reduce(
        (acc, r) =>
          EVENT_TONE_RANK[eventTone(r.event_type)] > EVENT_TONE_RANK[acc]
            ? eventTone(r.event_type)
            : acc,
        "neutral" as ChipTone
      );
      return {
        key,
        ...v,
        buckets: bucketize(v.rows, groupBy === "vehicle" ? "type" : "vehicle"),
        typeSummary: typeSummaryOf(v.rows),
        worst,
      };
    });

    // ARAÇ EKSENİ SIRASI: en ağır ton → en çok olay → plaka. Yönetici listenin
    // başında en sorunlu aracı görür; alfabetik sıra burada bilgi taşımaz.
    if (groupBy === "vehicle") {
      return out.sort(
        (a, b) =>
          EVENT_TONE_RANK[b.worst] - EVENT_TONE_RANK[a.worst] ||
          b.rows.length - a.rows.length ||
          a.label.localeCompare(b.label)
      );
    }
    return out.sort((a, b) =>
      groupBy === "severity" ? a.key.localeCompare(b.key) : b.key.localeCompare(a.key)
    );
  }, [grouped, groupBy, driverByVehicleId, t, locale]);

  const plateOptions = useMemo(
    () => [...new Set(events.map((e) => e.plate))].sort(),
    [events]
  );
  const typeOptions = useMemo(
    () =>
      [...new Set(events.map((e) => e.event_type))]
        .map((ty) => ({ value: ty, label: t(`type.${ty}`) }))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [events, t, locale]
  );

  const activeChips = [
    fVehicle && {
      k: "v",
      label: `${t("col_vehicle")}: ${fVehicle}`,
      clear: () => setFVehicle(""),
    },
    fType && {
      k: "t",
      label: `${t("filter_type")}: ${t(`type.${fType}`)}`,
      clear: () => setFType(""),
    },
    fSev && {
      k: "s",
      label: `${t("filter_severity")}: ${fSev === "critical" ? t("sev_critical") : fSev === "warning" ? t("sev_warning") : t("sev_neutral")}`,
      clear: () => setFSev(""),
    },
  ].filter(Boolean) as { k: string; label: string; clear: () => void }[];

  const toneDot = (tone: ChipTone) =>
    tone === "critical"
      ? "bg-status-critical"
      : tone === "warning"
        ? "bg-accent-gold"
        : "bg-muted-foreground";

  // ── Ortak parçalar ────────────────────────────────────────────────────────

  /** Şoför adı — atanmamışsa SEBEBİ yazılır, boş bırakılmaz. */
  const DriverName = ({ name, className }: { name: string | null; className?: string }) =>
    name ? (
      <span className={cn("truncate", className)} title={t("driver_source_hint")}>
        {name}
      </span>
    ) : (
      <span className={cn("truncate text-text-tertiary", className)}>{t("no_driver")}</span>
    );

  /** ③ STRIPE AÇILIR PANELİ — künye + mini harita + eylem. */
  const EventDetail = ({ e }: { e: AlarmRow }) => (
    <div className="mb-2 grid gap-4 rounded-[12px] bg-surface-panel px-4 py-3 md:grid-cols-[1fr_280px]">
      <dl>
        <SpecRow label={t("col_vehicle")} mono>
          <Link href={`/admin/araclar/${e.vehicle_id}`} className="hover:underline">
            {e.plate}
          </Link>
        </SpecRow>
        {/* ŞOFÖR künyenin İKİNCİ satırı: olay bir araca değil, o aracı süren
            kişiye sorulur. Eskiden künyede hiç yoktu. */}
        <SpecRow label={t("col_driver")} muted={!driverOf(e)}>
          {driverOf(e) ?? t("no_driver")}
        </SpecRow>
        <SpecRow label={t("col_type")}>{t(`type.${e.event_type}`)}</SpecRow>
        <SpecRow label={t("col_time")} mono>
          {formatDateTime(e.occurred_at, locale)}
        </SpecRow>
        {e.event_type === "idling" && e.duration_ms != null && (
          <SpecRow label={t("drawer_duration")} mono>
            {formatIdleShort(e.duration_ms, locale)}
            {e.ongoing ? ` (${t("ongoing")})` : ""}
          </SpecRow>
        )}
        <SpecRow
          label={t("drawer_speed")}
          mono
          muted={!SPEED_EVENTS.has(e.event_type) || e.speed_kmh === null}
        >
          {SPEED_EVENTS.has(e.event_type) && e.speed_kmh !== null
            ? `${Math.round(e.speed_kmh)} km/h`
            : "—"}
        </SpecRow>
        <SpecRow label={t("drawer_location")} mono muted={e.latitude === null}>
          {e.latitude !== null && e.longitude !== null
            ? `${e.latitude.toFixed(5)}, ${e.longitude.toFixed(5)}`
            : t("no_location")}
        </SpecRow>
      </dl>

      <div className="space-y-2">
        {e.latitude !== null && e.longitude !== null && (
          <div className="overflow-hidden rounded-[12px]">
            <EventMiniMap lat={e.latitude} lng={e.longitude} />
          </div>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link
            href={`/admin/araclar/${e.vehicle_id}`}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent-sky-text hover:underline"
          >
            <Truck className="size-3.5" aria-hidden />
            {t("go_vehicle")}
          </Link>
          <Link
            href={`/admin/araclar/${e.vehicle_id}/rota`}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent-sky-text hover:underline"
          >
            <Route className="size-3.5" aria-hidden />
            {t("go_route")}
          </Link>
          {e.latitude !== null && e.longitude !== null && (
            <a
              href={`https://www.google.com/maps?q=${e.latitude},${e.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent-sky-text hover:underline"
            >
              <MapPin className="size-3.5" aria-hidden />
              {t("open_maps")}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </div>
      </div>
    </div>
  );

  /**
   * Tekil olay satırı. `showWho`: araç ekseninde kimlik başlıkta olduğu için
   * satır tek satırdır; önem/tarih ekseninde plaka+şoför satıra iner — yoksa
   * o eksenlerde "kim" sorusu yine cevapsız kalırdı.
   */
  const EventRow = ({ e, showWho }: { e: AlarmRow; showWho: boolean }) => {
    const open = openId === e.id;
    const badge = idleBadge(e);
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpenId(open ? null : e.id)}
          aria-expanded={open}
          className="flex w-full items-start gap-3 rounded-[8px] px-2 py-2 text-left transition-colors hover:bg-surface-panel"
        >
          <span
            className={cn(
              "mt-1.5 size-2 shrink-0 rounded-full",
              toneDot(eventTone(e.event_type))
            )}
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px]">
              {t(`type.${e.event_type}`)}
              {badge && (
                <span className="ml-1.5 font-mono text-[12px] tabular-nums text-muted-foreground">
                  {badge}
                </span>
              )}
            </span>
            {showWho && (
              <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                <span className="font-mono uppercase tabular-nums">{e.plate}</span>
                <span aria-hidden>·</span>
                <DriverName name={driverOf(e)} />
              </span>
            )}
          </span>
          <span className="shrink-0 pt-0.5 font-mono text-[12px] tabular-nums text-text-tertiary">
            {formatTime(e.occurred_at, locale)}
          </span>
          <ChevronDown
            className={cn(
              "mt-0.5 size-3.5 shrink-0 text-text-tertiary transition-transform",
              open && "rotate-180"
            )}
            aria-hidden
          />
        </button>
        {open && <EventDetail e={e} />}
      </li>
    );
  };

  /** Bir grubun gövdesi: çok olaylı kovalar katlanır, tekler doğrudan satır. */
  const GroupBody = ({ g, showWho }: { g: Group; showWho: boolean }) => (
    <ul className="pl-4">
      {g.buckets.map((b) => {
        if (b.rows.length === 1)
          return <EventRow key={b.rows[0].id} e={b.rows[0]} showWho={showWho} />;
        const bkey = `${g.key}:${b.key}`;
        // Kovalar VARSAYILAN KAPALI: "Rölanti ×8" satırının kendisi zaten
        // bilgidir, altındaki 8 satır değil.
        const bOpen = toggled.has(bkey);
        return (
          <li key={bkey}>
            <button
              type="button"
              onClick={() => flip(bkey)}
              aria-expanded={bOpen}
              className="flex w-full items-center gap-2 rounded-[8px] px-2 py-2 text-left transition-colors hover:bg-surface-panel"
            >
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-text-tertiary transition-transform",
                  bOpen && "rotate-90"
                )}
                aria-hidden
              />
              <span
                className={cn("size-2 shrink-0 rounded-full", toneDot(b.tone))}
                aria-hidden
              />
              {b.type ? (
                <span className="min-w-0 flex-1 text-[13px]">{t(`type.${b.type}`)}</span>
              ) : (
                /* ARAÇ KOVASI — plaka ve şoför yan yana; önem/tarih ekseninde
                   "kim" sorusunun cevabı bu satırdadır. */
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-mono text-[13px] uppercase tabular-nums">
                    {b.plate}
                  </span>
                  <DriverName
                    name={b.driver ?? null}
                    className="text-[12px] text-muted-foreground"
                  />
                </span>
              )}
              <span className="shrink-0 font-mono text-[12px] font-medium tabular-nums text-muted-foreground">
                {t("repeat_n", { n: b.rows.length })}
              </span>
            </button>
            {bOpen && (
              <ul className="pl-5">
                {b.rows.map((e) => (
                  /* Kova zaten aracı adlandırdıysa satır tekrar etmez. */
                  <EventRow key={e.id} e={e} showWho={showWho && !b.plate} />
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );

  const byVehicle = groupBy === "vehicle";
  const groupDefaultOpen = !byVehicle;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-1">
          <h1 className="text-[28px] font-semibold leading-tight">{t("title")}</h1>
          <HelpTip tkey="alarms_page" />
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <EpochWarning epochISO={epochISO} show={showEpochWarning} />

      {/* ① ZENDESK ŞERİDİ — aralık filtresinden BAĞIMSIZ, hep son 90 gün. */}
      <AlarmStrip
        cells={density}
        days={stripDays}
        vehicles={vehicles}
        onPick={setFVehicle}
        activePlate={fVehicle}
      />

      {/* ② LINEAR ÇUBUĞU — solda Filter, sağda Display. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <ListFilter className="size-3.5" aria-hidden />
          {t("filter_label")}
        </span>

        <Select
          value={range}
          onValueChange={(v) =>
            v &&
            startNav(() => router.replace(`/admin/alarmlar?range=${v}`, { scroll: false }))
          }
        >
          <SelectTrigger
            className="h-8 w-auto gap-1.5 rounded-full px-3 text-[13px]"
            aria-label={t("filter_shown")}
          >
            <span>
              {range === "epoch"
                ? t("range_epoch")
                : range === "today"
                  ? t("range_today")
                  : range === "7d"
                    ? t("range_7d")
                    : t("range_30d")}
            </span>
          </SelectTrigger>
          <SelectContent>
            {epochISO && <SelectItem value="epoch">{t("range_epoch")}</SelectItem>}
            <SelectItem value="today">{t("range_today")}</SelectItem>
            <SelectItem value="7d">{t("range_7d")}</SelectItem>
            <SelectItem value="30d">{t("range_30d")}</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={fSev}
          onValueChange={(v) => setFSev(v === "__all" ? "" : String(v ?? ""))}
        >
          <SelectTrigger
            className="h-8 w-auto gap-1.5 rounded-full px-3 text-[13px]"
            aria-label={t("filter_severity")}
          >
            <span>{t("filter_severity")}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("all")}</SelectItem>
            <SelectItem value="critical">{t("sev_critical")}</SelectItem>
            <SelectItem value="warning">{t("sev_warning")}</SelectItem>
            <SelectItem value="neutral">{t("sev_neutral")}</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={fType}
          onValueChange={(v) => setFType(v === "__all" ? "" : String(v ?? ""))}
        >
          <SelectTrigger
            className="h-8 w-auto gap-1.5 rounded-full px-3 text-[13px]"
            aria-label={t("filter_type")}
          >
            <span>{t("filter_type")}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("all")}</SelectItem>
            {typeOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={fVehicle}
          onValueChange={(v) => setFVehicle(v === "__all" ? "" : String(v ?? ""))}
        >
          <SelectTrigger
            className="h-8 w-auto gap-1.5 rounded-full px-3 text-[13px]"
            aria-label={t("col_vehicle")}
          >
            <span>{t("col_vehicle")}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("all")}</SelectItem>
            {plateOptions.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <Select value={groupBy} onValueChange={(v) => v && setGroupBy(v as GroupBy)}>
            <SelectTrigger
              className="h-8 w-auto gap-1.5 rounded-full px-3 text-[13px]"
              aria-label={t("display_label")}
            >
              <SlidersHorizontal className="size-3.5" aria-hidden />
              <span>{t("display_label")}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vehicle">{t("group_vehicle")}</SelectItem>
              <SelectItem value="severity">{t("group_severity")}</SelectItem>
              <SelectItem value="date">{t("group_date")}</SelectItem>
            </SelectContent>
          </Select>
          <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
            {filtered.length !== events.length
              ? `${filtered.length} / ${events.length}`
              : filtered.length}
          </span>
        </div>
      </div>

      {/* Aktif filtre çipleri — görünmeyen filtre en pahalı hatadır. */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activeChips.map((c) => (
            <span
              key={c.k}
              className="surface-card inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px]"
            >
              {c.label}
              <button
                type="button"
                onClick={c.clear}
                aria-label={c.label}
                className="rounded-full p-0.5 text-text-tertiary transition-colors hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          kind={events.length === 0 ? "none" : "filtered"}
          title={events.length === 0 ? t("empty_none") : t("empty_filtered")}
          hint={events.length === 0 ? t("empty_hint_none") : t("empty_hint_filtered")}
        />
      ) : (
        <div className="space-y-4">
          {/* KRİTİK BANT — gruplamanın dışında, katlanmadan, en üstte. */}
          {criticals.length > 0 && (
            <section className="surface-card rounded-[16px] px-2 py-3 sm:px-4">
              <header className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2">
                <h2 className="text-[11px] font-medium uppercase tracking-[0.1em] text-status-critical-text">
                  {t("critical_band")}
                </h2>
                <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                  {criticals.length}
                </span>
                <p className="w-full text-[12px] text-text-tertiary">
                  {t("critical_band_hint")}
                </p>
              </header>
              <ul>
                {criticals.map((e) => (
                  <EventRow key={e.id} e={e} showWho />
                ))}
              </ul>
            </section>
          )}

          {/* ② LINEAR LİSTESİ — kolon başlığı yok, ayraç yok, zebra yok. */}
          {groups.length > 0 && (
            <div className="glass-panel rounded-[16px] px-2 py-3 sm:px-4">
              {groups.map((g) => {
                const open = toggled.has(g.key) ? !groupDefaultOpen : groupDefaultOpen;
                return (
                  <section key={g.key} className="mb-1 last:mb-0">
                    <button
                      type="button"
                      onClick={() => flip(g.key)}
                      aria-expanded={open}
                      className="flex w-full items-start gap-2 rounded-[8px] px-2 py-2 text-left transition-colors hover:bg-surface-panel"
                    >
                      <ChevronRight
                        className={cn(
                          "mt-1 size-3.5 shrink-0 text-text-tertiary transition-transform",
                          open && "rotate-90"
                        )}
                        aria-hidden
                      />
                      {byVehicle && (
                        <span
                          className={cn(
                            "mt-1.5 size-2 shrink-0 rounded-full",
                            toneDot(g.worst)
                          )}
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        {/* KİMLİK SATIRI: plaka + şoför. Araç ekseninde ikisi
                            de başlıktadır; yönetici grubu açmadan kimin sorunlu
                            olduğunu okur. */}
                        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span
                            className={cn(
                              "text-[13px] font-medium",
                              byVehicle && "font-mono uppercase tabular-nums"
                            )}
                          >
                            {g.label}
                          </span>
                          {byVehicle && (
                            <DriverName name={g.driver ?? null} className="text-[13px]" />
                          )}
                          <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                            {t("events_n_short", { n: g.rows.length })}
                          </span>
                        </span>
                        {/* ÖZET: tip bazında sayım. Grup kapalıyken bile "8
                            rölanti · 3 aşırı hız" okunur — asıl kazanç bu. */}
                        <span className="mt-0.5 block text-[12px] leading-snug text-text-tertiary">
                          {g.typeSummary}
                        </span>
                      </span>
                    </button>

                    {open && <GroupBody g={g} showWho={!byVehicle} />}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
