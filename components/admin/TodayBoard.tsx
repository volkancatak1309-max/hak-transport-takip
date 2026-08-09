"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, CalendarOff, PlayCircle, Truck, UserX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui-v2";
import { UserAvatar } from "@/components/UserAvatar";
import { formatDate, formatTime, formatDurationShort } from "@/lib/format";
import type { TodayRosterRow, RosterStatus } from "@/lib/admin-dashboard";

/**
 * GÜNÜN PANOSU — yöneticinin sabah açtığında gördüğü tek tablo:
 * "bugün kim, hangi araçla, ne durumda?"
 *
 * Satır sayısı vardiya sayısı DEĞİL, aktif şoför sayısıdır — vardiya AÇMAYAN
 * şoför de bir satırdır ve listenin en üstündedir. Eski panoda 12 kutu vardı
 * ama "kim işe çıkmadı" sorusu hiçbir yerde cevaplanmıyordu (Volkan, 22.07.2026).
 *
 * Sekmeler bir filtre değil, bir ÖNCELİK sırasıdır: Açmadı → Sahada → Kapandı.
 * Mobilde "Kapandı" varsayılan olarak kapalıdır — 20 satır boşuna kaydırmadır;
 * sabah eylem gerektiren satırlar diğer iki sekmededir.
 */

/** Roster'dan TÜREYEN kovalar — toplamları daima rows.length'tir. */
type RosterTab = "not_started" | "in_field" | "closed" | "on_leave";
/** Sekme şeridi = roster kovaları + kaynağı ayrı olan "dünden açık". */
type Tab = RosterTab | "carried_over";

/**
 * DÜNDEN AÇIK — GRUPLAMANIN DIŞINDA (09.08.2026).
 *
 * Bu sekme roster satırlarından TÜRETİLMEZ; kaynağı ayrı (activeShifts). Sebep
 * yapısal: roster BUGÜN başlayan vardiyaları taşır, dünden devreden vardiya
 * orada hiç yoktur. groupRows'un "kovaların toplamı = rows.length" değişmezi
 * bu yüzden BOZULMAZ — carried_over o toplamın dışındadır ve rosterCounts'a
 * da girmez. Aynı desen kritik alarm bandında da kullanıldı.
 */
export type CarriedOverShift = {
  id: string;
  worker_name: string;
  plate: string | null;
  started_at: string;
  elapsedMs: number;
};

/** Molada olan şoför "sahada" sayılır — ayrı sekme açmaz, rozetle ayrılır. */
function tabOf(s: RosterStatus): RosterTab {
  if (s === "not_started") return "not_started";
  if (s === "closed") return "closed";
  if (s === "on_leave") return "on_leave";
  return "in_field";
}

/**
 * Satırları sekme kovalarına ayırır — ŞERİDİN ve PANONUN TEK ortak kaynağı.
 *
 * Burada HİÇBİR satır elenmez; her aktif şoför tam olarak bir kovaya girer,
 * dolayısıyla kovaların toplamı daima rows.length'tir (= başlıktaki sayı).
 * Filosuz (atanmış aracı olmayan) personel de kendi durum kovasına girer:
 * "vardiya açmadı" gerçeği aracının olup olmamasından bağımsızdır ve yönetici
 * sabah o kişiyi de görmek zorundadır (25.07.2026). Aşağıdaki FİLOSUZ PERSONEL
 * bölümü bu satırları ayrıca listeler — eleme değil, ek vurgudur.
 */
function groupRows(rows: TodayRosterRow[]): Record<RosterTab, TodayRosterRow[]> {
  const g: Record<RosterTab, TodayRosterRow[]> = {
    not_started: [],
    in_field: [],
    closed: [],
    on_leave: [],
  };
  for (const r of rows) g[tabOf(r.status)].push(r);
  return g;
}

/** Telemetri yaşını insan diline çevirir; veri yoksa null (tire basılır). */
function useAgeLabel() {
  const locale = useLocale();
  return (ms: number | null) => (ms === null ? null : formatDurationShort(ms, locale));
}

