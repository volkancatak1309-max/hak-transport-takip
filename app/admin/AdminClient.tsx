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
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import {
  formatDate,
  formatTime,
  formatDuration,
  formatDurationShort,
  workedMs,
  kmDiff,
} from "@/lib/format";
import { dailyCapMs, touchesNightWindow } from "@/lib/azg-rules";
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
import {
  ActiveShiftsCard,
  type ActiveShiftRow,
} from "@/components/admin/ActiveShiftsCard";
import { TodayBoard, rosterCounts } from "@/components/admin/TodayBoard";
import { StartShiftForWorkerDialog } from "@/components/admin/StartShiftForWorkerDialog";
import { classifyUndelivered } from "@/lib/package-limits";
import { ShiftEditHistory } from "@/components/admin/ShiftEditHistory";
import { ShiftPhotosButton } from "@/components/admin/ShiftPhotosButton";
import {
  PageHeader,
  StatCard,
  OpsConsole,
  OpsStatGrid,
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
import {
  SHIFT_REPORT_DE,
  REPORT_EMPTY,
  buildShiftReportRow,
  reportPeriodDe,
} from "@/lib/report-de";
import type { TimeEntryWithWorker, WorkerPublic } from "@/lib/types";

// 22.07.2026: satır vurgusu 9 saatte değil YASAL TAVANDA kırmızıya döner
// (§ 9 Abs. 1 = 12 sa; gece çalışması varsa § 14 Abs. 2 = 10 sa). 9 saat bir
// ihlal değil, mola kademesidir — tabloda 20 şoförü kırmızı yapıyordu.

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
  activeShifts: ActiveShiftRow[];
  overLimitShifts: number;
  photoEntryIds: string[];
  /** Elle düzeltilmiş vardiyalar — listede "düzenlendi" rozeti çıkar. */
  editedEntryIds: string[];
  /**
   * Filo sefi modu: SADECE IZLEME. Excel/PDF/AZG/Calisan Ekle,
   * Vardiya Kayitlari arsivi, sofor bildirimleri ve Kapat/Duzelt
   * kisayollari gizlenir. Sunucu tarafi zaten requireAdmin() ile korunuyor
   * (adminCloseShiftAction / editEntryAction / getAZGReportData); bu prop
   * yalniz basildiginda hata verecek olu buton gostermemek icin.
   */
  readOnly?: boolean;
};

