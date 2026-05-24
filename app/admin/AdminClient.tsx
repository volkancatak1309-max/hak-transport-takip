"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Download,
  FileText,
  Plus,
  Loader2,
} from "lucide-react";
import { WeeklyChart, type WeeklyDatum } from "@/components/WeeklyChart";
import {
  formatDate,
  formatTime,
  formatDuration,
  formatDurationShort,
  workedMs,
  kmDiff,
} from "@/lib/format";
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
  weekly: WeeklyDatum[];
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
  weekly,
}: Props) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const tpdf = useTranslations("pdf");
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();

  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState<TimeEntryWithWorker | null>(null);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(Date.now());

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
        km: t("tblKm"),
        cargo: t("tblCargo"),
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
          km: km !== null ? String(km) : "—",
          cargo: e.cargo_count !== null ? String(e.cargo_count) : "—",
          plate: e.plate ?? "—",
        };
      }),
      filename: `hak-report-${range}-${new Date().toISOString().slice(0, 10)}.pdf`,
    });
  }

  const nf = locale === "de" ? "de-AT" : "tr-TR";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label={t("totalHours")} value={formatDuration(summary.totalMs)} nums />
        <SummaryCard label={t("totalKm")} value={summary.totalKm.toLocaleString(nf)} nums />
        <SummaryCard
          label={t("activeShifts")}
          value={String(summary.activeCount)}
          highlight={summary.activeCount > 0 ? "primary" : undefined}
        />
        <SummaryCard
          label={t("overLimit")}
          value={String(summary.overLimit)}
          highlight={summary.overLimit > 0 ? "destructive" : undefined}
          pulse={summary.overLimit > 0}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t("weeklyChart")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <WeeklyChart data={weekly} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>{t("dateRange")}</Label>
              <Select value={range} onValueChange={(v) => setParam("range", v ?? "today")}>
                <SelectTrigger className="h-10 w-[160px]">
                  <SelectValue />
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
                <SelectTrigger className="h-10 w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("statusAll")}</SelectItem>
                  {workers.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("status")}</Label>
              <Select value={statusFilter} onValueChange={(v) => setParam("status", v ?? "all")}>
                <SelectTrigger className="h-10 w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("statusAll")}</SelectItem>
                  <SelectItem value="active">{t("statusActive")}</SelectItem>
                  <SelectItem value="completed">{t("statusCompleted")}</SelectItem>
                  <SelectItem value="over">{t("statusOver")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 ml-auto items-end">
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!entries.length}>
                <Download className="size-4" />
                {t("exportExcel")}
              </Button>
              <Button variant="outline" size="sm" onClick={exportPdf} disabled={!entries.length}>
                <FileText className="size-4" />
                {t("exportPdf")}
              </Button>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="size-4" />
                {t("addWorker")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        {entries.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {t("noEntries")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("tblWorker")}</TableHead>
                  <TableHead>{t("tblDate")}</TableHead>
                  <TableHead>{t("tblStart")}</TableHead>
                  <TableHead>{t("tblEnd")}</TableHead>
                  <TableHead>{t("tblWorked")}</TableHead>
                  <TableHead>{t("tblBreak")}</TableHead>
                  <TableHead>{t("tblKm")}</TableHead>
                  <TableHead>{t("tblCargo")}</TableHead>
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
                    ? "border-l-4 border-l-primary"
                    : over
                    ? "border-l-4 border-l-destructive"
                    : "";
                  return (
                    <TableRow key={e.id} className={borderClass}>
                      <TableCell className="font-medium">{e.workers?.name ?? "—"}</TableCell>
                      <TableCell>{formatDate(e.started_at, locale)}</TableCell>
                      <TableCell className="nums">{formatTime(e.started_at, locale)}</TableCell>
                      <TableCell className="nums">
                        {isActive ? (
                          <Badge variant="default" className="text-[10px]">
                            {t("active")}
                          </Badge>
                        ) : (
                          formatTime(e.ended_at, locale)
                        )}
                      </TableCell>
                      <TableCell className="nums">
                        {isActive ? formatDuration(w) : formatDurationShort(w, locale)}
                        {over && (
                          <Badge
                            variant="destructive"
                            className="ml-2 text-[10px] gap-1"
                            title={t("overWarn")}
                          >
                            <AlertTriangle className="size-3" />
                            9h+
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="nums">{e.break_minutes ?? 0}</TableCell>
                      <TableCell className="nums">
                        {km !== null ? km.toLocaleString(nf) : "—"}
                      </TableCell>
                      <TableCell className="nums">{e.cargo_count ?? "—"}</TableCell>
                      <TableCell className="nums">{e.plate ?? "—"}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={e.notes ?? ""}>
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
    </div>
  );
}

function SummaryCard({
  label,
  value,
  nums,
  highlight,
  pulse,
}: {
  label: string;
  value: string;
  nums?: boolean;
  highlight?: "primary" | "destructive";
  pulse?: boolean;
}) {
  const color =
    highlight === "primary"
      ? "text-primary"
      : highlight === "destructive"
      ? "text-destructive"
      : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div
          className={`text-2xl font-bold mt-1 ${color} ${nums ? "nums" : ""} ${
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
