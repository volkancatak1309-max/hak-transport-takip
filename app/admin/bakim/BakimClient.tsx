"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Plus, SatelliteDish } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, StatusChip, EmptyState } from "@/components/ui-v2";
import { CrudSatirEylemleri } from "@/components/admin/CrudSatirEylemleri";
import {
  bakimPlaniKaydet,
  bakimPlaniSil,
  bakimYapildiIsaretle,
  bakimIsEmrineCevir,
} from "@/app/actions/bakim";
import type { BakimPlani, BakimDurumu } from "@/lib/bakim-db";

/**
 * PERİYODİK BAKIM — yönetici ekranı (migration 081).
 *
 * ═══ İKİ BLOK, İKİ SORU ═══
 *
 * ÜSTTE "şimdi ne yapmalıyım" (eşiğe giren araçlar), ALTTA "kural nedir"
 * (planlar). Tek listede birleştirseydik, 30 araçlık bir filoda tek bir
 * "8.000 km'de yağ" planı 30 satır üretir ve kuralın kendisi kaybolurdu.
 *
 * ═══ "KM ÖLÇÜLEMİYOR" GÖRÜNÜR ═══
 *
 * Odometresi 72 saatten bayat araçta km ekseni hesaplanmaz ve satır bunu
 * AÇIKÇA söyler. Sessizce "sorun yok" demek, cihazı susmuş aracı bakımsız
 * bırakmanın en kolay yoluydu (lib/km-quality.ts dersi).
 *
 * ═══ EKLE VARSA DÜZENLE VE SİL DE VAR ═══
 *
 * Kural yanlış girildiyse (15.000 yerine 1.500) düzeltilebilmeli. Silme geçmiş
 * servis kayıtlarını DÜŞÜRMEZ (FK `set null`); kural artık geçerli değilse
 * pasifleştirme daha doğru yoldur — plan listede kalır, eşik üretmez.
 */
