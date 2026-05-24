"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, KeyRound } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { UserAvatar } from "@/components/UserAvatar";
import type { WorkerWithStats } from "./page";

type Props = { workers: WorkerWithStats[] };

export function WorkersClient({ workers }: Props) {
  const router = useRouter();
  const t = useTranslations("workers");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [shownPin, setShownPin] = useState<{ worker: string; pin: string } | null>(null);

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
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
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
                {workers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      {t("noWorkers")}
                    </TableCell>
                  </TableRow>
                ) : (
                  workers.map((w) => (
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
                        </Link>
                      </TableCell>
                      <TableCell className="nums">{w.phone}</TableCell>
                      <TableCell className="nums">{w.plate ?? "—"}</TableCell>
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
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleReset(w)}
                            disabled={pending}
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
