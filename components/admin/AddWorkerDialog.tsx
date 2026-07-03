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
import { createWorkerAction } from "@/app/actions/workers";

type Props = {
  /** The element that opens the dialog (a styled Button). Each page supplies
   *  its own so the trigger matches that surface's toolbar/header. Base UI
   *  merges the trigger props into this element via `render`. */
  children: ReactElement;
};

/**
 * Shared "add worker" dialog used by both the admin dashboard and the workers
 * page. Owns its open state, submit transition and the createWorkerAction call
 * (which flags the new account must_change_pin server-side). The trigger is
 * passed as children via DialogTrigger so each surface keeps its own styling.
 */
export function AddWorkerDialog({ children }: Props) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

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
    };
    return known[e] ?? e;
  }

  function handleCreate(formData: FormData) {
    startTransition(async () => {
      const res = await createWorkerAction(formData);
      if (res.ok) {
        toast.success(t("workerAdded"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(mapCreateErr(res.error));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={children} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("createWorker")}</DialogTitle>
        </DialogHeader>
        <form action={handleCreate} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">{t("name")}</Label>
            <Input id="name" name="name" required className="h-11" />
          </div>
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
              required
              className="h-11 tracking-widest"
            />
          </div>
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
