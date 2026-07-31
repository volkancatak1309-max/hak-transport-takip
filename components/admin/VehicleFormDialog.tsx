"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VehicleWithStatus, VehicleBaseStatus, VehicleFleet } from "@/lib/types";
import { fleetLabel } from "@/lib/vehicle-ui";
import {
  createVehicle,
  updateVehicle,
  type VehicleActionResult,
} from "@/app/actions/vehicles";

const STATUSES: VehicleBaseStatus[] = ["active", "maintenance", "inactive"];

/** Select "şoför yok" seçeneği: Select boş string'i temizleme sayar. */
const NO_DRIVER = "__none__";

export type VehicleFormDriver = { id: string; name: string; is_active: boolean };

/**
 * ARAÇ KAYDI FORMU — araç kaydının TEK düzenleme yolu.
 *
 * Hem Araçlar listesi (satır menüsü → Düzenle, "Araç Ekle") hem araç detayı
 * (künye satırındaki "Düzenle") bu formu açar. İki sayfada iki ayrı kopya
 * tutulsaydı, alan eklendiğinde biri sessizce geride kalırdı — nitekim
 * `assigned_worker_id_prev` (kayıp-güncelleme koruması) tam olarak böyle bir
 * ayrıntı: kopyalanan formda unutulması veri kaybettirir.
 */
