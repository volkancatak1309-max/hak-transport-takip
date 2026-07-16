"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, useEffect, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Pencil,
  Trash2,
  FileSpreadsheet,
  FileText,
  Shield,
  UserPlus,
  Loader2,
  MoreHorizontal,
  BarChart3,
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
import { AttentionList } from "@/components/admin/AttentionList";
import { LiveWorked } from "@/components/admin/LiveWorked";
import { FleetDtcCard } from "@/components/admin/FleetDtcCard";
import type { DashboardData } from "@/lib/admin-dashboard";
import { AddWorkerDialog } from "@/components/admin/AddWorkerDialog";
import {
  DriverReportsCard,
  type AdminDriverReport,
} from "@/components/admin/DriverReportsCard";
import { ShiftPhotosButton } from "@/components/admin/ShiftPhotosButton";
import {
  PageHeader,
  StatCard,
  RankingTile,
  type RankRow,
  StatusChip,
  DataTable,
  DetailDrawer,
  ConfirmDialog,
  DensityToggle,
  EmptyState,
  type Column,
  type StatTone,
} from "@/components/ui-v2";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { editEntryAction, deleteEntryAction } from "../actions/shift";
import type { TimeEntryWithWorker, WorkerPublic } from "@/lib/types";

const NINE_HOURS = 9 * 60 * 60 * 1000;

