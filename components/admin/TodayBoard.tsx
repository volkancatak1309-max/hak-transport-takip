"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Truck, UserX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui-v2";
import { UserAvatar } from "@/components/UserAvatar";
import { formatTime, formatDurationShort } from "@/lib/format";
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

type Tab = "not_started" | "in_field" | "closed";

/** Molada olan şoför "sahada" sayılır — ayrı sekme açmaz, rozetle ayrılır. */
function tabOf(s: RosterStatus): Tab {
  if (s === "not_started") return "not_started";
  if (s === "closed") return "closed";
  return "in_field";
}

/** Telemetri yaşını insan diline çevirir; veri yoksa null (tire basılır). */
function useAgeLabel() {
  const locale = useLocale();
  return (ms: number | null) => (ms === null ? null : formatDurationShort(ms, locale));
}

export function TodayBoard({ rows }: { rows: TodayRosterRow[] }) {
  const t = useTranslations("admin");
  const locale = useLocale();
  const ageLabel = useAgeLabel();

  const groups = useMemo(() => {
    const g: Record<Tab, TodayRosterRow[]> = { not_started: [], in_field: [], closed: [] };
    for (const r of rows) g[tabOf(r.status)].push(r);
    return g;
  }, [rows]);

  // Varsayılan sekme: eylem gerektiren grup doluysa oraya, değilse sahadakiler.
  const [tab, setTab] = useState<Tab>(() =>
    groups.not_started.length > 0 ? "not_started" : "in_field"
  );

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "not_started", label: t("boardTabNotStarted"), count: groups.not_started.length },
    { key: "in_field", label: t("boardTabInField"), count: groups.in_field.length },
    { key: "closed", label: t("boardTabClosed"), count: groups.closed.length },
  ];

  const shown = groups[tab];

  return (
    <Card>
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
        <div className="sticky top-0 z-10 -mx-1 mb-3 flex gap-1.5 overflow-x-auto bg-card/95 px-1 py-1 backdrop-blur">
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
                    "nums rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                    urgent
                      ? "bg-accent-gold/15 text-accent-gold"
                      : "bg-surface-2 text-muted-foreground",
                  ].join(" ")}
                >
                  {tb.count}
                </span>
              </button>
            );
          })}
        </div>

        {shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {tab === "not_started" ? t("boardEmptyAllStarted") : t("boardEmpty")}
          </p>
        ) : (
          <>
            {/* ── Masaüstü: tablo ── */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">{t("boardColDriver")}</th>
                    <th className="py-2 pr-3 font-medium">{t("boardColVehicle")}</th>
                    <th className="py-2 pr-3 font-medium">{t("boardColStatus")}</th>
                    <th className="py-2 pr-3 font-medium">{t("boardColStart")}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t("boardColPackages")}</th>
                    <th className="py-2 text-right font-medium">{t("boardColSignal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.workerId} className="border-b border-border/50 last:border-0">
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-2">
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
                      <td className="nums py-2 pr-3 text-right">
                        {r.loadedPackages ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2 text-right">
                        <SignalCell row={r} t={t} ageLabel={ageLabel} />
                      </td>
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
                      <span className="truncate font-medium">{r.name}</span>
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
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate">{children}</dd>
    </div>
  );
}

type TFn = (key: string, values?: Record<string, string | number>) => string;

/** Araç hücresi: atanmış plaka; atanmamışsa uyarı, farklı araç kullanıldıysa not. */
function VehicleCell({ row, t }: { row: TodayRosterRow; t: TFn }) {
  if (!row.plate) {
    return (
      <span className="inline-flex items-center gap-1 text-accent-gold">
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
      {/* Şoför başka araçla açtıysa sessizce düzeltmiyoruz — farkı yazıyoruz. */}
      {row.usedPlate && (
        <span className="nums text-[11px] text-muted-foreground">
          → {row.usedPlate}
        </span>
      )}
    </span>
  );
}

function StatusCell({ row, t }: { row: TodayRosterRow; t: TFn }) {
  if (row.status === "not_started") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-gold">
        <UserX className="size-3.5 shrink-0" aria-hidden />
        {t("boardStatusNotStarted")}
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
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent-claret-text">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        {label}
      </span>
    );
  }
  return <span className="nums text-xs text-muted-foreground">{label}</span>;
}

/** Şerit için sayılar — panoyla AYNI satırlardan türer, ikinci kaynak yok. */
export function rosterCounts(rows: TodayRosterRow[]) {
  let notStarted = 0;
  let inField = 0;
  let closed = 0;
  let loaded = 0;
  let staleVehicles = 0;
  for (const r of rows) {
    const tb = tabOf(r.status);
    if (tb === "not_started") notStarted++;
    else if (tb === "in_field") inField++;
    else closed++;
    if (r.loadedPackages != null) loaded += r.loadedPackages;
    if (r.telemetryStale) staleVehicles++;
  }
  return { total: rows.length, notStarted, inField, closed, loaded, staleVehicles };
}

/**
 * EYLEM ŞERİDİ — eski 4 üst kartın yerine geçen 5 sayı.
 *
 * Hepsi BUGÜNÜ anlatır ve tarih filtresinden BAĞIMSIZDIR; eski kartların en
 * kafa karıştırıcı yanı, yan yana duran kutuların farklı zaman kapsamlarına
 * ait olmasıydı ("Toplam Saat: Bu Hafta" ile "Aktif Vardiya: Bugün").
 *
 * Sayılar panonun kendi satırlarından ve dikkat panosundan türer — ikinci bir
 * hesap kaynağı yok, dolayısıyla ekranın iki yerinde farklı rakam çıkamaz.
 */
export function TodayStrip({
  counts,
  openShifts,
  silentVehicles,
}: {
  counts: ReturnType<typeof rosterCounts>;
  openShifts: number;
  silentVehicles: number;
}) {
  const t = useTranslations("admin");

  const items: {
    key: string;
    label: string;
    value: string;
    urgent: boolean;
    critical?: boolean;
  }[] = [
    {
      key: "field",
      label: t("stripInField"),
      value: `${counts.inField} / ${counts.total}`,
      urgent: false,
    },
    {
      key: "notStarted",
      label: t("stripNotStarted"),
      value: String(counts.notStarted),
      urgent: counts.notStarted > 0,
    },
    {
      key: "open",
      label: t("stripOpenShifts"),
      value: String(openShifts),
      urgent: openShifts > 0,
    },
    {
      key: "silent",
      label: t("stripSilentVehicles"),
      value: String(silentVehicles),
      urgent: false,
      critical: silentVehicles > 0,
    },
    {
      key: "loaded",
      label: t("stripLoaded"),
      value: counts.loaded > 0 ? String(counts.loaded) : "—",
      urgent: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((it) => (
        <Card key={it.key}>
          <CardContent className="px-4 py-3">
            <div
              className={[
                "nums text-2xl font-bold",
                it.critical
                  ? "text-accent-claret-text"
                  : it.urgent
                    ? "text-accent-gold"
                    : "text-foreground",
              ].join(" ")}
            >
              {it.value}
            </div>
            <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              {it.label}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
