"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Receipt, Plus, Check, Undo2, Trash2, Loader2 } from "lucide-react";
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
import { HelpTip } from "@/components/help/HelpTip";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  addVehiclePenalty,
  setVehiclePenaltyPaid,
  deleteVehiclePenalty,
} from "@/app/actions/vehicles";
import type { VehiclePenalty } from "@/lib/types";

/** Admin-only penalty (Strafe) list + add/pay/delete for one vehicle. */
export function PenaltiesSection({
  vehicleId,
  penalties,
}: {
  vehicleId: string;
  penalties: VehiclePenalty[];
}) {
  const td = useTranslations("vehicles.detail");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const nf = locale === "de" ? "de-AT" : "tr-TR";

  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [pending, start] = useTransition();
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const money = (n: number | null) =>
    n === null ? "—" : `${n.toLocaleString(nf, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

  function add() {
    const amt = amount.trim() === "" ? null : Number(amount.replace(",", "."));
    if (amt !== null && (!Number.isFinite(amt) || amt < 0)) {
      return toast.error(td("penalty_amount"));
    }
    start(async () => {
      const r = await addVehiclePenalty(vehicleId, {
        penalty_date: date,
        amount: amt,
        description: desc,
      });
      if (r.ok) {
        toast.success(td("penalty_added"));
        setOpen(false);
        setAmount("");
        setDesc("");
        setDate(new Date().toISOString().slice(0, 10));
        router.refresh();
      } else {
        toast.error(td("penalty_error"));
      }
    });
  }

  function togglePaid(p: VehiclePenalty) {
    setRowBusy(p.id);
    start(async () => {
      const r = await setVehiclePenaltyPaid(p.id, !p.paid);
      if (r.ok) {
        toast.success(td("penalty_saved"));
        router.refresh();
      } else {
        toast.error(td("penalty_error"));
      }
      setRowBusy(null);
    });
  }

  function remove(p: VehiclePenalty) {
    if (!window.confirm(td("penalty_delete_confirm"))) return;
    setRowBusy(p.id);
    start(async () => {
      const r = await deleteVehiclePenalty(p.id);
      if (r.ok) {
        toast.success(td("penalty_deleted"));
        router.refresh();
      } else {
        toast.error(td("penalty_error"));
      }
      setRowBusy(null);
    });
  }

  const unpaidTotal = penalties
    .filter((p) => !p.paid && p.amount !== null)
    .reduce((s, p) => s + (p.amount ?? 0), 0);

  return (
    <section className="glass rounded-[16px] p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Receipt className="size-[18px] text-text-tertiary" />
          {td("penalties_title")}
          <HelpTip tkey="veh_penalties" />
          {penalties.some((p) => !p.paid) && (
            <span className="nums rounded-full bg-accent-claret/12 px-2 py-0.5 text-[11px] font-semibold text-accent-claret">
              {money(unpaidTotal)}
            </span>
          )}
        </h3>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          {td("penalties_add")}
        </Button>
      </div>

      {penalties.length === 0 ? (
        <p className="text-sm text-text-tertiary">{td("penalties_none")}</p>
      ) : (
        <ul className="-mx-1 divide-y divide-border">
          {penalties.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-1 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="nums font-medium">{money(p.amount)}</span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                      p.paid
                        ? "bg-accent-sky/12 text-accent-sky"
                        : "bg-accent-claret/12 text-accent-claret"
                    )}
                  >
                    {p.paid ? td("penalty_paid") : td("penalty_unpaid")}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-text-tertiary">
                  {formatDate(p.penalty_date, locale)}
                  {p.description ? ` · ${p.description}` : ""}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={rowBusy === p.id}
                onClick={() => togglePaid(p)}
                aria-label={p.paid ? td("penalty_mark_unpaid") : td("penalty_mark_paid")}
                title={p.paid ? td("penalty_mark_unpaid") : td("penalty_mark_paid")}
              >
                {rowBusy === p.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : p.paid ? (
                  <Undo2 className="size-4" />
                ) : (
                  <Check className="size-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={rowBusy === p.id}
                onClick={() => remove(p)}
                aria-label={td("penalty_delete")}
                title={td("penalty_delete")}
              >
                <Trash2 className="size-4 text-accent-claret" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{td("penalties_add")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pen_date">{td("penalty_date")}</Label>
              <Input
                id="pen_date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pen_amount">{td("penalty_amount_optional")}</Label>
              <Input
                id="pen_amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-11 nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pen_desc">{td("penalty_desc")}</Label>
              <Input
                id="pen_desc"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder={td("penalty_desc_ph")}
                className="h-11"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={add} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
