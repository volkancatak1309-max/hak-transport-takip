"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Truck,
  Search,
  Plus,
  Pencil,
  Trash2,
  MoreHorizontal,
  X,
  ArrowDownAZ,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { FleetDtcRow } from "@/lib/admin-dashboard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HelpTip } from "@/components/help/HelpTip";
import { SavedViews, type SavedView } from "@/components/ui-v2";
import { VehicleFormDialog } from "@/components/admin/VehicleFormDialog";
import { formatDurationShort } from "@/lib/format";
import { STATUS_STYLE, FLEET_STYLE } from "@/lib/vehicle-ui";
import type { VehicleWithStatus, VehicleFleet } from "@/lib/types";
import { cn } from "@/lib/utils";
import { deleteVehicle } from "@/app/actions/vehicles";

/** Filtre bandı seçenekleri — Reveal'ın canlı-harita araç panelindeki tek satır
 *  "Order by …" dropdown deseni (REVEAL-CLONE-SPEC E). */
type LiveFilter = "all" | "sevkiyatta" | "molada" | "bosta" | "bakimda";
type FleetFilter = "all" | VehicleFleet;
type SortKey = "plate" | "driver" | "status";

/** Kayıtlı görünüm anahtarları (Aboard deseni). */
type ViewKey = "all" | "silent" | "faulty" | "no_driver" | "mavi" | "bordo";

/** Sağlıklı cihaz saatlik heartbeat atar; 24 saat sessizlik "sinyalsiz"dir.
 *  Aynı eşik Dikkat panosunda da kullanılıyor (TELEMETRY_SILENT_HOURS). */
const SILENT_MS = 24 * 60 * 60 * 1000;
function isSilent(iso: string | undefined): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() >= SILENT_MS;
}

