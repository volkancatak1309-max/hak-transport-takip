"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RateSourceChip } from "@/components/admin/RateSourceChip";
import { saveCostRatesAction } from "@/app/actions/cost-rates";
import type { CostRates, CostRateOrigin } from "@/lib/cost-model";
import type { CostRateRow } from "@/lib/cost-rates-db";

/**
 * MALİYET ORANLARI FORMU — kiracı kendi rakamını girer.
 *
 * ═══ HER SATIR ÜÇ ŞEYİ BİRDEN SÖYLER ═══
 *
 *   1. ŞU AN GEÇERLİ değer (hesabın gerçekten kullandığı sayı)
 *   2. O sayının KAYNAĞI — ÖLÇÜLDÜ / GİRİLDİ / VARSAYILAN(kaynağıyla)
 *   3. Kullanıcının kendi değerini yazacağı alan
 *
 * Yalnız input göstermek yetmezdi: boş bir kutu, arkasında bir varsayılan
 * çalıştığını söylemez. Kullanıcı "girmedim, demek ki hesaba girmiyor" sanar —
 * oysa girer, bizim tahminimizle.
 *
 * ═══ L/100km NEDEN SALT OKUNUR ═══
 *
 * Tüketim telemetriden ÖLÇÜLÜYOR. Elle girilebilir yapmak, ürünün zaten
 * ölçtüğü bir büyüklüğü tahminle geçersiz kılmak olurdu. Satır yine
 * GÖSTERİLİYOR — çünkü hesabın dördüncü çarpanı o ve görünmeyen çarpan,
 * denetlenemeyen çarpandır.
 */
