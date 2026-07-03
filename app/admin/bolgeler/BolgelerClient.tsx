"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Plus, Hexagon, Pencil, Trash2, Ban, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Geofence, GeofenceRuleKind } from "@/lib/types";
import {
  createGeofence,
  updateGeofence,
  deleteGeofence,
  toggleGeofence,
} from "@/app/actions/geofences";

const GeofencePickerMap = dynamic(
  () => import("@/components/GeofencePickerMap").then((m) => m.GeofencePickerMap),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> }
);

const RULE_KINDS: GeofenceRuleKind[] = ["forbidden", "allowed_only"];

export function BolgelerClient({ zones }: { zones: Geofence[] }) {
  const t = useTranslations("zones");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Geofence | null>(null);
  const [name, setName] = useState("");
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [radius, setRadius] = useState("200");
  const [ruleKind, setRuleKind] = useState<GeofenceRuleKind>("forbidden");
  const [busy, setBusy] = useState(false);

  function openNew() {
    setEditing(null);
    setName("");
    setCenter(null);
    setRadius("200");
    setRuleKind("forbidden");
    setOpen(true);
  }
  function openEdit(z: Geofence) {
    setEditing(z);
    setName(z.name);
    setCenter([z.center_lat, z.center_lng]);
    setRadius(String(Math.round(z.radius_m)));
    setRuleKind(z.rule_kind);
    setOpen(true);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t("err_name"));
      return;
    }
    if (!center) {
      toast.error(t("err_center"));
      return;
    }
    const r = Number(radius);
    if (!Number.isFinite(r) || r < 50) {
      toast.error(t("err_radius"));
      return;
    }
    const fd = new FormData();
    if (editing) fd.set("id", editing.id);
    fd.set("name", name.trim());
    fd.set("center_lat", String(center[0]));
    fd.set("center_lng", String(center[1]));
    fd.set("radius_m", String(Math.round(r)));
    fd.set("rule_kind", ruleKind);

    setBusy(true);
    try {
      const res = editing ? await updateGeofence(fd) : await createGeofence(fd);
      if (!res.ok) {
        toast.error(t("save_error"));
        return;
      }
      toast.success(t("saved"));
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(z: Geofence) {
    if (!confirm(t("confirm_delete", { name: z.name }))) return;
    const res = await deleteGeofence(z.id);
    if (!res.ok) {
      toast.error(t("save_error"));
      return;
    }
    toast.success(t("deleted"));
    router.refresh();
  }

  async function toggle(z: Geofence) {
    const res = await toggleGeofence(z.id, !z.active);
    if (!res.ok) {
      toast.error(t("save_error"));
      return;
    }
    router.refresh();
  }

  function setLat(v: string) {
    const lat = Number(v);
    setCenter((c) => [Number.isFinite(lat) ? lat : 0, c?.[1] ?? 0]);
  }
  function setLng(v: string) {
    const lng = Number(v);
    setCenter((c) => [c?.[0] ?? 0, Number.isFinite(lng) ? lng : 0]);
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-5 px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        <Button size="sm" onClick={openNew}>
          <Plus className="size-4" /> {t("add")}
        </Button>
      </div>

      {zones.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-border px-4 py-12 text-center">
          <Hexagon className="mx-auto size-7 text-text-tertiary" />
          <p className="mt-2 text-sm text-text-tertiary">{t("none")}</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {zones.map((z) => (
            <li
              key={z.id}
              className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border bg-card p-4"
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-[10px]",
                  z.rule_kind === "forbidden"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-accent-sky/15 text-accent-sky"
                )}
              >
                {z.rule_kind === "forbidden" ? (
                  <Ban className="size-[18px]" />
                ) : (
                  <ShieldCheck className="size-[18px]" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{z.name}</span>
                  {!z.active && (
                    <Badge variant="secondary" className="bg-muted text-muted-foreground">
                      {t("passive")}
                    </Badge>
                  )}
                </div>
                <p className="nums mt-0.5 text-xs text-text-tertiary">
                  {t(`rule.${z.rule_kind}`)} · {Math.round(z.radius_m)} m ·{" "}
                  {z.center_lat.toFixed(5)}, {z.center_lng.toFixed(5)}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" onClick={() => toggle(z)}>
                  {z.active ? t("deactivate") : t("activate")}
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={t("edit")} onClick={() => openEdit(z)}>
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("delete")}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => remove(z)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{editing ? t("edit_title") : t("add")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="zone-name">{t("name")}</Label>
              <Input
                id="zone-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("name_placeholder")}
                className="h-11"
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("center")}</Label>
              <p className="text-xs text-text-tertiary">{t("center_hint")}</p>
              <div className="h-[280px] w-full overflow-hidden rounded-[10px] border border-border">
                <GeofencePickerMap
                  key={editing?.id ?? "new"}
                  center={center}
                  radius={Number(radius) || 0}
                  onPick={(lat, lng) => setCenter([lat, lng])}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="zone-lat">{t("lat")}</Label>
                <Input
                  id="zone-lat"
                  inputMode="decimal"
                  value={center ? String(center[0]) : ""}
                  onChange={(e) => setLat(e.target.value)}
                  placeholder="48.20000"
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="zone-lng">{t("lng")}</Label>
                <Input
                  id="zone-lng"
                  inputMode="decimal"
                  value={center ? String(center[1]) : ""}
                  onChange={(e) => setLng(e.target.value)}
                  placeholder="16.37000"
                  className="h-11"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="zone-radius">{t("radius")}</Label>
                <Input
                  id="zone-radius"
                  type="number"
                  min={50}
                  value={radius}
                  onChange={(e) => setRadius(e.target.value)}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("rule_label")}</Label>
                <Select value={ruleKind} onValueChange={(v) => v && setRuleKind(v as GeofenceRuleKind)}>
                  <SelectTrigger className="h-11">
                    <SelectValue>
                      {((v: unknown) => t(`rule.${String(v)}`)) as never}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {RULE_KINDS.map((rk) => (
                      <SelectItem key={rk} value={rk}>
                        {t(`rule.${rk}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button type="submit" className="h-11 w-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
