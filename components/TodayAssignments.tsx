"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Package, Navigation, Play, Check, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/format";
import { STATUS_STRIPE, routeSummary, directionsUrl } from "@/lib/assignments-ui";
import type { AssignmentWithWorker } from "@/lib/types";
import { startAssignment, completeAssignment } from "@/app/actions/assignments";

type Props = { assignments: AssignmentWithWorker[] };

export function TodayAssignments({ assignments }: Props) {
  const t = useTranslations("assignments");
  const locale = useLocale();
  const router = useRouter();

  // Hangi seferin isteği uçuyor — buton başına kilitlenir (tek `busy` bayrağı
  // olsaydı bir sefer başlatılırken diğerlerinin butonu da donardı).
  const [busyId, setBusyId] = useState<string | null>(null);

  // Only show the card when there is at least one active (assigned/started) trip.
  const hasActive = assignments.some(
    (a) => a.status === "assigned" || a.status === "started"
  );
  if (!hasActive) return null;

  /**
   * Sefer başlat/bitir — SAYAÇ SORULMADAN (21.07.2026). Eskiden her iki eylem de
   * şoföre odometre sorup `assignments.start_km/end_km`'e yazıyordu; şoför artık
   * hiçbir yerde sayaç girmiyor, kilometre araç telemetrisinden geliyor.
   */
  async function run(mode: "start" | "complete", a: AssignmentWithWorker) {
    setBusyId(a.id);
    try {
      const res =
        mode === "start"
          ? await startAssignment(a.id)
          : await completeAssignment(a.id);
      if (!res.ok) {
        toast.error(t("no_assignments"));
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  function openDirections(a: AssignmentWithWorker) {
    window.open(directionsUrl(a.stops), "_blank", "noopener,noreferrer");
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          📦 {t("today_assignments")} ({assignments.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {assignments.map((a) => (
          <div
            key={a.id}
            className={cn(
              "rounded-md border border-l-[3px] p-3",
              STATUS_STRIPE[a.status]
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold nums">{formatTime(a.scheduled_at, locale)}</span>
              <Badge variant="outline">{t(`category.${a.category}`)}</Badge>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Package className="size-3.5" /> {a.package_count ?? 0}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{routeSummary(a.stops)}</p>

            <div className="mt-2 flex flex-wrap gap-2">
              {a.status === "assigned" && (
                <Button
                  size="sm"
                  onClick={() => run("start", a)}
                  disabled={busyId === a.id}
                >
                  {busyId === a.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  {t("start_button")}
                </Button>
              )}
              {a.status === "started" && (
                <Button
                  size="sm"
                  onClick={() => run("complete", a)}
                  disabled={busyId === a.id}
                >
                  {busyId === a.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  {t("complete_button")}
                </Button>
              )}
              {a.status === "completed" && (
                <Button size="sm" variant="outline" disabled>
                  <Check className="size-4" /> {t("status.completed")}
                </Button>
              )}
              {a.status !== "completed" && (
                <Button size="sm" variant="outline" onClick={() => openDirections(a)}>
                  <Navigation className="size-4" /> {t("directions_button")}
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
