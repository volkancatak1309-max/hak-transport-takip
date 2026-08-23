"use client";

import { useTranslations } from "next-intl";
import { StatusChip } from "@/components/ui-v2";
import type { RateOrigin } from "@/lib/cost-model";

/**
 * KAYNAK ROZETİ — bir maliyet oranının nereden geldiğini söyleyen etiket.
 *
 * ═══ NEDEN ORTAK BİLEŞEN, HER EKRANDA KOPYA DEĞİL ═══
 *
 * İki yerde gösteriliyor: yakıt raporundaki oran listesi ve ayarlar formundaki
 * satır başlıkları. İlk yazımda ikisinde de bileşen fonksiyonun İÇİNDE
 * tanımlanmıştı ve ESLint haklı olarak reddetti (`react-hooks/static-components`:
 * her render'da yeni bir bileşen tipi doğar, React alt ağacı komple söküp yeniden
 * kurar). Kopyalamak ayrıca ikinci bir kusur doğururdu: rozet dili iki dosyada
 * ayrışabilirdi ve "ÖLÇÜLDÜ" ile "GİRİLDİ" ayrımı bu özelliğin ANA VAADİ.
 *
 * ═══ NEDEN `common` SÖZLÜĞÜ ═══
 *
 * Etiketler `reports` ya da `settings` bölümünde yaşasaydı, öteki ekran yabancı
 * bir isim alanından metin çekerdi. Rozet ikisine de ait değil; ikisinin de
 * kullandığı ortak bir kelime dağarcığı.
 *
 * ÜÇ DURUM, ÜÇ TON — renk bilgi taşıyor:
 *   ÖLÇÜLDÜ    info (mavi)    ürün ölçtü, kimse giremez
 *   GİRİLDİ     neutral        müşterinin kendi rakamı
 *   VARSAYILAN  warning (altın) DİKKAT: bu bizim tahminimiz, düzeltilmeyi bekliyor
 *
 * Altın bilinçli. Sessiz gri, varsayılanla bırakılmış bir oranı "hallolmuş" gibi
 * gösterirdi; oysa o, karar sayısının içinde duran bir eksiktir.
 */
export function RateSourceChip({ origin }: { origin: RateOrigin }) {
  const t = useTranslations("common");

  if (origin.source === "olculdu") {
    return <StatusChip tone="info">{t("src_measured")}</StatusChip>;
  }
  if (origin.source === "girildi") {
    return (
      <StatusChip tone="neutral">
        {origin.via === "panel" ? t("src_entered_panel") : t("src_entered_env")}
      </StatusChip>
    );
  }
  // Varsayılanın KAYNAĞI rozetin içinde: kaynağı yazılmayan bir varsayılan,
  // ölçüm kılığına girmiş tahmindir. `kaynak` boşsa (yalnız L/100km yedeği)
  // sade etiket kullanılır — uydurma bir kaynak adı basmaktansa sessiz kalır.
  return (
    <StatusChip tone="warning">
      {origin.kaynak
        ? t("src_default_with", { kaynak: origin.kaynak, tarih: origin.tarih })
        : t("src_default")}
    </StatusChip>
  );
}
