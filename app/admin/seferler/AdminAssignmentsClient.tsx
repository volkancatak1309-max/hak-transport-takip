"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, MoreHorizontal, Package, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, StatusChip, EmptyState, RevealFilterRow } from "@/components/ui-v2";
import { SpecRow } from "@/components/ui-v2/DetailSpec";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDateTime, viennaDayKey } from "@/lib/format";
import { STATUS_TONE, routeSummary } from "@/lib/assignments-ui";
import type { AssignmentWithWorker, AssignmentStatus } from "@/lib/types";
import {
  createAssignment,
  updateAssignment,
  cancelAssignment,
  type AssignmentInput,
} from "@/app/actions/assignments";
import { AssignmentForm } from "./AssignmentForm";

/**
 * SEFER LİSTESİ — gün gruplu sakin liste.
 *
 * İskelet Alarmlar sayfasında kurulan Linear dilinin aynısı: kolon başlığı yok,
 * zebra yok, satır ayırıcısı yok; grubu boşluk ve mikro etiket ayırır. Sefer
 * verisi doğası gereği GÜNE bağlı olduğu için gruplama ekseni gündür — eskiden
 * her sefer ayrı bir kutuydu ve aynı günün beş seferi beş bağımsız olay gibi
 * duruyordu.
 *
 * Sol 3px durum şeridi kaldırıldı (bkz. lib/assignments-ui STATUS_TONE): ton
 * satırın kenarında değil rozetinde yaşar. Şoför panelindeki KART görünümünde
 * şerit yerinde duruyor.
 *
 * İşlev kaybı yok: Gösterilen/Durum filtreleri, yeni · düzenle · iptal · detay
 * akışları ve iptal gerekçesi aynen korundu.
 */

type Tab = "today" | "tomorrow" | "week" | "all";
type WorkerOpt = { id: string; name: string };

type Props = {
  assignments: AssignmentWithWorker[];
  workers: WorkerOpt[];
};

function toInput(a: AssignmentWithWorker): AssignmentInput {
  return {
    worker_id: a.worker_id,
    scheduled_at: a.scheduled_at,
    category: a.category,
    stops: a.stops,
    package_count: a.package_count,
    notes: a.notes,
  };
}

