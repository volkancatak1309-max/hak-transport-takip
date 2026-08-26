"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Info, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, StatusChip } from "@/components/ui-v2";
import { saklamaAyarKaydet, hazirlikYurut, type SaklamaPanosu } from "@/app/actions/saklama";
import {
  GEREKCE_ESIGI,
  GEREKCE_MIN_UZUNLUK,
  HAM_GUN_MAX,
  HAM_GUN_MIN,
  VARSAYILAN_HAM_GUN,
  uzatmaUyarisiGerekli,
} from "@/lib/saklama";

/**
 * SAKLAMA POLİTİKASI EKRANI (090).
 *
 * ═══ ÜÇ ŞEY KALDIRILAMAZ ═══
 *
 * 1. UZATMA UYARISI. 90'ın üstüne çıkıldığı ANDA görünür ve cezalandırılmış
 *    süreleri sayıyla yazar. Kullanıcı "uzun tutmak serbest" sanmamalı.
 * 2. GEREKÇE ZORUNLU. 90'ın üstünde kaydet düğmesi gerekçesiz çalışmaz.
 * 3. SİLME DURUMU ve ENGELİ. "Neden hiçbir şey silinmiyor" sorusunun cevabı
 *    ekranda yazılı olmalı; sessizce çalışmayan bir temizlik, çalışıyor
 *    sanılır.
 *
 * ═══ ⚠️ BU EKRANDA "SİL" DÜĞMESİ YOK — BİLİNÇLİ ═══
 *
 * "Hazırlığı yürüt" özet üretir, izi dondurur ve silmeyi KURU modda sayar.
 * Gerçek silme yalnız cron'dan ve yalnız anahtar açıkken olur. Silme geri
 * alınamaz; bir ekran düğmesinin arkasına koymak, yanlış sekmede bir
 * tıklamayla 1,6 milyon satırı götürebilirdi.
 */

const say = (n: number) => new Intl.NumberFormat("de-AT").format(n);

