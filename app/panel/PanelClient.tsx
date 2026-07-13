"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  KeyRound,
  Loader2,
  Package,
  PackagePlus,
  Pause,
  Pencil,
  PlayCircle,
  Square,
} from "lucide-react";
import {
  endShiftAction,
  addBreakMinutesAction,
  startBreakAction,
  updateStartKmAction,
} from "../actions/shift";
import { addPackageAction, undoPackageAction } from "../actions/driver-panel";
import { formatDuration, formatTime, workedMs } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { LocationTracker } from "@/components/LocationTracker";
import { LenkzeitWarning } from "@/components/LenkzeitWarning";
import { TelegramLink } from "@/components/TelegramLink";
import { tryServerAction } from "@/lib/offline-aware";
import { ConfirmShiftCard } from "./ConfirmShiftCard";
import { ShiftSummaryCard } from "./ShiftSummaryCard";
import { ShiftPhotoButton } from "./ShiftPhotoButton";
import { ProblemReportDialog } from "./ProblemReportDialog";
import { getGeoFix } from "./geo";

/**
 * Şoför Paneli v2 (Faz 1) — eğitimsiz, telefonla çalışan şoförler için:
 * dev butonlar, minimum okuma, sıfır karmaşa.
 *
 * Ekran öncelik sırası:
 *  1. İmzasız vardiya özeti varsa → tam ekran özet + yeşil ONAYLA (İş 3).
 *  2. Aktif vardiya "onay bekliyor" ise → tam ekran VARDİYAYI ONAYLA (İş 1).
 *  3. Aktif vardiya → süre sayacı + bugünkü paket + 3 dev buton (İş 2).
 *  4. Vardiya yok → "kontak açılınca otomatik başlar" bekleme ekranı.
 */

type Totals = {
  todayClosedPackages: number;
  weekMs: number;
  weekKm: number;
  weekShifts: number;
};

type AssignedVehicle = {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
};

type Props = {
  active: TimeEntry | null;
  pendingSummary: TimeEntry | null;
  telegram: { linked: boolean; username: string | null };
  todayAssignmentCount: number;
  totals: Totals;
  assignedVehicle: AssignedVehicle | null;
};

