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
  Pencil,
  Package,
} from "lucide-react";
import {
  startShiftAction,
  endShiftAction,
  addBreakMinutesAction,
  startBreakAction,
  updateStartKmAction,
  updatePackageCountAction,
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
import type { TimeEntry, AssignmentWithWorker } from "@/lib/types";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LocationTracker } from "@/components/LocationTracker";
import { LenkzeitWarning } from "@/components/LenkzeitWarning";
import { TelegramLink } from "@/components/TelegramLink";
import { TodayAssignments } from "@/components/TodayAssignments";
import { tryServerAction } from "@/lib/offline-aware";

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

type VehicleOption = { id: string; plate: string; make: string | null; model: string | null };

type Props = {
  active: TimeEntry | null;
  past: TimeEntry[];
  defaultPlate: string;
  vehicles: VehicleOption[];
  telegram: { linked: boolean; username: string | null };
  todayAssignments: AssignmentWithWorker[];
  totals: Totals;
};

export function PanelClient({ active, past, defaultPlate, vehicles, telegram, todayAssignments, totals }: Props) {
  const t = useTranslations("panel");
  const tc = useTranslations("common");
  const tOffline = useTranslations("offline");
  const tAssign = useTranslations("assignments");
  const tMap = useTranslations("map");
  const locale = useLocale();
  const router = useRouter();
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState<string>(
    () =>
      vehicles.find((v) => v.plate.toUpperCase() === defaultPlate.toUpperCase())?.id ??
      vehicles[0]?.id ??
      ""
  );
  const [kmEditOpen, setKmEditOpen] = useState(false);
  const [pkgEditOpen, setPkgEditOpen] = useState(false);
  const [kmVal, setKmVal] = useState("");
  const [pkgVal, setPkgVal] = useState("");
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
      // mark break server-side so vehicle/admin views show "molada" live (best-effort)
      void startBreakAction().catch(() => {});
    } else {
      // end break — flush minutes to DB
      const elapsedMin = Math.max(0, Math.floor((Date.now() - breakStartLocal) / 60_000));
      setBreakStartLocal(null);
      setPendingBreakMinutes((m) => m + elapsedMin);
      if (elapsedMin > 0) {
        startTransition(async () => {
          const r = await tryServerAction(
            "break",
            { minutes: elapsedMin },
            new Date().toISOString(),
            () => addBreakMinutesAction(elapsedMin)
          );
          if (r.queued) {
            toast.warning(tOffline("queued_toast"));
            setPendingBreakMinutes(0);
            return;
          }
          if (r.result.ok) {
            toast.success(t("breakEnded"));
            setPendingBreakMinutes(0);
            router.refresh();
          } else {
            toast.error(r.result.error ?? "Error");
          }
        });
      } else {
        toast.success(t("breakEnded"));
      }
    }
  }

  function handleStart(formData: FormData) {
    // Required: vehicle (or plate fallback) + start km. Server re-validates.
    const vid = String(formData.get("vehicle_id") ?? "").trim();
    const plate = String(formData.get("plate") ?? "").trim();
    const skm = String(formData.get("start_km") ?? "").trim();
    if (!vid && !plate) {
      toast.error(t("selectVehicleErr"));
      return;
    }
    if (skm === "") {
      toast.error(t("startKmErr"));
      return;
    }
    const payload = {
      start_km: formData.get("start_km"),
      plate: formData.get("plate") || null,
      expected_cargo: formData.get("expected_cargo") || null,
      vehicle_id: formData.get("vehicle_id") || null,
    };
    startTransition(async () => {
      const r = await tryServerAction(
        "start",
        payload,
        new Date().toISOString(),
        () => startShiftAction(formData)
      );
      if (r.queued) {
        toast.warning(tOffline("queued_toast"));
        setStartOpen(false);
        return;
      }
      if (r.result.ok) {
        toast.success(t("shiftStarted"));
        setStartOpen(false);
        router.refresh();
      } else {
        toast.error(mapErr(r.result.error));
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
    const payload = {
      end_km: formData.get("end_km"),
      plate: formData.get("plate") || null,
      notes: formData.get("notes") || null,
      break_minutes: formData.get("break_minutes") || null,
      cargo_count: formData.get("cargo_count") || null,
      undelivered_count: formData.get("undelivered_count") || null,
    };
    startTransition(async () => {
      const r = await tryServerAction(
        "end",
        payload,
        new Date().toISOString(),
        () => endShiftAction(formData)
      );
      if (r.queued) {
        toast.warning(tOffline("queued_toast"));
        setEndOpen(false);
        return;
      }
      if (r.result.ok) {
        toast.success(t("shiftEnded"));
        setEndOpen(false);
        router.refresh();
      } else {
        toast.error(mapErr(r.result.error));
      }
    });
  }

  function mapErr(e?: string): string {
    if (!e) return "Error";
    if (e === "active") return t("errActive");
    if (e === "no_active") return t("errNoActive");
    if (e === "vehicle_required") return t("selectVehicleErr");
    if (e === "start_km_required" || e === "errKmNeg") return t("startKmErr");
    if (e.startsWith("km_low:")) {
      const [, end, start] = e.split(":");
      return t("errKmLow", { end, start });
    }
    return e;
  }

  function openKmEdit() {
    setKmVal(active ? String(active.start_km) : "");
    setKmEditOpen(true);
  }
  function saveKm() {
    const v = Number(kmVal);
    if (!Number.isFinite(v) || v < 0) {
      toast.error(t("startKmErr"));
      return;
    }
    startTransition(async () => {
      const r = await updateStartKmAction(v);
      if (r.ok) {
        toast.success(t("startKmSaved"));
        setKmEditOpen(false);
        router.refresh();
      } else toast.error(mapErr(r.error));
    });
  }

  function openPkgEdit() {
    setPkgVal(active?.start_package_count != null ? String(active.start_package_count) : "");
    setPkgEditOpen(true);
  }
  function savePkg() {
    const raw = pkgVal.trim();
    const v = raw === "" ? null : Number(raw);
    if (v !== null && (!Number.isFinite(v) || v < 0)) {
      toast.error(t("packages"));
      return;
    }
    startTransition(async () => {
      const r = await updatePackageCountAction(v);
      if (r.ok) {
        toast.success(t("packagesSaved"));
        setPkgEditOpen(false);
        router.refresh();
      } else toast.error(mapErr(r.error));
    });
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

                {/* Driver self-edit: start km (open shift only) + package count */}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openKmEdit}
                    disabled={pending}
                    className="gap-1.5"
                  >
                    <Pencil className="size-3.5" />
                    {t("editStartKm")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openPkgEdit}
                    disabled={pending}
                    className="gap-1.5"
                  >
                    <Package className="size-3.5" />
                    {t("packages")}:{" "}
                    <span className="nums font-medium">
                      {active.start_package_count ?? "—"}
                    </span>
                  </Button>
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
                <LocationTracker shiftId={active.id} />
                <LenkzeitWarning
                  timeEntryId={active.id}
                  startedAt={active.started_at}
                  isOnBreak={onBreak}
                  breakMinutes={totalBreakSoFar}
                  onStartBreak={() => {
                    if (!onBreak) toggleBreak();
                  }}
                />
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

      <TodayAssignments assignments={todayAssignments} />

      <div className="flex justify-center">
        <Link
          href="/panel/seferler"
          className="text-sm font-medium text-primary hover:underline flex items-center gap-1"
        >
          {tAssign("see_all")} <ArrowRight className="size-3" />
        </Link>
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

      <TelegramLink linked={telegram.linked} username={telegram.username} />

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
              <Label htmlFor="vehicle">{tMap("vehicle_select")}</Label>
              {vehicles.length > 0 ? (
                <>
                  <input type="hidden" name="vehicle_id" value={vehicleId} />
                  <Select value={vehicleId} onValueChange={(v) => v && setVehicleId(v)}>
                    <SelectTrigger id="vehicle" className="h-12 w-full">
                      <SelectValue>
                        {((val: unknown) => {
                          const v = vehicles.find((x) => x.id === String(val));
                          return v
                            ? `${v.plate}${v.make || v.model ? ` — ${[v.make, v.model].filter(Boolean).join(" ")}` : ""}`
                            : tMap("vehicle_select_hint");
                        }) as never}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {vehicles.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          <span className="nums font-medium uppercase">{v.plate}</span>
                          {(v.make || v.model) && (
                            <span className="text-muted-foreground">
                              {" "}
                              {[v.make, v.model].filter(Boolean).join(" ")}
                            </span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : (
                <Input
                  id="plate"
                  name="plate"
                  defaultValue={defaultPlate}
                  className="h-12 nums uppercase"
                  placeholder={t("plate")}
                />
              )}
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
            <div className="grid grid-cols-2 gap-3">
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
                <Label htmlFor="undelivered_count">{t("cargoUndelivered")}</Label>
                <Input
                  id="undelivered_count"
                  name="undelivered_count"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  defaultValue={active?.undelivered_count ?? ""}
                  className="h-12"
                />
              </div>
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

      {/* Driver: correct start km of the OPEN shift */}
      <Dialog open={kmEditOpen} onOpenChange={setKmEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editStartKm")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="edit_start_km">{t("startKm")}</Label>
            <Input
              id="edit_start_km"
              type="number"
              inputMode="numeric"
              min={0}
              value={kmVal}
              onChange={(e) => setKmVal(e.target.value)}
              className="h-12 nums"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKmEditOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={saveKm} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Driver: enter/update start-of-day package count on the OPEN shift */}
      <Dialog open={pkgEditOpen} onOpenChange={setPkgEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editPackages")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="edit_pkg">{t("packages")}</Label>
            <Input
              id="edit_pkg"
              type="number"
              inputMode="numeric"
              min={0}
              value={pkgVal}
              onChange={(e) => setPkgVal(e.target.value)}
              placeholder={t("packagesHint")}
              className="h-12 nums"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPkgEditOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={savePkg} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tc("save")}
            </Button>
          </DialogFooter>
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
