"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { TrendingUp, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserAvatar } from "@/components/UserAvatar";
import { formatDurationShort } from "@/lib/format";
import type { DriverPerf } from "@/lib/admin-dashboard";

type SortKey = "km" | "ms" | "delivered" | "shifts" | "rate" | "azg" | "score";

export function DriverPerformance({
  performance,
  range,
}: {
  performance: DriverPerf[];
  range: string;
}) {
  const t = useTranslations("admin");
  const locale = useLocale();
  const nf = locale === "de" ? "de-AT" : "tr-TR";
  const [sort, setSort] = useState<SortKey>("score");

  const rangeLabel =
    range === "week"
      ? t("rangeWeek")
      : range === "month"
      ? t("rangeMonth")
      : range === "custom"
      ? t("rangeCustom")
      : t("rangeToday");

  // Delivery success rate: delivered / (delivered + undelivered). No package
  // data at all → null (shown as "—", treated as neutral when sorting).
  const rateOf = (r: DriverPerf): number | null => {
    const handled = r.delivered + r.undelivered;
    return handled > 0 ? r.delivered / handled : null;
  };
  const pct = (v: number) =>
    locale === "de" ? `${Math.round(v * 100)} %` : `%${Math.round(v * 100)}`;

  const sortVal = (r: DriverPerf, key: SortKey): number => {
    switch (key) {
      case "km":
        return r.km;
      case "ms":
        return r.ms;
      case "delivered":
        return r.delivered;
      case "shifts":
        return r.shifts;
      case "rate":
        // Veri yok → EN ALTA (22.07.2026). Eskiden `?? 1` idi: paket verisi
        // olmayan şoför "%100" gibi sıralanıp listenin başına çıkıyordu.
        return rateOf(r) ?? -1;
      case "azg":
        return r.azgViol * 1000 + r.azgWarn; // most issues first
      case "score":
        return r.score;
    }
  };

  const rows = [...performance].sort((a, b) => sortVal(b, sort) - sortVal(a, sort));

  // Ranked-bar (Reveal Harsh Driving tile deseni — REVEAL-GAP §3.7): her satırın
  // arkasında, o an sıralanan metriğe göre oransal dolgu. Düz tabloyu görsel
  // karşılaştırmalı sıralamaya çevirir ("koyu temaya boyanmış tablo" itirazı).
  const maxVal = Math.max(1, ...rows.map((r) => Math.abs(sortVal(r, sort))));
  const barColor =
    sort === "azg"
      ? "var(--status-critical)"
      : sort === "score"
      ? "var(--accent-sky)"
      : "var(--accent-sky)";
  const rowBg = (r: DriverPerf): string => {
    const pct = Math.round((Math.abs(sortVal(r, sort)) / maxVal) * 100);
    return `linear-gradient(90deg, color-mix(in srgb, ${barColor} 14%, transparent) ${pct}%, transparent ${pct}%)`;
  };

  const cols: { key: SortKey; label: string }[] = [
    { key: "km", label: t("dash.perf_km") },
    { key: "ms", label: t("dash.perf_hours") },
    { key: "delivered", label: t("dash.perf_delivered") },
    { key: "rate", label: t("dash.perf_rate") },
    { key: "azg", label: t("dash.perf_azg") },
    { key: "shifts", label: t("dash.perf_shifts") },
    { key: "score", label: t("dash.perf_score") },
  ];

  function renderCell(r: DriverPerf, key: SortKey) {
    const active = sort === key;
    const base = "nums py-2 pl-2 text-right tabular-nums";

    if (key === "score") {
      const tone =
        r.score >= 80
          ? "text-accent-sky-text"
          : r.score >= 50
          ? "text-accent-gold-text"
          : "text-accent-claret-text";
      return (
        <td key={key} className={`${base} font-semibold ${tone}`}>
          {r.score}
        </td>
      );
    }
    if (key === "azg") {
      const tone =
        r.azgViol > 0
          ? "text-accent-claret-text"
          : r.azgWarn > 0
          ? "text-accent-gold-text"
          : "text-muted-foreground";
      return (
        <td
          key={key}
          className={`${base} ${active ? "font-semibold" : ""} ${tone}`}
          title={`${r.azgWarn} ${t("dash.perf_azg_warn")}`}
        >
          {r.azgViol}
        </td>
      );
    }

    let text: string;
    if (key === "km") text = r.km.toLocaleString(nf);
    else if (key === "ms") text = formatDurationShort(r.ms, locale);
    else if (key === "delivered") text = r.delivered.toLocaleString(nf);
    else if (key === "shifts") text = r.shifts.toLocaleString(nf);
    else {
      const rt = rateOf(r);
      text = rt === null ? "—" : pct(rt);
    }
    return (
      <td
        key={key}
        className={`${base} ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}
      >
        {text}
      </td>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp className="size-4 text-muted-foreground" />
            {t("dash.perf_title")}
          </CardTitle>
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
            {rangeLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t("dash.perf_empty")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
                  <th className="w-8 py-2 pr-2 text-left font-medium">#</th>
                  <th className="py-2 pr-2 text-left font-medium">{t("dash.perf_driver")}</th>
                  {cols.map((c) => (
                    <th key={c.key} className="py-2 pl-2 text-right font-medium">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setSort(c.key)}
                          className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${
                            sort === c.key ? "text-foreground" : ""
                          }`}
                        >
                          {c.label}
                          <ChevronDown
                            className={`size-3 transition-opacity ${
                              sort === c.key ? "opacity-100" : "opacity-0"
                            }`}
                          />
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.worker_id}
                    className="border-b border-border/50 transition-colors last:border-0 hover:bg-surface-2/50"
                    style={{ backgroundImage: rowBg(r) }}
                  >
                    <td className="py-2 pr-2 text-left">
                      <span
                        className={`nums text-xs font-semibold ${
                          i === 0 ? "text-accent-sky-text" : "text-muted-foreground"
                        }`}
                      >
                        {i + 1}
                      </span>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-2">
                        <UserAvatar name={r.name} size="xs" />
                        <span className="truncate font-medium">{r.name}</span>
                      </div>
                    </td>
                    {cols.map((c) => renderCell(r, c.key))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
