"use client";

import { useMemo, useState } from "react";
import { EXPORT_ENABLED } from "@/lib/tenant";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X, Loader2, FileSpreadsheet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RevealFilterRow, StatCard } from "@/components/ui-v2";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReceiptThumb } from "@/components/ReceiptThumb";
import { formatDate, viennaDayKey } from "@/lib/format";
import { APPROVAL_BADGE } from "@/lib/status-ui";
import type { ExpenseEntryWithWorker, ApprovalStatus } from "@/lib/types";
import {
  approveExpenseEntry,
  rejectExpenseEntry,
  generatePayrollExpenseCSV,
} from "@/app/actions/expenses";
import { CATEGORY_ICON } from "@/app/panel/masraflar/ExpenseDriverClient";
import { HelpTip } from "@/components/help/HelpTip";

type Props = { entries: ExpenseEntryWithWorker[] };
const eur = (n: number) => n.toFixed(2).replace(".", ",");

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExpenseAdminClient({ entries }: Props) {
  const t = useTranslations("expense");
  const ta = useTranslations("approval");
  const locale = useLocale();
  const router = useRouter();

  const [tab, setTab] = useState<ApprovalStatus>("pending");
  const [rejecting, setRejecting] = useState<ExpenseEntryWithWorker | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const monthOptions = useMemo(() => {
    const tag = locale === "de" ? "de-AT" : "tr-TR";
    const out: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({
        value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: new Intl.DateTimeFormat(tag, { month: "long", year: "numeric" }).format(d),
      });
    }
    return out;
  }, [locale]);

  const [csvOpen, setCsvOpen] = useState(false);
  const [csvMonth, setCsvMonth] = useState(monthOptions[0]?.value ?? "");
  const [csvBusy, setCsvBusy] = useState(false);

  const month = viennaDayKey(new Date()).slice(0, 7);
  const stats = useMemo(() => {
    const monthApproved = entries.filter(
      (e) => e.status === "approved" && viennaDayKey(e.spent_at).slice(0, 7) === month
    );
    const approvedTotal = monthApproved.reduce((s, e) => s + Number(e.amount), 0);
    const pendingList = entries.filter((e) => e.status === "pending");
    const pendingTotal = pendingList.reduce((s, e) => s + Number(e.amount), 0);
    const byWorker = new Map<string, number>();
    for (const e of monthApproved)
      byWorker.set(e.worker_name, (byWorker.get(e.worker_name) ?? 0) + Number(e.amount));
    let top = "—";
    let topVal = 0;
    for (const [n, v] of byWorker) if (v > topVal) { topVal = v; top = n; }
    return { approvedTotal, pendingCount: pendingList.length, pendingTotal, top };
  }, [entries, month]);

  const filtered = entries.filter((e) => e.status === tab);

  async function approve(id: string) {
    setBusy(true);
    try {
      const res = await approveExpenseEntry(id);
      if (res.ok) toast.success(t("approved"));
      else toast.error(t("save_error"));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function doReject() {
    if (!rejecting) return;
    setBusy(true);
    try {
      const res = await rejectExpenseEntry(rejecting.id, reason);
      if (res.ok) toast.success(t("rejected"));
      else toast.error(t("save_error"));
      setRejecting(null);
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function makeCsv() {
    setCsvBusy(true);
    try {
      const res = await generatePayrollExpenseCSV(csvMonth);
      if (!res.ok) {
        toast.error(t("no_entries"));
        return;
      }
      downloadCsv(res.csv, res.filename);
      setCsvOpen(false);
    } finally {
      setCsvBusy(false);
    }
  }

  return (
    <>
      {/* Başlık bloğu — klon A2 ölçüsü */}
      <div>
        <h1 className="flex items-center gap-1 text-[28px] font-semibold leading-tight">
          {t("admin_title")}
          <HelpTip tkey="page_expenses" />
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* KPI şeridi — tek kaynak StatCard (kapsam etiketi zorunlu) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label={t("stat_approved_month")}
          value={`${eur(stats.approvedTotal)} €`}
          scope={t("stat_month")}
        />
        <StatCard
          label={t("stat_pending")}
          value={stats.pendingCount}
          scope={t("stat_all")}
          tone={stats.pendingCount > 0 ? "warning" : "neutral"}
          delta={`${eur(stats.pendingTotal)} €`}
        />
        <StatCard label={t("stat_top")} value={stats.top} scope={t("stat_month")} />
      </div>

      {/* Filtre bandı — A3 dili; sekme şeridi "Durum" dropdown'ına taşındı */}
      <RevealFilterRow
        filters={[
          {
            label: t("filter_status"),
            value: tab,
            onChange: (v) => setTab(v as ApprovalStatus),
            options: [
              { value: "pending", label: ta("pending") },
              { value: "approved", label: ta("approved") },
              { value: "rejected", label: ta("rejected") },
            ],
          },
        ]}
        right={
          <Button variant="outline" className="h-9" onClick={() => setCsvOpen(true)} hidden={!EXPORT_ENABLED} disabled={!EXPORT_ENABLED}>
            <FileSpreadsheet className="size-4" /> {t("payroll_export")}
          </Button>
        }
      />

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("date")}</TableHead>
                <TableHead>{t("driver")}</TableHead>
                <TableHead>{t("category.label")}</TableHead>
                <TableHead>{t("description")}</TableHead>
                <TableHead className="text-right">{t("amount")}</TableHead>
                <TableHead>{t("receipt")}</TableHead>
                {tab === "pending" && <TableHead className="text-right">{t("action")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={tab === "pending" ? 7 : 6} className="py-6 text-center text-sm text-muted-foreground">
                    {t("no_entries")}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{formatDate(e.spent_at, locale)}</TableCell>
                    <TableCell>{e.worker_name}</TableCell>
                    <TableCell>
                      {CATEGORY_ICON[e.category]} {t(`category.${e.category}`)}
                    </TableCell>
                    {/* Açıklama mobilde SARAR, masaüstünde 200px'te kırpılır.
                        Kırpılan metnin tek kurtarma yolu `title` tooltip'iydi;
                        dokunmatikte hover olmadığı için masrafı onaylayan
                        yönetici neyi onayladığını okuyamıyordu. `sm:` öneki →
                        masaüstü davranışı birebir aynı. */}
                    <TableCell
                      className="whitespace-normal break-words sm:max-w-[200px] sm:truncate"
                      title={e.description ?? ""}
                    >
                      {e.description ?? "—"}
                    </TableCell>
                    <TableCell className="text-right nums">{eur(Number(e.amount))} €</TableCell>
                    <TableCell>
                      <ReceiptThumb
                        url={e.receipt_url}
                        title={`${CATEGORY_ICON[e.category]} ${t(`category.${e.category}`)}`}
                        emptyLabel={t("no_receipt")}
                        info={
                          <>
                            <p>{e.worker_name} · {formatDate(e.spent_at, locale)}</p>
                            <p className="nums">{eur(Number(e.amount))} €</p>
                            {e.description && <p className="text-muted-foreground">{e.description}</p>}
                          </>
                        }
                      />
                    </TableCell>
                    {tab === "pending" && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" disabled={busy} onClick={() => approve(e.id)} aria-label="approve">
                            <Check className="size-4 text-accent-sky-text" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => { setReason(""); setRejecting(e); }}
                            aria-label="reject"
                          >
                            <X className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("reject")}</DialogTitle>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reject_reason")} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={doReject} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t("reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={csvOpen} onOpenChange={setCsvOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("payroll_export")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{t("select_month")}</Label>
            <Select value={csvMonth} onValueChange={(v) => v && setCsvMonth(v)}>
              <SelectTrigger className="h-11">
                <SelectValue>
                  {((v: unknown) =>
                    monthOptions.find((m) => m.value === String(v))?.label ?? String(v)) as never}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCsvOpen(false)}>{t("cancel")}</Button>
            <Button onClick={makeCsv} disabled={csvBusy}>
              {csvBusy && <Loader2 className="size-4 animate-spin" />}
              {t("payroll_export")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