export function AdminClient({
  entries: rawEntries,
  workers,
  range,
  from,
  to,
  workerFilter,
  statusFilter,
  summary,
  dashboard,
  reports,
  activeShifts,
  overLimitShifts,
  photoEntryIds,
  editedEntryIds,
  readOnly = false,
}: Props) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const tExport = useTranslations("export");
  const tAzg = useTranslations("azg");
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();

  const [editOpen, setEditOpen] = useState<TimeEntryWithWorker | null>(null);
  // Manuel vardiya başlatma (patron + filo şefi). Roster'daki "Başlamadı"
  // satırından açılır; yetki server action'da denetlenir (fail-closed).
  const [startWorker, setStartWorker] = useState<{ id: string; name: string } | null>(null);
  // Paket alanları kontrollü: "teslim edilen" canlı hesaplanıyor ve uyarılar
  // şoför tarafıyla aynı kuraldan (lib/package-limits.ts) türüyor.
  const [editTaken, setEditTaken] = useState("");
  const [editReturned, setEditReturned] = useState("");
  const [detail, setDetail] = useState<TimeEntryWithWorker | null>(null);
  const [confirmDel, setConfirmDel] = useState<TimeEntryWithWorker | null>(null);
  const [azgOpen, setAzgOpen] = useState(false);
  /** Arşiv (vardiya kayıtları) varsayılan KAPALI — bkz. bölüm başlığındaki not. */
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Şerit sayıları panonun KENDİ satırlarından türer — ikinci bir kaynak
  // olmadığı için pano ile şerit hiçbir zaman çelişemez ("Aktif Vardiya 6 /
  // Sahadaki şoför 6" çakışmasının kök sebebi iki ayrı kaynaktı).
  // Düzenleme dialogu her açılışta o kaydın değerleriyle doldurulur.
  useEffect(() => {
    setEditTaken(editOpen?.start_package_count != null ? String(editOpen.start_package_count) : "");
    setEditReturned(editOpen?.undelivered_count != null ? String(editOpen.undelivered_count) : "");
  }, [editOpen]);

  const editTakenNum = editTaken.trim() === "" ? null : Math.floor(Number(editTaken));
  const editReturnedNum = editReturned.trim() === "" ? null : Math.floor(Number(editReturned));
  const editPkgCheck = classifyUndelivered(editReturnedNum, editTakenNum);
  const editDerivedCargo =
    editTakenNum !== null && editReturnedNum !== null
      ? Math.max(0, editTakenNum - editReturnedNum)
      : null;

  const boardCounts = useMemo(() => rosterCounts(dashboard.roster), [dashboard.roster]);
  // Sessiz araç sayısı dikkat panosuyla AYNI kaynaktan (kind === "silent"),
  // böylece iki yerde farklı sayı çıkamaz.
  const silentVehicleCount = useMemo(
    () => dashboard.attention.filter((a) => a.kind === "silent").length,
    [dashboard.attention]
  );
  const [azgMonth, setAzgMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [azgBusy, setAzgBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  const nf = locale === "de" ? "de-AT" : "tr-TR";
  const photoIdSet = useMemo(() => new Set(photoEntryIds), [photoEntryIds]);
  const editedIdSet = useMemo(() => new Set(editedEntryIds), [editedEntryIds]);

  // Aynı vardiya id'si listede iki kez görünmesin — savunmacı dedup (tablo/kart
  // ve detay gezinmesi tek kaynaktan bunu kullanır). Her satırın adı zaten kendi
  // worker_id'sinden çözülür (page.tsx), yani doğru isim satırına bağlı kalır.
  const entries = useMemo(() => {
    const seen = new Set<string>();
    const out: TimeEntryWithWorker[] = [];
    for (const e of rawEntries) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
    return out;
  }, [rawEntries]);

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
      // PDF SABİT ALMANCA — arayüz Türkçe olsa da. Bkz. lib/report-de.ts:
      // bu çıktı AZG kapsamında ibraz edilen bir Avusturya resmî belgesidir.
      await downloadPdf({
        title: SHIFT_REPORT_DE.title,
        company: SHIFT_REPORT_DE.company,
        address: SHIFT_REPORT_DE.address,
        uid: SHIFT_REPORT_DE.uid,
        period: `${SHIFT_REPORT_DE.period}: ${reportPeriodDe(range)}`,
        generatedAt: `${SHIFT_REPORT_DE.generatedAt}: ${new Date().toLocaleString(
          "de-AT",
          { timeZone: "Europe/Vienna" }
        )}`,
        footer: SHIFT_REPORT_DE.footer,
        headers: SHIFT_REPORT_DE.headers,
        rows: entries.map((e) =>
          buildShiftReportRow(e, e.workers?.name ?? REPORT_EMPTY)
        ),
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
    const over =
      workedMs(e) > dailyCapMs(touchesNightWindow(e.started_at, e.ended_at));
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
          {/* ELLE DÜZELTİLDİ (22.07.2026) — AZG yasal rapor bu tablodan
              besleniyor; düzeltilmiş kayıt görsel olarak ayrılmalı. */}
          {editedIdSet.has(e.id) && (
            <StatusChip tone="neutral">{t("editedBadge")}</StatusChip>
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

  return (
    <div className="space-y-6">
      {/* Sayfa başlığı + genel eylemler. Excel/PDF/AZG/Çalışan Ekle en üste
          alındı: yönetici bunları arşiv tablosunu açmadan da kullanır. */}
      <PageHeader
        title={t("title")}
        action={
          readOnly ? null : (
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
          )
        }
      />

      {/* ── OPERASYON KONSOLU (Stellate klonu, DESIGN.md §0 DESTEK C) ──
          TodayStrip (5'li KPI şeridi) SİLİNDİ; beş sayının hepsi aşağıdaki
          sayı ızgarasına taşındı — bilgi kaybı yok, ayrı bir bileşen daha az.
          Sol sütun ADIM 3'te gerçek filtrelere kavuşacak; şu an kapsamı ve
          durum dağılımını gösteriyor (okunur, tıklanabilir değil). */}
      <OpsConsole
        filters={
          <div className="space-y-4">
            <div>
              <span className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.04em] text-text-tertiary">
                {t("dash.ops_title")}
              </span>
              <span className="font-mono text-[15px] font-semibold tabular-nums">
                {scopeLabel}
              </span>
            </div>
            <div className="border-t border-border pt-3">
              <span className="mb-2 block text-[12px] font-medium uppercase tracking-[0.04em] text-text-tertiary">
                {t("boardTitle")}
              </span>
              <ul className="space-y-1.5">
                {[
                  { k: "not_started", label: t("boardTabNotStarted"), n: boardCounts.notStarted },
                  { k: "in_field", label: t("boardTabInField"), n: boardCounts.inField },
                  { k: "closed", label: t("boardTabClosed"), n: boardCounts.closed },
                  { k: "on_leave", label: t("boardTabOnLeave"), n: boardCounts.onLeave },
                ].map((r) => (
                  <li key={r.k} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="font-mono font-semibold tabular-nums">{r.n}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        }
      >
        <OpsStatGrid
          items={[
            { key: "field", label: t("stripInField"), value: `${boardCounts.inField} / ${boardCounts.total}` },
            { key: "notStarted", label: t("stripNotStarted"), value: boardCounts.notStarted, accent: boardCounts.notStarted > 0 },
            { key: "closed", label: t("boardTabClosed"), value: boardCounts.closed },
            { key: "overLimit", label: t("stripOverLimit"), value: overLimitShifts },
            { key: "silent", label: t("stripSilentVehicles"), value: silentVehicleCount },
            { key: "loaded", label: t("stripLoaded"), value: boardCounts.loaded > 0 ? boardCounts.loaded : "—" },
          ]}
        />

        {/* GÜNÜN PANOSU — sayfanın merkezi. Vardiya açmayan şoför dahil, her
            aktif şoför için bir satır. "Başlamadı" satırlarında manuel başlatma
            kısayolu (patron + filo şefi; şef readOnly olsa da bu eylem açık —
            yetki server action'da kendi filosuyla sınırlanır). */}
        <TodayBoard
          rows={dashboard.roster}
          onStart={(row) => setStartWorker({ id: row.workerId, name: row.name })}
        />
      </OpsConsole>

      {/* ARAÇ ARIZALARI (DTC) BURADAN KALDIRILDI (22.07.2026) → /admin/araclar.
          Ölçtük: masaüstünde sayfanın ilk bloğuydu (420px), mobilde en tepedeki
          içerikti — operasyon özetinden de dikkat panosundan da önce geliyordu.
          Arıza aracın özelliğidir, günün operasyon panosunun konusu değil. */}

      {/* KARAR KATMANI — şerit + pano yukarıda kurulur (bkz. yukarıdaki blok).
          Sıra bilinçli: önce "bugün ne oluyor / kim eksik", sonra dikkat
          kalemleri, sonra ölçüm (operasyon özeti), en sonda arşiv. */}

      {/* Dikkat kalemleri + şoför bildirimleri.
          Dikkat panosu HER ZAMAN render edilir — kardeş kartların (DTC, şoför
          bildirimi) boş-durum ekonomisinden bilinçli ayrılır: bu pano yalnız
          "iş var mı" değil, "kontrol edildi mi" sorusunu da yanıtlar. Kartın
          hiç görünmemesi ile hiç uyarı olmaması yönetici için ayırt edilemez;
          "şu an dikkat gerektiren bir şey yok" satırı bilgidir. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <AttentionList
          items={dashboard.attention}
          /* Hatalı paket uyarısından doğrudan düzenlemeye. Kayıt seçili
             aralıkta yüklü değilse (worker/status filtresi) kısayol sessizce
             hiçbir şey yapmaz — yanlış kaydı açmaktansa hiç açmamak doğru. */
          onEditEntry={
            readOnly
              ? undefined
              : (entryId) => {
                  const e = entries.find((x) => x.id === entryId);
                  if (e) setEditOpen(e);
                }
          }
        />
        {/* Aktif vardiyalar HER ZAMAN render edilir — dikkat panosuyla aynı
            gerekçe: "liste boş" ile "kart yok" yönetici için ayırt edilemez,
            oysa "şu an açık vardiya yok" bilgidir. Kart bir uyarı değil durum
            listesidir; uyarıyı yalnız yasal tavanı aşan satırlar üretir. */}
        <ActiveShiftsCard rows={activeShifts} readOnly={readOnly} />
        {!readOnly && reports.length > 0 && (
          <DriverReportsCard reports={reports} />
        )}
      </div>

      {/* Bugünün ÖLÇÜM katmanı — karar katmanının altında. */}
      <OpsSummary ops={dashboard.todayOps} detail={dashboard.opsDetail} />

      {/* ARŞİV — vardiya kayıtları. VARSAYILAN KAPALI (22.07.2026): mobilde
          sayfa 21.389 px'ti ve bunun büyük kısmı bu tabloydu. Geçmiş kayıt
          günlük karar aracı değil, arama aracıdır; isteyen açar. Kapalıyken
          tablo hiç render edilmez (mobil DOM'u da küçülür).
          FİLO ŞEFİNDE HİÇ YOK (Volkan onayı 22.07.2026) — sefin isi gunluk
          operasyon, gecmis kayit arama degil. */}
      {!readOnly && (
      <section className="space-y-4 border-t border-border pt-6">
        <button
          type="button"
          onClick={() => setArchiveOpen((v) => !v)}
          aria-expanded={archiveOpen}
          className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-surface-2/50"
        >
          <span className="flex items-center gap-2">
            <ChevronRight
              className={`size-4 shrink-0 text-muted-foreground transition-transform ${archiveOpen ? "rotate-90" : ""}`}
              aria-hidden
            />
            <span className="text-base font-semibold">{t("dash.shifts_title")}</span>
          </span>
          <span className="nums text-xs text-muted-foreground">
            {t("archiveCount", { n: entries.length, scope: scopeLabel })}
          </span>
        </button>

        {archiveOpen && (
          <>
        {/* Filtre çubuğu */}
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("dateRange")}</Label>
              <Select value={range} onValueChange={(v) => setParam("range", v ?? "today")}>
                <SelectTrigger className="h-9 w-[150px]" aria-label={t("dateRange")}>
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
                <SelectTrigger className="h-9 w-[190px]" aria-label={t("worker")}>
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
                <SelectTrigger className="h-9 w-[170px]" aria-label={t("status")}>
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
          <>
            {/* Masaüstü (sm+): mevcut tablo — DEĞİŞMEDİ. Kendi iç scroll'u ve
                hideBelow kolonları yalnız burada; mobilde hiç render edilmez. */}
            <div className="hidden sm:block">
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
            </div>

            {/* Mobil (sm altı): KART düzeni — gizli kolon YOK, yatay/iç dikey
                scroll YOK. Tüm bilgi (ad, durum, saatler, çalışılan, KM) kartta
                açık; sayfayla tek scroll akar. Karta dokun → detay çekmecesi
                (düzenle/sil orada). */}
            <ul className="space-y-2.5 sm:hidden">
              {entries.map((e) => {
                const { active, onBreak, over } = shiftState(e);
                const km = kmDiff(e);
                const stripe = stripeFor(e);
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setDetail(e)}
                      className="relative w-full overflow-hidden rounded-[14px] border border-border/60 bg-card p-3.5 text-left transition-colors active:bg-surface-2"
                    >
                      {stripe && (
                        <span
                          aria-hidden
                          className="absolute inset-y-0 left-0 w-[3px]"
                          style={{ background: stripe }}
                        />
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <UserAvatar name={e.workers?.name ?? "?"} size="sm" />
                          <span className="font-medium">{e.workers?.name ?? "—"}</span>
                        </div>
                        {onBreak ? (
                          <StatusChip tone="break" dot>{t("dash.ops_on_break")}</StatusChip>
                        ) : active ? (
                          <StatusChip tone="active" dot>{t("active")}</StatusChip>
                        ) : (
                          <StatusChip tone="neutral">{t("statusCompleted")}</StatusChip>
                        )}
                      </div>
                      {((e.confirmation_status === "pending" ||
                        e.confirmation_status === "unconfirmed") ||
                        editedIdSet.has(e.id)) && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {(e.confirmation_status === "pending" ||
                            e.confirmation_status === "unconfirmed") && (
                            <StatusChip tone="warning">{t("unconfirmedBadge")}</StatusChip>
                          )}
                          {editedIdSet.has(e.id) && (
                            <StatusChip tone="neutral">{t("editedBadge")}</StatusChip>
                          )}
                        </div>
                      )}
                      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                        <MobileField label={t("tblStart")} value={formatTime(e.started_at, locale)} />
                        <MobileField
                          label={t("tblEnd")}
                          value={active ? "—" : formatTime(e.ended_at, locale)}
                        />
                        <MobileField
                          label={t("tblWorked")}
                          value={
                            <span className="inline-flex items-center gap-1.5">
                              {active ? <LiveWorked entry={e} /> : formatDurationShort(workedMs(e), locale)}
                              {over && <StatusChip tone="warning">9h+</StatusChip>}
                            </span>
                          }
                        />
                        <MobileField
                          label={t("tblKm")}
                          value={km !== null ? km.toLocaleString(nf) : "—"}
                        />
                        {e.plate && (
                          <MobileField
                            label={t("tblPlate")}
                            value={<span className="uppercase">{e.plate}</span>}
                          />
                        )}
                      </dl>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {/* Aralığa ait toplam KM — üst karttan buraya indi: aralık filtresinin
            hemen altında, ait olduğu tablonun yanında anlam kazanıyor. */}
        {entries.length > 0 && (
          <p className="nums text-xs text-muted-foreground">
            {t("archiveTotals", {
              km: summary.totalKm.toLocaleString(nf),
              scope: scopeLabel,
            })}
          </p>
        )}
          </>
        )}
      </section>
      )}

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
          <>
            <ShiftDetail
              entry={detail}
              locale={locale}
              t={t}
              nf={nf}
              hasPhotos={photoIdSet.has(detail.id)}
            />
            {/* Düzenleme geçmişi — kayıt hiç düzenlenmediyse hiç render edilmez. */}
            <ShiftEditHistory entryId={detail.id} />
          </>
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
                  <Label htmlFor="e_sk">{t("editStartKm")}</Label>
                  <Input id="e_sk" type="number" name="start_km" defaultValue={editOpen.start_km} required className="h-10" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="e_ek">{t("editEndKm")}</Label>
                  <Input id="e_ek" type="number" name="end_km" defaultValue={editOpen.end_km ?? ""} className="h-10" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e_br">{t("tblBreak")}</Label>
                <Input id="e_br" type="number" name="break_minutes" defaultValue={editOpen.break_minutes ?? 0} className="h-10" />
              </div>

              {/* PAKETLER — kaynak alanlar artık düzenlenebilir (22.07.2026).
                  Eskiden yalnız TÜRETİLMİŞ alan (teslim edilen) düzenlenebiliyor,
                  hatanın gerçekte olduğu iki kaynak alan düzenlenemiyordu.
                  Teslim edilen artık elle girilmiyor: alınan − geri getirilen
                  olarak hesaplanıyor, yani yönetici de şoförle aynı matematiği
                  kullanıyor ve tutarsız üçlü oluşturulamıyor. */}
              <fieldset className="space-y-3 rounded-xl border border-border/60 p-3">
                <legend className="px-1 text-xs uppercase tracking-wide text-muted-foreground">
                  {t("editPackagesGroup")}
                </legend>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="e_pk">{t("tblLoaded")}</Label>
                    <Input
                      id="e_pk"
                      type="number"
                      min={0}
                      name="start_package_count"
                      value={editTaken}
                      onChange={(e) => setEditTaken(e.target.value)}
                      className="nums h-10"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="e_un">{t("editReturned")}</Label>
                    <Input
                      id="e_un"
                      type="number"
                      min={0}
                      name="undelivered_count"
                      value={editReturned}
                      onChange={(e) => setEditReturned(e.target.value)}
                      className="nums h-10"
                    />
                  </div>
                </div>
                <p className="text-sm">
                  <span className="text-muted-foreground">{t("tblCargo")}: </span>
                  <span
                    className={`nums font-semibold ${
                      editDerivedCargo === 0 ? "text-accent-claret-text" : "text-foreground"
                    }`}
                  >
                    {editDerivedCargo === null ? "—" : editDerivedCargo}
                  </span>
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {t("editCargoAuto")}
                  </span>
                </p>
                {/* Şoför tarafındaki kuralların aynısı: engel kırmızı, teyit
                    altın. Yönetici teyit gerektiren değeri yazabilir — kaydı
                    düzeltmek için bazen gerekir — ama görmeden geçemez. */}
                {editPkgCheck.level === "block" && (
                  <p className="flex items-start gap-1.5 text-xs text-accent-claret-text">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {t(editPkgCheck.code === "no_total" ? "v2BlockNoTotalAdmin" : "v2BlockOverAdmin")}
                  </p>
                )}
                {editPkgCheck.level === "confirm" && (
                  <p className="flex items-start gap-1.5 text-xs text-accent-gold">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {t(
                      editPkgCheck.code === "all_returned"
                        ? "v2ConfirmAllReturnedAdmin"
                        : "v2ConfirmManyReturnedAdmin"
                    )}
                  </p>
                )}
              </fieldset>
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

      {/* Manuel vardiya başlatma — Günün Panosu "Başlamadı" satırından. */}
      <StartShiftForWorkerDialog
        worker={startWorker}
        onClose={() => setStartWorker(null)}
        onDone={() => router.refresh()}
      />
    </div>
  );
}

/** Mobil vardiya kartındaki tek etiket/değer alanı (masaüstü tablosunun kolon
 *  karşılığı — gizli kolon yerine hepsi açık). */
function MobileField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="nums mt-0.5">{value}</dd>
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