export function AdminAssignmentsClient({ assignments, workers }: Props) {
  const t = useTranslations("assignments");
  const locale = useLocale();
  const router = useRouter();
  const nf = locale === "de" ? "de-AT" : "tr-TR";

  const [tab, setTab] = useState<Tab>("today");
  const [statusFilter, setStatusFilter] = useState<"all" | AssignmentStatus>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AssignmentWithWorker | null>(null);
  const [cancelling, setCancelling] = useState<AssignmentWithWorker | null>(null);
  const [detail, setDetail] = useState<AssignmentWithWorker | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const byStatus =
      statusFilter === "all"
        ? assignments
        : assignments.filter((a) => a.status === statusFilter);
    if (tab === "all") return byStatus;
    const now = new Date();
    const todayKey = viennaDayKey(now);
    const tmr = new Date(now);
    tmr.setDate(now.getDate() + 1);
    const tomorrowKey = viennaDayKey(tmr);
    const dow = (now.getDay() + 6) % 7;
    const mon = new Date(now);
    mon.setDate(now.getDate() - dow);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const weekStart = viennaDayKey(mon);
    const weekEnd = viennaDayKey(sun);

    return byStatus.filter((a) => {
      const k = viennaDayKey(a.scheduled_at);
      if (tab === "today") return k === todayKey;
      if (tab === "tomorrow") return k === tomorrowKey;
      return k >= weekStart && k <= weekEnd; // week
    });
  }, [assignments, tab, statusFilter]);

  /** Gün → o güne düşen seferler (sıra: en yeni gün üstte, gün içinde saat). */
  const groups = useMemo(() => {
    const m = new Map<string, AssignmentWithWorker[]>();
    for (const a of filtered) {
      const k = viennaDayKey(a.scheduled_at);
      const arr = m.get(k);
      if (arr) arr.push(a);
      else m.set(k, [a]);
    }
    return [...m.entries()]
      .sort((x, y) => y[0].localeCompare(x[0]))
      .map(([day, rows]) => ({
        day,
        rows: rows.sort(
          (x, y) =>
            new Date(x.scheduled_at).getTime() - new Date(y.scheduled_at).getTime()
        ),
      }));
  }, [filtered]);

  async function handleCreate(payload: AssignmentInput) {
    setBusy(true);
    try {
      const res = await createAssignment(payload);
      if (!res.ok) {
        toast.error(t("save_error"));
        return;
      }
      toast.success(t("created_toast"));
      setCreateOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleEdit(payload: AssignmentInput) {
    if (!editing) return;
    setBusy(true);
    try {
      const res = await updateAssignment(editing.id, payload);
      if (!res.ok) {
        toast.error(t("save_error"));
        return;
      }
      toast.success(t("created_toast"));
      setEditing(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!cancelling) return;
    setBusy(true);
    try {
      const res = await cancelAssignment(cancelling.id, reason);
      if (!res.ok) {
        toast.error(t("cancel_error"));
        return;
      }
      toast.success(t("cancelled_toast"));
      setCancelling(null);
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const dayLabel = (key: string) =>
    new Date(`${key}T12:00:00`).toLocaleDateString(nf, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  const timeLabel = (iso: string) =>
    new Date(iso).toLocaleTimeString(nf, { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        help="page_trips"
        action={
          <Button className="btn-primary h-9 rounded-full px-4" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> {t("new")}
          </Button>
        }
      />

      {/* Filtre bandı — Gösterilen (gün kapsamı) + Durum. Eylem yuvası boş:
          birincil eylem başlığa taşındı (ekran başına tek birincil eylem). */}
      <RevealFilterRow
        filters={[
          {
            label: t("filter_shown"),
            value: tab,
            onChange: (v) => setTab(v as Tab),
            options: [
              { value: "today", label: t("today") },
              { value: "tomorrow", label: t("tomorrow") },
              { value: "week", label: t("this_week") },
              { value: "all", label: t("all") },
            ],
          },
          {
            label: t("filter_status"),
            value: statusFilter,
            onChange: (v) => setStatusFilter(v as "all" | AssignmentStatus),
            options: [
              { value: "all", label: t("filter_all") },
              { value: "assigned", label: t("status.assigned") },
              { value: "started", label: t("status.started") },
              { value: "completed", label: t("status.completed") },
              { value: "cancelled", label: t("status.cancelled") },
            ],
          },
        ]}
      />

      {groups.length === 0 ? (
        <EmptyState kind="none" title={t("no_assignments")} />
      ) : (
        <div className="glass-panel space-y-8 rounded-[16px] p-6">
          {groups.map((g) => (
            <section key={g.day}>
              <header className="mb-3 flex items-baseline gap-2">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-text-tertiary">
                  {dayLabel(g.day)}
                </h3>
                <span className="nums text-[11px] text-text-tertiary">{g.rows.length}</span>
              </header>

              <ul>
                {g.rows.map((a) => (
                  <li key={a.id}>
                    <div className="group flex items-start gap-3 rounded-[10px] px-2 py-2.5 transition-colors hover:bg-surface-panel">
                      {/* Saat — satırın çapası, mono ve sabit genişlikte ki
                          gün içindeki seferler dikey hizada okunsun. */}
                      <span className="nums w-[44px] shrink-0 pt-0.5 text-[13px] text-muted-foreground">
                        {timeLabel(a.scheduled_at)}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[14px] font-medium">{a.worker_name}</span>
                          {a.worker_plate && (
                            <span className="nums text-[12px] uppercase text-muted-foreground">
                              {a.worker_plate}
                            </span>
                          )}
                          <StatusChip tone={STATUS_TONE[a.status]}>
                            {t(`status.${a.status}`)}
                          </StatusChip>
                          <span className="text-[12px] text-text-tertiary">
                            {t(`category.${a.category}`)}
                          </span>
                        </div>
                        {/* Güzergâh zaten routeSummary'de 60 karakterde "…" ile
                            kesiliyor; üstüne CSS `truncate` koymak İKİNCİ bir
                            kırpma olurdu ve dar ekranda adres tanınmaz hâle
                            gelirdi. Sığmayan satır atlar. */}
                        <p className="mt-1 flex items-start gap-1.5 text-[13px] text-muted-foreground">
                          <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          <span className="min-w-0 break-words">{routeSummary(a.stops)}</span>
                        </p>
                        <p className="nums mt-1 flex items-center gap-3 text-[12px] text-text-tertiary">
                          <span className="flex items-center gap-1">
                            <Package className="size-3.5" aria-hidden /> {a.package_count ?? 0}
                          </span>
                          {a.start_km != null && a.end_km != null && (
                            <span>{(a.end_km - a.start_km).toLocaleString(nf)} km</span>
                          )}
                        </p>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                              aria-label={t("detail")}
                            />
                          }
                        >
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDetail(a)}>
                            {t("detail")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={a.status === "completed" || a.status === "cancelled"}
                            onClick={() => setEditing(a)}
                          >
                            {t("edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={a.status === "completed" || a.status === "cancelled"}
                            onClick={() => {
                              setReason("");
                              setCancelling(a);
                            }}
                            className="text-destructive"
                          >
                            {t("delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("new")}</DialogTitle>
          </DialogHeader>
          <AssignmentForm
            workers={workers}
            busy={busy}
            onSubmit={handleCreate}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("edit")}</DialogTitle>
          </DialogHeader>
          {editing && (
            <AssignmentForm
              workers={workers}
              initial={toInput(editing)}
              busy={busy}
              onSubmit={handleEdit}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Cancel */}
      <Dialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("delete")}</DialogTitle>
            <DialogDescription>
              {cancelling?.worker_name} ·{" "}
              {cancelling && formatDateTime(cancelling.scheduled_at, locale)}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("cancel_reason_prompt")}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleCancel} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail — künye satırları Enode/DetailSpec dilinde: etiket solda,
          değer sağda; duraklar sıralı liste olarak kalır. */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail?.worker_name}</DialogTitle>
            <DialogDescription>
              {detail && formatDateTime(detail.scheduled_at, locale)} ·{" "}
              {detail && t(`category.${detail.category}`)} ·{" "}
              {detail && t(`status.${detail.status}`)}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div>
                {detail.stops.map((s, i) => (
                  <SpecRow key={i} label={s.label}>
                    {s.address}
                  </SpecRow>
                ))}
              </div>
              <div>
                <SpecRow label={t("packages")} mono>
                  {detail.package_count ?? 0}
                </SpecRow>
                {detail.start_km != null && detail.end_km != null && (
                  <SpecRow label="km" mono>
                    {detail.end_km - detail.start_km} km
                  </SpecRow>
                )}
              </div>
              {detail.notes && (
                <p className="rounded-[10px] bg-surface-panel px-3.5 py-2.5 text-[13px]">
                  {detail.notes}
                </p>
              )}
              {detail.status === "cancelled" && detail.cancel_reason && (
                <p className="rounded-[10px] bg-status-critical-soft px-3.5 py-2.5 text-[13px] text-status-critical-text">
                  {detail.cancel_reason}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
