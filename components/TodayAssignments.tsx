"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Package, Navigation, Play, Check, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/format";
import { STATUS_STRIPE, routeSummary, directionsUrl } from "@/lib/assignments-ui";
import type { AssignmentWithWorker } from "@/lib/types";
import { startAssignment, completeAssignment } from "@/app/actions/assignments";

type Props = { assignments: AssignmentWithWorker[] };

type KmDialog = { mode: "start" | "complete"; a: AssignmentWithWorker } | null;

export function TodayAssignments({ assignments }: Props) {
  const t = useTranslations("assignments");
  const locale = useLocale();
  const router = useRouter();

  const [dialog, setDialog] = useState<KmDialog>(null);
  const [km, setKm] = useState("");
  const [busy, setBusy] = useState(false);

  // Only show the card when there is at least one active (assigned/started) trip.
  const hasActive = assignments.some(
    (a) => a.status === "assigned" || a.status === "started"
  );
  if (!hasActive) return null;

  function openKm(mode: "start" | "complete", a: AssignmentWithWorker) {
    setKm("");
    setDialog({ mode, a });
  }

  async function confirmKm() {
    if (!dialog) return;
    const value = parseInt(km, 10);
    if (!Number.isFinite(value) || value < 0) {
      toast.error(dialog.mode === "start" ? t("start_km_prompt") : t("end_km_prompt"));
      return;
    }
    setBusy(true);
    try {
      const res =
        dialog.mode === "start"
          ? await startAssignment(dialog.a.id, value)
          : await completeAssignment(dialog.a.id, value);
      if (!res.ok) {
        toast.error(t("no_assignments"));
        return;
      }
      setDialog(null);
      router.refresh();
    } finally {
      setBusy(false);
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
                <Button size="sm" onClick={() => openKm("start", a)}>
                  <Play className="size-4" /> {t("start_button")}
                </Button>
              )}
              {a.status === "started" && (
                <Button size="sm" onClick={() => openKm("complete", a)}>
                  <Check className="size-4" /> {t("complete_button")}
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

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === "start" ? t("start_km_prompt") : t("end_km_prompt")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="assignment_km">
              {dialog?.mode === "start" ? t("start_km_prompt") : t("end_km_prompt")}
            </Label>
            <Input
              id="assignment_km"
              type="number"
              inputMode="numeric"
              min={0}
              value={km}
              autoFocus
              onChange={(e) => setKm(e.target.value)}
              className="h-12"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              {t("cancel")}
            </Button>
            <Button onClick={confirmKm} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {dialog?.mode === "start" ? t("start_button") : t("complete_button")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