export function BakimClient({
  planlar,
  durumlar,
  araclar,
  tabloYok,
}: {
  planlar: BakimPlani[];
  durumlar: BakimDurumu[];
  araclar: { id: string; plate: string }[];
  tabloYok: boolean;
}) {
  const t = useTranslations("maintenance");
  const tc = useTranslations("crud");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [acikForm, setAcikForm] = useState(false);
  const [duzenlenen, setDuzenlenen] = useState<BakimPlani | null>(null);

  function formuAc(p: BakimPlani | null) {
    setDuzenlenen(p);
    setAcikForm(true);
  }

  const acil = durumlar.filter((d) => d.gecti);
  const yaklasan = durumlar.filter((d) => !d.gecti && d.uyarida);
  const olculemeyen = durumlar.filter((d) => d.kmOlculemiyor);

  async function planKaydet(fd: FormData) {
    const sayi = (k: string) => {
      const v = String(fd.get(k) ?? "").trim();
      return v === "" ? null : Number(v);
    };
    const r = await bakimPlaniKaydet({
      id: duzenlenen?.id,
      vehicleId: (fd.get("vehicleId") as string) || null,
      tip: String(fd.get("tip") ?? ""),
      aralikKm: sayi("aralikKm"),
      aralikAy: sayi("aralikAy"),
      sonBakimKm: sayi("sonBakimKm"),
      sonBakimAt: (fd.get("sonBakimAt") as string) || null,
      uyariKm: sayi("uyariKm") ?? 500,
      uyariGun: sayi("uyariGun") ?? 14,
      // Pasiflik bu formdan yönetilmiyor; düzenleme onu KORUR.
      aktif: duzenlenen ? duzenlenen.aktif : true,
    });
    if (!r.ok) {
      toast.error(
        r.hata === "esik_yok"
          ? t("err_no_threshold")
          : r.hata === "cakisma"
            ? t("err_duplicate")
            : r.hata === "filo_geneli_yetki"
              ? t("err_fleet_wide")
              : r.hata === "tablo_yok"
                ? t("migration_needed")
                : t("save_error")
      );
      return;
    }
    toast.success(t("plan_saved"));
    setAcikForm(false);
    setDuzenlenen(null);
    router.refresh();
  }

  async function planSil(p: BakimPlani) {
    const r = await bakimPlaniSil(p.id);
    if (r.ok) {
      toast.success(tc("deleted"));
      router.refresh();
      return;
    }
    toast.error(
      r.hata === "kullanimda"
        ? tc("in_use_deactivate")
        : r.hata === "filo_geneli_yetki"
          ? t("err_fleet_wide")
          : t("save_error")
    );
  }

  async function planPasifDegistir(p: BakimPlani) {
    const r = await bakimPlaniKaydet({
      id: p.id,
      vehicleId: p.vehicleId,
      tip: p.tip,
      aralikKm: p.aralikKm,
      aralikAy: p.aralikAy,
      sonBakimKm: p.sonBakimKm,
      sonBakimAt: p.sonBakimAt,
      uyariKm: p.uyariKm,
      uyariGun: p.uyariGun,
      aktif: !p.aktif,
    });
    if (!r.ok) {
      toast.error(r.hata === "filo_geneli_yetki" ? t("err_fleet_wide") : t("save_error"));
      return;
    }
    toast.success(p.aktif ? tc("deactivated") : tc("activated"));
    router.refresh();
  }

  async function yapildi(d: BakimDurumu) {
    // Odometre BU ÇAĞRIDA GEÇMİYOR: sunucu taze telemetriden kendisi okur
    // (bkz. app/actions/bakim.ts). İstemcinin gönderdiği bir km, sayacı
    // sessizce kaydırabilirdi.
    const r = await bakimYapildiIsaretle({ planId: d.planId, vehicleId: d.vehicleId });
    if (!r.ok) {
      toast.error(t("save_error"));
      return;
    }
    toast.success(t("done_saved"));
    router.refresh();
  }

  async function emreCevir(d: BakimDurumu) {
    const r = await bakimIsEmrineCevir(d.planId, d.vehicleId);
    if (!r.ok) {
      toast.error(t("save_error"));
      return;
    }
    toast.success(r.zatenVar ? t("order_exists") : t("order_created"));
    router.refresh();
  }

  if (tabloYok) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} description={t("desc")} />
        <p className="rounded-lg border border-accent-gold/50 bg-accent-gold-soft px-3 py-2 text-xs font-medium text-accent-gold-text">
          {t("migration_needed")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("desc")} />

      {/* ── ŞİMDİ NE YAPMALIYIM ─────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold">{t("due_title")}</h2>
        {acil.length === 0 && yaklasan.length === 0 ? (
          <EmptyState kind="none" title={t("due_empty")} hint={t("due_empty_hint")} />
        ) : (
          <ul className="divide-y divide-border/60 rounded-[14px] border border-border/60">
            {[...acil, ...yaklasan].map((d) => (
              <li
                key={`${d.planId}-${d.vehicleId}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="nums font-semibold">{d.plaka}</span>
                    {/* Bakım tipi KİRACININ verisi — çevrilmez. */}
                    <span className="text-foreground">{d.tip}</span>
                    <StatusChip tone={d.gecti ? "critical" : "warning"}>
                      {d.gecti ? t("state_overdue") : t("state_soon")}
                    </StatusChip>
                  </p>
                  <p className="nums text-[11px] text-text-tertiary">
                    {d.eksen === "km" && d.kalanKm !== null
                      ? d.gecti
                        ? t("over_km", { km: Math.abs(d.kalanKm) })
                        : t("left_km", { km: d.kalanKm })
                      : d.kalanGun !== null
                        ? d.gecti
                          ? t("over_days", { days: Math.abs(d.kalanGun) })
                          : t("left_days", { days: d.kalanGun })
                        : ""}
                    {d.kmOlculemiyor && ` · ${t("km_unmeasured")}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => startTransition(async () => { await emreCevir(d); })}
                  >
                    {t("to_order")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => startTransition(async () => { await yapildi(d); })}
                  >
                    <CheckCircle2 className="size-4" />
                    {t("mark_done")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* ÖLÇÜLEMEYEN ODOMETRE — sessiz geçmez. */}
        {olculemeyen.length > 0 && (
          <p className="flex items-start gap-1.5 rounded-lg border border-accent-gold/50 bg-accent-gold-soft px-3 py-2 text-[11px] font-medium text-accent-gold-text">
            <SatelliteDish className="mt-px size-3.5 shrink-0" />
            <span>{t("km_unmeasured_note", { count: olculemeyen.length })}</span>
          </p>
        )}
      </section>

      {/* ── KURAL NEDİR ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold">{t("plans_title")}</h2>
          <Button type="button" variant="outline" onClick={() => formuAc(null)}>
            <Plus className="size-4" />
            {t("plan_add")}
          </Button>
        </div>

        {acikForm && (
          <form
            // `key`: aynı form hem ekleme hem düzenleme için kullanılıyor.
            key={duzenlenen?.id ?? "yeni"}
            action={(fd) => startTransition(async () => { await planKaydet(fd); })}
            className="space-y-3 rounded-[14px] border border-border/60 p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bp_vehicle">{t("field_vehicle")}</Label>
                <select
                  id="bp_vehicle"
                  name="vehicleId"
                  defaultValue={duzenlenen?.vehicleId ?? ""}
                  className="h-10 w-full rounded-lg border border-border/60 bg-transparent px-3 text-sm"
                >
                  {/* Boş = FİLO GENELİ. Tek planla tüm filo kurulur. */}
                  <option value="">{t("vehicle_all")}</option>
                  {araclar.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.plate}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bp_tip">{t("field_type")}</Label>
                <Input
                  id="bp_tip"
                  name="tip"
                  required
                  defaultValue={duzenlenen?.tip ?? ""}
                  placeholder={t("field_type_ph")}
                />
                <p className="text-[11px] text-muted-foreground">{t("field_type_hint")}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bp_km">{t("field_interval_km")}</Label>
                <Input
                  id="bp_km"
                  name="aralikKm"
                  type="number"
                  min={100}
                  max={500000}
                  defaultValue={duzenlenen?.aralikKm ?? ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bp_ay">{t("field_interval_month")}</Label>
                <Input
                  id="bp_ay"
                  name="aralikAy"
                  type="number"
                  min={1}
                  max={120}
                  defaultValue={duzenlenen?.aralikAy ?? ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bp_son_km">{t("field_last_km")}</Label>
                <Input
                  id="bp_son_km"
                  name="sonBakimKm"
                  type="number"
                  min={0}
                  defaultValue={duzenlenen?.sonBakimKm ?? ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bp_son_at">{t("field_last_date")}</Label>
                <Input
                  id="bp_son_at"
                  name="sonBakimAt"
                  type="date"
                  defaultValue={duzenlenen?.sonBakimAt ? duzenlenen.sonBakimAt.slice(0, 10) : ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bp_uk">{t("field_warn_km")}</Label>
                <Input
                  id="bp_uk"
                  name="uyariKm"
                  type="number"
                  min={0}
                  max={50000}
                  defaultValue={duzenlenen?.uyariKm ?? 500}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bp_ug">{t("field_warn_days")}</Label>
                <Input
                  id="bp_ug"
                  name="uyariGun"
                  type="number"
                  min={0}
                  max={365}
                  defaultValue={duzenlenen?.uyariGun ?? 14}
                />
              </div>
            </div>
            {/* ⚠️ Şema en az bir eşik istiyor; ekran bunu ÖNCEDEN söyler. */}
            <p className="flex items-start gap-1.5 text-[11px] leading-snug text-text-tertiary">
              <AlertTriangle className="mt-px size-3 shrink-0" />
              <span>{t("threshold_note")}</span>
            </p>
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? t("saving") : t("save")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setAcikForm(false);
                  setDuzenlenen(null);
                }}
              >
                {t("cancel")}
              </Button>
            </div>
          </form>
        )}

        {planlar.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("plans_empty")}</p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-[14px] border border-border/60">
            {planlar.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1 pl-4 pr-1 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">{p.tip}</span>
                  <span className="nums text-[11px] text-text-tertiary">
                    {p.vehicleId
                      ? (araclar.find((a) => a.id === p.vehicleId)?.plate ?? "—")
                      : t("vehicle_all")}
                  </span>
                  {!p.aktif && <StatusChip tone="neutral">{t("plan_inactive")}</StatusChip>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="nums text-xs text-muted-foreground">
                    {[
                      p.aralikKm !== null ? t("every_km", { km: p.aralikKm }) : null,
                      p.aralikAy !== null ? t("every_month", { months: p.aralikAy }) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <CrudSatirEylemleri
                    adi={p.tip}
                    pending={pending}
                    pasifMi={!p.aktif}
                    onDuzenle={() => formuAc(p)}
                    onSil={() => startTransition(async () => { await planSil(p); })}
                    onPasiflestir={() =>
                      startTransition(async () => { await planPasifDegistir(p); })
                    }
                    silmeAciklamasi={t("plan_delete_desc")}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
