"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Check,
  X,
  Trash2,
  CalendarOff,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/format";
import { leaveCellStyle, LeaveSwatch } from "@/components/admin/LeaveCell";
import {
  LEAVE_TYPES,
  leaveTypeDef,
  type LeaveTypeKey,
  type LeaveStatus,
} from "@/lib/leave-types";
import {
  submitLeaveAction,
  approveLeaveAction,
  rejectLeaveAction,
  deleteLeaveAction,
  type LeaveActionResult,
} from "@/app/actions/leaves";

export type CalWorker = { id: string; name: string; terminated?: boolean };
/**
 * Arşiv satırı (25.07.2026). Takvim ızgarasının aksine AYA BAĞLI DEĞİL ve
 * reddedilenleri de taşır: "kim neyi ne zaman onayladı/reddetti" izi.
 * İsimler sunucuda çözülür (karar veren çoğu zaman patrondur ve takvimin
 * personel listesinde bulunmaz).
 */
export type ArchiveLeave = {
  id: string;
  worker_name: string;
  leave_type: LeaveTypeKey;
  start_date: string;
  end_date: string;
  status: "approved" | "rejected";
  decided_by: string;
  decided_at: string | null;
  note: string | null;
};
export type CalLeave = {
  id: string;
  worker_id: string;
  leave_type: LeaveTypeKey;
  start_date: string; // YYYY-MM-DD
  end_date: string;
  status: LeaveStatus;
  note: string | null;
};

/** Bir tarihi (YYYY-MM-DD) iznin kapsayıp kapsamadığı — ISO string karşılaştırma
 *  doğru sıralar, TZ dönüşümü gerekmez. */
function covers(l: CalLeave, ymdStr: string): boolean {
  return l.start_date <= ymdStr && l.end_date >= ymdStr;
}

