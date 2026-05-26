"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Fuel } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { PhotoUpload } from "@/components/PhotoUpload";
import { ReceiptLightbox } from "@/components/ReceiptLightbox";
import { formatDate } from "@/lib/format";
import { APPROVAL_BADGE } from "@/lib/status-ui";
import type { FuelEntryWithWorker, FuelType } from "@/lib/types";
import { createFuelEntry, getFuelReceiptUrl } from "@/app/actions/fuel";

const FUEL_TYPES: FuelType[] = ["diesel", "benzin", "lpg", "elektro"];

function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

type Props = { plates: string[]; entries: FuelEntryWithWorker[] };

export function FuelDriverClient({ plates, entries }: Props) {
  const t = useTranslations("fuel");
  const ta = useTranslations("approval");
  const locale = useLocale();
  const router = useRouter();

  const [plate, setPlate] = useState(plates[0] ?? "");
  const [fuelType, setFuelType] = useState<FuelType>("diesel");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!receipt) {
      toast.error(t("receipt_required"));
      return;
    }
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("vehicle_plate", plate);
    fd.set("fuel_type", fuelType);
    fd.set("receipt", receipt);
    setBusy(true);
    try {
      const res = await createFuelEntry(fd);
      if (!res.ok) {
        toast.error(t("save_error"));
        return;
      }
      toast.success(t("saved"));
      form.reset();
      setReceipt(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Fuel className="size-4" /> {t("new_entry")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fueled_at">{t("date")}</Label>
              <Input
                id="fueled_at"
                name="fueled_at"
                type="datetime-local"
                defaultValue={nowLocal()}
                className="h-11"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("plate")}</Label>
              {plates.length > 0 ? (
                <Select value={plate} onValueChange={(v) => v && setPlate(v)}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder={t("plate")} />
                  </SelectTrigger>
                  <SelectContent>
                    {plates.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={plate}
                  onChange={(e) => setPlate(e.target.value.toUpperCase())}
                  placeholder="W-1234AB"
                  className="h-11 uppercase"
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="liters">{t("liters")}</Label>
                <Input id="liters" name="liters" inputMode="decimal" placeholder="65,00" className="h-11" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="total_cost">{t("total_cost")}</Label>
                <Input id="total_cost" name="total_cost" inputMode="decimal" placeholder="89,50" className="h-11" required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="odometer_km">{t("odometer")}</Label>
              <Input id="odometer_km" name="odometer_km" type="number" inputMode="numeric" min={1} className="h-11" required />
            </div>
            <div className="space-y-1.5">
              <Label>{t("fuel_type")}</Label>
              <Select value={fuelType} onValueChange={(v) => v && setFuelType(v as FuelType)}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FUEL_TYPES.map((ft) => (
                    <SelectItem key={ft} value={ft}>
                      {t(`type.${ft}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="station_name">{t("station")}</Label>
              <Input id="station_name" name="station_name" placeholder="OMV Feldkirch" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label>
                {t("photo")} <span className="text-destructive">*</span>
              </Label>
              <PhotoUpload onFile={setReceipt} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">{t("notes")}</Label>
              <Textarea id="notes" name="notes" rows={2} />
            </div>
            <Button type="submit" className="w-full h-12" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t("my_entries")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {entries.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("no_entries")}</p>
          ) : (
            entries.map((e) => (
              <ReceiptLightbox
                key={e.id}
                getUrl={() => getFuelReceiptUrl(e.id)}
                title={`${formatDate(e.fueled_at, locale)} · ${e.vehicle_plate}`}
                className="flex w-full items-center justify-between gap-2 rounded-md border p-3 text-left"
                info={
                  <>
                    <p className="nums">
                      {e.liters.toFixed(2).replace(".", ",")} L ·{" "}
                      {e.total_cost.toFixed(2).replace(".", ",")} € ·{" "}
                      {e.cost_per_liter.toFixed(3).replace(".", ",")} €/L
                    </p>
                    <p className="text-muted-foreground">
                      {t("odometer")}: {e.odometer_km.toLocaleString(locale === "de" ? "de-AT" : "tr-TR")} km · {t(`type.${e.fuel_type}`)}
                    </p>
                    {e.status === "rejected" && e.rejection_reason && (
                      <p className="border-l-2 border-destructive/40 pl-3 text-destructive">
                        {e.rejection_reason}
                      </p>
                    )}
                  </>
                }
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {formatDate(e.fueled_at, locale)} · {e.vehicle_plate}
                  </p>
                  <p className="text-xs text-muted-foreground nums">
                    {e.liters.toFixed(2).replace(".", ",")} L ·{" "}
                    {e.total_cost.toFixed(2).replace(".", ",")} €
                  </p>
                </div>
                <Badge variant={APPROVAL_BADGE[e.status]}>{ta(e.status)}</Badge>
              </ReceiptLightbox>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
