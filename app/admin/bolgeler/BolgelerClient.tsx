"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Loader2, Plus, Hexagon, Pencil, Trash2, Ban, ShieldCheck, MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RevealFilterRow,
  PageHeader,
  EmptyState,
  StatusChip,
} from "@/components/ui-v2";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { Geofence, GeofenceRuleKind, GeofencePurpose } from "@/lib/types";
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
const PURPOSES: GeofencePurpose[] = ["rule", "depot", "customer"];
/** Bölge içinde sayılmak için varsayılan bekleme (064). */
const VARSAYILAN_ESIK_SN = 120;

/** Filtre bandı seçenekleri (REVEAL-CLONE-SPEC H). */
type RuleFilter = "all" | GeofenceRuleKind;
type StateFilter = "all" | "active" | "passive";

export function BolgelerClient({ zones }: { zones: Geofence[] }) {
  const t = useTranslations("zones");
  const tc = useTranslations("common");
  const router = useRouter();

  const [ruleFilter, setRuleFilter] = useState<RuleFilter>("all");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const visibleZones = useMemo(
    () =>
      zones.filter(
        (z) =>
          (ruleFilter === "all" || z.rule_kind === ruleFilter) &&
          (stateFilter === "all" || (stateFilter === "active" ? z.active : !z.active))
      ),
    [zones, ruleFilter, stateFilter]
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Geofence | null>(null);
  const [name, setName] = useState("");
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [radius, setRadius] = useState("200");
  const [ruleKind, setRuleKind] = useState<GeofenceRuleKind>("forbidden");
  const [purpose, setPurpose] = useState<GeofencePurpose>("rule");
  // Müşteri bölgesi alanları (064) — yalnız purpose='customer' iken görünür.
  const [customerName, setCustomerName] = useState("");
  const [minDwell, setMinDwell] = useState(String(VARSAYILAN_ESIK_SN));
  const [busy, setBusy] = useState(false);

  function openNew() {
    setEditing(null);
    setName("");
    setCenter(null);
    setRadius("200");
    setRuleKind("forbidden");
    setPurpose("rule");
    setCustomerName("");
    setMinDwell(String(VARSAYILAN_ESIK_SN));
    setOpen(true);
  }
  function openEdit(z: Geofence) {
    setEditing(z);
    setName(z.name);
    setCenter([z.center_lat, z.center_lng]);
    setRadius(String(Math.round(z.radius_m)));
    setRuleKind(z.rule_kind);
    setPurpose(z.purpose ?? "rule");
    setCustomerName(z.customer_name ?? "");
    setMinDwell(String(z.min_dwell_s ?? VARSAYILAN_ESIK_SN));
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
    fd.set("purpose", purpose);
    fd.set("customer_name", customerName.trim());
    fd.set("min_dwell_s", minDwell);

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
    <div className="mx-auto max-w-[900px] space-y-6 px-4 py-6 sm:px-6">
      {/* Başlık — h1 DashboardShell topbar'ında; burada h2 (çift h1 olmaz).
          Birincil eylem başlığa taşındı: ekran başına tek birincil eylem. */}
      <PageHeader
        title={t("title")}
        description={t("intro")}
        help="page_zones"
        action={
          <Button className="btn-primary h-9 rounded-full px-4" onClick={openNew}>
            <Plus className="size-4" /> {t("add")}
          </Button>
        }
      />

      {/* Filtre bandı — Kural + Durum. Eylem yuvası boş: ekleme başlıkta. */}
      <RevealFilterRow
        filters={[
          {
            label: t("filter_rule"),
            value: ruleFilter,
            onChange: (v) => setRuleFilter(v as RuleFilter),
            options: [
              { value: "all", label: t("filter_all") },
              { value: "forbidden", label: t("rule.forbidden") },
              { value: "allowed_only", label: t("rule.allowed_only") },
            ],
            widthClass: "w-[240px]",
          },
          {
            label: t("filter_state"),
            value: stateFilter,
            onChange: (v) => setStateFilter(v as StateFilter),
            options: [
              { value: "all", label: t("filter_all") },
              { value: "active", label: t("filter_active") },
              { value: "passive", label: t("passive") },
            ],
          },
        ]}
      />

      {visibleZones.length === 0 ? (
        // Hiç bölge yok ≠ filtre eşleşmedi — ikisini karıştırmıyoruz.
        <EmptyState
          kind={zones.length === 0 ? "none" : "filtered"}
          icon={zones.length === 0 ? Hexagon : undefined}
          title={zones.length === 0 ? t("none") : t("no_match")}
        />
      ) : (
        <ul className="glass-panel rounded-[16px] p-3">
          {visibleZones.map((z) => (
            <li
              key={z.id}
              className="flex flex-wrap items-center gap-3 rounded-[10px] px-3 py-3 transition-colors hover:bg-surface-panel"
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-[10px]",
                  z.rule_kind === "forbidden"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-accent-sky/15 text-accent-sky-text"
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
                  {/* TRUNCATE YOK (mobilde ölçüldü): "Depo — Bordo filo
                      (güney)" gibi adlar 390px'te üç noktaya düşüyordu ve iki
                      depo birbirinden ayırt edilemiyordu. Bölge adı kimliktir,
                      sığmıyorsa satır atlar. */}
                  <span className="min-w-0 break-words text-sm font-medium">{z.name}</span>
                  {!z.active && <StatusChip tone="neutral">{t("passive")}</StatusChip>}
                </div>
                {/* HAM KOORDİNAT MOBİLDE GİZLİ (19.08.2026, referans: Apple
                    Maps "Saved Places" / Careem "Saved addresses").
                    Ölçüldü, 393 px: "Sadece burada (çıkılmamalı) · 500 m ·
                    47.45576, 9.74036" satırın yarısını yiyordu ve koordinatı
                    kimse listede okumuyor — insan konumu HARİTADA görür.
                    Masaüstünde KALIYOR: orada yer bol ve yönetici bazen
                    koordinatı kopyalıyor. */}
                <p className="nums mt-0.5 text-xs text-text-tertiary">
                  {t(`rule.${z.rule_kind}`)} · {Math.round(z.radius_m)} m
                  <span className="hidden md:inline">
                    {" · "}
                    {z.center_lat.toFixed(5)}, {z.center_lng.toFixed(5)}
                  </span>
                </p>
              </div>
              {/* EYLEMLER — mobilde tek "···" menüsü, masaüstünde AYNEN eskisi.
                  Ölçüldü, 393 px: üç düğme de 28 px yüksekliğindeydi (Apple
                  asgarisi 44) ve bunlardan biri SİL — geri dönüşü olmayan bir
                  eylem, yanlış dokunmaya en açık boyutta. Üstelik satıra
                  sığmayıp alta sarıyor, satırı 126 px'e çıkarıyorlardı.
                  `md:contents` sarmalayıcıyı masaüstünde düzenden ŞEFFAF
                  kılar → orada üç düğme yine li'nin doğrudan flex öğesi. */}
              <div className="md:contents">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        className="size-11 shrink-0 p-0 md:hidden"
                        aria-label={tc("actions")}
                      />
                    }
                  >
                    <MoreHorizontal className="size-5 text-text-tertiary" />
                  </DropdownMenuTrigger>
                  {/* Menü ögeleri 44 px: ölçümde 28 px çıktılar. Tetiği 44'e
                      büyütüp menüyü 28'de bırakmak işi YARIM yapardı — asıl
                      dokunulan yer burası ve "Sil" bu listenin içinde.
                      Menü zaten yalnız mobilde açılıyor (tetik md:hidden),
                      dolayısıyla masaüstü yoğunluğu etkilenmiyor. */}
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem className="min-h-11" onClick={() => toggle(z)}>
                      {z.active ? t("deactivate") : t("activate")}
                    </DropdownMenuItem>
                    <DropdownMenuItem className="min-h-11" onClick={() => openEdit(z)}>
                      <Pencil className="size-4" /> {t("edit")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="min-h-11 text-destructive"
                      onClick={() => remove(z)}
                    >
                      <Trash2 className="size-4" /> {t("delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <div className="hidden items-center gap-1.5 md:flex">
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
                className="btn-outline-ring h-11 rounded-[10px] border-0 bg-transparent"
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("center")}</Label>
              <p className="text-xs text-text-tertiary">{t("center_hint")}</p>
              <div className="h-[280px] w-full overflow-hidden rounded-[12px] border border-border">
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
                  className="btn-outline-ring h-11 rounded-[10px] border-0 bg-transparent"
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
                  className="btn-outline-ring h-11 rounded-[10px] border-0 bg-transparent"
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
                  className="btn-outline-ring h-11 rounded-[10px] border-0 bg-transparent"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("rule_label")}</Label>
                <Select value={ruleKind} onValueChange={(v) => v && setRuleKind(v as GeofenceRuleKind)}>
                  <SelectTrigger className="btn-outline-ring h-11 rounded-[10px] border-0 bg-transparent">
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
              <div className="space-y-1.5">
                <Label>{t("purpose_label")}</Label>
                <Select value={purpose} onValueChange={(v) => v && setPurpose(v as GeofencePurpose)}>
                  <SelectTrigger className="btn-outline-ring h-11 rounded-[10px] border-0 bg-transparent">
                    <SelectValue>
                      {((v: unknown) => t(`purpose.${String(v)}`)) as never}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PURPOSES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {t(`purpose.${p}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-text-tertiary">{t(`purpose_hint.${purpose}`)}</p>
              </div>
            </div>

            {/* MÜŞTERİ BÖLGESİ ALANLARI — yalnız amaç 'customer' iken.
                Her zaman göstermek, kural bölgesi tanımlayan yöneticiye
                anlamsız iki alan sorardı; gizlemek yerine KOŞULLU açmak
                formu kısa tutuyor. Alanlar boşken bile kayıt geçerli:
                müşteri adı boşsa raporda bölge adı kullanılır. */}
            {purpose === "customer" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="gf-customer">{t("customer_name_label")}</Label>
                  <Input
                    id="gf-customer"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder={t("customer_name_ph")}
                    maxLength={80}
                    className="btn-outline-ring h-11 rounded-[10px] border-0 bg-transparent"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gf-dwell">{t("min_dwell_label")}</Label>
                  <Input
                    id="gf-dwell"
                    type="number"
                    inputMode="numeric"
                    min={30}
                    max={14400}
                    step={30}
                    value={minDwell}
                    onChange={(e) => setMinDwell(e.target.value)}
                    className="nums btn-outline-ring h-11 rounded-[10px] border-0 bg-transparent"
                  />
                  <p className="text-xs text-text-tertiary">{t("min_dwell_hint")}</p>
                </div>
              </div>
            )}

            <Button type="submit" className="btn-primary h-11 w-full rounded-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
