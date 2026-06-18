"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X, Loader2, Fuel, Clock, Truck, TrendingUp, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Label } from "@/components/ui/label";
import { ReceiptThumb } from "@/components/ReceiptThumb";
import { formatDate, viennaDayKey } from "@/lib/format";
import { APPROVAL_BADGE } from "@/lib/status-ui";
import type { FuelEntryWithWorker, ApprovalStatus } from "@/lib/types";
import {
  approveFuelEntry,
  rejectFuelEntry,
  generateCO2Report,
} from "@/app/actions/fuel";
import { downloadCO2Report } from "@/components/pdf/CO2Report";

type Props = { entries: FuelEntryWithWorker[] };

const eur = (n: number) => n.toFixed(2).replace(".", ",");

export function FuelAdminClient({ entries }: Props) {
  const t = useTranslations("fuel");
  const ta = useTranslations("approval");
  const tco2 = useTranslations("co2");
  const locale = useLocale();
  const router = useRouter();

  const [tab, setTab] = useState<ApprovalStatus>("pending");
  const [rejecting, setRejecting] = useState<FuelEntryWithWorker | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const monthOptions = useMemo(() => {
    const tag = locale === "de" ? "de-AT" : "tr-TR";
    const out: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      out.push({
        value,
        label: new Intl.DateTimeFormat(tag, { month: "long", year: "numeric" }).format(d),
      });
    }
    return out;
  }, [locale]);

  const [co2Open, setCo2Open] = useState(false);
  const [co2Month, setCo2Month] = useState(monthOptions[0]?.value ?? "");
  const [co2Busy, setCo2Busy] = useState(false);

  async function makeCo2() {
    setCo2Busy(true);
    try {
      const res = await generateCO2Report(co2Month);
      if (!res.ok) {
        toast.error(t("save_error"));
        return;
      }
      await downloadCO2Report(res.data, tco2("report_title"));
      setCo2Open(false);
    } catch {
      toast.error(t("save_error"));
    } finally {
      setCo2Busy(false);
    }
  }

  const month = viennaDayKey(new Date()).slice(0, 7);
  const stats = useMemo(() => {
    const monthApproved = entries.filter(
      (e) => e.status === "approved" && viennaDayKey(e.fueled_at).slice(0, 7) === month
    );
    const totalCost = monthApproved.reduce((s, e) => s + Number(e.total_cost), 0);
    const totalLiters = monthApproved.reduce((s, e) => s + Number(e.liters), 0);
    const cons = monthApproved.map((e) => e.consumption).filter((c): c is number => c != null);
    const avgCons = cons.length ? cons.reduce((s, c) => s + c, 0) / cons.length : 0;
    const pending = entries.filter((e) => e.status === "pending").length;
    const vehicles = new Set(entries.map((e) => e.vehicle_plate)).size;

    const litersByPlate = new Map<string, number>();
    for (const e of monthApproved)
      litersByPlate.set(e.vehicle_plate, (litersByPlate.get(e.vehicle_plate) ?? 0) + Number(e.liters));
    let topVehicle = "—";
    let topLiters = 0;
    for (const [p, l] of litersByPlate) if (l > topLiters) { topLiters = l; topVehicle = p; }

    return { totalCost, totalLiters, avgCons, pending, vehicles, topVehicle };
  }, [entries, month]);

  // Per-vehicle consumption summary (all approved).
  const byVehicle = useMemo(() => {
    const map = new Map<string, { liters: number; count: number; cons: number[] }>();
    for (const e of entries) {
      if (e.status !== "approved") continue;
      const v = map.get(e.vehicle_plate) ?? { liters: 0, count: 0, cons: [] };
      v.liters += Number(e.liters);
      v.count += 1;
      if (e.consumption != null) v.cons.push(e.consumption);
      map.set(e.vehicle_plate, v);
    }
    return [...map.entries()]
      .map(([plate, v]) => ({
        plate,
        liters: v.liters,
        count: v.count,
        avg: v.cons.length ? v.cons.reduce((s, c) => s + c, 0) / v.cons.length : null,
      }))
      .sort((a, b) => b.liters - a.liters);
  }, [entries]);

  const filtered = entries.filter((e) => e.status === tab);

  async function approve(id: string) {
    setBusy(true);
    try {
      const res = await approveFuelEntry(id);
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
      const res = await rejectFuelEntry(rejecting.id, reason);
      if (res.ok) toast.success(t("rejected"));
      else toast.error(t("save_error"));
      setRejecting(null);
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t("admin_title")}</h1>
        <Button variant="outline" onClick={() => setCo2Open(true)}>
          <BarChart3 className="size-4" /> {tco2("button")}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <Fuel className="size-4 text-muted-foreground" />
            <p className="mt-1 text-lg font-bold nums">{eur(stats.totalCost)} €</p>
            <p className="text-xs text-muted-foreground nums">
              {eur(stats.totalLiters)} L · {eur(stats.avgCons)} L/100
            </p>
            <p className="text-xs text-muted-foreground">{t("stat_month")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <Clock className="size-4 text-muted-foreground" />
            <p className="mt-1 text-lg font-bold nums">{stats.pending}</p>
            <p className="text-xs text-muted-foreground">{t("stat_pending")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <Truck className="size-4 text-muted-foreground" />
            <p className="mt-1 text-lg font-bold nums">{stats.vehicles}</p>
            <p className="text-xs text-muted-foreground">{t("stat_vehicles")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <TrendingUp className="size-4 text-muted-foreground" />
            <p className="mt-1 text-lg font-bold nums">{stats.topVehicle}</p>
            <p className="text-xs text-muted-foreground">{t("stat_top")}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as ApprovalStatus)}>
        <TabsList>
          <TabsTrigger value="pending">{ta("pending")}</TabsTrigger>
          <TabsTrigger value="approved">{ta("approved")}</TabsTrigger>
          <TabsTrigger value="rejected">{ta("rejected")}</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("date")}</TableHead>
                <TableHead>{t("driver")}</TableHead>
                <TableHead>{t("plate")}</TableHead>
                <TableHead className="text-right">{t("liters")}</TableHead>
                <TableHead className="text-right">{t("total_cost")}</TableHead>
                <TableHead className="text-right">€/L</TableHead>
                <TableHead className="text-right">L/100</TableHead>
                <TableHead>{t("receipt")}</TableHead>
                {tab === "pending" && <TableHead className="text-right">{t("action")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={tab === "pending" ? 9 : 8} className="py-6 text-center text-sm text-muted-foreground">
                    {t("no_entries")}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{formatDate(e.fueled_at, locale)}</TableCell>
                    <TableCell>{e.worker_name}</TableCell>
                    <TableCell className="nums">{e.vehicle_plate}</TableCell>
                    <TableCell className="text-right nums">{eur(Number(e.liters))}</TableCell>
                    <TableCell className="text-right nums">{eur(Number(e.total_cost))} €</TableCell>
                    <TableCell className="text-right nums">{Number(e.cost_per_liter).toFixed(3).replace(".", ",")}</TableCell>
                    <TableCell className="text-right nums">
                      {e.consumption != null ? eur(e.consumption) : "—"}
                    </TableCell>
                    <TableCell>
                      <ReceiptThumb
                        url={e.receipt_url}
                        title={`${formatDate(e.fueled_at, locale)} · ${e.vehicle_plate}`}
                        emptyLabel={t("no_receipt")}
                        info={
                          <>
                            <p>{e.worker_name} · {e.vehicle_plate}</p>
                            <p className="nums">
                              {eur(Number(e.liters))} L · {eur(Number(e.total_cost))} € ·{" "}
                              {Number(e.cost_per_liter).toFixed(3).replace(".", ",")} €/L
                            </p>
                          </>
                        }
                      />
                    </TableCell>
                    {tab === "pending" && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" disabled={busy} onClick={() => approve(e.id)} aria-label="approve">
                            <Check className="size-4 text-accent-sky" />
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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t("consumption_title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("plate")}</TableHead>
                <TableHead className="text-right">{t("entries_count")}</TableHead>
                <TableHead className="text-right">{t("liters")}</TableHead>
                <TableHead className="text-right">{t("avg_consumption")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byVehicle.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                    {t("no_entries")}
                  </TableCell>
                </TableRow>
              ) : (
                byVehicle.map((v) => (
                  <TableRow key={v.plate}>
                    <TableCell className="nums">{v.plate}</TableCell>
                    <TableCell className="text-right nums">{v.count}</TableCell>
                    <TableCell className="text-right nums">{eur(v.liters)}</TableCell>
                    <TableCell className="text-right nums">{v.avg != null ? `${eur(v.avg)} L/100` : "—"}</TableCell>
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

      <Dialog open={co2Open} onOpenChange={setCo2Open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tco2("report_title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{tco2("select_month")}</Label>
            <Select value={co2Month} onValueChange={(v) => v && setCo2Month(v)}>
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCo2Open(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={makeCo2} disabled={co2Busy}>
              {co2Busy && <Loader2 className="size-4 animate-spin" />}
              {tco2("generate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
