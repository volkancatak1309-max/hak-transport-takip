"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { UserMinus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { terminateWorkerAction } from "@/app/actions/workers";
import { TENANT_TZ } from "@/lib/tz";

/** Bugünün Viyana takvim tarihi (YYYY-MM-DD) — son çalışma günü varsayılanı. */
function todayYmdVienna(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TENANT_TZ });
}

/**
 * İŞTEN ÇIKIŞ diyaloğu (Modül 2). Son çalışma gününü sorar, onay ister.
 * terminateWorkerAction: terminated_at + is_active=false + filo şefliği bırak.
 * Araç ataması boşaltılmaz — "şoförsüz araç" Dikkat kalemi devreye girer.
 */
export function TerminateWorkerDialog({
  worker,
  onClose,
}: {
  worker: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const t = useTranslations("workers");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lastDay, setLastDay] = useState(todayYmdVienna());

  if (!worker) return null;
  const w = worker;

  function submit() {
    start(async () => {
      const res = await terminateWorkerAction(w.id, lastDay);
      if (res.ok) {
        toast.success(tc("save"));
        router.refresh();
        onClose();
      } else {
        toast.error(res.error ?? "Error");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="close"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="glass relative w-full max-w-sm rounded-2xl p-5 page-enter">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <UserMinus className="size-4 text-accent-claret-text" />
            {t("terminateTitle")}
          </h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="close">
            <X className="size-5" />
          </Button>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          {t("terminateHint", { name: w.name })}
        </p>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("terminateDate")}
          </span>
          <input
            type="date"
            value={lastDay}
            onChange={(e) => setLastDay(e.target.value)}
            className="w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={pending || !lastDay}
          >
            {t("terminateConfirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
