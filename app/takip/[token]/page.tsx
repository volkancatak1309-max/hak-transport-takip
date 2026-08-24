import type { Metadata } from "next";
import { readTakipByToken } from "@/lib/takip-db";
import { TakipClient, Kapandi } from "./TakipClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /takip/[token] — MÜŞTERİNİN GÖRDÜĞÜ SAYFA. Girişsiz.
 *
 * ═══ NEDEN KAPI YOK ═══
 *
 * Bu depoda yetki her sayfada AÇIKÇA çağrılıyor (`requireAdmin` /
 * `requireDriver`); ortak bir middleware YOK (ölçüldü). Yani bu sayfanın
 * girişsiz olması bir istisna değil, sadece o çağrının yokluğu. Yetkiyi
 * token taşıyor.
 *
 * ⚠️ BURAYA `requireAdmin` BENZERİ BİR ŞEY EKLEMEYİN — sayfanın tamamı
 * girişsiz olmak ÜZERE tasarlandı. Korunması gereken şey erişim değil, VERİ:
 * gövde `lib/takip-db.ts`te kuruluyor ve içinde plaka/şoför/filo yok.
 *
 * ═══ İLK HÂL SUNUCUDAN ═══
 *
 * Sayfa ilk görünümü sunucuda çözüp veriyor: müşteri linke tıkladığında boş
 * bir iskelet + "yükleniyor" görmüyor. Tazeleme istemcide (20 sn yoklama).
 *
 * ═══ ARAMA MOTORU ═══
 *
 * `noindex, nofollow`: paylaşılmış bir takip linkinin aranabilir olması,
 * müşteri adresini ve teslim saatini herkese açardı.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  // Başlıkta sefer/müşteri/araç bilgisi YOK: sekme başlığı da bir yüzeydir.
  title: "Canlı Takip",
};

export default async function TakipSayfasi({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Biçim denetimi ÖNCE — veritabanına gitmeden elenebilecek istek elensin.
  if (!/^[A-Za-z0-9_-]{32,86}$/.test(token)) {
    return <Kapandi sebep="bulunamadi" />;
  }

  const sonuc = await readTakipByToken(token);
  if (!sonuc.ok) return <Kapandi sebep={sonuc.sebep} />;

  return <TakipClient token={token} ilk={sonuc.gorunum} />;
}
