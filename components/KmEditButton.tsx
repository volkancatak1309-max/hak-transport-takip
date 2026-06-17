"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Pencil, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminUpdateKmAction } from "@/app/actions/shift";

/** Admin-only quick odometer correction for any shift (open or closed). */
export function KmEditButton({
  entryId,
  startKm,
  endKm,
}: {
  entryId: string;
  startKm: number;
  endKm: number | null;
}) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [s, setS] = useState(String(startKm));
  const [e, setE] = useState(endKm === null ? "" : String(endKm));
  const [pending, start] = useTransition();

  function reset() {
    setS(String(startKm));
    setE(endKm === null ? "" : String(endKm));
  }

  function save() {
    const sv = Number(s);
    const ev = e.trim() === "" ? null : Number(e);
    if (!Number.isFinite(sv) || sv < 0) return toast.error(`KM ${tc("save")}`);
    if (ev !== null && (!Number.isFinite(ev) || ev < 0)) return toast.error(`KM`);
    if (ev !== null && ev < sv) return toast.error(`KM ${ev} < ${sv}`);
    start(async () => {
      const r = await adminUpdateKmAction(entryId, sv, ev);
      if (r.ok) {
        toast.success(t("kmUpdated"));
        setOpen(false);
        router.refresh();
      } else if (r.error?.startsWith("km_low:")) {
        const [, a, b] = r.error.split(":");
        toast.error(`KM ${a} < ${b}`);
      } else {
        toast.error(r.error ?? "Error");
      }
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        aria-label={t("editKm")}
        title={t("editKm")}
      >
        <Pencil className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editKmTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="km_s">{t("kmStartLabel")}</Label>
              <Input
                id="km_s"
                type="number"
                inputMode="numeric"
                value={s}
                onChange={(ev) => setS(ev.target.value)}
                className="h-11 nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="km_e">{t("kmEndLabel")}</Label>
              <Input
                id="km_e"
                type="number"
                inputMode="numeric"
                value={e}
                onChange={(ev) => setE(ev.target.value)}
                className="h-11 nums"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
