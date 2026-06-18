"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertTriangle,
  Pencil,
  Trash2,
  FileSpreadsheet,
  FileText,
  Shield,
  UserPlus,
  Loader2,
} from "lucide-react";
import {
  formatDate,
  formatTime,
  formatDuration,
  formatDurationShort,
  workedMs,
  kmDiff,
} from "@/lib/format";
import { UserAvatar } from "@/components/UserAvatar";
import { OpsSummary } from "@/components/admin/OpsSummary";
import { FleetStatus } from "@/components/admin/FleetStatus";
import { DriverPerformance } from "@/components/admin/DriverPerformance";
import { AttentionList } from "@/components/admin/AttentionList";
import type { DashboardData } from "@/lib/admin-dashboard";
import {
  createWorkerAction,
} from "../actions/workers";
import {
  editEntryAction,
  deleteEntryAction,
} from "../actions/shift";
import type { TimeEntryWithWorker, Worker } from "@/lib/types";

const NINE_HOURS = 9 * 60 * 60 * 1000;

type Props = {
  entries: TimeEntryWithWorker[];
  workers: Worker[];
  range: string;
  from: string;
  to: string;
  workerFilter: string;
  statusFilter: string;
  summary: { totalMs: number; totalKm: number; activeCount: number; overLimit: number };
  dashboard: DashboardData;
  rangeStart: string;
  rangeEnd: string;
};

