"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, FileText, KeyRound } from "lucide-react";
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
import { toggleActiveAction, resetPinAction } from "../../../actions/workers";
import type { Worker, TimeEntry } from "@/lib/types";

type Props = {
  worker: Worker;
  entries: TimeEntry[];
  monthSummary: { shifts: number; ms: number; km: number; cargo: number };
};

export function WorkerDetailClient({ worker, entries, monthSummary }: Props) {
  const t = useTranslations("workers");
  const ta = useTranslations("admin");
  const tc = useTranslations("common");
  const tpdf = useTranslations("pdf");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

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

  function handleReset() {
    if (!confirm(t("confirmPin", { name: worker.name }))) return;
    startTransition(async () => {
      const res = await resetPinAction(worker.id);
      if (res.ok && res.newPin) {
        alert(`${t("newPinFor", { name: worker.name })}\n\n${res.newPin}\n\n${t("newPinWarn")}`);
        router.refresh();
      } else {
        toast.error(res.error ?? "Error");
      }
    });
  }

  async function exportPdf() {
    const { downloadPdf } = await import("@/components/pdf/ShiftReport");
    await downloadPdf({
      title: `${tpdf("title")} — ${worker.name}`,
      company: tpdf("company"),
      address: tpdf("address"),
      period: `${tpdf("period")}: ${formatDate(entries[entries.length - 1]?.started_at, locale)} – ${formatDate(entries[0]?.started_at, locale)}`,
      generatedAt: `${tpdf("generatedAt")}: ${new Date().toLocaleString(
        locale === "de" ? "de-AT" : "tr-TR",
        { timeZone: "Europe/Vienna" }
      )}`,
      footer: tpdf("footer"),
      headers: {
        worker: ta("tblWorker"),
        date: ta("tblDate"),
        start: ta("tblStart"),
        end: ta("tblEnd"),
        worked: ta("tblWorked"),
        breakMin: ta("tblBreak"),
        km: ta("tblKm"),
        cargo: ta("tblCargo"),
        plate: ta("tblPlate"),
      },
      rows: entries.map((e) => {
        const w = workedMs(e);
        const km = kmDiff(e);
        return {
          worker: worker.name,
          date: formatDate(e.started_at, locale),
          start: formatTime(e.started_at, locale),
          end: e.ended_at ? formatTime(e.ended_at, locale) : "—",
          worked: formatDurationShort(w, locale),
          breakMin: String(e.break_minutes ?? 0),
          km: km !== null ? String(km) : "—",
          cargo: e.cargo_count !== null ? String(e.cargo_count) : "—",
          plate: e.plate ?? "—",
        };
      }),
      filename: `hak-${worker.name.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.pdf`,
    });
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
        <Button variant="outline" size="sm" onClick={handleReset} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          {t("resetPin")}
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
                    <TableHead>{ta("tblCargo")}</TableHead>
                    <TableHead>{ta("tblPlate")}</TableHead>
                    <TableHead>{ta("tblNote")}</TableHead>
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
                        <TableCell className="nums">{e.cargo_count ?? "—"}</TableCell>
                        <TableCell className="nums">{e.plate ?? "—"}</TableCell>
                        <TableCell className="max-w-[200px] truncate" title={e.notes ?? ""}>
                          {e.notes ?? "—"}
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
    </>
  );
}