export function AraclarClient({
  vehicles,
  drivers,
  dtc,
  lastSeen,
}: {
  vehicles: VehicleWithStatus[];
  drivers: { id: string; name: string; is_active: boolean }[];
  /** Aktif arıza kodu olan araçlar. Artık ayrı kart DEĞİL: "Arızalı" kayıtlı
   *  görünümünü ve satır rozetini besler (26.07.2026). */
  dtc: FleetDtcRow[];
  /** Araç id → son telemetri anı (ISO). "Sinyalsiz" görünümü ve kolon için. */
  lastSeen: Record<string, string>;
}) {
  const t = useTranslations("vehicles");
  const tm = useTranslations("vehicles.manage");
  const router = useRouter();
  const [q, setQ] = useState("");
  const [liveFilter, setLiveFilter] = useState<LiveFilter>("all");
  const [fleetFilter, setFleetFilter] = useState<FleetFilter>("all");
  const [sort, setSort] = useState<SortKey>("plate");
  /** Aktif kayıtlı görünüm (Aboard deseni). */
  const [view, setView] = useState<ViewKey>("all");
  const locale = useLocale();

  // "Son sinyal" süreleri için tek zaman damgası: render sırasında Date.now()
  // çağırmak saf-olmayan bir işlem (React Compiler kuralı) ve satırlar arası
  // tutarsızlık üretir. State'e alınır, dakikada bir tazelenir — etiketler
  // sayfa açık kaldıkça kendiliğinden ilerler.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  /** Araç başına aktif arıza sayısı — DTC kartının yerini alan tek kaynak. */
  const dtcByVehicle = useMemo(
    () => new Map(dtc.map((d) => [d.vehicle_id, d.count])),
    [dtc]
  );

  // Create/edit dialog state. Form gövdesi ortak bileşende
  // (components/admin/VehicleFormDialog) — detay sayfasındaki "Düzenle" ile
  // birebir aynı form.
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleWithStatus | null>(null);

  /** Kayıtlı görünüm sayaçları — KPI şeridinin yerini alan sayılar. */
  const views: SavedView[] = useMemo(() => {
    const silent = vehicles.filter((v) => isSilent(lastSeen[v.id])).length;
    const faulty = vehicles.filter((v) => (dtcByVehicle.get(v.id) ?? 0) > 0).length;
    const noDriver = vehicles.filter((v) => !v.driver_name).length;
    return [
      { key: "all", label: t("view_all"), count: vehicles.length },
      { key: "silent", label: t("view_silent"), count: silent, alert: true },
      { key: "faulty", label: t("view_faulty"), count: faulty, alert: true },
      { key: "no_driver", label: t("view_no_driver"), count: noDriver, alert: true },
      { key: "mavi", label: t("fleet.mavi"), count: vehicles.filter((v) => v.fleet === "mavi").length },
      { key: "bordo", label: t("fleet.bordo"), count: vehicles.filter((v) => v.fleet === "bordo").length },
    ];
  }, [vehicles, lastSeen, dtcByVehicle, t]);

  const filtered = useMemo(() => {
    const s = q.trim().toLocaleLowerCase("tr");
    let out = vehicles;
    // KAYITLI GÖRÜNÜM önce uygulanır; çip filtreleri onun üstüne biner.
    if (view === "silent") out = out.filter((v) => isSilent(lastSeen[v.id]));
    else if (view === "faulty") out = out.filter((v) => (dtcByVehicle.get(v.id) ?? 0) > 0);
    else if (view === "no_driver") out = out.filter((v) => !v.driver_name);
    else if (view === "mavi" || view === "bordo") out = out.filter((v) => v.fleet === view);
    if (liveFilter !== "all") out = out.filter((v) => v.live_status === liveFilter);
    if (fleetFilter !== "all") out = out.filter((v) => v.fleet === fleetFilter);
    if (s) {
      out = out.filter(
        (v) =>
          v.plate.toLocaleLowerCase("tr").includes(s) ||
          (v.driver_name ?? "").toLocaleLowerCase("tr").includes(s) ||
          `${v.make ?? ""} ${v.model ?? ""}`.toLocaleLowerCase("tr").includes(s)
      );
    }
    // Sıralama listeyi kopyalayarak yapılır — prop dizisini yerinde bozmaz.
    const coll = new Intl.Collator("tr");
    return [...out].sort((a, b) => {
      if (sort === "driver") {
        // Şoförü olanlar önce; ikisi de boşsa plakaya düşer.
        const an = a.driver_name ?? "";
        const bn = b.driver_name ?? "";
        if (an && !bn) return -1;
        if (!an && bn) return 1;
        const c = coll.compare(an, bn);
        if (c !== 0) return c;
      } else if (sort === "status") {
        const order: Record<string, number> = {
          sevkiyatta: 0,
          molada: 1,
          bosta: 2,
          bakimda: 3,
        };
        const c = (order[a.live_status] ?? 9) - (order[b.live_status] ?? 9);
        if (c !== 0) return c;
      }
      return coll.compare(a.plate, b.plate);
    });
  }, [vehicles, q, liveFilter, fleetFilter, sort, view, lastSeen, dtcByVehicle]);

  function openNew() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(v: VehicleWithStatus) {
    setEditing(v);
    setOpen(true);
  }

  async function remove(v: VehicleWithStatus) {
    if (!confirm(tm("delete_confirm", { plate: v.plate }))) return;
    const res = await deleteVehicle(v.id);
    if (!res.ok) {
      toast.error(tm("save_error"));
      return;
    }
    toast.success(tm("deleted"));
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      {/* Başlık bloğu — REVEAL-CLONE-SPEC A2 ölçüsü (H1 ~28px semibold + açıklama) */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight">{t("title")}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <HelpTip tkey="veh_list" />
      </div>

      {/* KAYITLI GORUNUMLER (Aboard klonu) — KPI seridi (4 kutu) KALDIRILDI:
          Aboard'da KPI yok, sayilar gorunum rozetlerinde yasiyor ve
          tiklanabilir. FleetDtcCard da kaldirildi: ariza artik "Arizali"
          gorunumu + satir rozeti. (26.07.2026, onayli) */}
      <SavedViews views={views} active={view} onChange={(k) => setView(k as ViewKey)} />

      {/* ARAC CUBUGU (Aboard): solda kaldirilabilir filtre CIPLERI + "filtre
          ekle" dropdown'lari, sagda arama ve birincil eylem. Aboard'daki
          "Archive date is not set x" satirinin ayni davranisi. */}
      <div className="flex flex-wrap items-center gap-2">
        {liveFilter !== "all" && (
          <FilterChip
            label={t("filter_status") + ": " + t("status." + liveFilter)}
            onClear={() => setLiveFilter("all")}
          />
        )}
        {fleetFilter !== "all" && (
          <FilterChip
            label={t("filter_fleet") + ": " + t("fleet." + fleetFilter)}
            onClear={() => setFleetFilter("all")}
          />
        )}
        <Select value={liveFilter} onValueChange={(v) => setLiveFilter((v ?? "all") as LiveFilter)}>
          <SelectTrigger
            className="h-9 w-auto gap-1.5 border-dashed px-3 text-[13px]"
            aria-label={t("filter_status")}
          >
            <Plus className="size-3.5" />
            <span>{t("filter_status")}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filter_all")}</SelectItem>
            <SelectItem value="sevkiyatta">{t("status.sevkiyatta")}</SelectItem>
            <SelectItem value="molada">{t("status.molada")}</SelectItem>
            <SelectItem value="bosta">{t("status.bosta")}</SelectItem>
            <SelectItem value="bakimda">{t("status.bakimda")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={fleetFilter} onValueChange={(v) => setFleetFilter((v ?? "all") as FleetFilter)}>
          <SelectTrigger
            className="h-9 w-auto gap-1.5 border-dashed px-3 text-[13px]"
            aria-label={t("filter_fleet")}
          >
            <Plus className="size-3.5" />
            <span>{t("filter_fleet")}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filter_all")}</SelectItem>
            <SelectItem value="bordo">{t("fleet.bordo")}</SelectItem>
            <SelectItem value="mavi">{t("fleet.mavi")}</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("search")}
              className="h-9 w-[190px] pl-9"
              aria-label={t("search")}
            />
          </div>
          <Button onClick={openNew} className="h-9 shrink-0">
            <Plus className="size-4" /> {tm("add")}
          </Button>
        </div>
      </div>

      {/* TABLO (Aboard anatomisi): cok kolonlu, ince yatay ayrac, dikey cizgi
          yok. Ilk hucrede ikon + plaka (Aboard'in avatar + isim hucresi).
          Olcum kolonlari mono ve saga hizali; satir sonunda uc-nokta menu. */}
      <div className="glass-panel overflow-hidden rounded-[16px]">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{t("none")}</div>
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-panel text-left text-[12px] uppercase tracking-[0.04em] text-muted-foreground">
                    {/* Sıralama kolon başlığından (Aboard): ayrı bir "sırala"
                        dropdown'ı yok, başlığa tıklanır. */}
                    <th className="px-4 py-2.5 font-medium">
                      <SortHeader label={t("col_vehicle")} active={sort === "plate"} onClick={() => setSort("plate")} />
                    </th>
                    <th className="px-3 py-2.5 font-medium">
                      <SortHeader label={t("col_driver")} active={sort === "driver"} onClick={() => setSort("driver")} />
                    </th>
                    <th className="px-3 py-2.5 font-medium">
                      <SortHeader label={t("col_status")} active={sort === "status"} onClick={() => setSort("status")} />
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">{t("col_last_seen")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("col_flags")}</th>
                    <th className="px-2 py-2.5" aria-label={tm("actions")} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((v) => {
                    const st = STATUS_STYLE[v.live_status];
                    const dtcCount = dtcByVehicle.get(v.id) ?? 0;
                    const seen = lastSeen[v.id];
                    const silent = isSilent(seen);
                    return (
                      <tr
                        key={v.id}
                        className="border-b border-border/50 transition-colors last:border-0 hover:bg-surface-hover"
                      >
                        <td className="px-4 py-2.5">
                          <Link href={"/admin/araclar/" + v.id} className="flex items-center gap-2.5">
                            <span
                              className={cn(
                                "flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-surface-panel",
                                FLEET_STYLE[v.fleet].text
                              )}
                            >
                              <Truck className="size-4" />
                            </span>
                            <span className="min-w-0">
                              {/* Plaka HICBIR ekranda kirpilmaz. */}
                              <span className="block whitespace-nowrap font-mono text-[13px] font-semibold uppercase tabular-nums">
                                {v.plate}
                              </span>
                              <span className="block text-[12px] text-text-tertiary">
                                {[v.make, v.model].filter(Boolean).join(" ") || "-"}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">
                          {v.live_drivers.length > 1 ? (
                            <span className="flex flex-wrap items-center gap-1.5">
                              {v.live_drivers.join(", ")}
                              <span className="rounded-full bg-accent-gold px-1.5 py-0.5 text-[10px] font-medium text-[#181818]">
                                {t("shared_vehicle", { n: v.live_drivers.length })}
                              </span>
                            </span>
                          ) : v.driver_name ? (
                            <span>
                              {v.driver_name}
                              {!v.driver_is_live && (
                                <span className="ml-1 text-[12px] text-text-tertiary">
                                  {"· " + t("assigned_label")}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-text-tertiary">{t("no_driver")}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                              st.chip
                            )}
                          >
                            {st.live ? (
                              <span className="live-dot" />
                            ) : (
                              <span className={cn("size-1.5 rounded-full", st.dot)} />
                            )}
                            {t("status." + st.labelKey)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {seen ? (
                            <span
                              className={cn(
                                "font-mono text-[12px] tabular-nums",
                                silent
                                  ? "font-semibold text-status-critical-text"
                                  : "text-muted-foreground"
                              )}
                            >
                              {formatDurationShort(nowMs - new Date(seen).getTime(), locale)}
                            </span>
                          ) : (
                            <span className="text-[12px] text-text-tertiary">{t("no_signal")}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                                FLEET_STYLE[v.fleet].chip
                              )}
                            >
                              {t("fleet." + v.fleet)}
                            </span>
                            {dtcCount > 0 && (
                              <span className="rounded-full bg-status-critical-soft px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-status-critical-text">
                                {t("dtc_badge", { n: dtcCount })}
                              </span>
                            )}
                            {/* text-tertiary DEĞİL: #6E6E73 panel grisi üstünde
                                tam 4.50:1 sınırında — ikincil ton güvenli. */}
                            {v.imei && (
                              <span className="rounded bg-surface-panel px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                GPS
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          <RowMenu vehicle={v} onEdit={openEdit} onRemove={remove} label={tm("actions")} editLabel={tm("edit")} deleteLabel={tm("delete")} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobil kart listesi — tablo dar ekranda okunmaz. */}
            <ul className="divide-y divide-border/60 sm:hidden">
              {filtered.map((v) => {
                const st = STATUS_STYLE[v.live_status];
                const dtcCount = dtcByVehicle.get(v.id) ?? 0;
                const seen = lastSeen[v.id];
                return (
                  <li key={v.id} className="flex items-start gap-3 px-4 py-3">
                    <Link href={"/admin/araclar/" + v.id} className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[13px] font-semibold uppercase tabular-nums">
                          {v.plate}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium",
                            FLEET_STYLE[v.fleet].chip
                          )}
                        >
                          {t("fleet." + v.fleet)}
                        </span>
                        {dtcCount > 0 && (
                          <span className="rounded-full bg-status-critical-soft px-2 py-0.5 font-mono text-[10px] font-semibold text-status-critical-text">
                            {t("dtc_badge", { n: dtcCount })}
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-[12px] text-muted-foreground">
                        {v.driver_name ?? t("no_driver")}
                      </span>
                      <span className="mt-1.5 flex items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                            st.chip
                          )}
                        >
                          {st.live ? (
                            <span className="live-dot" />
                          ) : (
                            <span className={cn("size-1.5 rounded-full", st.dot)} />
                          )}
                          {t("status." + st.labelKey)}
                        </span>
                        {seen && (
                          <span className="font-mono text-[11px] tabular-nums text-text-tertiary">
                            {formatDurationShort(nowMs - new Date(seen).getTime(), locale)}
                          </span>
                        )}
                      </span>
                    </Link>
                    <RowMenu vehicle={v} onEdit={openEdit} onRemove={remove} label={tm("actions")} editLabel={tm("edit")} deleteLabel={tm("delete")} />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {/* Create / edit dialog — form gövdesi ortak bileşende. */}
      <VehicleFormDialog
        open={open}
        onOpenChange={setOpen}
        vehicle={editing}
        drivers={drivers}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}

/** Tıklanabilir kolon başlığı — aktif sıralama mercanla işaretlenir. */
function SortHeader({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 uppercase tracking-[0.04em] transition-colors",
        active ? "text-accent-coral-text" : "hover:text-foreground"
      )}
    >
      {label}
      {active && <ArrowDownAZ className="size-3.5" aria-hidden />}
    </button>
  );
}

/**
 * FILTRE CIPI — Aboard'in "Archive date is not set x" satiri. Aktif filtre
 * gorunur durur ve tek tikla kalkar; filtrenin gizli kalmasi en pahali hatadir.
 */
function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-surface-panel px-2.5 py-1.5 text-[13px]">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={label}
        className="rounded-full p-0.5 text-text-tertiary transition-colors hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}

/**
 * SATIR MENUSU — duzenle/sil. Aboard'da satir eylemleri satirin sonunda tek
 * menude toplanir; eskiden masaustunde iki ayri ikon butonu vardi ve tablo
 * kolonu ile yarisiyordu. Mobil/masaustu ayni bilesen.
 */
function RowMenu({
  vehicle,
  onEdit,
  onRemove,
  label,
  editLabel,
  deleteLabel,
}: {
  vehicle: VehicleWithStatus;
  onEdit: (v: VehicleWithStatus) => void;
  onRemove: (v: VehicleWithStatus) => void;
  label: string;
  editLabel: string;
  deleteLabel: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="size-7 shrink-0" aria-label={label} />
        }
      >
        <MoreHorizontal className="size-4 text-text-tertiary" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onEdit(vehicle)}>
          <Pencil className="size-4" /> {editLabel}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onRemove(vehicle)}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="size-4" /> {deleteLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
