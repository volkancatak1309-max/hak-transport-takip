"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { TrendingUp, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserAvatar } from "@/components/UserAvatar";
import { formatDurationShort } from "@/lib/format";
import type { DriverPerf } from "@/lib/admin-dashboard";

type SortKey = "km" | "ms" | "delivered" | "shifts";

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
  const [sort, setSort] = useState<SortKey>("km");

  const rangeLabel =
    range === "week"
      ? t("rangeWeek")
      : range === "month"
      ? t("rangeMonth")
      : range === "custom"
      ? t("rangeCustom")
      : t("rangeToday");

  const rows = [...performance].sort((a, b) => b[sort] - a[sort]);

  const cols: { key: SortKey; label: string }[] = [
    { key: "km", label: t("dash.perf_km") },
    { key: "ms", label: t("dash.perf_hours") },
    { key: "delivered", label: t("dash.perf_delivered") },
    { key: "shifts", label: t("dash.perf_shifts") },
  ];

  function cellValue(r: DriverPerf, key: SortKey): string {
    if (key === "km") return r.km.toLocaleString(nf);
    if (key === "ms") return formatDurationShort(r.ms, locale);
    if (key === "delivered") return r.delivered.toLocaleString(nf);
    return r.shifts.toLocaleString(nf);
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
                      <button
                        type="button"
                        onClick={() => setSort(c.key)}
                        className={`ml-auto inline-flex items-center gap-1 transition-colors hover:text-foreground ${
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
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.worker_id}
                    className="border-b border-border/50 transition-colors last:border-0 hover:bg-surface-2/50"
                  >
                    <td className="py-2 pr-2 text-left">
                      <span
                        className={`nums text-xs font-semibold ${
                          i === 0 ? "text-accent-sky" : "text-muted-foreground"
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
                    {cols.map((c) => (
                      <td
                        key={c.key}
                        className={`nums py-2 pl-2 text-right tabular-nums ${
                          sort === c.key ? "font-semibold text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {cellValue(r, c.key)}
                      </td>
                    ))}
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
