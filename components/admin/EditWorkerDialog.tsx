"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getWorkerVehicleOptions,
  updateWorkerAction,
} from "@/app/actions/workers";
import type { WorkerPublic } from "@/lib/types";

type Props = {
  /** Düzenlenecek çalışan; null → dialog kapalı. Kontrollü (parent açar/kapatır). */
  worker: WorkerPublic | null;
  onClose: () => void;
};

/** Bölüm başlığı — AddWorkerDialog ile birebir aynı stil (yeni dil icat edilmedi). */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="pt-1 text-[12px] sm:text-[11px] font-medium uppercase tracking-[0.04em] text-text-tertiary">
      {children}
    </p>
  );
}

/**
 * Mevcut çalışanın personel dosyasını düzenler. AddWorkerDialog'un alan dili
 * birebir; farkı: PIN/durum yok (ayrı akışlar), araç ataması eklendi ve kayıt
 * updateWorkerAction'a gider (diff bazlı — sadece değişen alan yazılır, araç
 * ataması vehicles.assigned_worker_id tek-kaynağından yürür).
 *
 * Kontrollü dialog: parent `worker` verince açılır. İç form `key={worker.id}`
 * ile yeniden kurulur → başka bir çalışana geçilince alanlar doğru dolar.
 */
export function EditWorkerDialog({ worker, onClose }: Props) {
  const t = useTranslations("admin");
  return (
    <Dialog open={!!worker} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("editWorker")}</DialogTitle>
        </DialogHeader>
        {worker && <EditWorkerForm key={worker.id} worker={worker} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function EditWorkerForm({
  worker,
  onDone,
}: {
  worker: WorkerPublic;
  onDone: () => void;
}) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [employmentType, setEmploymentType] = useState<string>(
    worker.employment_type ?? "none"
  );
  // Araç seçenekleri dialog açılınca lazy çekilir (açılmadan sıfır maliyet).
  const [vehicles, setVehicles] = useState<{ id: string; plate: string }[]>([]);
  // "prev" form açıldığındaki atama — lost-update koruması için sunucuya gider.
  const [assignedVehicle, setAssignedVehicle] = useState<string>("none");
  const [prevVehicle, setPrevVehicle] = useState<string>("none");

  useEffect(() => {
    let alive = true;
    getWorkerVehicleOptions(worker.id).then((res) => {
      if (!alive) return;
      setVehicles(res.vehicles);
      const cur = res.currentVehicleId ?? "none";
      setAssignedVehicle(cur);
      setPrevVehicle(cur);
    });
    return () => {
      alive = false;
    };
  }, [worker.id]);

  function mapErr(e?: string): string {
    if (!e) return "Error";
    const known: Record<string, string> = {
      errName: t("errName"),
      errPhone: t("errPhone"),
      errEmail: t("errEmail"),
      errDate: t("errDate"),
      // Yetki kapıları (sunucuda uygulanır, mesaj burada çevrilir).
      errSelfDemote: t("errSelfDemote"),
      errLastAdmin: t("errLastAdmin"),
    };
    return known[e] ?? e;
  }

  function handleUpdate(formData: FormData) {
    formData.set("id", worker.id);
    formData.set("employment_type", employmentType);
    formData.set("assigned_vehicle_id", assignedVehicle);
    formData.set("assigned_vehicle_id_prev", prevVehicle);
    startTransition(async () => {
      const res = await updateWorkerAction(formData);
      if (res.ok) {
        toast.success(t("workerUpdated"));
        onDone();
        router.refresh();
      } else {
        toast.error(mapErr(res.error));
      }
    });
  }

  return (
    <form action={handleUpdate} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="e_name">{t("name")}</Label>
        <Input id="e_name" name="name" required defaultValue={worker.name} className="h-11" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="e_phone">{t("phone")}</Label>
          <Input
            id="e_phone"
            name="phone"
            type="tel"
            required
            defaultValue={worker.phone}
            placeholder="+43 699 1234567"
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="e_employee_number">{t("employeeNumber")}</Label>
          <Input
            id="e_employee_number"
            name="employee_number"
            inputMode="numeric"
            defaultValue={worker.employee_number ?? ""}
            placeholder={t("employeeNumberHint")}
            className="h-11 nums"
          />
        </div>
      </div>

      {/* ── Kişisel ── */}
      <SectionLabel>{t("secPersonal")}</SectionLabel>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="e_birth_date">{t("birthDate")}</Label>
          <Input
            id="e_birth_date"
            name="birth_date"
            type="date"
            defaultValue={worker.birth_date ?? ""}
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="e_ssn">{t("ssn")}</Label>
          <Input
            id="e_ssn"
            name="social_security_no"
            inputMode="numeric"
            defaultValue={worker.social_security_no ?? ""}
            className="h-11 nums"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="e_email">{t("email")}</Label>
        <Input
          id="e_email"
          name="email"
          type="email"
          defaultValue={worker.email ?? ""}
          className="h-11"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="e_address">{t("address")}</Label>
        <Input
          id="e_address"
          name="address"
          defaultValue={worker.address ?? ""}
          className="h-11"
        />
      </div>

      {/* ── İstihdam ── */}
      <SectionLabel>{t("secEmployment")}</SectionLabel>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="e_employment_start">{t("employmentStart")}</Label>
          <Input
            id="e_employment_start"
            name="employment_start"
            type="date"
            defaultValue={worker.employment_start ?? ""}
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("employmentType")}</Label>
          <Select value={employmentType} onValueChange={(v) => v && setEmploymentType(v)}>
            <SelectTrigger className="h-11">
              <SelectValue>
                {((v: unknown) =>
                  String(v) === "none" ? "—" : t(`employment_${String(v)}`)) as never}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              <SelectItem value="full_time">{t("employment_full_time")}</SelectItem>
              <SelectItem value="hourly">{t("employment_hourly")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Atanmış araç (tek kaynak: vehicles.assigned_worker_id) ── */}
      <div className="space-y-1.5">
        <Label>{t("assignedVehicle")}</Label>
        <Select value={assignedVehicle} onValueChange={(v) => v && setAssignedVehicle(v)}>
          <SelectTrigger className="h-11">
            <SelectValue>
              {((v: unknown) =>
                String(v) === "none"
                  ? t("assignedVehicleNone")
                  : vehicles.find((x) => x.id === String(v))?.plate ??
                    t("assignedVehicleNone")) as never}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("assignedVehicleNone")}</SelectItem>
            {vehicles.map((v) => (
              <SelectItem key={v.id} value={v.id} className="uppercase">
                {v.plate}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Ehliyet ── */}
      <SectionLabel>{t("secLicense")}</SectionLabel>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="e_license_no">{t("licenseNo")}</Label>
          <Input
            id="e_license_no"
            name="license_no"
            defaultValue={worker.license_no ?? ""}
            className="h-11 nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="e_license_expiry">{t("licenseExpiry")}</Label>
          <Input
            id="e_license_expiry"
            name="license_expiry"
            type="date"
            defaultValue={worker.license_expiry ?? ""}
            className="h-11"
          />
        </div>
      </div>

      {/* ── Acil durum ── */}
      <SectionLabel>{t("secEmergency")}</SectionLabel>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="e_ec_name">{t("emergencyName")}</Label>
          <Input
            id="e_ec_name"
            name="emergency_contact_name"
            defaultValue={worker.emergency_contact_name ?? ""}
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="e_ec_relation">{t("emergencyRelation")}</Label>
          <Input
            id="e_ec_relation"
            name="emergency_contact_relation"
            defaultValue={worker.emergency_contact_relation ?? ""}
            className="h-11"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="e_ec_phone">{t("emergencyPhone")}</Label>
        <Input
          id="e_ec_phone"
          name="emergency_contact_phone"
          type="tel"
          defaultValue={worker.emergency_contact_phone ?? ""}
          className="h-11"
        />
      </div>

      {/* ── Yetki ──
          Kutu 04.08.2026'da EKLENDİ. Eskiden yalnız EKLEME formundaydı: bir kez
          yönetici yapılan kişinin yetkisi panelden geri alınamıyordu, yanlışlıkla
          yönetici eklenen şoför öyle kalıyordu. Kapılar sunucuda (kendi kendini
          düşürme + son yönetici); bu form yalnız patrona açık (requireAdmin). */}
      <label className="flex items-center gap-2 pt-1 text-sm">
        <Checkbox
          name="is_admin"
          id="e_is_admin"
          defaultChecked={worker.is_admin}
        />
        {t("isAdmin")}
      </label>

      {/* MUAFİYET (migration 041). Yalnız yönetici kaydında anlamlı: yetki
          kaldırılırsa sunucu bu bayrağı da false'a düşürür. */}
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          name="counts_as_driver"
          id="e_counts_as_driver"
          defaultChecked={worker.counts_as_driver}
          className="mt-0.5"
        />
        <span>
          {t("countsAsDriver")}
          <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
            {t("countsAsDriverHint")}
          </span>
        </span>
      </label>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {tc("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {pending ? tc("saving") : tc("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
