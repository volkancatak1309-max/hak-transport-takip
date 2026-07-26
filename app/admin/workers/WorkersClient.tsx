"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  KeyRound,
  UserPlus,
  MoreHorizontal,
  Pencil,
  Power,
  UserMinus,
  MapPinOff,
  PlayCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { RevealFilterRow } from "@/components/ui-v2";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toggleActiveAction } from "../../actions/workers";
import { setDepotExemptionAction } from "@/app/actions/depot";
import { formatDate, formatDurationShort } from "@/lib/format";
import { licenseState, LICENSE_BADGE } from "@/lib/worker-ui";
import { UserAvatar } from "@/components/UserAvatar";
import { AddWorkerDialog } from "@/components/admin/AddWorkerDialog";
import { EditWorkerDialog } from "@/components/admin/EditWorkerDialog";
import { SetPinDialog } from "@/components/admin/SetPinDialog";
import { TerminateWorkerDialog } from "@/components/admin/TerminateWorkerDialog";
import { StartShiftForWorkerDialog } from "@/components/admin/StartShiftForWorkerDialog";
import type { WorkerWithStats } from "./page";

type Props = { workers: WorkerWithStats[] };

export function WorkersClient({ workers }: Props) {
  const router = useRouter();
  const t = useTranslations("workers");
  const tc = useTranslations("common");
  const ta = useTranslations("admin");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  // PIN'i YÖNETİCİ belirler (SetPinDialog). Mevcut PIN hiçbir yerde gösterilmez.
  const [pinFor, setPinFor] = useState<WorkerWithStats | null>(null);
  const [editing, setEditing] = useState<WorkerWithStats | null>(null);
  const [terminating, setTerminating] = useState<WorkerWithStats | null>(null);
  // Manuel vardiya başlatma (yönetici) — otomatik açılmayan personel için.
  const [startingShift, setStartingShift] = useState<WorkerWithStats | null>(null);
  // Client-side status filter. Default "active" so the passive roster doesn't
  // clutter the list; passive workers are only hidden, never deleted — their
  // shift history stays intact. The dataset is one company's staff (already
  // fully fetched with stats), so filtering here beats a server round-trip.
  const [status, setStatus] = useState<"active" | "passive" | "all">("active");
  // İşten AYRILANLAR (terminated_at dolu) ana listeden çıkar → aşağıda "Eski
  // Personeller" bölümünde. Ana tablo yalnız hâlâ kadrodakileri gösterir;
  // pasif = geçici durdurulmuş (ayrılmış değil).
  const roster = workers.filter((w) => !w.terminated_at);
  const former = workers.filter((w) => w.terminated_at);
  const visible = roster.filter((w) =>
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

  function handleDepotExempt(w: WorkerWithStats) {
    startTransition(async () => {
      const res = await setDepotExemptionAction(w.id);
      if (res.ok) {
        toast.success(tc("save"));
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
                        {/* İşlemler araçlardaki gibi tek üç-nokta menüde toplandı
                            (Düzenle / PIN Sıfırla / Aktif-Pasif) — hem masaüstü
                            hem mobilde tek dokunuşla erişilir, satır dar ekranda
                            taşmaz. Handler'lar aynen korundu. */}
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                disabled={pending}
                                aria-label={tc("actions")}
                              />
                            }
                          >
                            <MoreHorizontal className="size-4 text-text-tertiary" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {/* Manuel vardiya başlatma — otomatik açılmayan
                                personel için (telemetri düştüğünde). Yalnız
                                AKTİF şoförde anlamlı. */}
                            {w.is_active && (
                              <DropdownMenuItem onClick={() => setStartingShift(w)}>
                                <PlayCircle className="size-4" /> {t("startShift")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => setEditing(w)}>
                              <Pencil className="size-4" /> {tc("edit")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setPinFor(w)}>
                              <KeyRound className="size-4" /> {t("setPin")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleToggle(w)}>
                              <Power className="size-4" />{" "}
                              {w.is_active ? t("deactivate") : t("activate")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setTerminating(w)}>
                              <UserMinus className="size-4" /> {t("terminate")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDepotExempt(w)}>
                              <MapPinOff className="size-4" /> {t("depotExempt")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── ESKİ PERSONELLER ── işten ayrılanlar (terminated_at). Kayıtlar
          silinmez; adları geçmiş raporlarda kalır (7 yıl arşiv). */}
      {former.length > 0 && (
        <details className="mt-5 rounded-2xl border border-border/60 bg-card">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold">
            {t("formerTitle", { n: former.length })}
          </summary>
          <div className="border-t border-border/60 px-4 py-3">
            <p className="mb-3 text-xs text-muted-foreground">{t("formerNote")}</p>
            <ul className="divide-y divide-border/50">
              {former.map((w) => (
                <li
                  key={w.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <UserAvatar name={w.name} size="xs" />
                    <span className="font-medium">{w.name}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="nums">
                      {t("formerPeriod")}:{" "}
                      {w.employment_start
                        ? formatDate(w.employment_start, locale)
                        : "—"}
                      {" → "}
                      {w.terminated_at ? formatDate(w.terminated_at, locale) : "—"}
                    </span>
                    <Link
                      href={`/admin/workers/${w.id}`}
                      className="font-medium text-accent-sky-text hover:underline"
                    >
                      {t("formerReport")}
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      <StartShiftForWorkerDialog
        worker={startingShift ? { id: startingShift.id, name: startingShift.name } : null}
        onClose={() => setStartingShift(null)}
        onDone={() => router.refresh()}
      />
      <EditWorkerDialog worker={editing} onClose={() => setEditing(null)} />
      <SetPinDialog worker={pinFor} onClose={() => setPinFor(null)} />
      <TerminateWorkerDialog
        worker={terminating ? { id: terminating.id, name: terminating.name } : null}
        onClose={() => setTerminating(null)}
      />
    </>
  );
}
