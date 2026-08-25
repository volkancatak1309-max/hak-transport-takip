"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, StatusChip, EmptyState, SegmentedControl } from "@/components/ui-v2";
import { CrudSatirEylemleri } from "@/components/admin/CrudSatirEylemleri";
import { formatDate } from "@/lib/format";
import { isEmriAc, isEmriGuncelle, isEmriSil } from "@/app/actions/is-emri";
import {
  IS_EMRI_DURUMLARI,
  IS_EMRI_ONCELIKLERI,
  IS_EMRI_KAYNAKLARI,
  type IsEmri,
  type IsEmriDurum,
  type IsEmriOncelik,
} from "@/lib/is-emri";

/**
 * İŞ EMİRLERİ — yönetici kuyruğu (migration 081).
 *
 * ═══ KUYRUK, ARŞİV DEĞİL ═══
 *
 * Varsayılan görünüm YALNIZ açık emirler. Kapanmışları görmek bir tık uzakta
 * ama varsayılan değil: bu ekranın sorusu "bugün neyi halletmeliyim", "geçen
 * ay ne yapmıştık" değil (o soru raporların işi).
 *
 * ═══ AÇIKLAMA DÜZENLENMEZ ═══
 *
 * Kusurun ne olduğu bildirildiği hâliyle kalır — DVIR yolunda o metin kontrol
 * formundaki kanıttan doğuyor. Yönetici DURUMU, önceliği, atananı, maliyeti ve
 * kapanış notunu yazar; olayın kendisini değil.
 *
 * ═══ SİLME YALNIZ ELLE AÇILANDA ═══
 *
 * Kontrol formundan / DTC'den / bakımdan doğan emir bir kanıt zincirinin
 * halkasıdır; onlarda geri alınabilir yol SİLME değil DURUM DEĞİŞTİRMEDİR
 * (kapat ↔ yeniden aç, ikisi de bu ekranda). Elle açılan emir ise yalnız bir
 * yönetici girdisi — yanlış araca açılmış olabilir, silinebilir.
 */

const ONCELIK_TONU: Record<IsEmriOncelik, "critical" | "warning" | "info" | "neutral"> = {
  kritik: "critical",
  yuksek: "warning",
  normal: "info",
  dusuk: "neutral",
};

