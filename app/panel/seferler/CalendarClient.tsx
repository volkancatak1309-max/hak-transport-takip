"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatTime, viennaDayKey } from "@/lib/format";
import { STATUS_STRIPE, STATUS_BADGE, routeSummary } from "@/lib/assignments-ui";
import type { AssignmentWithWorker } from "@/lib/types";

type Props = { assignments: AssignmentWithWorker[] };

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export function CalendarClient({ assignments }: Props) {
  const t = useTranslations("assignments");
  const locale = useLocale();
  const tag = locale === "de" ? "de-AT" : "tr-TR";

  const today = new Date();
  const todayKey = viennaDayKey(today);

  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [selected, setSelected] = useState(todayKey);

  // Group assignments by Vienna day key.
  const byDay = useMemo(() => {
    const map = new Map<string, AssignmentWithWorker[]>();
    for (const a of assignments) {
      const k = viennaDayKey(a.scheduled_at);
      const arr = map.get(k) ?? [];
      arr.push(a);
      map.set(k, arr);
    }
    return map;
  }, [assignments]);

  const firstDow = (new Date(view.y, view.m, 1).getDay() + 6) % 7; // Mon = 0
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();

  const weekdays = useMemo(() => {
    // Monday-first short weekday labels.
    const base = new Date(2024, 0, 1); // a Monday
    return Array.from({ length: 7 }, (_, i) =>
      new Intl.DateTimeFormat(tag, { weekday: "short" }).format(
        new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)
      )
    );
  }, [tag]);

  const monthLabel = new Intl.DateTimeFormat(tag, {
    month: "long",
    year: "numeric",
  }).format(new Date(view.y, view.m, 1));

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  const selectedList = byDay.get(selected) ?? [];

  return (
    <div className="space-y-4">
      {/* Month header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={() => shiftMonth(-1)} aria-label="prev">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="font-semibold capitalize">{monthLabel}</span>
        <Button variant="ghost" size="icon" onClick={() => shiftMonth(1)} aria-label="next">
          <ChevronRight className="size-5" />
        </Button>
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {weekdays.map((w) => (
          <div key={w} className="py-1 text-xs font-medium text-muted-foreground">
            {w}
          </div>
        ))}
        {Array.from({ length: firstDow }).map((_, i) => (
          <div key={`b${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const k = keyOf(view.y, view.m, day);
          const count = byDay.get(k)?.length ?? 0;
          const isToday = k === todayKey;
          const isSel = k === selected;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setSelected(k)}
              className={cn(
                "flex aspect-square flex-col items-center justify-center rounded-md border text-sm",
                isSel
                  ? "border-primary bg-primary text-primary-foreground"
                  : isToday
                  ? "border-primary/50 bg-primary/5"
                  : "border-transparent hover:bg-muted"
              )}
            >
              <span className={cn(isToday && !isSel && "font-bold text-primary")}>{day}</span>
              {count > 0 && (
                <span
                  className={cn(
                    "mt-0.5 size-1.5 rounded-full",
                    isSel ? "bg-primary-foreground" : "bg-primary"
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Selected day list */}
      <div className="space-y-2">
        {selectedList.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("no_today")}
          </p>
        ) : (
          selectedList.map((a) => (
            <Card key={a.id} className={cn("border-l-[3px]", STATUS_STRIPE[a.status])}>
              <CardContent className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold nums">{formatTime(a.scheduled_at, locale)}</span>
                  <Badge variant="outline">{t(`category.${a.category}`)}</Badge>
                  <Badge variant={STATUS_BADGE[a.status]}>{t(`status.${a.status}`)}</Badge>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Package className="size-3.5" /> {a.package_count ?? 0}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{routeSummary(a.stops)}</p>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
