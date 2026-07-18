"use client";

import { useState, useTransition, type ReactElement } from "react";
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
  DialogTrigger,
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
import { createWorkerAction } from "@/app/actions/workers";

type Props = {
  /** The element that opens the dialog (a styled Button). Each page supplies
   *  its own so the trigger matches that surface's toolbar/header. Base UI
   *  merges the trigger props into this element via `render`. */
  children: ReactElement;
};

/** Bölüm başlığı — dialog içi form gruplaması (kişisel / istihdam / ehliyet /
 *  acil durum). Araç formundaki alan diliyle aynı; yeni stil icat edilmedi. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="pt-1 text-[12px] sm:text-[11px] font-medium uppercase tracking-[0.04em] text-text-tertiary">
      {children}
    </p>
  );
}

/**
 * Shared "add worker" dialog used by both the admin dashboard and the workers
 * page. Owns its open state, submit transition and the createWorkerAction call
 * (which flags the new account must_change_pin server-side). The trigger is
 * passed as children via DialogTrigger so each surface keeps its own styling.
 *
 * Migration 025: personel dosyası alanları (kişisel/istihdam/ehliyet/acil durum)
 * forma eklendi. ZORUNLU alanlar değişmedi (ad/telefon/PIN) — kâğıt formlar
 * eksik gelebildiği için yeni alanların HEPSİ opsiyonel.
 */
export function AddWorkerDialog({ children }: Props) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Select boş kalabilmeli (opsiyonel alan) — sentinel "none" gönderimde atılır.
  const [employmentType, setEmploymentType] = useState<string>("none");

  // createWorkerAction returns raw zod message keys on validation failure;
  // translate the ones createWorkerSchema can emit (others — e.g. "Bu telefon
  // zaten kayıtlı" — are already human-readable and pass through unchanged).
  function mapCreateErr(e?: string): string {
    if (!e) return "Error";
    const known: Record<string, string> = {
      errName: t("errName"),
      errPhone: t("errPhone"),
      errPin: t("errPin"),
      errPinWeak: t("errPinWeak"),
      errEmail: t("errEmail"),
      errDate: t("errDate"),
    };
    return known[e] ?? e;
  }

  function handleCreate(formData: FormData) {
    if (employmentType !== "none") formData.set("employment_type", employmentType);
    // Saha standardı: PIN boş bırakıldıysa geçici varsayılan 123456 (sunucu da
    // aynısını uygular; must_change_pin ile ilk girişte zorunlu değişim).
    if (!String(formData.get("pin") ?? "").trim()) formData.set("pin", "123456");
    startTransition(async () => {
      const res = await createWorkerAction(formData);
      if (res.ok) {
        toast.success(t("workerAdded"));
        setOpen(false);
        setEmploymentType("none");
        router.refresh();
      } else {
        toast.error(mapCreateErr(res.error));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={children} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("createWorker")}</DialogTitle>
        </DialogHeader>
        <form action={handleCreate} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="name">{t("name")}</Label>
            <Input id="name" name="name" required className="h-11" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="phone">{t("phone")}</Label>
              <Input id="phone" name="phone" type="tel" required placeholder="+43 699 1234567" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pin">{t("pin")}</Label>
              <Input
                id="pin"
                name="pin"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                placeholder="123456"
                className="h-11 tracking-widest"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="plate">{t("plate")}</Label>
              <Input id="plate" name="plate" className="h-11 nums uppercase" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="employee_number">{t("employeeNumber")}</Label>
              <Input
                id="employee_number"
                name="employee_number"
                inputMode="numeric"
                placeholder={t("employeeNumberHint")}
                className="h-11 nums"
              />
            </div>
          </div>

          {/* ── Kişisel (migration 025 — tümü opsiyonel) ── */}
          <SectionLabel>{t("secPersonal")}</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="birth_date">{t("birthDate")}</Label>
              <Input id="birth_date" name="birth_date" type="date" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ssn">{t("ssn")}</Label>
              <Input id="ssn" name="social_security_no" inputMode="numeric" className="h-11 nums" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" name="email" type="email" className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address">{t("address")}</Label>
            <Input id="address" name="address" className="h-11" />
          </div>

          {/* ── İstihdam ── */}
          <SectionLabel>{t("secEmployment")}</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="employment_start">{t("employmentStart")}</Label>
              <Input id="employment_start" name="employment_start" type="date" className="h-11" />
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

          {/* ── Ehliyet ── */}
          <SectionLabel>{t("secLicense")}</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="license_no">{t("licenseNo")}</Label>
              <Input id="license_no" name="license_no" className="h-11 nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="license_expiry">{t("licenseExpiry")}</Label>
              <Input id="license_expiry" name="license_expiry" type="date" className="h-11" />
            </div>
          </div>

          {/* ── Acil durum ── */}
          <SectionLabel>{t("secEmergency")}</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ec_name">{t("emergencyName")}</Label>
              <Input id="ec_name" name="emergency_contact_name" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec_relation">{t("emergencyRelation")}</Label>
              <Input id="ec_relation" name="emergency_contact_relation" className="h-11" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ec_phone">{t("emergencyPhone")}</Label>
            <Input id="ec_phone" name="emergency_contact_phone" type="tel" className="h-11" />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="is_admin" id="is_admin" />
            {t("isAdmin")}
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {pending ? tc("saving") : tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