export function IsEmirleriClient({
  emirler,
  personel,
  araclar,
  tabloYok,
  yalnizAcik,
}: {
  emirler: IsEmri[];
  personel: { id: string; ad: string }[];
  araclar: { id: string; plate: string }[];
  tabloYok: boolean;
  yalnizAcik: boolean;
}) {
  const t = useTranslations("workorders");
  const tc = useTranslations("crud");
  const locale = useLocale();
  /**
   * Kaynak etiketi. Bilinmeyen bir değer HAM basılır — `t()` bilinmeyen
   * anahtarda patlar ve tek bir yeni kaynak türü tüm ekranı düşürürdü.
   */
  const kaynakEtiketi = (k: string) =>
    (IS_EMRI_KAYNAKLARI as readonly string[]).includes(k) ? t(`source_${k}`) : k;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [acikForm, setAcikForm] = useState(false);
  const [duzenlenen, setDuzenlenen] = useState<string | null>(null);

  async function yeni(fd: FormData) {
    const r = await isEmriAc({
      vehicleId: String(fd.get("vehicleId") ?? ""),
      aciklama: String(fd.get("aciklama") ?? ""),
      oncelik: String(fd.get("oncelik") ?? "normal") as IsEmriOncelik,
      atananId: (fd.get("atananId") as string) || null,
    });
    if (!r.ok) {
      toast.error(r.hata === "tablo_yok" ? t("migration_needed") : t("save_error"));
      return;
    }
    toast.success(t("created"));
    setAcikForm(false);
    router.refresh();
  }

  async function sil(e: IsEmri) {
    const r = await isEmriSil(e.id);
    if (r.ok) {
      toast.success(tc("deleted"));
      router.refresh();
      return;
    }
    toast.error(
      r.hata === "silinemez_kaynak"
        ? t("delete_only_manual")
        : r.hata === "silinemez_kapali"
          ? t("delete_not_closed")
          : t("save_error")
    );
  }

  async function guncelle(id: string, fd: FormData) {
    const maliyetHam = String(fd.get("maliyet") ?? "").trim();
    const r = await isEmriGuncelle(id, {
      durum: String(fd.get("durum") ?? "acik") as IsEmriDurum,
      oncelik: String(fd.get("oncelik") ?? "normal") as IsEmriOncelik,
      atananId: (fd.get("atananId") as string) || null,
      maliyet: maliyetHam === "" ? null : Number(maliyetHam),
      servisAt: (fd.get("servisAt") as string) || null,
      kapanisNotu: (fd.get("kapanisNotu") as string) || null,
    });
    if (!r.ok) {
      toast.error(t("save_error"));
      return;
    }
    toast.success(t("updated"));
    setDuzenlenen(null);
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
    <div className="space-y-5">
      <PageHeader title={t("title")} description={t("desc")} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={yalnizAcik ? "acik" : "hepsi"}
          onChange={(v) =>
            router.push(v === "acik" ? "/admin/is-emirleri" : "/admin/is-emirleri?hepsi=1")
          }
          options={[
            { value: "acik", label: t("filter_open") },
            { value: "hepsi", label: t("filter_all") },
          ]}
        />
        <Button type="button" variant="outline" onClick={() => setAcikForm((o) => !o)}>
          <Plus className="size-4" />
          {t("add")}
        </Button>
      </div>

      {acikForm && (
        <form
          action={(fd) => startTransition(async () => { await yeni(fd); })}
          className="space-y-3 rounded-[14px] border border-border/60 p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wo_vehicle">{t("field_vehicle")}</Label>
              <select
                id="wo_vehicle"
                name="vehicleId"
                required
                className="h-10 w-full rounded-lg border border-border/60 bg-transparent px-3 text-sm"
              >
                {araclar.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.plate}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wo_priority">{t("field_priority")}</Label>
              <select
                id="wo_priority"
                name="oncelik"
                defaultValue="normal"
                className="h-10 w-full rounded-lg border border-border/60 bg-transparent px-3 text-sm"
              >
                {IS_EMRI_ONCELIKLERI.map((o) => (
                  <option key={o} value={o}>
                    {t(`priority_${o}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="wo_desc">{t("field_desc")}</Label>
              <Textarea id="wo_desc" name="aciklama" rows={2} required maxLength={1000} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wo_assignee">{t("field_assignee")}</Label>
              <select
                id="wo_assignee"
                name="atananId"
                className="h-10 w-full rounded-lg border border-border/60 bg-transparent px-3 text-sm"
              >
                <option value="">{t("assignee_none")}</option>
                {personel.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ad}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? t("saving") : t("save")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAcikForm(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}

      {emirler.length === 0 ? (
        <EmptyState kind="none" title={t("empty")} hint={t("empty_desc")} />
      ) : (
        <ul className="divide-y divide-border/60 rounded-[14px] border border-border/60">
          {emirler.map((e) => (
            <li key={e.id} className="space-y-3 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="min-w-0 space-y-0.5">
                  <p className="flex items-center gap-2 text-sm">
                    <span className="nums font-semibold">{e.plaka}</span>
                    <StatusChip tone={ONCELIK_TONU[e.oncelik]}>
                      {t(`priority_${e.oncelik}`)}
                    </StatusChip>
                    <StatusChip tone={e.durum === "kapali" ? "neutral" : "info"}>
                      {t(`status_${e.durum}`)}
                    </StatusChip>
                  </p>
                  {/* Açıklama KİRACININ/ŞOFÖRÜN metni — çevrilmez. */}
                  <p className="text-sm text-foreground">{e.aciklama}</p>
                  <p className="nums text-[11px] text-text-tertiary">
                    {kaynakEtiketi(e.kaynak)} ·{" "}
                    {formatDate(e.createdAt, locale)} · {e.bildirenAd}
                    {e.atananAd ? ` · → ${e.atananAd}` : ""}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDuzenlenen((o) => (o === e.id ? null : e.id))}
                  >
                    <Wrench className="size-4" />
                    {t("manage")}
                  </Button>
                  {/* Düzenleme "Yönet" panelinde; burada yalnız silme kalıyor.
                      Pasiflik yok: bu kaydın ekseni DURUM (açık/serviste/kapalı)
                      ve ona ikinci bir pasiflik kavramı eklemek iki gerçek
                      üretirdi. */}
                  <CrudSatirEylemleri
                    adi={e.plaka}
                    pending={pending}
                    onDuzenle={() => setDuzenlenen(e.id)}
                    onSil={() => startTransition(async () => { await sil(e); })}
                    silmeAciklamasi={
                      e.kaynak === "elle" ? t("delete_desc") : t("delete_only_manual")
                    }
                  />
                </span>
              </div>

              {duzenlenen === e.id && (
                <form
                  action={(fd) => startTransition(async () => { await guncelle(e.id, fd); })}
                  className="grid gap-3 rounded-lg border border-border/60 p-3 sm:grid-cols-2"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor={`d_${e.id}`}>{t("field_status")}</Label>
                    <select
                      id={`d_${e.id}`}
                      name="durum"
                      defaultValue={e.durum}
                      className="h-10 w-full rounded-lg border border-border/60 bg-transparent px-3 text-sm"
                    >
                      {IS_EMRI_DURUMLARI.map((d) => (
                        <option key={d} value={d}>
                          {t(`status_${d}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`o_${e.id}`}>{t("field_priority")}</Label>
                    <select
                      id={`o_${e.id}`}
                      name="oncelik"
                      defaultValue={e.oncelik}
                      className="h-10 w-full rounded-lg border border-border/60 bg-transparent px-3 text-sm"
                    >
                      {IS_EMRI_ONCELIKLERI.map((o) => (
                        <option key={o} value={o}>
                          {t(`priority_${o}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`a_${e.id}`}>{t("field_assignee")}</Label>
                    <select
                      id={`a_${e.id}`}
                      name="atananId"
                      defaultValue={e.atananId ?? ""}
                      className="h-10 w-full rounded-lg border border-border/60 bg-transparent px-3 text-sm"
                    >
                      <option value="">{t("assignee_none")}</option>
                      {personel.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.ad}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`m_${e.id}`}>{t("field_cost")}</Label>
                    <Input
                      id={`m_${e.id}`}
                      name="maliyet"
                      type="number"
                      step="0.01"
                      min={0}
                      defaultValue={e.maliyet ?? ""}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`s_${e.id}`}>{t("field_service_date")}</Label>
                    <Input
                      id={`s_${e.id}`}
                      name="servisAt"
                      type="date"
                      defaultValue={e.servisAt ? e.servisAt.slice(0, 10) : ""}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor={`k_${e.id}`}>{t("field_close_note")}</Label>
                    <Textarea
                      id={`k_${e.id}`}
                      name="kapanisNotu"
                      rows={2}
                      maxLength={500}
                      defaultValue={e.kapanisNotu ?? ""}
                    />
                  </div>
                  <div className="flex items-center gap-2 sm:col-span-2">
                    <Button type="submit" disabled={pending}>
                      {pending ? t("saving") : t("save")}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setDuzenlenen(null)}>
                      {t("cancel")}
                    </Button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