export function AdminClient({
  entries,
  workers,
  range,
  from,
  to,
  workerFilter,
  statusFilter,
  summary,
  dashboard,
  rangeStart,
  rangeEnd,
}: Props) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const tpdf = useTranslations("pdf");
  const tExport = useTranslations("export");
  const tAzg = useTranslations("azg");
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();

  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState<TimeEntryWithWorker | null>(null);
  const [azgOpen, setAzgOpen] = useState(false);
  const [azgMonth, setAzgMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [azgBusy, setAzgBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(Date.now());

  const monthOptions = (() => {
    const opts: { value: string; label: string }[] = [];
    const base = new Date();
    base.setDate(1);
    for (let i = 0; i < 12; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString(locale === "de" ? "de-AT" : "tr-TR", {
        month: "long",
        year: "numeric",
      });
      opts.push({ value, label });
    }
    return opts;
  })();

  function downloadCsv(csv: string, filename: string) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleDatev() {
    setExportBusy(true);
    try {
      const { generateDATEV } = await import("../actions/datev-export");
      const res = await generateDATEV(rangeStart, rangeEnd);
      if (res.ok) {
        downloadCsv(res.csv, res.filename);
        toast.success(tExport("datev_success"));
      } else {
        toast.error(res.error === "no_data" ? tExport("no_data") : tExport("error"));
      }
    } catch {
      toast.error(tExport("error"));
    } finally {
      setExportBusy(false);
    }
  }

  async function handleBmd() {
    setExportBusy(true);
    try {
      const { generateBMD } = await import("../actions/bmd-export");
      const res = await generateBMD(rangeStart, rangeEnd);
      if (res.ok) {
        downloadCsv(res.csv, res.filename);
        toast.success(tExport("bmd_success"));
      } else {
        toast.error(res.error === "no_data" ? tExport("no_data") : tExport("error"));
      }
    } catch {
      toast.error(tExport("error"));
    } finally {
      setExportBusy(false);
    }
  }

  async function handleAzg() {
    setAzgBusy(true);
    try {
      const { getAZGReportData } = await import("../actions/azg-report");
      const res = await getAZGReportData(azgMonth);
      if (!res.ok) {
        toast.error(tAzg("error"));
        return;
      }
      const { downloadAZGReport } = await import("@/components/pdf/AZGReport");
      await downloadAZGReport(res.data, tAzg("report_title"));
      toast.success(tAzg("success"));
      setAzgOpen(false);
    } catch {
      toast.error(tAzg("error"));
    } finally {
      setAzgBusy(false);
    }
  }

  useEffect(() => {
    if (summary.activeCount === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [summary.activeCount]);

  function setParam(key: string, value: string) {
    const u = new URLSearchParams(params.toString());
    if (value && value !== "all") u.set(key, value);
    else u.delete(key);
    if (key === "range" && value !== "custom") {
      u.delete("from");
      u.delete("to");
    }
    router.push(`/admin?${u.toString()}`);
  }

  function handleCreate(formData: FormData) {
    startTransition(async () => {
      const res = await createWorkerAction(formData);
      if (res.ok) {
        toast.success(t("workerAdded"));
        setAddOpen(false);
        router.refresh();
      } else {
        toast.error(res.error ?? "Error");
      }
    });
  }

  function handleEdit(formData: FormData) {
    startTransition(async () => {
      const res = await editEntryAction(formData);
      if (res.ok) {
        toast.success(t("updated"));
        setEditOpen(null);
        router.refresh();
      } else {
        toast.error(mapErr(res.error));
      }
    });
  }

  function handleDelete(entry: TimeEntryWithWorker) {
    if (
      !confirm(
        t("deleteConfirm", {
          name: entry.workers?.name ?? "—",
          date: formatDate(entry.started_at, locale),
        })
      )
    )
      return;
    startTransition(async () => {
      const res = await deleteEntryAction(entry.id);
      if (res.ok) {
        toast.success(t("deleted"));
        router.refresh();
      } else {
        toast.error(res.error ?? "Error");
      }
    });
  }

  function mapErr(e?: string): string {
    if (!e) return "Error";
    if (e.startsWith("km_low:")) {
      const [, end, start] = e.split(":");
      return `KM ${end} < ${start}`;
    }
    return e;
  }

  function exportCsv() {
    const header = [
      t("tblWorker"),
      t("tblDate"),
      t("tblStart"),
      t("tblEnd"),
      t("tblWorked"),
      t("tblBreak"),
      t("tblKm"),
      t("tblCargo"),
      t("tblUndelivered"),
      t("tblPlate"),
      t("tblNote"),
    ];
    const rows = entries.map((e) => {
      const w = workedMs(e);
      const km = kmDiff(e);
      return [
        e.workers?.name ?? "",
        formatDate(e.started_at, locale),
        formatTime(e.started_at, locale),
        e.ended_at ? formatTime(e.ended_at, locale) : "ACTIVE",
        formatDurationShort(w, locale),
        String(e.break_minutes ?? 0),
        km !== null ? String(km) : "",
        e.cargo_count !== null ? String(e.cargo_count) : "",
        e.undelivered_count !== null ? String(e.undelivered_count) : "",
        e.plate ?? "",
        (e.notes ?? "").replace(/[\r\n]+/g, " "),
      ];
    });
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
      .join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hak-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportPdf() {
    try {
      const { downloadPdf } = await import("@/components/pdf/ShiftReport");
      await downloadPdf({
      title: tpdf("title"),
      company: tpdf("company"),
      address: tpdf("address"),
      period: `${tpdf("period")}: ${range}`,
      generatedAt: `${tpdf("generatedAt")}: ${new Date().toLocaleString(
        locale === "de" ? "de-AT" : "tr-TR",
        { timeZone: "Europe/Vienna" }
      )}`,
      footer: tpdf("footer"),
      headers: {
        worker: t("tblWorker"),
        date: t("tblDate"),
        start: t("tblStart"),
        end: t("tblEnd"),
        worked: t("tblWorked"),
        breakMin: t("tblBreak"),
        startKm: t("tblStartKm"),
        endKm: t("tblEndKm"),
        km: t("tblKm"),
        cargo: t("tblCargo"),
        undelivered: t("tblUndelivered"),
        plate: t("tblPlate"),
      },
      rows: entries.map((e) => {
        const w = workedMs(e);
        const km = kmDiff(e);
        return {
          worker: e.workers?.name ?? "—",
          date: formatDate(e.started_at, locale),
          start: formatTime(e.started_at, locale),
          end: e.ended_at ? formatTime(e.ended_at, locale) : "—",
          worked: formatDurationShort(w, locale),
          breakMin: String(e.break_minutes ?? 0),
          startKm: e.start_km != null ? String(e.start_km) : "—",
          endKm: e.end_km != null ? String(e.end_km) : "—",
          km: km !== null ? String(km) : "—",
          cargo: e.cargo_count !== null ? String(e.cargo_count) : "—",
          undelivered: e.undelivered_count !== null ? String(e.undelivered_count) : "—",
          plate: e.plate ?? "—",
        };
      }),
      filename: `hak-report-${range}-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
    } catch {
      toast.error(tExport("error"));
    }
  }

  const nf = locale === "de" ? "de-AT" : "tr-TR";

  return (
    <div className="space-y-6">
      {/* 1 — Today's live operations snapshot */}
      <OpsSummary ops={dashboard.todayOps} />

      {/* 2 + 4 — Fleet status distribution & action items */}
      <div className="grid gap-6 lg:grid-cols-2">
        <FleetStatus fleet={dashboard.fleet} />
        <AttentionList items={dashboard.attention} />
      </div>

      {/* 3 — Driver performance ranking (selected range) */}
      <DriverPerformance performance={dashboard.performance} range={range} />

      {/* Shift records — range totals, filters, export & table */}
      <section className="space-y-4 border-t border-border pt-6">
        <h2 className="text-sm font-semibold tracking-tight">{t("dash.shifts_title")}</h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label={t("totalHours")} value={formatDuration(summary.totalMs)} nums />
          <SummaryCard label={t("totalKm")} value={summary.totalKm.toLocaleString(nf)} nums />
          <SummaryCard
            label={t("activeShifts")}
            value={String(summary.activeCount)}
            highlight={summary.activeCount > 0 ? "sky" : undefined}
            live={summary.activeCount > 0}
          />
          <SummaryCard
            label={t("overLimit")}
            value={String(summary.overLimit)}
            highlight={summary.overLimit > 0 ? "gold" : undefined}
            pulse={summary.overLimit > 0}
          />
        </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>{t("dateRange")}</Label>
              <Select value={range} onValueChange={(v) => setParam("range", v ?? "today")}>
                <SelectTrigger className="h-10 w-[160px]">
                  <SelectValue>
                    {((v: unknown) => {
                      const map: Record<string, string> = {
                        today: t("rangeToday"),
                        week: t("rangeWeek"),
                        month: t("rangeMonth"),
                        custom: t("rangeCustom"),
                      };
                      return map[String(v)] ?? t("rangeToday");
                    }) as never}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">{t("rangeToday")}</SelectItem>
                  <SelectItem value="week">{t("rangeWeek")}</SelectItem>
                  <SelectItem value="month">{t("rangeMonth")}</SelectItem>
                  <SelectItem value="custom">{t("rangeCustom")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {range === "custom" && (
              <>
                <div className="space-y-1.5">
                  <Label>{t("from")}</Label>
                  <Input
                    type="date"
                    value={from}
                    onChange={(e) => setParam("from", e.target.value)}
                    className="h-10 nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("to")}</Label>
                  <Input
                    type="date"
                    value={to}
                    onChange={(e) => setParam("to", e.target.value)}
                    className="h-10 nums"
                  />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label>{t("worker")}</Label>
              <Select value={workerFilter} onValueChange={(v) => setParam("worker", v ?? "all")}>
                <SelectTrigger className="h-10 w-[200px]">
                  <SelectValue>
                    {((v: unknown) => {
                      const id = String(v);
                      if (id === "all") return t("statusAll");
                      return workers.find((w) => w.id === id)?.name ?? t("statusAll");
                    }) as never}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("statusAll")}</SelectItem>
                  {workers.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      <UserAvatar name={w.name} size="xs" />
                      <span>{w.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("status")}</Label>
              <Select value={statusFilter} onValueChange={(v) => setParam("status", v ?? "all")}>
                <SelectTrigger className="h-10 w-[180px]">
                  <SelectValue>
                    {((v: unknown) => {
                      const map: Record<string, string> = {
                        all: t("statusAll"),
                        active: t("statusActive"),
                        completed: t("statusCompleted"),
                        over: t("statusOver"),
                      };
                      return map[String(v)] ?? t("statusAll");
                    }) as never}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("statusAll")}</SelectItem>
                  <SelectItem value="active">{t("statusActive")}</SelectItem>
                  <SelectItem value="completed">{t("statusCompleted")}</SelectItem>
                  <SelectItem value="over">{t("statusOver")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-1.5 ml-auto items-end">
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                disabled={!entries.length}
                title={t("exportExcel")}
              >
                <FileSpreadsheet className="size-4" />
                <span className="hidden xl:inline">Excel</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDatev}
                disabled={exportBusy}
                title={tExport("datev_tooltip")}
              >
                <FileText className="size-4" />
                <span className="hidden xl:inline">DATEV</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleBmd}
                disabled={exportBusy}
                title={tExport("bmd_tooltip")}
              >
                <FileText className="size-4" />
                <span className="hidden xl:inline">BMD</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportPdf}
                disabled={!entries.length}
                title={t("exportPdf")}
              >
                <FileText className="size-4" />
                <span className="hidden xl:inline">PDF</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAzgOpen(true)}
                title={tAzg("report_title")}
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Shield className="size-4" />
                <span className="hidden xl:inline">AZG</span>
              </Button>
              <Button size="sm" onClick={() => setAddOpen(true)} title={t("addWorker")}>
                <UserPlus className="size-4" />
                <span className="hidden xl:inline">{t("addWorker")}</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold tracking-tight">{t("dash.shifts_table")}</h3>
          <span className="nums rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {entries.length}
          </span>
        </div>
        {entries.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {t("noEntries")}
          </div>
        ) : (
          <div className="max-h-[640px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card [&_tr]:border-b [&_th]:text-[11px] [&_th]:uppercase [&_th]:tracking-[0.04em] [&_th]:text-muted-foreground">
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("tblWorker")}</TableHead>
                  <TableHead>{t("tblDate")}</TableHead>
                  <TableHead>{t("tblStart")}</TableHead>
                  <TableHead>{t("tblEnd")}</TableHead>
                  <TableHead>{t("tblWorked")}</TableHead>
                  <TableHead className="text-right">{t("tblBreak")}</TableHead>
                  <TableHead className="text-right">{t("tblKm")}</TableHead>
                  <TableHead className="text-right">{t("tblCargo")}</TableHead>
                  <TableHead className="text-right">{t("tblUndelivered")}</TableHead>
                  <TableHead>{t("tblPlate")}</TableHead>
                  <TableHead className="max-w-[200px]">{t("tblNote")}</TableHead>
                  <TableHead className="text-right">{t("tblActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => {
                  const isActive = e.ended_at === null;
                  const w = isActive ? workedMs(e, now) : workedMs(e);
                  const over = w > NINE_HOURS;
                  const km = kmDiff(e);
                  const borderClass = isActive
                    ? "border-l-2 border-l-accent-sky"
                    : over
                    ? "border-l-2 border-l-accent-gold"
                    : "border-l-2 border-l-transparent";
                  return (
                    <TableRow key={e.id} className={borderClass}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <UserAvatar name={e.workers?.name ?? "?"} size="xs" />
                          <span>{e.workers?.name ?? "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(e.started_at, locale)}
                      </TableCell>
                      <TableCell className="nums">{formatTime(e.started_at, locale)}</TableCell>
                      <TableCell className="nums">
                        {isActive ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-sky/15 px-2 py-0.5 text-[10px] font-medium text-accent-sky">
                            <span className="live-dot" />
                            {t("active")}
                          </span>
                        ) : (
                          formatTime(e.ended_at, locale)
                        )}
                      </TableCell>
                      <TableCell className="nums">
                        {isActive ? formatDuration(w) : formatDurationShort(w, locale)}
                        {over && (
                          <span
                            className="ml-2 inline-flex items-center gap-1 rounded-full bg-accent-gold/15 px-2 py-0.5 text-[10px] font-medium text-accent-gold"
                            title={t("overWarn")}
                          >
                            <AlertTriangle className="size-3" />
                            9h+
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="nums text-right text-muted-foreground">
                        {e.break_minutes ?? 0}
                      </TableCell>
                      <TableCell className="nums text-right">
                        {km !== null ? km.toLocaleString(nf) : "—"}
                      </TableCell>
                      <TableCell className="nums text-right">{e.cargo_count ?? "—"}</TableCell>
                      <TableCell className="nums text-right">
                        {e.undelivered_count != null && e.undelivered_count > 0 ? (
                          <span className="font-medium text-accent-gold">{e.undelivered_count}</span>
                        ) : (
                          e.undelivered_count ?? "—"
                        )}
                      </TableCell>
                      <TableCell className="nums uppercase text-muted-foreground">
                        {e.plate ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted-foreground" title={e.notes ?? ""}>
                        {e.notes ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditOpen(e)}
                            aria-label={tc("edit")}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(e)}
                            disabled={pending}
                            aria-label={tc("delete")}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      </section>

      {/* Add Worker */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
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
                pattern="\d{4}"
                maxLength={4}
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
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
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

      {/* Edit Entry */}
      <Dialog open={!!editOpen} onOpenChange={(o) => !o && setEditOpen(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("editTitle")}</DialogTitle>
            <DialogDescription>
              {editOpen?.workers?.name} · {editOpen && formatDate(editOpen.started_at, locale)}
            </DialogDescription>
          </DialogHeader>
          {editOpen && (
            <form action={handleEdit} className="space-y-3">
              <input type="hidden" name="id" value={editOpen.id} />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="e_start">{t("tblStart")}</Label>
                  <Input
                    id="e_start"
                    type="datetime-local"
                    name="started_at"
                    defaultValue={toLocalInput(editOpen.started_at)}
                    required
                    className="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="e_end">{t("tblEnd")}</Label>
                  <Input
                    id="e_end"
                    type="datetime-local"
                    name="ended_at"
                    defaultValue={editOpen.ended_at ? toLocalInput(editOpen.ended_at) : ""}
                    className="h-10"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="e_sk">{t("tblKm")} ({t("tblStart")})</Label>
                  <Input
                    id="e_sk"
                    type="number"
                    name="start_km"
                    defaultValue={editOpen.start_km}
                    required
                    className="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="e_ek">{t("tblKm")} ({t("tblEnd")})</Label>
                  <Input
                    id="e_ek"
                    type="number"
                    name="end_km"
                    defaultValue={editOpen.end_km ?? ""}
                    className="h-10"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="e_br">{t("tblBreak")}</Label>
                  <Input
                    id="e_br"
                    type="number"
                    name="break_minutes"
                    defaultValue={editOpen.break_minutes ?? 0}
                    className="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="e_cg">{t("tblCargo")}</Label>
                  <Input
                    id="e_cg"
                    type="number"
                    name="cargo_count"
                    defaultValue={editOpen.cargo_count ?? ""}
                    className="h-10"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e_pl">{t("tblPlate")}</Label>
                <Input
                  id="e_pl"
                  name="plate"
                  defaultValue={editOpen.plate ?? ""}
                  className="h-10 nums uppercase"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e_nt">{t("tblNote")}</Label>
                <Textarea
                  id="e_nt"
                  name="notes"
                  defaultValue={editOpen.notes ?? ""}
                  rows={2}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditOpen(null)}>
                  {tc("cancel")}
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  {tc("save")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* AZG audit report */}
      <Dialog open={azgOpen} onOpenChange={setAzgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="size-5 text-destructive" />
              {tAzg("report_title")}
            </DialogTitle>
            <DialogDescription>{tAzg("report_modal_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{tAzg("select_month")}</Label>
              <Select value={azgMonth} onValueChange={(v) => v && setAzgMonth(v)}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue>
                    {((v: unknown) =>
                      monthOptions.find((o) => o.value === String(v))?.label ??
                      String(v)) as never}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAzgOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleAzg} disabled={azgBusy}>
              {azgBusy && <Loader2 className="size-4 animate-spin" />}
              {azgBusy ? tAzg("generating") : tAzg("generate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  nums,
  highlight,
  pulse,
  live,
}: {
  label: string;
  value: string;
  nums?: boolean;
  highlight?: "sky" | "gold";
  pulse?: boolean;
  live?: boolean;
}) {
  const color =
    highlight === "sky"
      ? "text-accent-sky"
      : highlight === "gold"
      ? "text-accent-gold"
      : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5">
          {live && <span className="live-dot" />}
          <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-text-tertiary">
            {label}
          </span>
        </div>
        <div
          className={`text-2xl font-semibold mt-1.5 ${color} ${nums ? "nums" : ""} ${
            pulse ? "pulse-soft" : ""
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function toLocalInput(iso: string): string {
  // datetime-local needs YYYY-MM-DDTHH:mm in local zone — we use Vienna
  const d = new Date(iso);
  const tz = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Vienna" }));
  const yyyy = tz.getFullYear();
  const mm = String(tz.getMonth() + 1).padStart(2, "0");
  const dd = String(tz.getDate()).padStart(2, "0");
  const hh = String(tz.getHours()).padStart(2, "0");
  const mi = String(tz.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
