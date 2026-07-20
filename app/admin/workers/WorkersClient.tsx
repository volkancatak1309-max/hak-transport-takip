"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, KeyRound, UserPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { RevealFilterRow } from "@/components/ui-v2";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toggleActiveAction, resetPinAction } from "../../actions/workers";
import { formatDate, formatDurationShort } from "@/lib/format";
import { licenseState, LICENSE_BADGE } from "@/lib/worker-ui";
import { UserAvatar } from "@/components/UserAvatar";
import { AddWorkerDialog } from "@/components/admin/AddWorkerDialog";
import type { WorkerWithStats } from "./page";

type Props = { workers: WorkerWithStats[] };

export function WorkersClient({ workers }: Props) {
  const router = useRouter();
  const t = useTranslations("workers");
  const tc = useTranslations("common");
  const ta = useTranslations("admin");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [shownPin, setShownPin] = useState<{ worker: string; pin: string } | null>(null);
  // Client-side status filter. Default "active" so the passive roster doesn't
  // clutter the list; passive workers are only hidden, never deleted — their
  // shift history stays intact. The dataset is one company's staff (already
  // fully fetched with stats), so filtering here beats a server round-trip.
  const [status, setStatus] = useState<"active" | "passive" | "all">("active");
  const visible = workers.filter((w) =>
    status === "all" ? true : status === "active" ? w.is_active : !w.is_active
  );

  function handleToggle(w: WorkerWithStats) {
    if (
      !confirm(
        t("confirmStatus", {
          name: w.name,
          action: w.is_active ? tc("passive") : tc("active"),
        })
      )
    )
      return;
    startTransition(async () => {
      const res = await toggleActiveAction(w.id);
      if (res.ok) {
        toast.success(tc("save"));
        router.refresh();
      } else {
        toast.error(res.error ?? "Error");
      }
    });
  }

  function handleReset(w: WorkerWithStats) {
    if (!confirm(t("confirmPin", { name: w.name }))) return;
    startTransition(async () => {
      const res = await resetPinAction(w.id);
      if (res.ok && res.newPin) {
        setShownPin({ worker: w.name, pin: res.newPin });
        router.refresh();
      } else {
        toast.error(res.error ?? "Error");
      }
    });
  }

  return (
    <>
      {/* Başlık bloğu — klon A2 ölçüsü */}
      <div>
        <h1 className="text-[28px] font-semibold leading-tight">{t("title")}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Filtre bandı — A3 dili. Eski buton grubu (Aktif/Pasif/Tümü) tek
          "Durum" dropdown'ına indi; çalışan ekleme bandın sağında. */}
      <RevealFilterRow
        className="mb-4"
        filters={[
          {
            label: t("filter_status"),
            value: status,
            onChange: (v) => setStatus(v as "active" | "passive" | "all"),
            options: [
              { value: "active", label: tc("active") },
              { value: "passive", label: tc("passive") },
              { value: "all", label: tc("all") },
            ],
          },
        ]}
        right={
          <AddWorkerDialog>
            <Button className="h-9" title={ta("addWorker")}>
              <UserPlus className="size-4" />
              <span className="ml-1 hidden sm:inline">{ta("addWorker")}</span>
            </Button>
          </AddWorkerDialog>
        }
      />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("tblName")}</TableHead>
                  <TableHead>{t("tblPhone")}</TableHead>
                  <TableHead>{t("tblPlate")}</TableHead>
                  <TableHead>{t("tblStatus")}</TableHead>
                  <TableHead>{t("tblLastShift")}</TableHead>
                  <TableHead>{t("tblMonthHours")}</TableHead>
                  <TableHead className="text-right">{t("tblActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      {t("noWorkers")}
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((w) => (
                    <TableRow key={w.id} className={!w.is_active ? "opacity-60" : ""}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/admin/workers/${w.id}`}
                          className="flex items-center gap-2 hover:text-primary"
                        >
                          <UserAvatar name={w.name} size="sm" />
                          <span className="hover:underline">{w.name}</span>
                          {w.is_admin && (
                            <Badge variant="secondary" className="text-[10px]">
                              {tc("admin")}
                            </Badge>
                          )}
                          {/* Ehliyet uyarısı (migration 025): geçmiş = kritik,
                              60 gün içinde = gold — FleetDtcCard rozet ailesi. */}
                          {(() => {
                            const ls = licenseState(w.license_expiry);
                            if (!ls) return null;
                            return (
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] sm:text-[11px] font-semibold ${LICENSE_BADGE[ls.state]}`}
                              >
                                {ls.state === "expired"
                                  ? t("licenseExpired")
                                  : t("licenseExpiring", { days: ls.days })}
                              </span>
                            );
                          })()}
                        </Link>
                      </TableCell>
                      <TableCell className="nums">{w.phone}</TableCell>
                      <TableCell className="nums uppercase">
                        {w.assignedPlate ?? "—"}
                      </TableCell>
                      <TableCell>
                        {w.is_active ? (
                          <Badge variant="default">{tc("active")}</Badge>
                        ) : (
                          <Badge variant="outline">{tc("passive")}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {w.lastShiftAt ? formatDate(w.lastShiftAt, locale) : "—"}
                      </TableCell>
                      <TableCell className="nums">
                        {formatDurationShort(w.monthHoursMs, locale)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          {/* aria-label ŞART: metin `hidden md:inline` — dar
                              ekranda gizlenince butonun erişilebilir adı hiç
                              kalmıyordu (Lighthouse button-name, mobil). */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleReset(w)}
                            disabled={pending}
                            aria-label={t("resetPin")}
                          >
                            <KeyRound className="size-4" />
                            <span className="hidden md:inline ml-1">{t("resetPin")}</span>
                          </Button>
                          <Button
                            variant={w.is_active ? "outline" : "default"}
                            size="sm"
                            onClick={() => handleToggle(w)}
                            disabled={pending}
                          >
                            {w.is_active ? t("deactivate") : t("activate")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!shownPin} onOpenChange={(o) => !o && setShownPin(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("newPin")}</DialogTitle>
          </DialogHeader>
          {shownPin && (
            <div className="text-center space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("newPinFor", { name: shownPin.worker })}
              </p>
              <p className="nums text-5xl font-bold tracking-widest text-foreground bg-secondary rounded-lg py-6">
                {shownPin.pin}
              </p>
              <p className="text-xs text-destructive">{t("newPinWarn")}</p>
              <DialogFooter>
                <Button onClick={() => setShownPin(null)} className="w-full">
                  {t("newPinClose")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