export function PanelClient({
  active,
  pendingSummary,
  telegram,
  todayAssignmentCount,
  totals,
  assignedVehicle,
}: Props) {
  const t = useTranslations("panel");
  const tc = useTranslations("common");
  const tOffline = useTranslations("offline");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Otomatik başlayan/biten vardiyalar sunucuda oluşur — panel 30 sn'de bir
  // tazelenir ki onay kartı/özet şoförün karşısına kendiliğinden çıksın.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(id);
  }, [router]);

  // Tam ekran katmanların "Daha sonra" durumu (oturum-yerel; sunucu durumu
  // değişmediği sürece bir sonraki girişte tekrar çıkarlar).
  const [confirmLater, setConfirmLater] = useState(false);
  const [summaryLater, setSummaryLater] = useState(false);

  const [endOpen, setEndOpen] = useState(false);
  const [problemOpen, setProblemOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [kmEditOpen, setKmEditOpen] = useState(false);
  const [kmVal, setKmVal] = useState("");

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  // Mola — v1 ile aynı yerel-önce mantık: yerelde biriktir, kapatınca DB'ye yaz.
  const [breakStartLocal, setBreakStartLocal] = useState<number | null>(null);
  const [pendingBreakMinutes, setPendingBreakMinutes] = useState(0);
  const activeId = active?.id ?? null;
  useEffect(() => {
    if (!activeId) {
      setBreakStartLocal(null);
      setPendingBreakMinutes(0);
      setConfirmLater(false);
    }
  }, [activeId]);

  // Paket sayacı: sunucu değeriyle başlar, dokunuşta iyimser artar,
  // her router.refresh'te sunucuyla eşitlenir.
  const [pkgCount, setPkgCount] = useState(active?.cargo_count ?? 0);
  useEffect(() => {
    setPkgCount(active?.cargo_count ?? 0);
  }, [activeId, active?.cargo_count]);

  const totalBreakSoFar =
    (active?.break_minutes ?? 0) +
    pendingBreakMinutes +
    (breakStartLocal !== null ? Math.floor((now - breakStartLocal) / 60_000) : 0);

  const workedMsLive = active
    ? workedMs(
        {
          started_at: active.started_at,
          ended_at: null,
          break_minutes: totalBreakSoFar,
        },
        now
      )
    : 0;

  const onBreak = breakStartLocal !== null;
  const todayPackages = totals.todayClosedPackages + pkgCount;

  function toggleBreak() {
    if (breakStartLocal === null) {
      setBreakStartLocal(Date.now());
      toast.info(t("breakStarted"));
      void startBreakAction().catch(() => {});
    } else {
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

  // İş 2 — "+1 PAKET": iyimser sayaç + GPS + 5 sn "Geri Al" tostu.
  async function handleAddPackage() {
    const clientTime = new Date().toISOString();
    setPkgCount((c) => c + 1);
    const fix = await getGeoFix();
    const r = await tryServerAction(
      "package",
      { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy },
      clientTime,
      () => addPackageAction({ ...fix, clientTime })
    );
    if (r.queued) {
      toast.warning(tOffline("queued_toast"));
      return;
    }
    if (!r.result.ok) {
      setPkgCount((c) => Math.max(0, c - 1));
      toast.error(t("v2PkgErr"));
      return;
    }
    const packageId = r.result.packageId;
    if (typeof r.result.count === "number") setPkgCount(r.result.count);
    toast.success(t("v2PkgSaved"), {
      duration: 5000,
      action: packageId
        ? {
            label: t("v2PkgUndo"),
            onClick: () => {
              void (async () => {
                const u = await undoPackageAction(packageId);
                if (u.ok) {
                  if (typeof u.count === "number") setPkgCount(u.count);
                  else setPkgCount((c) => Math.max(0, c - 1));
                  toast.success(t("v2PkgUndone"));
                  router.refresh();
                } else {
                  toast.error(t("v2PkgErr"));
                }
              })();
            },
          }
        : undefined,
    });
  }

  function handleEnd(formData: FormData) {
    if (breakStartLocal !== null) {
      // Süren mola, form alanı varsayılanı totalBreakSoFar'a zaten dahil.
      setBreakStartLocal(null);
    }
    const payload = {
      end_km: formData.get("end_km"),
      notes: formData.get("notes") || null,
      break_minutes: formData.get("break_minutes") || null,
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
        setSummaryLater(false); // biten vardiyanın özeti hemen çıksın
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
    if (e === "start_km_required" || e === "errKmNeg") return t("startKmErr");
    if (e.startsWith("km_low:")) {
      const [, end, start] = e.split(":");
      return t("errKmLow", { end, start });
    }
    if (e.startsWith("km_high:")) {
      const [, diff, max] = e.split(":");
      return t("errKmHigh", { diff, max });
    }
    if (e === "errKmRange") return t("errKmRange");
    return e;
  }

  function openKmEdit() {
    setKmVal(active ? String(active.start_km) : "");
    setSettingsOpen(false);
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

  // ── Ekran seçimi ───────────────────────────────────────────────────────────
  const showSummary = !!pendingSummary && !summaryLater;
  const showConfirm =
    !showSummary &&
    !!active &&
    active.confirmation_status === "pending" &&
    !confirmLater;

  return (
    <div className="mx-auto max-w-md space-y-5">
      {/* Telefon GPS + Lenkzeit uyarısı, onay durumu ne olursa olsun vardiya
          boyunca çalışır ("şoför onaylamasa bile veri akmaya devam eder"). */}
      {active && (
        <>
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
      )}

      {showSummary && pendingSummary && (
        <ShiftSummaryCard
          entry={pendingSummary}
          week={{ ms: totals.weekMs, km: totals.weekKm, shifts: totals.weekShifts }}
          onLater={() => setSummaryLater(true)}
        />
      )}

      {showConfirm && active && (
        <ConfirmShiftCard
          plate={active.plate}
          startedAt={active.started_at}
          onLater={() => setConfirmLater(true)}
        />
      )}

      {active ? (
        <>
          {/* Üst blok: kocaman süre sayacı + bugünkü paket. Başka hiçbir şey. */}
          <Card>
            <CardContent className="space-y-4 py-5 text-center">
              <div>
                <div className="flex items-center justify-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                  {t("v2ShiftTime")}
                  {onBreak && (
                    <Badge variant="secondary" className="text-[10px]">
                      {t("onBreak")}
                    </Badge>
                  )}
                </div>
                <div
                  className={`nums mt-1 text-6xl font-bold ${
                    onBreak ? "text-muted-foreground" : "text-primary"
                  }`}
                >
                  {formatDuration(workedMsLive)}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {t("started")}:{" "}
                  <span className="nums text-foreground">
                    {formatTime(active.started_at, locale)}
                  </span>
                  {active.plate && (
                    <>
                      {" · "}
                      <span className="nums uppercase text-foreground">
                        {active.plate}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-center gap-3 border-t border-white/[0.06] pt-4">
                <Package className="size-6 text-accent-sky" aria-hidden />
                <span className="text-sm text-muted-foreground">
                  {t("v2TodayPackages")}
                </span>
                <span className="nums text-4xl font-bold text-foreground">
                  {todayPackages}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* 3 dev buton */}
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleAddPackage}
              className="btn-primary flex h-28 w-full items-center justify-center gap-4 rounded-2xl text-3xl font-bold tracking-wide text-primary-foreground shadow-lg transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98]"
            >
              <PackagePlus className="size-10" aria-hidden />
              {t("v2AddPackage")}
            </button>

            <ShiftPhotoButton />

            <button
              type="button"
              onClick={() => setProblemOpen(true)}
              className="glass-field flex h-24 w-full items-center justify-center gap-4 rounded-2xl text-xl font-bold tracking-wide text-foreground transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:bg-white/[0.06] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98]"
            >
              <AlertTriangle className="size-8 text-accent-gold" aria-hidden />
              {t("v2Report")}
            </button>
          </div>

          {/* İkincil: mola + vardiyayı bitir */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={toggleBreak}
              variant={onBreak ? "default" : "outline"}
              className="h-14 text-base"
              disabled={pending}
            >
              {onBreak ? (
                <>
                  <PlayCircle className="size-5" />
                  {t("endBreak")}
                </>
              ) : (
                <>
                  <Pause className="size-5" />
                  {t("startBreak")}
                </>
              )}
            </Button>
            <Button
              onClick={() => setEndOpen(true)}
              variant="destructive"
              className="h-14 text-base"
              disabled={pending}
            >
              <Square className="size-5" />
              {t("endShift")}
            </Button>
          </div>
        </>
      ) : (
        /* Bekleme ekranı: manuel başlatma yok — kontak vardiyayı başlatır. */
        <Card>
          <CardContent className="space-y-5 py-10 text-center">
            <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-accent-sky/12 text-accent-sky pulse-soft">
              <KeyRound className="size-10" aria-hidden />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-foreground">
                {t("v2WaitTitle")}
              </h1>
              <p className="mx-auto max-w-xs text-sm text-muted-foreground">
                {t("v2WaitDesc")}
              </p>
            </div>
            {assignedVehicle ? (
              <div className="inline-flex items-center gap-2 rounded-full bg-accent-sky/15 px-4 py-2 text-sm font-medium text-accent-sky">
                <span className="live-dot" aria-hidden />
                {t("v2YourVehicle")}:{" "}
                <span className="nums uppercase">{assignedVehicle.plate}</span>
              </div>
            ) : (
              <div className="mx-auto flex max-w-xs items-start gap-2 rounded-xl bg-accent-gold/12 px-4 py-3 text-left text-sm text-accent-gold">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t("v2WaitNoVehicle")}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sessiz alt bağlantılar: seferler / geçmiş / ayarlar */}
      <div className="flex items-center justify-center gap-6 pb-2 text-sm">
        <Link
          href="/panel/seferler"
          className="flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("v2LinkAssignments")}
          {todayAssignmentCount > 0 && (
            <span className="nums rounded-full bg-accent-sky/15 px-1.5 text-xs text-accent-sky">
              {todayAssignmentCount}
            </span>
          )}
        </Link>
        <Link
          href="/panel/gecmis"
          className="font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("v2LinkHistory")}
        </Link>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("v2LinkSettings")} <ArrowRight className="size-3" aria-hidden />
        </button>
      </div>

      <ProblemReportDialog open={problemOpen} onOpenChange={setProblemOpen} />

      {/* Ayarlar: Telegram bağlantısı + başlangıç km düzeltme */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("v2LinkSettings")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <TelegramLink linked={telegram.linked} username={telegram.username} />
            {active && (
              <Button
                variant="outline"
                onClick={openKmEdit}
                className="h-12 w-full gap-2"
              >
                <Pencil className="size-4" />
                {t("editStartKm")}
                <span className="nums font-medium">
                  {active.start_km.toLocaleString(locale === "de" ? "de-AT" : "tr-TR")}
                </span>
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Vardiyayı bitir — sade form: bitiş km + teslim edilemeyen + not */}
      <Dialog open={endOpen} onOpenChange={setEndOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("endShift")}</DialogTitle>
            <DialogDescription>
              {t("v2TodayPackages")}: {todayPackages}
            </DialogDescription>
          </DialogHeader>
          <form action={handleEnd} className="space-y-4">
            <input type="hidden" name="break_minutes" value={totalBreakSoFar} />
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
                className="h-14 text-lg nums"
              />
              {active && (
                <p className="text-xs text-muted-foreground">
                  {t("startKm")}:{" "}
                  {active.start_km.toLocaleString(locale === "de" ? "de-AT" : "tr-TR")}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="undelivered_count">{t("cargoUndelivered")}</Label>
              <Input
                id="undelivered_count"
                name="undelivered_count"
                type="number"
                inputMode="numeric"
                min={0}
                className="h-12"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">{t("notes")}</Label>
              <Textarea
                id="notes"
                name="notes"
                rows={2}
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

      {/* Başlangıç km düzeltme (otomatik başlatılan vardiyada km yanlış olabilir) */}
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
              className="h-14 text-lg nums"
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
    </div>
  );
}
