"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, PlayCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  startShiftForWorkerAction,
  listStartableVehiclesAction,
} from "@/app/actions/shift";

/**
 * YÖNETİCİ / FİLO ŞEFİ — bir personelin vardiyasını ELLE başlatma dialogu.
 *
 * İki yüzeyden çağrılır (aynı bileşen): Günün Panosu roster'ı (patron + şef) ve
 * Çalışanlar sayfası üç-nokta menüsü (patron). Kendi verisini kendi getirir:
 * araç listesi kapsam-farkındadır (listStartableVehiclesAction — şef yalnız
 * kendi filosu). Yetki server action'da yeniden denetlenir (fail-closed);
 * buradaki gizleme yalnız kozmetik.
 *
 * Saat: varsayılan ŞİMDİ (Viyana duvar-saati) ama düzenlenebilir — mesaiye daha
 * erken başlamışsa geri tarihlenir. Tarayıcı yerel saatini ISO'ya çevirip
 * gönderir; sunucu "bugünün Viyana günü + gelecekte değil" doğrular.
 */

type WorkerLite = { id: string; name: string };
type Vehicle = { id: string; plate: string; assigned_worker_id: string | null };

/** "YYYY-MM-DDTHH:mm" — tarayıcı yerel saati (kullanıcılar Viyana'da). */
function nowLocalInput(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

const KNOWN_ERRORS = [
  "unauthorized",
  "out_of_scope",
  "inactive_worker",
  "no_vehicle",
  "vehicle_unavailable",
  "vehicle_out_of_scope",
  "invalid_time",
  "future_time",
  "not_today",
  "active",
  "day_done",
];

export function StartShiftForWorkerDialog({
  worker,
  onClose,
  onDone,
}: {
  worker: WorkerLite | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const t = useTranslations("manualStart");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loadingVeh, setLoadingVeh] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [startedAt, setStartedAt] = useState(nowLocalInput());
  const [busy, setBusy] = useState(false);
  // Formun hangi şoför için kurulduğu. Senkron sıfırlamalar (saat/araç) prop
  // DEĞİŞİNCE render fazında yapılır — React'in "türetilmiş durumu prop
  // değişiminde sıfırla" deseni; setState-in-effect tuzağından kaçınır. Araç
  // getirme (async dış-sistem senkronu) yalnız effect'te, setState callback'te.
  const [formFor, setFormFor] = useState<string | null>(null);

  const open = worker !== null;
  const workerId = worker?.id ?? null;

  if (workerId === null) {
    if (formFor !== null) setFormFor(null);
  } else if (workerId !== formFor) {
    setFormFor(workerId);
    setStartedAt(nowLocalInput());
    setVehicleId("");
    setVehicles([]);
    setLoadingVeh(true);
  }

  useEffect(() => {
    if (!workerId) return;
    let alive = true;
    listStartableVehiclesAction()
      .then((list) => {
        if (!alive) return;
        setVehicles(list);
        const assigned = list.find((v) => v.assigned_worker_id === workerId);
        setVehicleId(assigned?.id ?? list[0]?.id ?? "");
      })
      .catch(() => {
        if (alive) setVehicles([]);
      })
      .finally(() => {
        if (alive) setLoadingVeh(false);
      });
    return () => {
      alive = false;
    };
  }, [workerId]);

  function errMsg(code?: string): string {
    if (code && KNOWN_ERRORS.includes(code)) return t(`err_${code}`);
    return t("err_generic");
  }

  function submit() {
    if (!worker) return;
    if (!vehicleId) {
      toast.error(t("err_no_vehicle"));
      return;
    }
    const ms = new Date(startedAt).getTime();
    if (!Number.isFinite(ms)) {
      toast.error(t("err_invalid_time"));
      return;
    }
    const iso = new Date(ms).toISOString();
    setBusy(true);
    startShiftForWorkerAction({ workerId: worker.id, startedAt: iso, vehicleId })
      .then((res) => {
        if (res.ok) {
          toast.success(res.reopened ? t("okReopened") : t("ok"));
          onClose();
          onDone?.();
        } else {
          toast.error(errMsg(res.error));
        }
      })
      .catch(() => toast.error(t("err_generic")))
      .finally(() => setBusy(false));
  }

  const selectedPlate = vehicles.find((v) => v.id === vehicleId)?.plate ?? "";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlayCircle className="size-5 text-accent-sky-text" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>
            {worker ? t("subtitle", { name: worker.name }) : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ms_time">{t("timeLabel")}</Label>
            <Input
              id="ms_time"
              type="datetime-local"
              value={startedAt}
              max={nowLocalInput()}
              onChange={(e) => setStartedAt(e.target.value)}
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">{t("timeHint")}</p>
          </div>

          <div className="space-y-1.5">
            <Label>{t("vehicleLabel")}</Label>
            <Select
              value={vehicleId}
              onValueChange={(v) => v && setVehicleId(v)}
              disabled={loadingVeh || vehicles.length === 0}
            >
              <SelectTrigger className="h-11">
                <SelectValue>
                  {selectedPlate ? (
                    <span className="nums uppercase">{selectedPlate}</span>
                  ) : loadingVeh ? (
                    t("loading")
                  ) : (
                    t("vehiclePlaceholder")
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {vehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    <span className="nums uppercase">{v.plate}</span>
                    {v.assigned_worker_id === worker?.id && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {t("assignedTag")}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={busy || loadingVeh || !vehicleId}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
