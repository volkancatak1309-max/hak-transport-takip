"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, KeyRound, Route, Pencil } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { RoutePoint } from "@/components/RouteMap";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatDate,
  formatTime,
  formatDurationShort,
  workedMs,
  kmDiff,
  formatDuration,
} from "@/lib/format";
import { toggleActiveAction } from "../../../actions/workers";
import { SetPinDialog } from "@/components/admin/SetPinDialog";
import {
  SHIFT_REPORT_DE,
  REPORT_LOCALE,
  buildShiftReportRow,
} from "@/lib/report-de";
import { KmEditButton } from "@/components/KmEditButton";
import { EditWorkerDialog } from "@/components/admin/EditWorkerDialog";
import type { WorkerPublic, TimeEntry } from "@/lib/types";

const RouteMap = dynamic(
  () => import("@/components/RouteMap").then((m) => m.RouteMap),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[50vh] w-full rounded-lg" />,
  }
);

type Props = {
  worker: WorkerPublic;
  entries: TimeEntry[];
  routePoints: RoutePoint[];
  monthSummary: { shifts: number; ms: number; km: number; cargo: number };
};

export function WorkerDetailClient({
  worker,
  entries,
  routePoints,
  monthSummary,
}: Props) {
  const t = useTranslations("workers");
  const ta = useTranslations("admin");
  const tc = useTranslations("common");
  const tmap = useTranslations("map");
  const tExport = useTranslations("export");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  function handleToggle() {
    if (
      !confirm(
        t("confirmStatus", {
          name: worker.name,
          action: worker.is_active ? tc("passive") : tc("active"),
        })
      )
    )
      return;
    startTransition(async () => {
      const res = await toggleActiveAction(worker.id);
      if (res.ok) {
        toast.success(tc("save"));
        router.refresh();
      } else toast.error(res.error ?? "Error");
    });
  }


  async function exportPdf() {
    try {
      const { downloadPdf } = await import("@/components/pdf/ShiftReport");
      // Arayüz dili ne olursa olsun SABİT ALMANCA — bkz. lib/report-de.ts.
      await downloadPdf({
      title: `${SHIFT_REPORT_DE.title} — ${worker.name}`,
      company: SHIFT_REPORT_DE.company,
      address: SHIFT_REPORT_DE.address,
      uid: SHIFT_REPORT_DE.uid,
      period: `${SHIFT_REPORT_DE.period}: ${formatDate(entries[entries.length - 1]?.started_at, REPORT_LOCALE)} – ${formatDate(entries[0]?.started_at, REPORT_LOCALE)}`,
      generatedAt: `${SHIFT_REPORT_DE.generatedAt}: ${new Date().toLocaleString(
        "de-AT",
        { timeZone: "Europe/Vienna" }
      )}`,
      footer: SHIFT_REPORT_DE.footer,
      headers: SHIFT_REPORT_DE.headers,
      rows: entries.map((e) => buildShiftReportRow(e, worker.name)),
      filename: `hak-${worker.name.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
    } catch {
      toast.error(tExport("error"));
    }
  }

  const nf = locale === "de" ? "de-AT" : "tr-TR";

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("totalShifts")}
            </div>
            <div className="text-2xl font-bold mt-1 nums">{monthSummary.shifts}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("totalHours")}
            </div>
            <div className="text-2xl font-bold mt-1 nums">
              {formatDuration(monthSummary.ms)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("totalKm")}
            </div>
            <div className="text-2xl font-bold mt-1 nums">
              {monthSummary.km.toLocaleString(nf)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("totalCargo")}
            </div>
            <div className="text-2xl font-bold mt-1 nums">{monthSummary.cargo}</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 justify-end">
        {/* Düzenle — personel dosyasını (telefon/SV/ehliyet/adres/acil durum/araç)
            düzeltir. flex-wrap sayesinde 390px'te de görünür ve dokunulabilir. */}
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="size-4" />
          {tc("edit")}
        </Button>
        {/* PIN'i yönetici belirler; mevcut PIN gösterilmez (bcrypt, geri
            döndürülemez). Bkz. components/admin/SetPinDialog. */}
        <Button variant="outline" size="sm" onClick={() => setPinOpen(true)}>
          <KeyRound className="size-4" />
          {t("setPin")}
        </Button>
        <Button
          variant={worker.is_active ? "outline" : "default"}
          size="sm"
          onClick={handleToggle}
          disabled={pending}
        >
          {worker.is_active ? t("deactivate") : t("activate")}
        </Button>
        <Button size="sm" onClick={exportPdf} disabled={entries.length === 0}>
          <FileText className="size-4" />
          {t("pdfForWorker")}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Route className="size-4 text-primary" />
            {tmap("today_route")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {routePoints.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              {tmap("no_route_data")}
            </p>
          ) : (
            <div className="h-[50vh] w-full overflow-hidden rounded-b-lg">
              <RouteMap points={routePoints} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t("fullHistory")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {ta("noEntries")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{ta("tblDate")}</TableHead>
                    <TableHead>{ta("tblStart")}</TableHead>
                    <TableHead>{ta("tblEnd")}</TableHead>
                    <TableHead>{ta("tblWorked")}</TableHead>
                    <TableHead>{ta("tblBreak")}</TableHead>
                    <TableHead>{ta("tblKm")}</TableHead>
                    <TableHead>{ta("tblLoaded")}</TableHead>
                    <TableHead>{ta("tblCargo")}</TableHead>
                    <TableHead>{ta("tblPlate")}</TableHead>
                    <TableHead>{ta("tblNote")}</TableHead>
                    <TableHead className="text-right">{ta("tblActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => {
                    const w = workedMs(e);
                    const km = kmDiff(e);
                    const isActive = e.ended_at === null;
                    return (
                      <TableRow key={e.id} className={isActive ? "border-l-4 border-l-primary" : ""}>
                        <TableCell>{formatDate(e.started_at, locale)}</TableCell>
                        <TableCell className="nums">{formatTime(e.started_at, locale)}</TableCell>
                        <TableCell className="nums">{formatTime(e.ended_at, locale)}</TableCell>
                        <TableCell className="nums">{formatDurationShort(w, locale)}</TableCell>
                        <TableCell className="nums">{e.break_minutes ?? 0}</TableCell>
                        <TableCell className="nums">
                          {km !== null ? km.toLocaleString(nf) : "—"}
                        </TableCell>
                        <TableCell className="nums">{e.start_package_count ?? "—"}</TableCell>
                        <TableCell className="nums">{isActive ? "—" : e.cargo_count ?? "—"}</TableCell>
                        <TableCell className="nums">{e.plate ?? "—"}</TableCell>
                        {/* Vardiya notu mobilde SARAR, masaüstünde 200px'te
                            kırpılır — bkz. ExpenseAdminClient'taki aynı kalıp.
                            `sm:` öneki masaüstünü değiştirmez. */}
                        <TableCell
                          className="whitespace-normal break-words sm:max-w-[200px] sm:truncate"
                          title={e.notes ?? ""}
                        >
                          {e.notes ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <KmEditButton entryId={e.id} startKm={e.start_km} endKm={e.end_km} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <EditWorkerDialog
        worker={editOpen ? worker : null}
        onClose={() => setEditOpen(false)}
      />
      <SetPinDialog
        worker={pinOpen ? { id: worker.id, name: worker.name } : null}
        onClose={() => setPinOpen(false)}
      />
    </>
  );
}