export function SaklamaClient({ pano }: { pano: SaklamaPanosu }) {
  const t = useTranslations("retention");
  const [hamGun, setHamGun] = useState(pano.ayar.hamGun);
  const [silmeAcik, setSilmeAcik] = useState(pano.ayar.silmeAcik);
  const [gerekce, setGerekce] = useState(pano.ayar.gerekce ?? "");
  const [kaydetBekle, kaydetBasla] = useTransition();
  const [hazirlikBekle, hazirlikBasla] = useTransition();

  const uyariGerekli = uzatmaUyarisiGerekli(hamGun);
  const gerekceEksik = uyariGerekli && gerekce.trim().length < GEREKCE_MIN_UZUNLUK;

  const kaydet = () =>
    kaydetBasla(async () => {
      const r = await saklamaAyarKaydet({
        hamGun,
        silmeAcik,
        gerekce: gerekce.trim() || null,
      });
      if (r.ok) toast.success(t("saved"));
      else toast.error(t(`error_${r.hata}` as never));
    });

  const hazirlik = () =>
    hazirlikBasla(async () => {
      const r = await hazirlikYurut();
      if (!r.ok) {
        toast.error(r.hata ?? t("error_hata"));
        return;
      }
      toast.success(
        t("prep_done", {
          months: r.ozetYazilan.length,
          shifts: r.kmDondurulan,
          rows: say(r.silinecekTelemetri),
        })
      );
    });

  if (pano.ayar.tabloYok) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("title")} description={t("description")} />
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          <AlertTriangle className="mt-px size-4 shrink-0" />
          <span>{t("migration_missing")}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      {/* ── DURUM ŞERİDİ ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border/60 bg-card/60 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* "info" = aktif/rutin bilgi vurgusu; "neutral" = pasif durum.
              Silme AÇIK bir başarı değil, bir DURUM — "success" tonu
              yanlış okuma yaratırdı (veri silmek kutlanacak bir şey değil). */}
          <StatusChip tone={pano.ayar.silmeAcik ? "info" : "neutral"}>
            {pano.ayar.silmeAcik ? t("purge_on") : t("purge_off")}
          </StatusChip>
          <StatusChip tone="neutral">{t("current_days", { days: pano.ayar.hamGun })}</StatusChip>
          <StatusChip tone="neutral">
            {t("cutoff", { date: pano.kesim.slice(0, 10) })}
          </StatusChip>
        </div>

        {/* NEDEN SİLİNMİYOR — cevabı ekranda. Sessiz bir temizlik, çalışıyor
            sanılır; bu satır o yanılgıyı imkânsız kılar. */}
        {!pano.kapi.izin && (
          <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-px size-3.5 shrink-0" />
            <span>
              {t(`blocked_${pano.kapi.engel ?? "ayar_kapali"}` as never)}
              {pano.kapi.ayrinti ? ` — ${pano.kapi.ayrinti}` : ""}
            </span>
          </p>
        )}

        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{t("months_ready")}</dt>
            <dd className="font-medium">{pano.hazirAylar.length}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("months_missing")}</dt>
            <dd className="font-medium">{pano.eksikAylar.length}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("shifts_unfrozen")}</dt>
            <dd className="font-medium">{say(pano.kmDonmamis)}</dd>
          </div>
        </dl>
      </section>

      {/* ── AYAR ─────────────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-xl border border-border/60 bg-card/60 p-4">
        <div className="space-y-1">
          <label htmlFor="ham-gun" className="text-sm font-medium">
            {t("days_label")}
          </label>
          <Input
            id="ham-gun"
            type="number"
            min={HAM_GUN_MIN}
            max={HAM_GUN_MAX}
            value={hamGun}
            onChange={(e) => setHamGun(Number(e.target.value))}
            className="max-w-32"
          />
          <p className="text-xs text-muted-foreground">
            {t("days_hint", { min: HAM_GUN_MIN, max: HAM_GUN_MAX, def: VARSAYILAN_HAM_GUN })}
          </p>
        </div>

        {/**
         * 🔴 UZATMA UYARISI — kullanıcı 90'ı geçtiği ANDA görünür.
         *
         * Cezalandırılmış süreler sayıyla yazılı: sayısız "dikkatli olun"
         * cümlesinden daha caydırıcı olan, gerçekte ne olduğudur.
         */}
        {uyariGerekli && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            <span>{t("extend_warning", { threshold: GEREKCE_ESIGI })}</span>
          </p>
        )}

        {uyariGerekli && (
          <div className="space-y-1">
            <label htmlFor="gerekce" className="text-sm font-medium">
              {t("reason_label")}
            </label>
            <textarea
              id="gerekce"
              value={gerekce}
              onChange={(e) => setGerekce(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
              placeholder={t("reason_placeholder")}
            />
            <p className="text-xs text-muted-foreground">
              {t("reason_hint", { min: GEREKCE_MIN_UZUNLUK })}
            </p>
          </div>
        )}

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={silmeAcik}
            onChange={(e) => setSilmeAcik(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-medium">{t("purge_toggle")}</span>
            <span className="block text-xs text-muted-foreground">{t("purge_toggle_hint")}</span>
          </span>
        </label>

        <Button onClick={kaydet} disabled={kaydetBekle || gerekceEksik}>
          {kaydetBekle ? <Loader2 className="mr-2 size-4 animate-spin" /> : <ShieldCheck className="mr-2 size-4" />}
          {t("save")}
        </Button>
      </section>

      {/* ── HAZIRLIK ─────────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-4">
        <h2 className="text-sm font-medium">{t("prep_title")}</h2>
        <p className="text-xs text-muted-foreground">{t("prep_desc")}</p>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Trash2 className="mt-px size-3.5 shrink-0" />
          <span>{t("prep_no_delete")}</span>
        </p>
        <Button variant="secondary" onClick={hazirlik} disabled={hazirlikBekle}>
          {hazirlikBekle && <Loader2 className="mr-2 size-4 animate-spin" />}
          {t("prep_run")}
        </Button>
      </section>
    </div>
  );
}
