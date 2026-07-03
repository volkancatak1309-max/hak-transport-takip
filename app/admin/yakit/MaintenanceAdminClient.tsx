"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Wrench, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { PhotoUpload } from "@/components/PhotoUpload";
import { ReceiptThumb } from "@/components/ReceiptThumb";
import { formatDate } from "@/lib/format";
import type { VehicleMaintenance, MaintenanceType } from "@/lib/types";
import { createMaintenance } from "@/app/actions/maintenance";

const TYPES: MaintenanceType[] = [
  "oil_change",
  "inspection",
  "tire_change",
  "brake_check",
  "general_service",
  "repair",
  "other",
];

function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type Props = { items: VehicleMaintenance[]; dueIds: string[]; plates: string[] };

export function MaintenanceAdminClient({ items, dueIds, plates }: Props) {
  const t = useTranslations("maintenance");
  const locale = useLocale();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [plate, setPlate] = useState(plates[0] ?? "");
  const [serviceType, setServiceType] = useState<MaintenanceType>("oil_change");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const plateVal = plates.length > 0 ? plate : (fd.get("vehicle_plate") as string) || "";
    fd.set("vehicle_plate", plateVal);
    fd.set("service_type", serviceType);
    if (receipt) fd.set("receipt", receipt);

    if (!plateVal || !fd.get("serviced_at") || !fd.get("odometer_km")) {
      toast.error(t("required"));
      return;
    }
    setBusy(true);
    try {
      const res = await createMaintenance(fd);
      if (!res.ok) {
        toast.error(t("save_error"));
        return;
      }
      toast.success(t("saved"));
      setOpen(false);
      setReceipt(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Wrench className="size-4" /> {t("title")}
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="size-4" /> {t("add")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          items.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {m.vehicle_plate} · {t(`type.${m.service_type}`)}
                </p>
                <p className="text-xs text-muted-foreground nums">
                  {formatDate(m.serviced_at, locale)} ·{" "}
                  {m.odometer_km.toLocaleString(locale === "de" ? "de-AT" : "tr-TR")} km
                  {m.next_service_km ? ` · → ${m.next_service_km.toLocaleString(locale === "de" ? "de-AT" : "tr-TR")} km` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <ReceiptThumb
                  url={m.receipt_url}
                  title={`${m.vehicle_plate} · ${t(`type.${m.service_type}`)}`}
                  emptyLabel={t("no_receipt")}
                  info={
                    <p className="nums">
                      {formatDate(m.serviced_at, locale)} ·{" "}
                      {m.odometer_km.toLocaleString(locale === "de" ? "de-AT" : "tr-TR")} km
                    </p>
                  }
                />
                {dueIds.includes(m.id) && <Badge variant="destructive">{t("due")}</Badge>}
              </div>
            </div>
          ))
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("add")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("plate")}</Label>
              {plates.length > 0 ? (
                <Select value={plate} onValueChange={(v) => v && setPlate(v)}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder={t("plate")} />
                  </SelectTrigger>
                  <SelectContent>
                    {plates.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input name="vehicle_plate" className="h-11 uppercase" placeholder="W-1234AB" />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="serviced_at">{t("date")}</Label>
                <Input id="serviced_at" name="serviced_at" type="date" defaultValue={todayLocal()} className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="odometer_km">{t("odometer")}</Label>
                <Input id="odometer_km" name="odometer_km" type="number" min={1} className="h-11" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("service_type")}</Label>
              <Select value={serviceType} onValueChange={(v) => v && setServiceType(v as MaintenanceType)}>
                <SelectTrigger className="h-11">
                  <SelectValue>
                    {((v: unknown) => t(`type.${String(v)}`)) as never}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((ty) => (
                    <SelectItem key={ty} value={ty}>{t(`type.${ty}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cost">{t("cost")}</Label>
              <Input id="cost" name="cost" inputMode="decimal" placeholder="0,00" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">{t("description")}</Label>
              <Input id="description" name="description" className="h-11" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="next_service_km">{t("next_km")}</Label>
                <Input id="next_service_km" name="next_service_km" type="number" min={1} className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="next_service_date">{t("next_date")}</Label>
                <Input id="next_service_date" name="next_service_date" type="date" className="h-11" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("photo_optional")}</Label>
              <PhotoUpload onFile={setReceipt} />
            </div>
            <Button type="submit" className="w-full h-11" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
