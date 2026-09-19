"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusChip } from "@/components/ui-v2";
import { saveTenantSettingsAction } from "@/app/actions/tenant-settings";
import type { BirimSistemi, AyarKaynak } from "@/lib/tenant-settings";

/**
 * BÖLGESEL AYARLAR — ölçü birimi + saat dilimi (migration 108).
 *
 * ═══ NEDEN BURADA ═════════════════════════════════════════════════════════
 * İkisi de KİRACI AYARI: "bizim filomuz hangi birimlerle çalışır, hangi
 * dilimde gün başlar". Ayarlar sayfası tam olarak bunun için bir kap olarak
 * açılmıştı (076, maliyet oranları).
 *
 * ═══ MOBİLLE AYNI ALANLAR, AYNI ÇEKİRDEK ══════════════════════════════════
 * `PATCH /api/mobile/tenant` bu iki alanı yazıyor; panel de aynı action ve
 * aynı `lib/tenant-settings.ts` çekirdeğinden geçiyor. İki yüzeyde iki farklı
 * doğrulama olsaydı, panelde kabul edilen bir dilim telefonda reddedilirdi.
 *
 * ═══ ROZET: GİRİLDİ / VARSAYILAN ══════════════════════════════════════════
 * 076'nın kuralı: kullanıcı baktığı rakamın KENDİ verisi mi, bizim
 * varsayılanımız mı olduğunu görmeden karar veremez. Saat diliminde üçüncü bir
 * kaynak daha var — env (`NEXT_PUBLIC_TENANT_TZ`) — ve o da ayrı etiketleniyor:
 * env'e bir değer yazan kişi de o kiracıya ait bir karar vermiştir, onu "bizim
 * varsayılanımız" diye göstermek yalan olurdu.
 *
 * ⚠️ PARA BİRİMİ BU FORMDA YOK: EUR sabit ve 108 ona dokunmuyor.
 */
export function TenantSettingsSection({
  birimSistemi,
  saatDilimi,
  kaynak,
  tabloYok,
  /** Tabloda duran ham dilim — boş bırakılmışsa input da boş açılır. */
  satirTz,
}: {
  birimSistemi: BirimSistemi;
  saatDilimi: string;
  kaynak: { birim: AyarKaynak; saatDilimi: AyarKaynak };
  tabloYok: boolean;
  satirTz: string | null;
}) {
  const t = useTranslations("settings");
  const [pending, startTransition] = useTransition();
  const [birim, setBirim] = useState<BirimSistemi>(birimSistemi);
  const [tz, setTz] = useState(satirTz ?? "");
  const [hataliAlan, setHataliAlan] = useState<string | null>(null);

  function kaydet(formData: FormData) {
    setHataliAlan(null);
    startTransition(async () => {
      const r = await saveTenantSettingsAction(formData);
      if (r.ok) {
        toast.success(t("saved"));
        return;
      }
      if (r.sebep === "tablo_yok") {
        toast.error(t("region_migration_needed"));
        return;
      }
      if (r.sebep === "gecersiz") {
        setHataliAlan(r.alan ?? null);
        toast.error(r.alan === "saatDilimi" ? t("region_tz_invalid") : t("invalid"));
        return;
      }
      toast.error(r.hata ?? t("save_error"));
    });
  }

  const rozet = (k: AyarKaynak) =>
    k === "tablo" ? t("in_effect") : k === "env" ? "env" : t("placeholder_default");

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
      <header className="mb-4">
        <h2 className="text-base font-semibold">{t("region_title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("region_desc")}</p>
      </header>

      {tabloYok ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t("region_migration_needed")}</span>
        </p>
      ) : null}

      <form action={kaydet} className="mt-4 space-y-5">
        {/* ── ÖLÇÜ BİRİMİ ── */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="unit_system">{t("region_unit")}</Label>
            <StatusChip tone={kaynak.birim === "tablo" ? "info" : "neutral"}>
              {rozet(kaynak.birim)}
            </StatusChip>
          </div>
          <select
            id="unit_system"
            name="unit_system"
            value={birim}
            onChange={(e) => setBirim(e.target.value as BirimSistemi)}
            disabled={tabloYok || pending}
            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="metric">{t("region_unit_metric")}</option>
            <option value="imperial">{t("region_unit_imperial")}</option>
          </select>
          <p className="text-xs text-muted-foreground">{t("region_unit_hint")}</p>
        </div>

        {/* ── SAAT DİLİMİ ── */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="timezone">{t("region_tz")}</Label>
            <StatusChip tone={kaynak.saatDilimi === "tablo" ? "info" : "neutral"}>
              {rozet(kaynak.saatDilimi)}
            </StatusChip>
          </div>
          <Input
            id="timezone"
            name="timezone"
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            placeholder={saatDilimi}
            disabled={tabloYok || pending}
            aria-invalid={hataliAlan === "saatDilimi"}
            autoComplete="off"
          />
          {/* Boş bırakmak "UTC yap" değil "varsayılana dön" demek — yazılı olmazsa
              kullanıcı geri dönüş yolunu bulamaz. */}
          <p className="text-xs text-muted-foreground">{t("region_tz_hint")}</p>
          {/* Gün sınırını oynatan bir ayar; etkisi yazılı olmalı. */}
          <p className="text-xs text-muted-foreground">{t("region_tz_warn")}</p>
        </div>

        <Button type="submit" disabled={tabloYok || pending}>
          {pending ? t("saving") : t("save")}
        </Button>
      </form>
    </section>
  );
}