export function VehicleFormDialog({
  open,
  onOpenChange,
  vehicle,
  drivers,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → yeni araç. */
  vehicle: VehicleWithStatus | null;
  drivers: VehicleFormDriver[];
  onSaved: () => void;
}) {
  const tm = useTranslations("vehicles.manage");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{vehicle ? tm("edit_title") : tm("add_title")}</DialogTitle>
        </DialogHeader>
        {/* Gövde yalnız açıkken monte edilir ve araç kimliğiyle key'lenir:
            alanlar her açılışta kaynaktan doğar. Efektle "senkronlamak"
            React 19'da bayat değer bırakıyordu (kapat-aç-aynı-veri tuzağı). */}
        {open && (
          <VehicleForm
            key={vehicle?.id ?? "new"}
            vehicle={vehicle}
            drivers={drivers}
            onDone={() => {
              onOpenChange(false);
              onSaved();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function VehicleForm({
  vehicle,
  drivers,
  onDone,
}: {
  vehicle: VehicleWithStatus | null;
  drivers: VehicleFormDriver[];
  onDone: () => void;
}) {
  const t = useTranslations("vehicles");
  const tm = useTranslations("vehicles.manage");

  const [plate, setPlate] = useState(vehicle?.plate ?? "");
  const [make, setMake] = useState(vehicle?.make ?? "");
  const [model, setModel] = useState(vehicle?.model ?? "");
  const [year, setYear] = useState(vehicle?.year ? String(vehicle.year) : "");
  const [status, setStatus] = useState<VehicleBaseStatus>(vehicle?.status ?? "active");
  const [fleet, setFleet] = useState<VehicleFleet>(vehicle?.fleet ?? "mavi");
  const [deviceId, setDeviceId] = useState(
    vehicle?.flespi_device_id != null ? String(vehicle.flespi_device_id) : ""
  );
  const [imei, setImei] = useState(vehicle?.imei ?? "");
  const [tankCapacity, setTankCapacity] = useState(
    vehicle?.tank_capacity_l != null ? String(vehicle.tank_capacity_l) : ""
  );
  const [inspectionDue, setInspectionDue] = useState(vehicle?.inspection_due ?? "");
  const [insuranceDue, setInsuranceDue] = useState(vehicle?.insurance_due ?? "");
  // driver_id DEĞİL: o, vardiyadaki canlı şoföre kayabilir. Form kalıcı
  // atamayı düzenler, yani ham assigned_worker_id'yi.
  const [assignedWorkerId, setAssignedWorkerId] = useState<string>(
    vehicle?.assigned_worker_id ?? NO_DRIVER
  );
  const [busy, setBusy] = useState(false);

  // Pasif şoför adına etiket eklenir: yönetici ex-çalışana atanmış bir aracı
  // gördüğünde bunu fark edip temizleyebilsin.
  const driverNames = new Map(
    drivers.map((d) => [
      d.id,
      d.is_active ? d.name : `${d.name} (${tm("assigned_driver_passive")})`,
    ])
  );

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
      case "errTank":
        return tm("err_tank");
      case "errDriver":
        return tm("err_driver");
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
    if (vehicle) fd.set("id", vehicle.id);
    fd.set("plate", plate.trim());
    fd.set("make", make.trim());
    fd.set("model", model.trim());
    fd.set("year", year.trim());
    fd.set("status", status);
    fd.set("fleet", fleet);
    fd.set("flespi_device_id", deviceId.trim());
    fd.set("imei", imei.trim());
    fd.set("tank_capacity_l", tankCapacity.trim());
    fd.set("inspection_due", inspectionDue);
    fd.set("insurance_due", insuranceDue);
    fd.set(
      "assigned_worker_id",
      assignedWorkerId === NO_DRIVER ? "" : assignedWorkerId
    );
    // Form açıldığındaki değer: sunucu yalnız gerçekten değiştiyse atamayı
    // yazsın, bayat dialog başkasının değişikliğini geri almasın.
    fd.set("assigned_worker_id_prev", vehicle?.assigned_worker_id ?? "");

    setBusy(true);
    try {
      const res = vehicle ? await updateVehicle(fd) : await createVehicle(fd);
      if (!res.ok) {
        toast.error(errMsg(res));
        return;
      }
      toast.success(tm("saved"));
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
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
        <Label>{tm("fleet")}</Label>
        <Select value={fleet} onValueChange={(v) => v && setFleet(v as VehicleFleet)}>
          <SelectTrigger className="h-11">
            <SelectValue>
              {((v: unknown) => fleetLabel(String(v), t)) as never}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mavi">{fleetLabel("mavi", t)}</SelectItem>
            <SelectItem value="bordo">{fleetLabel("bordo", t)}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Depo hacmi (litre) — yakıt raporunun % → litre / L100km çevriminin
          tek kaynağı. Boş bırakılırsa o araç raporda %-bazlı kalır. */}
      <div className="space-y-1.5">
        <Label htmlFor="veh-tank">{tm("tank_capacity")}</Label>
        <Input
          id="veh-tank"
          type="number"
          inputMode="numeric"
          min={1}
          max={1500}
          value={tankCapacity}
          onChange={(e) => setTankCapacity(e.target.value)}
          placeholder="70"
          className="nums h-11"
        />
        <p className="text-xs text-text-tertiary">{tm("tank_capacity_hint")}</p>
      </div>

      {/* Şoför↔araç eşleşmesinin TEK yazma yolu. Şoför paneli "atanmış
          aracım var mı"yı, Çalışanlar sayfası plaka kolonunu buradan
          okur. Bir şoför tek araca atanır: aynı şoför başka araca
          verilirse sunucu eski atamayı serbest bırakır. */}
      <div className="space-y-1.5">
        <Label>{tm("assigned_driver")}</Label>
        <Select
          value={assignedWorkerId}
          onValueChange={(v) => v && setAssignedWorkerId(String(v))}
        >
          <SelectTrigger className="h-11">
            <SelectValue>
              {((v: unknown) =>
                String(v) === NO_DRIVER
                  ? tm("assigned_driver_none")
                  : driverNames.get(String(v)) ??
                    tm("assigned_driver_none")) as never}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_DRIVER}>{tm("assigned_driver_none")}</SelectItem>
            {drivers
              // Pasifler yalnız zaten atanmışsa listelenir — yeni atama
              // için seçilemezler, ama mevcut atama görünür kalır.
              .filter((d) => d.is_active || d.id === assignedWorkerId)
              .map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {driverNames.get(d.id) ?? d.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{tm("assigned_driver_hint")}</p>
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
  );
}
