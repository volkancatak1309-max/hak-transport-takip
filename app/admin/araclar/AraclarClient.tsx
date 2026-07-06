"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Truck,
  Search,
  ChevronRight,
  UserRound,
  Plus,
  Pencil,
  Trash2,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HelpTip } from "@/components/help/HelpTip";
import { STATUS_STYLE } from "@/lib/vehicle-ui";
import type { VehicleWithStatus, VehicleBaseStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  createVehicle,
  updateVehicle,
  deleteVehicle,
  type VehicleActionResult,
} from "@/app/actions/vehicles";

const STATUSES: VehicleBaseStatus[] = ["active", "maintenance", "inactive"];

export function AraclarClient({ vehicles }: { vehicles: VehicleWithStatus[] }) {
  const t = useTranslations("vehicles");
  const tm = useTranslations("vehicles.manage");
  const router = useRouter();
  const [q, setQ] = useState("");

  // Create/edit dialog state.
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleWithStatus | null>(null);
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [status, setStatus] = useState<VehicleBaseStatus>("active");
  const [deviceId, setDeviceId] = useState("");
  const [imei, setImei] = useState("");
  const [inspectionDue, setInspectionDue] = useState("");
  const [insuranceDue, setInsuranceDue] = useState("");
  const [busy, setBusy] = useState(false);

  const counts = useMemo(() => {
    const c = { total: vehicles.length, sevkiyatta: 0, molada: 0, bosta: 0, bakimda: 0 };
    for (const v of vehicles) c[v.live_status]++;
    return c;
  }, [vehicles]);

  const filtered = useMemo(() => {
    const s = q.trim().toLocaleLowerCase("tr");
    if (!s) return vehicles;
    return vehicles.filter(
      (v) =>
        v.plate.toLocaleLowerCase("tr").includes(s) ||
        (v.driver_name ?? "").toLocaleLowerCase("tr").includes(s) ||
        `${v.make ?? ""} ${v.model ?? ""}`.toLocaleLowerCase("tr").includes(s)
    );
  }, [vehicles, q]);

  function openNew() {
    setEditing(null);
    setPlate("");
    setMake("");
    setModel("");
    setYear("");
    setStatus("active");
    setDeviceId("");
    setImei("");
    setInspectionDue("");
    setInsuranceDue("");
    setOpen(true);
  }
  function openEdit(v: VehicleWithStatus) {
    setEditing(v);
    setPlate(v.plate);
    setMake(v.make ?? "");
    setModel(v.model ?? "");
    setYear(v.year ? String(v.year) : "");
    setStatus(v.status);
    setDeviceId(v.flespi_device_id != null ? String(v.flespi_device_id) : "");
    setImei(v.imei ?? "");
    setInspectionDue(v.inspection_due ?? "");
    setInsuranceDue(v.insurance_due ?? "");
    setOpen(true);
  }

  function errMsg(res: VehicleActionResult): string {
    switch (res.error) {
      case "plate_taken":
        return tm("err_plate_taken");
      case "imei_taken":
        return tm("err_imei_taken", { plate: res.conflict ?? "" });
      case "device_taken":
        return tm("err_device_taken", { plate: res.conflict ?? "" });
      case "errPlateRequired":
        return tm("err_plate_required");
      case "errImeiFormat":
        return tm("err_imei_format");
      case "errYear":
        return tm("err_year");
      case "errDevice":
        return tm("err_device");
      default:
        return tm("save_error");
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!plate.trim()) {
      toast.error(tm("err_plate_required"));
      return;
    }
    const fd = new FormData();
    if (editing) fd.set("id", editing.id);
    fd.set("plate", plate.trim());
    fd.set("make", make.trim());
    fd.set("model", model.trim());
    fd.set("year", year.trim());
    fd.set("status", status);
    fd.set("flespi_device_id", deviceId.trim());
    fd.set("imei", imei.trim());
    fd.set("inspection_due", inspectionDue);
    fd.set("insurance_due", insuranceDue);

    setBusy(true);
    try {
      const res = editing ? await updateVehicle(fd) : await createVehicle(fd);
      if (!res.ok) {
        toast.error(errMsg(res));
        return;
      }
      toast.success(tm("saved"));
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(v: VehicleWithStatus) {
    if (!confirm(tm("delete_confirm", { plate: v.plate }))) return;
    const res = await deleteVehicle(v.id);
    if (!res.ok) {
      toast.error(tm("save_error"));
      return;
    }
    toast.success(tm("deleted"));
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-5 px-4 py-6 sm:px-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("kpi_total")} value={counts.total} />
        <Kpi label={t("kpi_active")} value={counts.sevkiyatta} accent="sky" live={counts.sevkiyatta > 0} />
        <Kpi label={t("kpi_break")} value={counts.molada} accent="claret" />
        <Kpi label={t("kpi_idle")} value={counts.bosta} accent="gold" />
      </div>

      {/* Search + Add */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search")}
            className="h-11 pl-9"
          />
        </div>
        <Button onClick={openNew} className="h-11 shrink-0">
          <Plus className="size-4" /> {tm("add")}
        </Button>
        <HelpTip tkey="veh_list" />
      </div>

      {/* List */}
      <div className="glass overflow-hidden rounded-[16px]">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{t("none")}</div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((v) => {
              const st = STATUS_STYLE[v.live_status];
              return (
                <li
                  key={v.id}
                  className={cn(
                    "group flex items-center gap-3 border-l-[3px] px-4 py-3.5 transition-colors duration-150 hover:bg-surface-2",
                    st.stripe
                  )}
                >
                  <Link
                    href={`/admin/araclar/${v.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-muted-foreground">
                      <Truck className="size-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="nums truncate text-sm font-semibold uppercase tracking-wide">
                          {v.plate}
                        </span>
                        <span className="hidden truncate text-xs text-text-tertiary sm:inline">
                          {[v.make, v.model].filter(Boolean).join(" ")}
                        </span>
                        {v.imei && (
                          <span className="hidden shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary md:inline">
                            GPS
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <UserRound className="size-3.5 shrink-0 text-text-tertiary" />
                        {v.driver_name ? (
                          <span className="truncate">
                            {v.driver_name}
                            {!v.driver_is_live && (
                              <span className="ml-1 text-text-tertiary">· {t("assigned_label")}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-text-tertiary">{t("no_driver")}</span>
                        )}
                      </div>
                    </div>
                  </Link>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                      st.chip
                    )}
                  >
                    {st.live ? (
                      <span className="live-dot" />
                    ) : (
                      <span className={cn("size-1.5 rounded-full", st.dot)} />
                    )}
                    {t(`status.${st.labelKey}`)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={tm("edit")}
                    onClick={() => openEdit(v)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={tm("delete")}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => remove(v)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                  <Link
                    href={`/admin/araclar/${v.id}`}
                    aria-label={v.plate}
                    className="shrink-0"
                  >
                    <ChevronRight className="size-4 text-text-tertiary transition-colors group-hover:text-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Create / edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{editing ? tm("edit_title") : tm("add_title")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="veh-plate">{tm("plate")}</Label>
              <Input
                id="veh-plate"
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
                placeholder={tm("plate_ph")}
                className="h-11 uppercase"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="veh-make">{tm("make")}</Label>
                <Input
                  id="veh-make"
                  value={make}
                  onChange={(e) => setMake(e.target.value)}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="veh-model">{tm("model")}</Label>
                <Input
                  id="veh-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="h-11"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="veh-year">{tm("year")}</Label>
                <Input
                  id="veh-year"
                  type="number"
                  min={1950}
                  max={2100}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{tm("status")}</Label>
                <Select value={status} onValueChange={(v) => v && setStatus(v as VehicleBaseStatus)}>
                  <SelectTrigger className="h-11">
                    <SelectValue>
                      {((v: unknown) => tm(`status_${String(v)}`)) as never}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {tm(`status_${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="veh-imei">{tm("imei")}</Label>
              <Input
                id="veh-imei"
                inputMode="numeric"
                value={imei}
                onChange={(e) => setImei(e.target.value)}
                placeholder="864022089572837"
                className="nums h-11"
              />
              <p className="text-xs text-text-tertiary">{tm("imei_hint")}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="veh-device">{tm("flespi_device_id")}</Label>
              <Input
                id="veh-device"
                inputMode="numeric"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                className="nums h-11"
              />
              <p className="text-xs text-text-tertiary">{tm("flespi_device_id_hint")}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="veh-inspection">{t("detail.inspection_due")}</Label>
                <Input
                  id="veh-inspection"
                  type="date"
                  value={inspectionDue}
                  onChange={(e) => setInspectionDue(e.target.value)}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="veh-insurance">{t("detail.insurance_due")}</Label>
                <Input
                  id="veh-insurance"
                  type="date"
                  value={insuranceDue}
                  onChange={(e) => setInsuranceDue(e.target.value)}
                  className="h-11"
                />
              </div>
            </div>

            <Button type="submit" className="h-11 w-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {tm("save")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
  live,
}: {
  label: string;
  value: number;
  accent?: "sky" | "claret" | "gold";
  live?: boolean;
}) {
  const color =
    accent === "sky"
      ? "text-accent-sky"
      : accent === "claret"
      ? "text-accent-claret"
      : accent === "gold"
      ? "text-accent-gold"
      : "text-foreground";
  return (
    <div className="glass card-kpi rounded-[16px] px-4 py-3.5">
      <div className="flex items-center gap-1.5">
        {live && <span className="live-dot" />}
        <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-text-tertiary">
          {label}
        </span>
      </div>
      <div className={`nums mt-1.5 text-[28px] font-semibold leading-none ${color}`}>{value}</div>
    </div>
  );
}
