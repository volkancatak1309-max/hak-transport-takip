"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Play,
  Square,
  Pause,
  PlayCircle,
  Loader2,
  Clock,
  Calendar,
  ArrowRight,
} from "lucide-react";
import {
  startShiftAction,
  endShiftAction,
  addBreakMinutesAction,
} from "../actions/shift";
import {
  formatDuration,
  formatDurationShort,
  formatDateTime,
  formatDate,
  formatTime,
  workedMs,
  kmDiff,
  rawDurationMs,
} from "@/lib/format";
import type { TimeEntry } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Totals = {
  todayMs: number;
  todayKm: number;
  todayCargo: number;
  weekMs: number;
  weekKm: number;
  weekDays: number;
  avgDailyMs: number;
  shiftCount: number;
};

type Props = {
  active: TimeEntry | null;
  past: TimeEntry[];
  defaultPlate: string;
  totals: Totals;
};

export function PanelClient({ active, past, defaultPlate, totals }: Props) {
  const t = useTranslations("panel");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());

  // local break state — accumulates locally, flushed to DB when toggled off or shift ends
  const [breakStartLocal, setBreakStartLocal] = useState<number | null>(null);
  const [pendingBreakMinutes, setPendingBreakMinutes] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  // reset local break state when active shift goes away
  useEffect(() => {
    if (!active) {
      setBreakStartLocal(null);
      setPendingBreakMinutes(0);
    }
  }, [active?.id]);

  const totalBreakSoFar =
    (active?.break_minutes ?? 0) +
    pendingBreakMinutes +
    (breakStartLocal !== null ? Math.floor((now - breakStartLocal) / 60_000) : 0);

  const workedMsLive = active
    ? workedMs({
        started_at: active.started_at,
        ended_at: null,
        break_minutes: totalBreakSoFar,
      }, now)
    : 0;

  function toggleBreak() {
    if (breakStartLocal === null) {
      // start break
      setBreakStartLocal(Date.now());
      toast.info(t("breakStarted"));
    } else {
      // end break — flush minutes to DB
      const elapsedMin = Math.max(0, Math.floor((Date.now() - breakStartLocal) / 60_000));
      setBreakStartLocal(null);
      setPendingBreakMinutes((m) => m + elapsedMin);
      if (elapsedMin > 0) {
        startTransition(async () => {
          const res = await addBreakMinutesAction(elapsedMin);
          if (res.ok) {
            toast.success(t("breakEnded"));
            setPendingBreakMinutes(0);
            router.refresh();
          } else {
            toast.error(res.error ?? "Error");
          }
        });
      } else {
        toast.success(t("breakEnded"));
      }
    }
  }

  function handleStart(formData: FormData) {
    startTransition(async () => {
      const res = await startShiftAction(formData);
      if (res.ok) {
        toast.success(t("shiftStarted"));
        setStartOpen(false);
        router.refresh();
      } else {
        toast.error(mapErr(res.error));
      }
    });
  }

  function handleEnd(formData: FormData) {
    // ensure any active break is closed and counted
    if (breakStartLocal !== null) {
      const elapsedMin = Math.max(0, Math.floor((Date.now() - breakStartLocal) / 60_000));
      const currentBreakField = Number(formData.get("break_minutes") ?? 0);
      formData.set("break_minutes", String(currentBreakField + elapsedMin));
      setBreakStartLocal(null);
    }
    startTransition(async () => {
      const res = await endShiftAction(formData);
      if (res.ok) {
        toast.success(t("shiftEnded"));
        setEndOpen(false);
        router.refresh();
      } else {
        toast.error(mapErr(res.error));
      }
    });
  }

  function mapErr(e?: string): string {
    if (!e) return "Error";
    if (e === "active") return t("errActive");
    if (e === "no_active") return t("errNoActive");
    if (e.startsWith("km_low:")) {
      const [, end, start] = e.split(":");
      return t("errKmLow", { end, start });
    }
    return e;
  }

  const onBreak = breakStartLocal !== null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {/* Active Shift card */}
        <Card
          className={`md:col-span-2 ${
            active ? "border-primary/40" : ""
          }`}
        >
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="size-4" />
              {active ? t("activeShift") : t("noActive")}
            </CardTitle>
            {active && (
              <Badge variant={onBreak ? "secondary" : "default"} className="text-xs">
                {onBreak ? t("onBreak") : t("activeShift")}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {active ? (
              <>
                <div className="text-center py-2">
                  <div
                    className={`nums text-5xl sm:text-6xl font-bold ${
                      onBreak ? "text-muted-foreground" : "text-primary"
                    }`}
                  >
                    {formatDuration(workedMsLive)}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-xs text-muted-foreground">
                    <div>
                      <div className="uppercase tracking-wide">{t("started")}</div>
                      <div className="nums font-medium text-foreground mt-0.5">
                        {formatTime(active.started_at, locale)}
                      </div>
                    </div>
                    <div>
                      <div className="uppercase tracking-wide">{t("startKm")}</div>
                      <div className="nums font-medium text-foreground mt-0.5">
                        {active.start_km.toLocaleString(locale === "de" ? "de-AT" : "tr-TR")}
                      </div>
                    </div>
                    <div>
                      <div className="uppercase tracking-wide">{t("tblBreak")}</div>
                      <div className="nums font-medium text-foreground mt-0.5">
                        {totalBreakSoFar} {locale === "de" ? "Min" : "dk"}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    onClick={toggleBreak}
                    variant={onBreak ? "default" : "outline"}
                    size="lg"
                    className="flex-1 h-12"
                    disabled={pending}
                  >
                    {onBreak ? (
                      <>
                        <PlayCircle className="size-4" />
                        {t("endBreak")}
                      </>
                    ) : (
                      <>
                        <Pause className="size-4" />
                        {t("startBreak")}
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => setEndOpen(true)}
                    variant="destructive"
                    size="lg"
                    className="flex-1 h-12"
                    disabled={pending}
                  >
                    <Square className="size-4" />
                    {t("endShift")}
                  </Button>
                </div>
              </>
            ) : (
              <div className="py-6 text-center space-y-3">
                <p className="text-sm text-muted-foreground">{t("noActive")}</p>
                <Button
                  onClick={() => setStartOpen(true)}
                  size="lg"
                  className="w-full h-14 text-base"
                  disabled={pending}
                >
                  <Play className="size-5" />
                  {t("startShift")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Today summary */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="size-4" />
              {t("today")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <SummaryLine
              label={t("workedHours")}
              value={formatDurationShort(totals.todayMs, locale)}
            />
            <SummaryLine
              label={t("totalKm")}
              value={totals.todayKm.toLocaleString(locale === "de" ? "de-AT" : "tr-TR")}
            />
            <SummaryLine
              label={t("cargoCount")}
              value={String(totals.todayCargo)}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("thisWeek")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label={t("workedHours")} value={formatDurationShort(totals.weekMs, locale)} />
            <Stat
              label={t("totalKm")}
              value={totals.weekKm.toLocaleString(locale === "de" ? "de-AT" : "tr-TR")}
            />
            <Stat
              label={t("avgDaily")}
              value={formatDurationShort(totals.avgDailyMs, locale)}
            />
            <Stat label={t("shiftCount")} value={String(totals.shiftCount)} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t("recent")}
          </CardTitle>
          <Link
            href="/panel/gecmis"
            className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
          >
            {t("viewAll")} <ArrowRight className="size-3" />
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {past.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {t("noHistory")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("tblDate")}</TableHead>
                    <TableHead>{t("tblStart")}</TableHead>
                    <TableHead>{t("tblEnd")}</TableHead>
                    <TableHead>{t("tblWorked")}</TableHead>
                    <TableHead>{t("tblBreak")}</TableHead>
                    <TableHead>{t("tblKm")}</TableHead>
                    <TableHead>{t("tblCargo")}</TableHead>
                    <TableHead>{t("tblPlate")}</TableHead>
                    <TableHead>{t("tblNote")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {past.map((e) => {
                    const w = workedMs(e);
                    const km = kmDiff(e);
                    return (
                      <TableRow key={e.id}>
                        <TableCell>{formatDate(e.started_at, locale)}</TableCell>
                        <TableCell className="nums">{formatTime(e.started_at, locale)}</TableCell>
                        <TableCell className="nums">{formatTime(e.ended_at, locale)}</TableCell>
                        <TableCell>{formatDurationShort(w, locale)}</TableCell>
                        <TableCell className="nums">{e.break_minutes ?? 0}</TableCell>
                        <TableCell className="nums">
                          {km !== null ? km.toLocaleString(locale === "de" ? "de-AT" : "tr-TR") : "—"}
                        </TableCell>
                        <TableCell className="nums">{e.cargo_count ?? "—"}</TableCell>
                        <TableCell className="nums">{e.plate ?? "—"}</TableCell>
                        <TableCell className="max-w-[200px] truncate" title={e.notes ?? ""}>
                          {e.notes ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={startOpen} onOpenChange={setStartOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("startShift")}</DialogTitle>
            <DialogDescription>{tc("save")}</DialogDescription>
          </DialogHeader>
          <form action={handleStart} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="start_km">{t("startKm")}</Label>
              <Input
                id="start_km"
                name="start_km"
                type="number"
                inputMode="numeric"
                min={0}
                required
                autoFocus
                className="h-12"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plate">{t("plate")}</Label>
              <Input
                id="plate"
                name="plate"
                defaultValue={defaultPlate}
                className="h-12 nums uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expected_cargo">{t("expectedCargo")}</Label>
              <Input
                id="expected_cargo"
                name="expected_cargo"
                type="number"
                inputMode="numeric"
                min={0}
                className="h-12"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStartOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                {pending ? tc("saving") : t("startShift")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={endOpen} onOpenChange={setEndOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("endShift")}</DialogTitle>
            <DialogDescription>
              {active && formatDateTime(active.started_at, locale)}
            </DialogDescription>
          </DialogHeader>
          <form action={handleEnd} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="end_km">{t("endKm")}</Label>
              <Input
                id="end_km"
                name="end_km"
                type="number"
                inputMode="numeric"
                min={active?.start_km ?? 0}
                required
                autoFocus
                className="h-12"
              />
              {active && (
                <p className="text-xs text-muted-foreground">
                  {t("startKm")}: {active.start_km.toLocaleString(locale === "de" ? "de-AT" : "tr-TR")}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cargo_count">{t("cargoDelivered")}</Label>
              <Input
                id="cargo_count"
                name="cargo_count"
                type="number"
                inputMode="numeric"
                min={0}
                defaultValue={active?.cargo_count ?? ""}
                className="h-12"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="break_minutes">{t("breakMinutes")}</Label>
              <Input
                id="break_minutes"
                name="break_minutes"
                type="number"
                inputMode="numeric"
                min={0}
                max={1440}
                defaultValue={totalBreakSoFar}
                className="h-12"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plate_end">{t("plate")}</Label>
              <Input
                id="plate_end"
                name="plate"
                defaultValue={active?.plate ?? defaultPlate}
                className="h-12 nums uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">{t("notes")}</Label>
              <Textarea
                id="notes"
                name="notes"
                rows={3}
                maxLength={500}
                placeholder={t("notesPlaceholder")}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEndOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                {pending ? tc("saving") : t("endShift")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="nums text-base font-semibold">{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="nums text-xl font-semibold mt-0.5">{value}</div>
    </div>
  );
}