export function CostRatesForm({
  rates,
  origin,
  row,
  tabloYok,
  consumptionSlot,
}: {
  rates: CostRates;
  origin: CostRateOrigin;
  row: CostRateRow | null;
  tabloYok: boolean;
  /**
   * ÖLÇÜLEN tüketim satırı — SUNUCUDAN AKITILARAK gelir, burada hesaplanmaz.
   *
   * ⚠️ NEDEN YUVA: bu satırın kaynağı `buildFuelReport` ve o çağrı canlıda
   * 40-60 SANİYE sürüyor (24.08.2026 ölçümü: 48 sn). Sayfanın tamamını ona
   * bağlamak, üç sayı düzenlemeye gelen yöneticiyi 43 saniye boş ekranda
   * bekletiyordu — üstelik veritabanı yavaşladığında sayfa büsbütün boş
   * render oluyordu (bir kez ölçüldü). Formun üç parasal oranı yakıt raporuna
   * HİÇ ihtiyaç duymuyor; tek bağımlı satır buydu ve artık Suspense arkasında.
   */
  consumptionSlot: React.ReactNode;
}) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const nfTag = locale === "de" ? "de-AT" : locale === "en" ? "en-US" : "tr-TR";
  const num = (v: number, d: number) =>
    v.toLocaleString(nfTag, { minimumFractionDigits: d, maximumFractionDigits: d });

  const [pending, startTransition] = useTransition();
  const [hataliAlan, setHataliAlan] = useState<string | null>(null);

  async function kaydet(fd: FormData) {
    setHataliAlan(null);
    const r = await saveCostRatesAction(fd);
    if (r.ok) {
      toast.success(t("saved"));
      return;
    }
    if (r.sebep === "gecersiz") {
      setHataliAlan(r.alan ?? null);
      toast.error(t("invalid"));
      return;
    }
    toast.error(r.sebep === "tablo_yok" ? t("migration_needed") : t("save_error"));
  }

  /** Üç düzenlenebilir oran — tek yerde tanımlı, üçü de aynı satırı render eder. */
  const alanlar = [
    {
      id: "fuel_eur_per_l",
      key: "fuel" as const,
      label: t("rate_fuel"),
      hint: t("rate_fuel_hint"),
      suffix: "€/L",
      basamak: 3,
      deger: rates.fuelEurPerL,
      o: origin.fuel,
      mevcut: row?.fuel_eur_per_l ?? null,
      step: "0.001",
    },
    {
      id: "labor_eur_per_hour",
      key: "labor" as const,
      label: t("rate_labor"),
      hint: t("rate_labor_hint"),
      suffix: `€/${t("unit_hour")}`,
      basamak: 2,
      deger: rates.laborEurPerHour,
      o: origin.labor,
      mevcut: row?.labor_eur_per_hour ?? null,
      step: "0.01",
    },
    {
      id: "vehicle_eur_per_day",
      key: "vehicleDay" as const,
      label: t("rate_vehicle_day"),
      hint: t("rate_vehicle_day_hint"),
      suffix: `€/${t("unit_vehicle_day")}`,
      basamak: 2,
      deger: rates.vehicleEurPerDay,
      o: origin.vehicleDay,
      mevcut: row?.vehicle_eur_per_day ?? null,
      step: "0.01",
    },
  ];

  return (
    <section className="surface-card space-y-5 rounded-[16px] p-5 sm:p-6">
      <div className="space-y-1">
        <h2 className="text-[15px] font-semibold">{t("cost_rates_title")}</h2>
        <p className="text-xs text-muted-foreground">{t("cost_rates_desc")}</p>
      </div>

      {/* MIGRATION KAPISI: tablo yoksa form ÇALIŞMAZ ama ekran yine oranları ve
          kaynaklarını gösterir — yönetici neyin geçerli olduğunu görmeli, yalnız
          değiştiremediğini öğrenmeli. */}
      {tabloYok && (
        <p className="flex items-start gap-1.5 rounded-lg border border-accent-gold/50 bg-accent-gold-soft px-3 py-2 text-xs font-medium text-accent-gold-text">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>{t("migration_needed")}</span>
        </p>
      )}

      <form action={(fd) => startTransition(() => void kaydet(fd))} className="space-y-5">
        {alanlar.map((a) => (
          <div key={a.id} className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <Label htmlFor={a.id} className="text-[13px]">
                {a.label}
              </Label>
              <span className="flex items-center gap-2 text-xs">
                {/* ⚠️ Etiket ve değer TEK dizede birleşiyor. Ayrı JSX
                    elemanlarına bölünce React araya boşluk koyuyordu ve ekranda
                    "Geçerli : 2,043" çıkıyordu (üretim HTML'inde ölçüldü). */}
                <span className="nums text-muted-foreground">
                  {`${t("in_effect")}: `}
                  <span className="font-medium text-foreground">
                    {`${num(a.deger, a.basamak)} ${a.suffix}`}
                  </span>
                </span>
                <RateSourceChip origin={a.o} />
              </span>
            </div>
            <Input
              id={a.id}
              name={a.id}
              type="text"
              inputMode="decimal"
              step={a.step}
              disabled={tabloYok || pending}
              // ⚠️ defaultValue YALNIZ panelde girilmiş değeri taşır, geçerli
              // değeri DEĞİL. Varsayılanı kutuya yazsaydık kullanıcı ona
              // dokunmadan kaydettiğinde bizim tahminimiz onun "kendi rakamı"
              // olarak mühürlenirdi ve rozet sessizce GİRİLDİ'ye dönerdi.
              defaultValue={a.mevcut === null ? "" : String(a.mevcut)}
              placeholder={t("placeholder_default", { n: num(a.deger, a.basamak) })}
              aria-invalid={hataliAlan === a.key || undefined}
              className={hataliAlan === a.key ? "border-status-critical" : undefined}
            />
            <p className="text-xs text-muted-foreground">{a.hint}</p>
          </div>
        ))}

        {consumptionSlot}

        {/* CC BY 4.0 ATFI — kaynaktan çekilen fiyat gösterildiği her yerde ZORUNLU.
            Lisans dört unsur istiyor: kaynak adı, lisans adı+bağlantısı, veriye
            bağlantı ve DEĞİŞİKLİK BİLDİRİMİ (1000 L → 1 L dönüşümü bir uyarlama).
            🔴 AB LOGOSU/AMBLEMİ KULLANILMAZ ve "AB onaylı/iş ortağı" DENMEZ —
            Karar 2011/833/EU Md.2(2)(a) logoları kapsam dışı bırakıyor,
            CC BY 4.0 Md.2(a)(6) "No endorsement". Atıf METİNLE yapılır. */}
        {origin.fuel.source === "kaynaktan" && (
          <p className="text-[11px] leading-snug text-text-tertiary">
            {origin.fuel.atif}{" "}
            <a
              href={origin.fuel.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              {t("source_link")}
            </a>
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={tabloYok || pending}>
            {pending ? t("saving") : t("save")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("clear_hint")}</p>
        </div>
      </form>
    </section>
  );
}
