"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, MoreVertical, Package, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { cn } from "@/lib/utils";
import { formatDateTime, viennaDayKey } from "@/lib/format";
import { STATUS_STRIPE, STATUS_BADGE, routeSummary } from "@/lib/assignments-ui";
import type { AssignmentWithWorker } from "@/lib/types";
import {
  createAssignment,
  updateAssignment,
  cancelAssignment,
  type AssignmentInput,
} from "@/app/actions/assignments";
import { AssignmentForm } from "./AssignmentForm";

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

  const [tab, setTab] = useState<Tab>("today");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AssignmentWithWorker | null>(null);
  const [cancelling, setCancelling] = useState<AssignmentWithWorker | null>(null);
  const [detail, setDetail] = useState<AssignmentWithWorker | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    if (tab === "all") return assignments;
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

    return assignments.filter((a) => {
      const k = viennaDayKey(a.scheduled_at);
      if (tab === "today") return k === todayKey;
      if (tab === "tomorrow") return k === tomorrowKey;
      return k >= weekStart && k <= weekEnd; // week
    });
  }, [assignments, tab]);

  async function handleCreate(payload: AssignmentInput) {
    setBusy(true);
    try {
      const res = await createAssignment(payload);
      if (!res.ok) {
        toast.error(t("no_assignments"));
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
        toast.error(t("no_assignments"));
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
      await cancelAssignment(cancelling.id, reason);
      toast.success(t("cancelled_toast"));
      setCancelling(null);
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t("title")}</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> {t("new")}
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="today">{t("today")}</TabsTrigger>
          <TabsTrigger value="tomorrow">{t("tomorrow")}</TabsTrigger>
          <TabsTrigger value="week">{t("this_week")}</TabsTrigger>
          <TabsTrigger value="all">{t("all")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t("no_assignments")}
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => (
            <div
              key={a.id}
              className={cn(
                "rounded-lg border border-l-[3px] bg-card p-4",
                STATUS_STRIPE[a.status]
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{a.worker_name}</span>
                    {a.worker_plate && (
                      <span className="text-sm text-muted-foreground">{a.worker_plate}</span>
                    )}
                    <span className="text-sm font-medium">
                      {formatDateTime(a.scheduled_at, locale)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{t(`category.${a.category}`)}</Badge>
                    <Badge variant={STATUS_BADGE[a.status]}>{t(`status.${a.status}`)}</Badge>
                  </div>
                  <p className="flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="size-3.5 shrink-0" />
                    {routeSummary(a.stops)}
                  </p>
                  <p className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Package className="size-3.5" /> {a.package_count ?? 0}
                    </span>
                    {a.start_km != null && a.end_km != null && (
                      <span className="nums">
                        {(a.end_km - a.start_km).toLocaleString(
                          locale === "de" ? "de-AT" : "tr-TR"
                        )}{" "}
                        km
                      </span>
                    )}
                  </p>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon" className="shrink-0" />}
                  >
                    <MoreVertical className="size-4" />
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
            </div>
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
              {cancelling?.worker_name} · {cancelling && formatDateTime(cancelling.scheduled_at, locale)}
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

      {/* Detail */}
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
            <div className="space-y-3 text-sm">
              <ol className="space-y-1">
                {detail.stops.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground">{s.label}:</span>
                    <span>{s.address}</span>
                  </li>
                ))}
              </ol>
              <p className="text-muted-foreground">
                {t("packages")}: {detail.package_count ?? 0}
                {detail.start_km != null && detail.end_km != null
                  ? ` · ${detail.end_km - detail.start_km} km`
                  : ""}
              </p>
              {detail.notes && <p className="border-l-2 border-border pl-3">{detail.notes}</p>}
              {detail.status === "cancelled" && detail.cancel_reason && (
                <p className="border-l-2 border-destructive/40 pl-3 text-destructive">
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
