import { getTranslations, getLocale } from "next-intl/server";
import { Gauge } from "lucide-react";
import { computeAnalyticsRange } from "@/lib/analytics";
import { buildFuelReport } from "@/lib/reports";
import { resolveCostRates } from "@/lib/cost-rates-db";
import { RateSourceChip } from "@/components/admin/RateSourceChip";

/**
 * ÖLÇÜLEN TÜKETİM SATIRI — ayarlar formunun tek AĞIR parçası.
 *
 * ═══ NEDEN AYRI BİLEŞEN VE SUSPENSE ARKASINDA ═══
 *
 * Değerin tek kaynağı `buildFuelReport` ve o çağrı canlıda 40-60 saniye
 * sürüyor (24.08.2026: yakıt raporu 48 sn). Ayarlar sayfası bu çağrıyı
 * doğrudan bekliyordu; sonuç, ÜÇ SAYI düzenlemeye gelen yöneticinin 43 saniye
 * boş ekranda beklemesiydi. Daha kötüsü ölçülerek görüldü: veritabanı
 * yavaşladığı bir anda sayfa 200 dönüp İÇERİKSİZ render oldu — form hiç
 * çıkmadı.
 *
 * Form artık anında geliyor; bu satır arkadan akıyor. Düzenlenebilir üç oran
 * yakıt raporuna HİÇ ihtiyaç duymuyor (bkz. lib/cost-rates-db.ts zinciri).
 *
 * ═══ NEDEN SATIR YİNE DE VAR ═══
 *
 * L/100km hesabın DÖRDÜNCÜ çarpanı. Görünmeyen çarpan, denetlenemeyen
 * çarpandır — kullanıcı €/km'yi neyin oluşturduğunu göremeden ona güvenemez.
 * Girilemez olması onu gizlememizin gerekçesi değil, tam tersi: "bunu siz
 * giremezsiniz çünkü biz ölçüyoruz" cümlesi ürünün vaadi.
 */
export async function ConsumptionRow() {
  const t = await getTranslations("settings");
  const locale = await getLocale();
  const nfTag = locale === "de" ? "de-AT" : locale === "en" ? "en-US" : "tr-TR";

  // Aralık "ay": oran ekranı bir DÖNEM raporu değil, "bugün hangi sayı
  // geçerli" ekranı; 30 gün ölçümün oturması için yeterli ve yakıt raporunun
  // kendi varsayılanıyla aynı pencere.
  const range = computeAnalyticsRange("ay");
  const fuel = await buildFuelReport(range);
  const cozum = await resolveCostRates(fuel.fleetLPer100Km);

  return (
    <div className="space-y-1.5 rounded-lg border border-border/60 bg-surface-2/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-[13px] font-medium">
          <Gauge className="size-3.5 shrink-0 text-accent-sky-text" />
          {t("rate_l100")}
        </span>
        <span className="flex items-center gap-2 text-xs">
          <span className="nums font-medium text-foreground">
            {`${cozum.rates.lPer100Km.toLocaleString(nfTag, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })} L/100km`}
          </span>
          <RateSourceChip origin={cozum.origin.lPer100} />
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{t("rate_l100_hint")}</p>
    </div>
  );
}

/**
 * Akış sürerken duran yer tutucu.
 *
 * Boş bir kutu DEĞİL, metinli: "ölçülüyor" demek, kullanıcıya satırın var
 * olduğunu ve neyi beklediğini söyler. Sessiz bir iskelet, yavaş bir
 * bağlantıda "burada bir şey yok" diye okunur.
 */
export function ConsumptionRowSkeleton({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface-2/60 px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Gauge className="size-3.5 shrink-0 animate-pulse" />
        {label}
      </span>
    </div>
  );
}