function ymd(y: number, m1: number, d: number): string {
  return `${y}-${String(m1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

type DrawerState =
  | { mode: "add"; workerId: string; date: string }
  | { mode: "edit"; leave: CalLeave }
  | null;

export function LeaveCalendar({
  workers,
  leaves,
  month,
  isChief,
  archive = [],
  archiveCapped = false,
}: {
  workers: CalWorker[];
  leaves: CalLeave[];
  month: string; // YYYY-MM
  isChief: boolean;
  /** Karara bağlanmış izinler (onaylı + reddedilmiş), en yeni önce. */
  archive?: ArchiveLeave[];
  /** Arşiv tavana dayandı mı → dipnot basılır (sessiz kırpma yok). */
  archiveCapped?: boolean;
}) {
  const t = useTranslations("izinler");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const canApprove = !isChief; // patron onaylar

  const [year, mon] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  // React Compiler (Next 16) memoize eder — elle useMemo tutmuyoruz.
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const prevMonth = new Date(Date.UTC(year, mon - 2, 1)).toISOString().slice(0, 7);
  const nextMonth = new Date(Date.UTC(year, mon, 1)).toISOString().slice(0, 7);
  const monthLabel = new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString(
    locale === "de" ? "de-AT" : "tr-TR",
    { month: "long", year: "numeric", timeZone: "UTC" }
  );

  // worker_id → (gün → izin). Örtüşme engellendiği için gün başına en fazla bir
  // reddedilmemiş izin olur; yine de onaylıyı önceleriz.
  const byWorkerDay = (() => {
    const map = new Map<string, Map<number, CalLeave>>();
    for (const l of leaves) {
      let inner = map.get(l.worker_id);
      if (!inner) {
        inner = new Map();
        map.set(l.worker_id, inner);
      }
      for (const d of days) {
        if (!covers(l, ymd(year, mon, d))) continue;
        const cur = inner.get(d);
        if (!cur || (cur.status !== "approved" && l.status === "approved")) {
          inner.set(d, l);
        }
      }
    }
    return map;
  })();

  const pendingLeaves = leaves.filter((l) => l.status === "pending");
  const nameById = new Map(workers.map((w) => [w.id, w.name]));

  // AYRILAN personel ana ızgaradan ÇIKAR → aşağıda katlanır "Ayrılan personel"
  // bölümünde salt okunur gösterilir (Çalışanlar sayfasındaki "Eski Personeller"
  // deseniyle tutarlı). 20 kişi ayrılınca ana liste kullanılmaz hâle gelmesin.
  const activeWorkers = workers.filter((w) => !w.terminated);
  const formerWorkers = workers.filter((w) => w.terminated);

  function isWeekend(d: number): boolean {
    const dow = new Date(Date.UTC(year, mon - 1, d)).getUTCDay();
    return dow === 0 || dow === 6;
  }

  const refresh = () => {
    setDrawer(null);
    router.refresh();
  };

  // Onay bekleyen listesindeki tek-tık onayla/reddet.
  function decide(fn: () => Promise<LeaveActionResult>) {
    start(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
    });
  }

  // Gün numarası başlığı — hem aktif ızgara hem ayrılan-personel bölümü kullanır.
  const dayHeader = (
    <thead>
      <tr>
        <th className="sticky left-0 z-10 min-w-[9rem] border-b border-border bg-card px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("colWorker")}
        </th>
        {days.map((d) => (
          <th
            key={d}
            className={[
              "nums border-b border-border py-2 text-center text-[11px] font-medium text-muted-foreground",
              isWeekend(d) ? "bg-surface-2/50" : "",
            ].join(" ")}
            style={{ minWidth: 26 }}
          >
            {d}
          </th>
        ))}
      </tr>
    </thead>
  );

  // Tek satır. readOnly=true (ayrılan personel): isim gri + "(ayrıldı)", boş
  // hücre etkileşimsiz, izin hücreleri tıklanamaz (yeni izin yok, düzenleme yok).
  const renderRow = (w: CalWorker, readOnly: boolean) => {
    const inner = byWorkerDay.get(w.id);
    return (
      <tr key={w.id} className="border-b border-border/50 last:border-0">
        <td
          className={`sticky left-0 z-10 min-w-[9rem] bg-card px-3 py-1.5 font-medium ${
            readOnly ? "text-muted-foreground" : ""
          }`}
        >
          {w.name}
          {readOnly && (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              ({t("terminated")})
            </span>
          )}
        </td>
        {days.map((d) => {
          const l = inner?.get(d);
          if (!l) {
            // Boş hücre: aktif personelde tıklanır (izin ekle), ayrılanda değil.
            if (readOnly) {
              return (
                <td key={d} className={isWeekend(d) ? "bg-surface-panel/60" : ""} />
              );
            }
            return (
              <td key={d} className={isWeekend(d) ? "bg-surface-panel/60" : ""}>
                <button
                  type="button"
                  aria-label={t("addForDay", { day: d })}
                  className="h-7 w-full min-w-[26px] rounded-[4px] transition-colors hover:bg-surface-hover"
                  onClick={() =>
                    setDrawer({
                      mode: "add",
                      workerId: w.id,
                      date: ymd(year, mon, d),
                    })
                  }
                />
              </td>
            );
          }
          const def = leaveTypeDef(l.leave_type);
          const isPending = l.status === "pending";
          const title = `${nameById.get(l.worker_id) ?? ""} · ${def.tr} · ${l.start_date} → ${l.end_date}${
            isPending ? ` · ${t("statusPending")}` : ""
          }${l.note ? ` · ${l.note}` : ""}`;
          // Ayrılan personelde izin GÖRÜNÜR ama tıklanamaz (salt okunur).
          if (readOnly) {
            return (
              <td key={d} className="p-0">
                <span
                  title={title}
                  className="flex h-7 w-full min-w-[26px] cursor-default items-center justify-center rounded-[4px] text-[10px] font-semibold opacity-60"
                  style={leaveCellStyle(def, false)}
                >
                  {def.short}
                </span>
              </td>
            );
          }
          return (
            <td key={d} className="p-0">
              <button
                type="button"
                title={title}
                onClick={() => setDrawer({ mode: "edit", leave: l })}
                className="flex h-7 w-full min-w-[26px] items-center justify-center rounded-[4px] text-[10px] font-semibold transition-opacity hover:opacity-80"
                style={leaveCellStyle(def, isPending)}
              >
                {def.short}
              </button>
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <div className="space-y-5">
      {/* Başlık + ay navigasyonu */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/izinler?month=${prevMonth}`}
            className="btn-outline-ring inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            aria-label={t("prevMonth")}
          >
            <ChevronLeft className="size-4" />
          </Link>
          <span className="nums min-w-[9rem] text-center text-sm font-medium capitalize">
            {monthLabel}
          </span>
          <Link
            href={`/admin/izinler?month=${nextMonth}`}
            className="btn-outline-ring inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            aria-label={t("nextMonth")}
          >
            <ChevronRight className="size-4" />
          </Link>
          <Button
            size="sm"
            onClick={() =>
              setDrawer({
                mode: "add",
                workerId: (workers.find((w) => !w.terminated) ?? workers[0])?.id ?? "",
                date: ymd(year, mon, 1),
              })
            }
            className="ml-1"
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t("addLeave")}</span>
          </Button>
        </div>
      </div>

      {/* Onay bekleyen talepler (yalnız patron) */}
      {canApprove && pendingLeaves.length > 0 && (
        <Card className="surface-card rounded-[12px]">
          <CardContent className="p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-accent-coral-text">
              <CalendarOff className="size-4" />
              {t("pendingTitle", { n: pendingLeaves.length })}
            </h2>
            <ul className="space-y-2">
              {pendingLeaves.map((l) => {
                const def = leaveTypeDef(l.leave_type);
                return (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-surface-panel px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <LeaveSwatch def={def} />
                      <span className="font-medium">
                        {nameById.get(l.worker_id) ?? "—"}
                      </span>
                      <span className="nums text-muted-foreground">
                        · {def.tr} · {l.start_date} → {l.end_date}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => decide(() => approveLeaveAction(l.id))}
                      >
                        <Check className="size-3.5" /> {t("approve")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => decide(() => rejectLeaveAction(l.id))}
                      >
                        <X className="size-3.5" /> {t("reject")}
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Izgara — YALNIZ aktif kadro. Ayrılanlar aşağıdaki katlanır bölümde.
          Bölüm paneli = cam (DESIGN.md §3.1); içindeki hücreler cam DEĞİL. */}
      <Card className="glass-panel rounded-[16px]">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              {dayHeader}
              <tbody>
                {activeWorkers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={days.length + 1}
                      className="px-3 py-8 text-center text-sm text-muted-foreground"
                    >
                      {t("noWorkers")}
                    </td>
                  </tr>
                ) : (
                  activeWorkers.map((w) => renderRow(w, false))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── AYRILAN PERSONEL ── varsayılan GİZLİ, katlanır. Salt okunur: geçmiş
          izinleri gri tonda görünür, yeni izin girilemez. Çalışanlar sayfasındaki
          "Eski Personeller" (details/summary) deseniyle tutarlı. */}
      {formerWorkers.length > 0 && (
        <details className="surface-card overflow-hidden rounded-[12px]">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold">
            {t("formerTitle", { n: formerWorkers.length })}
          </summary>
          <div className="border-t border-border/60">
            <p className="px-4 pt-3 text-xs text-muted-foreground">
              {t("formerNote")}
            </p>
            <div className="overflow-x-auto p-1 opacity-90">
              <table className="w-full border-collapse text-sm">
                {dayHeader}
                <tbody>{formerWorkers.map((w) => renderRow(w, true))}</tbody>
              </table>
            </div>
          </div>
        </details>
      )}

      {/* ── ARŞİV ── karara bağlanmış izinler. "Ayrılan personel" ile aynı
          details/summary deseni, varsayılan KAPALI. Takvim yalnız bir ayı ve
          reddedilmeyenleri gösterdiği için "kim onayladı/reddetti" izi başka
          hiçbir ekranda görünmüyordu (25.07.2026). */}
      <LeaveArchive
        rows={archive.filter((a) => a.status === "approved")}
        title={t("archiveApprovedTitle", {
          n: archive.filter((a) => a.status === "approved").length,
        })}
        decidedLabel={t("archiveApprovedBy")}
        locale={locale}
        capped={archiveCapped}
      />
      <LeaveArchive
        rows={archive.filter((a) => a.status === "rejected")}
        title={t("archiveRejectedTitle", {
          n: archive.filter((a) => a.status === "rejected").length,
        })}
        decidedLabel={t("archiveRejectedBy")}
        locale={locale}
        capped={archiveCapped}
        muted
      />

      {/* LEJANT — üç kanal birden: desen örneği + kısa kod + isim.
          Renk tek taşıyıcı değil; desen ve kod da anlamı taşıyor. */}
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {LEAVE_TYPES.filter((d) => d.common).map((d) => (
          <span key={d.key} className="inline-flex items-center gap-1.5 text-xs">
            <span
              className="inline-flex size-4 items-center justify-center rounded-[4px] text-[9px] font-bold"
              style={leaveCellStyle(d, false)}
            >
              {d.short}
            </span>
            {d.tr}
          </span>
        ))}
        {/* Bekleyen talep YOKKEN bu satır karşılığı olmayan bir açıklamaydı:
            ekranda tek bir silik hücre bile olmadan "silik = onay bekliyor"
            diyordu. Artık yalnız gerçekten silik hücre varsa görünür. */}
        {pendingLeaves.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block size-4 rounded-sm bg-muted-foreground/40" />
            {t("legendPending")}
          </span>
        )}
      </div>

      {drawer && (
        <LeaveDrawer
          key={
            drawer.mode === "edit"
              ? drawer.leave.id
              : `add-${drawer.workerId}-${drawer.date}`
          }
          state={drawer}
          workers={workers}
          isChief={isChief}
          canApprove={canApprove}
          onClose={() => setDrawer(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

/**
 * Katlanır arşiv tablosu — onaylananlar ve reddedilenler için TEK bileşen.
 * Boş liste hiç render edilmez (kapalı bir "(0)" başlığı gürültüdür).
 * `muted` = reddedilenler: karar olumsuz, satırlar sönük tonda.
 */
function LeaveArchive({
  rows,
  title,
  decidedLabel,
  locale,
  capped,
  muted = false,
}: {
  rows: ArchiveLeave[];
  title: string;
  decidedLabel: string;
  locale: string;
  capped: boolean;
  muted?: boolean;
}) {
  const t = useTranslations("izinler");
  if (rows.length === 0) return null;
  return (
    <details className="surface-card overflow-hidden rounded-[12px]">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold">
        {title}
      </summary>
      <div className="border-t border-border/60">
        {/* Geniş tablo KENDİ kutusunda kayar — sayfa gövdesi yatay kaymaz. */}
        <div className="overflow-x-auto p-1">
          <table className={`w-full border-collapse text-sm ${muted ? "opacity-75" : ""}`}>
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t("archiveColWorker")}</th>
                <th className="px-3 py-2 font-medium">{t("archiveColType")}</th>
                <th className="px-3 py-2 font-medium">{t("archiveColRange")}</th>
                <th className="px-3 py-2 font-medium">{decidedLabel}</th>
                <th className="px-3 py-2 font-medium">{t("archiveColWhen")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const def = leaveTypeDef(r.leave_type);
                return (
                  <tr key={r.id} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2 font-medium">{r.worker_name}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <LeaveSwatch def={def} />
                        {locale === "de" ? def.de : def.tr}
                      </span>
                    </td>
                    <td className="nums px-3 py-2 text-muted-foreground">
                      {formatDate(r.start_date, locale)} → {formatDate(r.end_date, locale)}
                    </td>
                    <td className="px-3 py-2">{r.decided_by}</td>
                    <td className="nums px-3 py-2 text-muted-foreground">
                      {r.decided_at ? formatDateTime(r.decided_at, locale) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {capped && (
          <p className="px-4 pb-3 pt-1 text-xs text-muted-foreground">
            {t("archiveCapped")}
          </p>
        )}
      </div>
    </details>
  );
}

function errorMessage(
  t: (k: string) => string,
  code: string | undefined
): string {
  switch (code) {
    case "overlap":
      return t("errOverlap");
    case "scope":
    case "forbidden":
    case "admin_target":
    case "terminated_target":
      return t("errForbidden");
    case "no_worker":
      return t("errRequired");
    case "range":
      return t("errRange");
    default:
      return t("errGeneric");
  }
}

function LeaveDrawer({
  state,
  workers,
  isChief,
  canApprove,
  onClose,
  onChanged,
}: {
  state: NonNullable<DrawerState>;
  workers: CalWorker[];
  isChief: boolean;
  canApprove: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("izinler");
  const [pending, start] = useTransition();
  const editing = state.mode === "edit" ? state.leave : null;
  const [workerId, setWorkerId] = useState(
    editing?.worker_id ?? (state.mode === "add" ? state.workerId : "")
  );
  const [type, setType] = useState<LeaveTypeKey>(
    editing?.leave_type ?? "jahresurlaub"
  );
  const [startDate, setStartDate] = useState(
    editing?.start_date ?? (state.mode === "add" ? state.date : "")
  );
  const [endDate, setEndDate] = useState(
    editing?.end_date ?? (state.mode === "add" ? state.date : "")
  );
  const [note, setNote] = useState(editing?.note ?? "");
  const [confirmShift, setConfirmShift] = useState<number | null>(null);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const common = LEAVE_TYPES.filter((d) => d.common);
  const other = LEAVE_TYPES.filter((d) => !d.common);
  // Onaylanmış bir izni şef düzenleyemez/silemez (sunucu da reddeder; ölü buton
  // göstermemek için görsel eş).
  const chiefLocked = isChief && editing !== null && editing.status !== "pending";

  function submit(force: boolean) {
    setLocalErr(null);
    if (!workerId || !startDate || !endDate) {
      setLocalErr(t("errRequired"));
      return;
    }
    if (endDate < startDate) {
      setLocalErr(t("errRange"));
      return;
    }
    start(async () => {
      const res = await submitLeaveAction({
        id: editing?.id,
        worker_id: workerId,
        leave_type: type,
        start_date: startDate,
        end_date: endDate,
        note: note.trim() || null,
        force,
      });
      if (res.needConfirm) {
        setConfirmShift(res.conflictShifts ?? 0);
      } else if (res.ok) {
        onChanged();
      } else {
        setConfirmShift(null);
        setLocalErr(errorMessage(t, res.error));
      }
    });
  }

  function act(fn: () => Promise<LeaveActionResult>) {
    start(async () => {
      const res = await fn();
      if (res.ok) onChanged();
      else setLocalErr(errorMessage(t, res.error));
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="close"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="glass relative flex h-full w-full max-w-md flex-col overflow-y-auto p-5 page-enter">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">
            {editing ? t("editTitle") : t("addTitle")}
          </h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="close">
            <X className="size-5" />
          </Button>
        </div>

        {chiefLocked ? (
          <p className="rounded-lg bg-surface-2 p-3 text-sm text-muted-foreground">
            {t("chiefLocked")}
          </p>
        ) : (
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("colWorker")}
              </span>
              <select
                value={workerId}
                onChange={(e) => setWorkerId(e.target.value)}
                disabled={!!editing}
                className="btn-outline-ring w-full rounded-[8px] border-0 bg-transparent px-3 py-2 text-sm disabled:opacity-60"
              >
                <option value="">—</option>
                {/* Ayrılan personele yeni izin girilemez → seçenekten çıkar. */}
                {workers
                  .filter((w) => !w.terminated)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("leaveType")}
              </span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as LeaveTypeKey)}
                className="btn-outline-ring w-full rounded-[8px] border-0 bg-transparent px-3 py-2 text-sm"
              >
                <optgroup label={t("groupCommon")}>
                  {common.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.tr}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("groupOther")}>
                  {other.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.tr}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t("startDate")}
                </span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="btn-outline-ring w-full rounded-[8px] border-0 bg-transparent px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t("endDate")}
                </span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="btn-outline-ring w-full rounded-[8px] border-0 bg-transparent px-3 py-2 text-sm"
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("note")}
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="btn-outline-ring w-full rounded-[8px] border-0 bg-transparent px-3 py-2 text-sm"
              />
            </label>

            {isChief && !editing && (
              <p className="rounded-lg bg-accent-gold/10 p-2.5 text-xs text-accent-gold-text">
                {t("chiefRequestHint")}
              </p>
            )}

            {localErr && <p className="text-sm text-destructive">{localErr}</p>}

            {confirmShift !== null ? (
              <div className="space-y-2 rounded-lg bg-accent-gold/10 p-3">
                <p className="text-sm text-accent-gold-text">
                  {t("shiftConflict", { n: confirmShift })}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" disabled={pending} onClick={() => submit(true)}>
                    {t("saveAnyway")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmShift(null)}
                  >
                    {t("cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 pt-1">
                {editing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => act(() => deleteLeaveAction(editing.id))}
                  >
                    <Trash2 className="size-4" /> {t("delete")}
                  </Button>
                )}
                <Button
                  className="ml-auto"
                  disabled={pending}
                  onClick={() => submit(false)}
                >
                  {editing ? t("save") : isChief ? t("request") : t("save")}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Patron: bekleyen talebi çekmeceden de onaylayabilir/reddedebilir */}
        {editing && canApprove && editing.status === "pending" && (
          <div className="mt-4 flex gap-2 border-t border-border pt-4">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => act(() => approveLeaveAction(editing.id))}
            >
              <Check className="size-4" /> {t("approve")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              className="text-muted-foreground hover:text-destructive"
              onClick={() => act(() => rejectLeaveAction(editing.id))}
            >
              <X className="size-4" /> {t("reject")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
