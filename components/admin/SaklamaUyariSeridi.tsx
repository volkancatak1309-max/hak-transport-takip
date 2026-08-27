import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AlertTriangle } from "lucide-react";
import { uyarilar } from "@/lib/saklama-db";
import { uyariVarMi } from "@/lib/saklama";

/**
 * SAKLAMA UYARI ŞERİDİ (090) — yönetici panosunun üstü.
 *
 * ═══ NEDEN AYRI BİLEŞEN, Dikkat panosuna KALEM OLARAK EKLENMEDİ ═══
 *
 * Dikkat panosunun her kalemi bir ŞOFÖR ya da ARAÇ hakkındadır ve
 * `AttentionItem` birliği o iki ekseni varsayıyor (id + worker_name / plate).
 * Saklama uyarısının öznesi KİRACININ KENDİSİ; üçüncü bir eksen. Onu
 * `AttentionItem`e sıkıştırmak, ya sahte bir plaka uydurmayı ya da birliği
 * tüm tüketicilerde (mobil uç dahil) genişletmeyi gerektirirdi.
 *
 * Haftalık aksiyon panosunda ise kalem olarak ÇIKIYOR (`saklama_uyarisi`
 * kuralı, TABAN 450) — orada özne alanları zaten null olabiliyor.
 *
 * ═══ 🔴 BU ŞERİT SİLME ÖNERMEZ ═══
 *
 * "Karar verin" der, "silin" demez: silme kararı ve zamanı veri
 * sorumlusunundur (müşteri); Galzura veri işleyendir. Bağlantı silme
 * ekranına gider, silme eylemine değil.
 */
export async function SaklamaUyariSeridi() {
  const [{ uyarilar: liste, hata }, t] = await Promise.all([
    uyarilar(),
    getTranslations("retention"),
  ]);

  // Migration uygulanmamışsa sessiz kal — panonun üstünde kurulum notu
  // göstermek yöneticinin işine yaramaz, /admin/saklama zaten söylüyor.
  if (hata || liste.length === 0) return null;

  const aktif = liste.filter(uyariVarMi);
  if (aktif.length === 0) return null;

  const toplam = aktif.reduce((a, u) => a + u.satirSayisi, 0);
  const yaslar = aktif.map((u) => u.enEskiGun).filter((x): x is number => x !== null);
  const enEski = yaslar.length ? Math.max(...yaslar) : null;
  const ilk = aktif[0];

  return (
    <Link
      href="/admin/saklama"
      className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 transition-colors hover:bg-amber-500/15"
    >
      <AlertTriangle className="mt-px size-3.5 shrink-0" />
      <span>
        {t("warning_line", {
          rows: new Intl.NumberFormat("de-AT").format(toplam),
          days: ilk.uyariGun,
          table: aktif.map((u) => u.tabloAdi).join(", "),
        })}{" "}
        {enEski !== null && t("warning_oldest", { days: enEski })}{" "}
        {/**
         * 🔴 YASAL ÇIPA DOĞRULANMAMIŞSA SAYI YAZILMAZ.
         * `saklama_esikleri` bugün BOŞ ve bu bilinçli; eşikler ayrı bir
         * araştırma turuyla kaynaklı doldurulacak.
         */}
        {ilk.yasalEsikGun === null
          ? t("anchor_unverified", { country: ilk.ulkeKodu })
          : t("anchor_verified", {
              country: ilk.ulkeKodu,
              days: ilk.yasalEsikGun,
              basis: ilk.yasalDayanak ?? "—",
            })}
      </span>
    </Link>
  );
}