export function TodayBoard({
  rows,
  carriedOver = [],
  onStart,
}: {
  rows: TodayRosterRow[];
  /** Dünden devreden açık vardiyalar — roster'dan DEĞİL, ayrı kaynaktan. */
  carriedOver?: CarriedOverShift[];
  /** Verilirse "Başlamadı" satırlarında "Vardiya Başlat" butonu çıkar (patron+şef).
   *  Yetki server action'da denetlenir; buton yalnız kısayol. */
  onStart?: (row: TodayRosterRow) => void;
}) {
  const t = useTranslations("admin");
  const locale = useLocale();
  const ageLabel = useAgeLabel();

  // FİLOSUZ PERSONEL ayrıca vurgulanır (22.07.2026). Filo, aracın filosundan
  // türüyor (lib/fleet-scope.ts); atanmış aracı olmayan kişinin filosu YOK ve
  // hiçbir filo şefinin kapsamına girmez. Bu satırlar yalnız patrona ulaşır —
  // şef için sunucu tarafında zaten elenmişlerdir. Listenin altındaki kendi
  // başlığında tekrar gösterilirler; sekmelerden ÇIKARILMAZLAR (25.07.2026 —
  // eskiden çıkarılıyordu ve "Başlamadı" sekmesi şeritten eksik sayıyordu).
  const fleetless = useMemo(
    () => rows.filter((r) => r.plate === null && r.status !== "on_leave"),
    [rows]
  );

  // Sekme kovaları: şeridin kullandığı rosterCounts ile AYNI fonksiyondan —
  // iki yüzeyin farklı rakam göstermesi artık yapısal olarak mümkün değil.
  const groups = useMemo(() => groupRows(rows), [rows]);

  // Varsayılan sekme: eylem gerektiren grup doluysa oraya, değilse sahadakiler.
  const [tab, setTab] = useState<Tab>(() =>
    groups.not_started.length > 0 ? "not_started" : "in_field"
  );

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "not_started", label: t("boardTabNotStarted"), count: groups.not_started.length },
    { key: "in_field", label: t("boardTabInField"), count: groups.in_field.length },
    { key: "closed", label: t("boardTabClosed"), count: groups.closed.length },
    { key: "on_leave", label: t("boardTabOnLeave"), count: groups.on_leave.length },
    // Yalnız gerçekten devreden vardiya varken görünür: her güne boş bir sekme
    // eklemek şerit gürültüsü olurdu.
    ...(carriedOver.length > 0
      ? [
          {
            key: "carried_over" as Tab,
            label: t("boardTabCarriedOver"),
            count: carriedOver.length,
          },
        ]
      : []),
  ];

  const shown = tab === "carried_over" ? [] : groups[tab as RosterTab];
  // Hücre-içi bar için ölçek: en çok yüklenen şoför %100.
  const maxLoaded = Math.max(1, ...rows.map((r) => r.loadedPackages ?? 0));

  return (
    <Card className="glass-panel rounded-[16px]">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
          <span>{t("boardTitle")}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {t("boardSubtitle", { n: rows.length })}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Sekmeler yapışkan: mobilde 20+ satır kaydırılırken hangi grupta
            olunduğu kaybolmasın. */}
        <div className="sticky top-0 z-10 -mx-1 mb-3 flex gap-1.5 overflow-x-auto bg-card px-1 py-1">
          {TABS.map((tb) => {
            const on = tb.key === tab;
            const urgent = tb.key === "not_started" && tb.count > 0;
            return (
              <button
                key={tb.key}
                type="button"
                onClick={() => setTab(tb.key)}
                aria-pressed={on}
                className={[
                  "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  on
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-surface-2/60",
                ].join(" ")}
              >
                {tb.label}
                <span
                  className={[
                    // Sayaç rozeti (26.07.2026 kontrast düzeltmesi): acil rozet
                    // gold/15 zemin + gold metinle 11px'te 2.8:1 kalıyordu.
                    // Artık DOLU gold + koyu metin (~8:1) — hem okunur hem daha
                    // güçlü sinyal. Nötr rozet de tam kontrast metne geçti.
                    "font-mono tabular-nums rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                    urgent
                      ? "bg-accent-gold text-[#181818]"
                      : "bg-surface-2 text-foreground",
                  ].join(" ")}
                >
                  {tb.count}
                </span>
              </button>
            );
          })}
        </div>

        {tab === "carried_over" ? (
          <div className="space-y-2">
            <p className="pb-1 text-xs text-muted-foreground">
              {t("boardCarriedOverHint")}
            </p>
            {carriedOver.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-border px-3 py-2.5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <UserAvatar name={c.worker_name} size="xs" />
                  <span className="truncate font-medium">{c.worker_name}</span>
                  <StatusChip tone="neutral">{c.plate ?? "—"}</StatusChip>
                </span>
                <span className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="nums">
                    {formatDate(c.started_at, locale)} {formatTime(c.started_at, locale)}
                  </span>
                  {/* Geçen süre vurgulu: "20 saattir açık" bu kartın asıl mesajı. */}
                  <span className="nums font-semibold text-accent-coral">
                    {formatDurationShort(c.elapsedMs, locale)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {tab === "not_started" ? t("boardEmptyAllStarted") : t("boardEmpty")}
          </p>
        ) : (
          <>
            {/* ── Masaüstü: tablo ── */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  {/* Başlık satırı — Stripe "Revenue recognition" yoğunluğu:
                      12px, 500, uppercase, +0.04em, üçüncül ton. */}
                  {/* STICKY başlık (Adım 6): 28 satırlık listede kolon adları
                      kaydırınca kaybolmasın. Zemin panel grisi — Stellate'in
                      tablo başlığı da içerikten bir basamak koyu. */}
                  <tr className="sticky top-0 z-10 border-b border-border bg-surface-panel text-left text-[12px] uppercase tracking-[0.04em] text-muted-foreground">
                    <th className="py-2.5 pr-3 font-medium">{t("boardColDriver")}</th>
                    <th className="py-2.5 pr-3 font-medium">{t("boardColVehicle")}</th>
                    <th className="py-2.5 pr-3 font-medium">{t("boardColStatus")}</th>
                    <th className="py-2.5 pr-3 font-medium">{t("boardColStart")}</th>
                    <th className="py-2.5 pr-3 text-right font-medium">{t("boardColPackages")}</th>
                    <th className="py-2.5 text-right font-medium">{t("boardColSignal")}</th>
                    {onStart && <th className="py-2.5 pl-3 text-right font-medium" aria-label={t("boardStartShift")} />}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr
                      key={r.workerId}
                      className="border-b border-border/50 transition-colors last:border-0 odd:bg-surface-panel/50 hover:bg-surface-hover"
                    >
                      {/* İsim KIRPILMAZ (26.07.2026): truncate kalktı — panonun
                          tek işi kimin ne durumda olduğunu söylemek. */}
                      <td className="py-2.5 pr-3">
                        <span className="flex items-center gap-2.5">
                          <UserAvatar name={r.name} size="xs" />
                          <span className="font-medium">{r.name}</span>
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <VehicleCell row={r} t={t} />
                      </td>
                      <td className="py-2 pr-3">
                        <StatusCell row={r} t={t} />
                      </td>
                      <td className="nums py-2 pr-3 text-muted-foreground">
                        {r.startedAt ? formatTime(r.startedAt, locale) : "—"}
                        {r.endedAt && (
                          <span className="text-muted-foreground/70">
                            {" → "}
                            {formatTime(r.endedAt, locale)}
                          </span>
                        )}
                      </td>
                      {/* HÜCRE-İÇİ BAR: paket sayısı hem rakam hem oran olarak
                          okunur. Oran, o gün en çok yüklenen şoföre göre. */}
                      <td className="relative py-2 pr-3 text-right">
                        {r.loadedPackages == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            <span
                              aria-hidden
                              className="absolute inset-y-1 right-0 rounded-[4px] bg-accent-coral opacity-[0.14]"
                              style={{ width: `${Math.round((r.loadedPackages / maxLoaded) * 100)}%` }}
                            />
                            <span className="relative font-mono text-[13px] font-semibold tabular-nums">
                              {r.loadedPackages}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <SignalCell row={r} t={t} ageLabel={ageLabel} />
                      </td>
                      {onStart && (
                        <td className="py-2 pl-3 text-right">
                          {r.status === "not_started" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() => onStart(r)}
                            >
                              <PlayCircle className="size-3.5" />
                              <span className="hidden lg:inline">{t("boardStartShift")}</span>
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Mobil: kart listesi ── */}
            <ul className="space-y-2.5 sm:hidden">
              {shown.map((r) => (
                <li
                  key={r.workerId}
                  className="rounded-[14px] border border-border/60 bg-card p-3.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <UserAvatar name={r.name} size="sm" />
                      <span className="font-medium">{r.name}</span>
                    </span>
                    <StatusCell row={r} t={t} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <Field label={t("boardColVehicle")}>
                      <VehicleCell row={r} t={t} />
                    </Field>
                    <Field label={t("boardColStart")}>
                      <span className="nums">
                        {r.startedAt ? formatTime(r.startedAt, locale) : "—"}
                        {r.endedAt && ` → ${formatTime(r.endedAt, locale)}`}
                      </span>
                    </Field>
                    <Field label={t("boardColPackages")}>
                      <span className="nums">{r.loadedPackages ?? "—"}</span>
                    </Field>
                    <Field label={t("boardColSignal")}>
                      <SignalCell row={r} t={t} ageLabel={ageLabel} />
                    </Field>
                  </dl>
                  {onStart && r.status === "not_started" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 w-full"
                      onClick={() => onStart(r)}
                    >
                      <PlayCircle className="size-4" />
                      {t("boardStartShift")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {/* ── FİLOSUZ PERSONEL ── atanmış aracı olmadığı için hiçbir filoya
            bağlanamayan çalışanlar. Durum sekmesinde zaten sayılırlar; burası
            ek vurgu: araç ataması yapılmadan bu kişiler hiçbir şefin
            kapsamında olmaz, o eksik listenin altında görünür kalsın. */}
        {fleetless.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle className="size-3.5 text-accent-gold-text" aria-hidden />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-accent-gold-text">
                {t("boardFleetlessTitle", { n: fleetless.length })}
              </h3>
            </div>
            <p className="mb-2.5 text-xs text-muted-foreground">
              {t("boardFleetlessHint")}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {fleetless.map((r) => (
                <li
                  key={r.workerId}
                  className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-foreground"
                >
                  {r.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

type TFn = (key: string, values?: Record<string, string | number>) => string;

/** Araç hücresi: atanmış plaka; atanmamışsa uyarı, farklı araç kullanıldıysa not. */
function VehicleCell({ row, t }: { row: TodayRosterRow; t: TFn }) {
  if (!row.plate) {
    return (
      <span className="inline-flex items-center gap-1 text-accent-gold-text">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        {t("boardNoVehicle")}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="nums uppercase">{row.plate}</span>
      {row.vehicleStatus && row.vehicleStatus !== "active" && (
        <StatusChip tone="warning">{t("boardVehicleNotActive")}</StatusChip>
      )}
      {/* GEÇİCİ ARAÇ (22.07.2026): şoför bugün başka araçla çıktıysa
          ASIL aracı solda kalır, kullandığı sağda "geçici" rozetiyle
          gösterilir — ikisi karışmasın. Gold ton = uyarı, ihlal değil. */}
      {row.usedPlate && (
        <span className="inline-flex items-center gap-1">
          <span className="nums text-[11px] text-muted-foreground">
            → {row.usedPlate}
          </span>
          <span className="rounded-full bg-accent-gold/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-gold-text">
            {t("boardTempVehicle")}
          </span>
        </span>
      )}
      {/* PAYLAŞILAN ARAÇ: aynı araçta bugün başka şoför de var. Bitiş km'si
          iki vardiyada da aynı odometreden türediği için mesafe ÇİFT sayılır —
          sayıyı bozmuyoruz, yöneticiye görünür kılıyoruz. */}
      {row.sharedVehicle && (
        <span
          className="rounded-full bg-accent-gold/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-gold-text"
          title={t("boardSharedVehicleHint")}
        >
          {t("boardSharedVehicle")}
        </span>
      )}
    </span>
  );
}

/**
 * Durum hücresi — KISA etiket + ikon (26.07.2026, Volkan onayı).
 * Konsol iskeletinde içerik sütunu daraldı ve "Vardiya başlamadı" iki satıra
 * sarıyordu. Uzun metin `title` içinde durur: ikon + kısa etiket ekranda,
 * tam cümle hover'da. Renk tek taşıyıcı değil — ikon her durumda eşlik eder.
 */
function StatusCell({ row, t }: { row: TodayRosterRow; t: TFn }) {
  if (row.status === "not_started") {
    return (
      <span
        title={t("boardStatusNotStarted")}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-gold-text"
      >
        <UserX className="size-3.5 shrink-0" aria-hidden />
        {t("boardStatusNotStartedShort")}
      </span>
    );
  }
  if (row.status === "on_leave") {
    // NÖTR: gold "Açmadı" sinyali DEĞİL. İzinli personel eylem gerektirmez.
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <CalendarOff className="size-3.5 shrink-0" aria-hidden />
        {t("boardStatusOnLeave")}
      </span>
    );
  }
  if (row.status === "on_break") {
    return <StatusChip tone="break" dot>{t("dash.ops_on_break")}</StatusChip>;
  }
  if (row.status === "in_field") {
    return <StatusChip tone="active" dot>{t("boardStatusInField")}</StatusChip>;
  }
  return <StatusChip tone="neutral">{t("boardStatusClosed")}</StatusChip>;
}

/**
 * Araç sinyali: son telemetrinin yaşı. 24 saati aşarsa bordo — o araçtan konum,
 * km ve yakıt verisi GELMİYOR demektir, vardiya açık olsa bile.
 */
function SignalCell({
  row,
  t,
  ageLabel,
}: {
  row: TodayRosterRow;
  t: TFn;
  ageLabel: (ms: number | null) => string | null;
}) {
  if (!row.plate) return <span className="text-muted-foreground">—</span>;
  const label = ageLabel(row.telemetryAgeMs);
  if (label === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Truck className="size-3.5 shrink-0" aria-hidden />
        {t("boardSignalNone")}
      </span>
    );
  }
  if (row.telemetryStale) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-status-critical-text">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        {label}
      </span>
    );
  }
  return <span className="nums text-xs text-muted-foreground">{label}</span>;
}

/**
 * Şerit için sayılar — panonun sekmeleriyle AYNI groupRows'tan türer, ikinci
 * hesap kaynağı yok. Kovalar sekmelerin birebir karşılığıdır; total = kovaların
 * toplamı = başlıktaki aktif şoför sayısı.
 *
 * İZİNLİ ayrı kovadır (25.07.2026). Eskiden üçlü bir if/else zinciri vardı ve
 * on_leave son else'e, yani KAPANDI'ya düşüyordu: izinli personel "vardiyasını
 * kapattı" gibi sayılıyordu (şeritte 6 fazla).
 */
export function rosterCounts(rows: TodayRosterRow[]) {
  const g = groupRows(rows);
  let loaded = 0;
  let staleVehicles = 0;
  for (const r of rows) {
    if (r.loadedPackages != null) loaded += r.loadedPackages;
    if (r.telemetryStale) staleVehicles++;
  }
  return {
    total: rows.length,
    notStarted: g.not_started.length,
    inField: g.in_field.length,
    closed: g.closed.length,
    onLeave: g.on_leave.length,
    loaded,
    staleVehicles,
  };
}

// TodayStrip KALDIRILDI (26.07.2026): 5'li KPI şeridi Stellate iskeletindeki
// OpsStatGrid'e taşındı (AdminClient). rosterCounts DURUYOR — sayıları o üretir.