type Props = {
  entries: TimeEntryWithWorker[];
  workers: WorkerPublic[];
  range: string;
  from: string;
  to: string;
  workerFilter: string;
  statusFilter: string;
  summary: { totalMs: number; totalKm: number; activeCount: number; overLimit: number };
  dashboard: DashboardData;
  reports: AdminDriverReport[];
  photoEntryIds: string[];
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
  reports,
  photoEntryIds,
}: Props) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const tpdf = useTranslations("pdf");
  const tExport = useTranslations("export");
  const tAzg = useTranslations("azg");
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();

  const [editOpen, setEditOpen] = useState<TimeEntryWithWorker | null>(null);
  const [detail, setDetail] = useState<TimeEntryWithWorker | null>(null);
  const [confirmDel, setConfirmDel] = useState<TimeEntryWithWorker | null>(null);
  const [azgOpen, setAzgOpen] = useState(false);
  const [azgMonth, setAzgMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [azgBusy, setAzgBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  const nf = locale === "de" ? "de-AT" : "tr-TR";
  const photoIdSet = useMemo(() => new Set(photoEntryIds), [photoEntryIds]);

  const scopeLabel =
    range === "week"
      ? t("rangeWeek")
      : range === "month"
      ? t("rangeMonth")
      : range === "custom"
      ? t("rangeCustom")
      : t("rangeToday");

  const monthOptions = (() => {
    const opts: { value: string; label: string }[] = [];
    const base = new Date();
    base.setDate(1);
    for (let i = 0; i < 12; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString(nf, { month: "long", year: "numeric" });
      opts.push({ value, label });
    }
    return opts;
  })();

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
      await downloadAZGReport(res.data);
      toast.success(tAzg("success"));
      setAzgOpen(false);
    } catch {
      toast.error(tAzg("error"));
    } finally {
      setAzgBusy(false);
    }
  }

  // Yumuşak otomatik yenileme (vardiya başl/mola/bitiş F5'siz görünsün) — canlı
  // harita ile aynı yaklaşım. Aktif vardiyanın saniyelik canlı süresi artık
  // LiveWorked bileşeninde izole; buradaki 1sn'lik global tick KALDIRILDI.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(id);
  }, [router]);

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
    startTransition(async () => {
      const res = await deleteEntryAction(entry.id);
      if (res.ok) {
        toast.success(t("deleted"));
        setConfirmDel(null);
        setDetail(null);
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
    if (e.startsWith("km_high:")) {
      const [, diff, max] = e.split(":");
      return `KM +${diff} > ${max}`;
    }
    if (e === "errKmRange") return "KM aralık dışı";
    return e;
  }

  function exportCsv() {
    const sortedWorkers = [...workers].sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "", locale === "de" ? "de" : "tr")
    );
    const persNr = new Map<string, string>();
    sortedWorkers.forEach((w, i) =>
      persNr.set(w.id, (w.employee_number ?? "").trim() || String(i + 1))
    );

    const header = [
      t("tblPersNr"), t("tblWorker"), t("tblDate"), t("tblStart"), t("tblEnd"),
      t("tblWorked"), t("tblBreak"), t("tblKm"), t("tblLoaded"), t("tblCargo"),
      t("tblUndelivered"), t("tblPlate"), t("tblNote"),
    ];
    const rows = entries.map((e) => {
      const w = workedMs(e);
      const km = kmDiff(e);
      return [
        persNr.get(e.worker_id) ?? "—",
        e.workers?.name ?? "",
        formatDate(e.started_at, locale),
        formatTime(e.started_at, locale),
        e.ended_at ? formatTime(e.ended_at, locale) : t("statusActive"),
        formatDurationShort(w, locale),
        String(e.break_minutes ?? 0),
        km !== null ? String(km) : "",
        e.start_package_count !== null ? String(e.start_package_count) : "",
        e.ended_at && e.cargo_count !== null ? String(e.cargo_count) : "",
        e.undelivered_count !== null ? String(e.undelivered_count) : "",
        e.plate ?? "",
        e.notes ?? "",
      ];
    });

    const text = [header, ...rows]
      .map((r) => r.map((c) => String(c ?? "").replace(/[\t\r\n]+/g, " ")).join("\t"))
      .join("\r\n");
    const buf = new ArrayBuffer(2 + text.length * 2);
    const view = new DataView(buf);
    view.setUint8(0, 0xff);
    view.setUint8(1, 0xfe);
    for (let i = 0; i < text.length; i++) {
      view.setUint16(2 + i * 2, text.charCodeAt(i), true);
    }
    const blob = new Blob([buf], { type: "text/csv;charset=utf-16le" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hak-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
        generatedAt: `${tpdf("generatedAt")}: ${new Date().toLocaleString(nf, {
          timeZone: "Europe/Vienna",
        })}`,
        footer: tpdf("footer"),
        headers: {
          worker: t("tblWorker"), date: t("tblDate"), start: t("tblStart"),
          end: t("tblEnd"), worked: t("tblWorked"), breakMin: t("tblBreak"),
          startKm: t("tblStartKm"), endKm: t("tblEndKm"), km: t("tblKm"),
          loaded: t("tblLoaded"), cargo: t("tblCargo"),
          undelivered: t("tblUndelivered"), plate: t("tblPlate"),
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
            loaded: e.start_package_count != null ? String(e.start_package_count) : "—",
            cargo: e.ended_at && e.cargo_count !== null ? String(e.cargo_count) : "—",
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

  // ── Vardiya tablosu kolonları ────────────────────────────────────────────
  const shiftState = (e: TimeEntryWithWorker) => {
    const active = e.ended_at === null;
    const onBreak = active && !!e.break_started_at;
    const over = (active ? workedMs(e) : workedMs(e)) > NINE_HOURS;
    return { active, onBreak, over };
  };
  const stripeFor = (e: TimeEntryWithWorker) => {
    const { active, onBreak, over } = shiftState(e);
    if (onBreak) return "var(--status-break)";
    if (active) return "var(--status-active)";
    if (over) return "var(--status-idle)";
    return null;
  };

  const columns: Column<TimeEntryWithWorker>[] = [
    {
      key: "worker",
      header: t("tblWorker"),
      cell: (e) => (
        <div className="flex items-center gap-2">
          <UserAvatar name={e.workers?.name ?? "?"} size="xs" />
          <span className="font-medium">{e.workers?.name ?? "—"}</span>
          {(e.confirmation_status === "pending" ||
            e.confirmation_status === "unconfirmed") && (
            <StatusChip tone="warning">{t("unconfirmedBadge")}</StatusChip>
          )}
        </div>
      ),
      sortable: true,
      sortValue: (e) => e.workers?.name ?? "",
    },
    {
      key: "date",
      header: t("tblDate"),
      cell: (e) => formatDate(e.started_at, locale),
      nums: true,
      sortable: true,
      sortValue: (e) => e.started_at,
      hideBelow: "lg",
    },
    {
      key: "start",
      header: t("tblStart"),
      cell: (e) => formatTime(e.started_at, locale),
      nums: true,
      hideBelow: "md",
    },
    {
      key: "end",
      header: t("tblEnd"),
      cell: (e) => {
        const { active, onBreak } = shiftState(e);
        if (onBreak) return <StatusChip tone="break" dot>{t("dash.ops_on_break")}</StatusChip>;
        if (active) return <StatusChip tone="active" dot>{t("active")}</StatusChip>;
        return formatTime(e.ended_at, locale);
      },
      nums: true,
    },
    {
      key: "worked",
      header: t("tblWorked"),
      cell: (e) => {
        const { active, over } = shiftState(e);
        return (
          <span className="inline-flex items-center gap-2">
            {active ? <LiveWorked entry={e} /> : formatDurationShort(workedMs(e), locale)}
            {over && <StatusChip tone="warning">9h+</StatusChip>}
          </span>
        );
      },
      nums: true,
      sortable: true,
      sortValue: (e) => workedMs(e),
    },
    {
      key: "break",
      header: t("tblBreak"),
      cell: (e) => e.break_minutes ?? 0,
      align: "right",
      nums: true,
      hideBelow: "lg",
    },
    {
      key: "km",
      header: t("tblKm"),
      cell: (e) => {
        const km = kmDiff(e);
        return km !== null ? km.toLocaleString(nf) : "—";
      },
      align: "right",
      nums: true,
      sortable: true,
      sortValue: (e) => kmDiff(e) ?? -1,
    },
    {
      key: "loaded",
      header: t("tblLoaded"),
      cell: (e) => e.start_package_count ?? "—",
      align: "right",
      nums: true,
      hideBelow: "lg",
    },
    {
      key: "cargo",
      header: t("tblCargo"),
      cell: (e) => (shiftState(e).active ? "—" : e.cargo_count ?? "—"),
      align: "right",
      nums: true,
      hideBelow: "lg",
    },
    {
      key: "plate",
      header: t("tblPlate"),
      cell: (e) => <span className="uppercase">{e.plate ?? "—"}</span>,
      nums: true,
      hideBelow: "md",
    },
  ];

  const shiftIndex = detail ? entries.findIndex((e) => e.id === detail.id) : -1;

  // ── Reveal dashboard klonu — ranked-bar tile satırları (REVEAL-CLONE-SPEC B2)
  const perf = dashboard.performance;
  const scoreColor = (s: number) =>
    s >= 80 ? "var(--accent-sky)" : s >= 50 ? "var(--accent-gold)" : "var(--accent-claret)";
  const rankRows = (
    metric: "ms" | "km" | "delivered" | "score" | "azg" | "shifts"
  ): RankRow[] => {
    const val = (r: (typeof perf)[number]) => (metric === "azg" ? r.azgViol : r[metric]);
    return [...perf]
      .sort((a, b) => val(b) - val(a))
      .slice(0, 8)
      .map((r) => ({
        key: r.worker_id,
        label: r.name,
        value: Math.max(0, val(r)),
        display:
          metric === "ms"
            ? formatDurationShort(r.ms, locale)
            : metric === "km"
            ? r.km.toLocaleString(nf)
            : String(val(r)),
        color:
          metric === "azg"
            ? "var(--status-critical)"
            : metric === "score"
            ? scoreColor(r.score)
            : "var(--accent-sky)",
      }));
  };
  const tileIcon = <BarChart3 className="size-4" />;
  // Tile'lar tablo aralığını DEĞİL, sabit kayan pencereyi kapsar (lib/admin-dashboard
  // PERF_WINDOW_DAYS) — altyazı bunu açıkça yazar ki tablodaki aralıkla karışmasın.
  const perfScope = `${t("dash.perf_driver")} · ${t("dash.perf_window", {
    days: dashboard.performanceWindowDays,
  })}`;

  return (
    <div className="space-y-6">
      {/* Reveal dashboard klonu — ranked-bar tile ızgarası (REVEAL-CLONE-SPEC B2).
          6 tile / 3 kolon; her tile yatay bar leaderboard. Reveal'ın FleetStatus
          donut + DriverPerformance tablosunun yerini alır. */}
      {/* Izgara aralık boşken de durur: Reveal tile'larını hiç gizlemez, boş
          tile'ı kendi içinde yazar. RankingTile rows=[] için ortalanmış
          emptyLabel render eder. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <RankingTile title={t("dash.perf_hours")} icon={tileIcon} rows={rankRows("ms")} scope={perfScope} emptyLabel={t("dash.perf_empty")} />
        <RankingTile title={t("dash.perf_km")} icon={tileIcon} rows={rankRows("km")} scope={perfScope} emptyLabel={t("dash.perf_empty")} />
        <RankingTile title={t("dash.perf_score")} icon={tileIcon} rows={rankRows("score")} scope={perfScope} emptyLabel={t("dash.perf_empty")} />
        <RankingTile title={t("dash.perf_delivered")} icon={tileIcon} rows={rankRows("delivered")} scope={perfScope} emptyLabel={t("dash.perf_empty")} />
        <RankingTile title={t("dash.perf_azg")} icon={tileIcon} rows={rankRows("azg")} scope={perfScope} emptyLabel={t("dash.perf_empty")} />
        <RankingTile title={t("dash.perf_shifts")} icon={tileIcon} rows={rankRows("shifts")} scope={perfScope} emptyLabel={t("dash.perf_empty")} />
      </div>

      {/* Filo arıza özeti — yalnız aktif arızası olan araç varsa. Boş filoda
          "arıza yok" kutusu göstermeye gerek yok (boş-durum ekonomisi); kart
          kendi içindeki temiz boş-durumunu yalnız veri gelip sıfırlandığında
          göstermez, hiç render edilmez. */}
      {dashboard.dtc.length > 0 && <FleetDtcCard rows={dashboard.dtc} />}

      {/* Bugünün canlı operasyon özeti (analitik ızgaranın altında) */}
      <OpsSummary ops={dashboard.todayOps} detail={dashboard.opsDetail} />

      {/* Dikkat kalemleri + şoför bildirimleri — yalnız içerik varken (boş-durum
          ekonomisi); boş dev kutu yok. */}
      {(dashboard.attention.length > 0 || reports.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {dashboard.attention.length > 0 && <AttentionList items={dashboard.attention} />}
          {reports.length > 0 && <DriverReportsCard reports={reports} />}
        </div>
      )}

      {/* Vardiya kayıtları — özet · filtre · tablo */}
      <section className="space-y-4 border-t border-border pt-6">
        <PageHeader
          title={t("dash.shifts_title")}
          action={
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!entries.length} title={t("exportExcel")}>
                <FileSpreadsheet className="size-4" />
                <span className="hidden xl:inline">Excel</span>
              </Button>
              <Button variant="outline" size="sm" onClick={exportPdf} disabled={!entries.length} title={t("exportPdf")}>
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
              <AddWorkerDialog>
                <Button size="sm" className="btn-primary text-white" title={t("addWorker")}>
                  <UserPlus className="size-4" />
                  <span className="hidden xl:inline">{t("addWorker")}</span>
                </Button>
              </AddWorkerDialog>
            </div>
          }
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={t("totalHours")} value={formatDuration(summary.totalMs)} scope={scopeLabel} />
          <StatCard label={t("totalKm")} value={summary.totalKm.toLocaleString(nf)} scope={scopeLabel} />
          <StatCard
            label={t("activeShifts")}
            value={String(summary.activeCount)}
            scope={t("rangeToday")}
            tone={summary.activeCount > 0 ? ("info" as StatTone) : "neutral"}
          />
          <StatCard
            label={t("overLimit")}
            value={String(summary.overLimit)}
            scope={scopeLabel}
            tone={summary.overLimit > 0 ? ("warning" as StatTone) : "neutral"}
          />
        </div>

        {/* Filtre çubuğu */}
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("dateRange")}</Label>
              <Select value={range} onValueChange={(v) => setParam("range", v ?? "today")}>
                <SelectTrigger className="h-9 w-[150px]">
                  <SelectValue>
                    {range === "week" ? t("rangeWeek") : range === "month" ? t("rangeMonth") : range === "custom" ? t("rangeCustom") : t("rangeToday")}
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
                  <Label className="text-xs">{t("from")}</Label>
                  <Input type="date" value={from} onChange={(e) => setParam("from", e.target.value)} className="nums h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("to")}</Label>
                  <Input type="date" value={to} onChange={(e) => setParam("to", e.target.value)} className="nums h-9" />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">{t("worker")}</Label>
              <Select value={workerFilter} onValueChange={(v) => setParam("worker", v ?? "all")}>
                <SelectTrigger className="h-9 w-[190px]">
                  <SelectValue>
                    {workerFilter === "all" ? t("statusAll") : workers.find((w) => w.id === workerFilter)?.name ?? t("statusAll")}
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
              <Label className="text-xs">{t("status")}</Label>
              <Select value={statusFilter} onValueChange={(v) => setParam("status", v ?? "all")}>
                <SelectTrigger className="h-9 w-[170px]">
                  <SelectValue>
                    {statusFilter === "active" ? t("statusActive") : statusFilter === "completed" ? t("statusCompleted") : statusFilter === "over" ? t("statusOver") : t("statusAll")}
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
            <div className="ml-auto flex items-end">
              <DensityToggle />
            </div>
          </CardContent>
        </Card>

        {entries.length === 0 ? (
          <EmptyState kind="filtered" title={t("noEntries")} />
        ) : (
          <DataTable
            rows={entries}
            columns={columns}
            rowKey={(e) => e.id}
            onRowClick={(e) => setDetail(e)}
            stripe={stripeFor}
            totalLabel={t("dash.shifts_table")}
            rowMenu={(e) => (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon" className="size-8" aria-label={tc("edit")} />}
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditOpen(e)}>
                    <Pencil className="size-4" /> {tc("edit")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setConfirmDel(e)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="size-4" /> {tc("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          />
        )}
      </section>

      {/* Vardiya detay çekmecesi */}
      <DetailDrawer
        open={detail !== null}
        onOpenChange={(v) => !v && setDetail(null)}
        title={detail?.workers?.name ?? "—"}
        subtitle={detail ? formatDate(detail.started_at, locale) : undefined}
        onPrev={shiftIndex > 0 ? () => setDetail(entries[shiftIndex - 1]) : null}
        onNext={shiftIndex >= 0 && shiftIndex < entries.length - 1 ? () => setDetail(entries[shiftIndex + 1]) : null}
        footer={
          detail && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { const e = detail; setDetail(null); setEditOpen(e); }}>
                <Pencil className="size-4" /> {tc("edit")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmDel(detail)}
              >
                <Trash2 className="size-4" /> {tc("delete")}
              </Button>
            </div>
          )
        }
      >
        {detail && (
          <ShiftDetail
            entry={detail}
            locale={locale}
            t={t}
            nf={nf}
            hasPhotos={photoIdSet.has(detail.id)}
          />
        )}
      </DetailDrawer>

      {/* Silme onayı — native confirm yerine */}
      <ConfirmDialog
        open={confirmDel !== null}
        onOpenChange={(v) => !v && setConfirmDel(null)}
        title={tc("delete")}
        description={
          confirmDel
            ? t("deleteConfirm", {
                name: confirmDel.workers?.name ?? "—",
                date: formatDate(confirmDel.started_at, locale),
              })
            : ""
        }
        destructive
        confirmLabel={tc("delete")}
        cancelLabel={tc("cancel")}
        onConfirm={() => {
          if (confirmDel) handleDelete(confirmDel);
        }}
      />

      {/* Vardiya düzenle */}
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
                  <Input id="e_start" type="datetime-local" name="started_at" defaultValue={toLocalInput(editOpen.started_at)} required className="h-10" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="e_end">{t("tblEnd")}</Label>
                  <Input id="e_end" type="datetime-local" name="ended_at" defaultValue={editOpen.ended_at ? toLocalInput(editOpen.ended_at) : ""} className="h-10" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="e_sk">{t("tblKm")} ({t("tblStart")})</Label>
                  <Input id="e_sk" type="number" name="start_km" defaultValue={editOpen.start_km} required className="h-10" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="e_ek">{t("tblKm")} ({t("tblEnd")})</Label>
                  <Input id="e_ek" type="number" name="end_km" defaultValue={editOpen.end_km ?? ""} className="h-10" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="e_br">{t("tblBreak")}</Label>
                  <Input id="e_br" type="number" name="break_minutes" defaultValue={editOpen.break_minutes ?? 0} className="h-10" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="e_cg">{t("tblCargo")}</Label>
                  <Input id="e_cg" type="number" name="cargo_count" defaultValue={editOpen.cargo_count ?? ""} className="h-10" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e_pl">{t("tblPlate")}</Label>
                <Input id="e_pl" name="plate" defaultValue={editOpen.plate ?? ""} className="nums h-10 uppercase" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e_nt">{t("tblNote")}</Label>
                <Textarea id="e_nt" name="notes" defaultValue={editOpen.notes ?? ""} rows={2} />
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

      {/* AZG denetim raporu */}
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
                    {monthOptions.find((o) => o.value === azgMonth)?.label ?? azgMonth}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
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

/** Vardiya detay çekmecesi içeriği — tam alan seti + not. */
function ShiftDetail({
  entry,
  locale,
  t,
  nf,
  hasPhotos,
}: {
  entry: TimeEntryWithWorker;
  locale: string;
  t: ReturnType<typeof useTranslations>;
  nf: string;
  hasPhotos: boolean;
}) {
  const active = entry.ended_at === null;
  const km = kmDiff(entry);
  const field = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="nums mt-0.5">{value}</dd>
    </div>
  );
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-2 gap-3">
        {field(t("tblStart"), formatTime(entry.started_at, locale))}
        {field(t("tblEnd"), active ? <StatusChip tone="active" dot>{t("active")}</StatusChip> : formatTime(entry.ended_at, locale))}
        {field(t("tblWorked"), active ? <LiveWorked entry={entry} /> : formatDurationShort(workedMs(entry), locale))}
        {field(t("tblBreak"), `${entry.break_minutes ?? 0} dk`)}
        {field(t("tblKm"), km !== null ? km.toLocaleString(nf) : "—")}
        {field(t("tblPlate"), <span className="uppercase">{entry.plate ?? "—"}</span>)}
        {field(t("tblLoaded"), entry.start_package_count ?? "—")}
        {field(t("tblCargo"), active ? "—" : entry.cargo_count ?? "—")}
      </dl>
      {entry.notes && (
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("tblNote")}</dt>
          <dd className="mt-0.5">{entry.notes}</dd>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Link
          href={`/admin/workers/${entry.worker_id}`}
          className="inline-flex items-center gap-2 text-sm text-accent-sky hover:underline"
        >
          <UserAvatar name={entry.workers?.name ?? "?"} size="xs" />
          {entry.workers?.name}
        </Link>
        {hasPhotos && <ShiftPhotosButton entryId={entry.id} />}
      </div>
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const tz = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Vienna" }));
  const yyyy = tz.getFullYear();
  const mm = String(tz.getMonth() + 1).padStart(2, "0");
  const dd = String(tz.getDate()).padStart(2, "0");
  const hh = String(tz.getHours()).padStart(2, "0");
  const mi = String(tz.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
