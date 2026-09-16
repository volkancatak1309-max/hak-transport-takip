/**
 * KM KAYNAĞININ EKRANDAKİ KARŞILIĞI — İSTEMCİ-GÜVENLİ.
 *
 * `lib/km-axis.ts` `server-only`; istemci bileşenleri (AdminClient,
 * WorkerDetailClient, HistoryClient, ShiftSummaryCard) onu içe aktaramaz.
 * Bu yüzden EKRANIN ihtiyaç duyduğu iki şey — kaynak tipi ve etiketi — burada,
 * sunucu bağı olmayan bir dosyada yaşıyor. `km-axis` tipi BURADAN alır, yani
 * iki tanım değil tek tanım var.
 *
 * ── ETİKET KURALI (Volkan, 16.09.2026) ────────────────────────────────────
 *   cihaz      → ETİKET YOK. Beklenen ve doğru olan hâl; her satıra "cihaz"
 *                yazmak gürültüdür ve gerçekten dikkat isteyen "sayaç"ı
 *                görünmez kılar.
 *   sayac      → küçük gri "sayaç". Sayı cihazdan DEĞİL, vardiya sayacından
 *                geliyor; okuyan bunu bilmeli.
 *   olculmedi  → etiket yok, çünkü zaten sayı yok: km null ve ekran "—" basar.
 *   bilinmiyor → etiket yok. Çekirdek karar üretemedi (RPC düştü); sayı yedek
 *                eksenden geliyor ama bunu "sayaç" diye ilan etmek, ölçülmemiş
 *                bir şeyi ölçülmüş göstermek olurdu.
 */

export type KmKaynak = "cihaz" | "sayac" | "olculmedi" | "bilinmiyor";

/** Ekranda km'nin yanına yazılacak etiket; `null` → hiçbir şey yazma. */
export function kmKaynakEtiketi(kaynak: KmKaynak | null | undefined): string | null {
  return kaynak === "sayac" ? "sayaç" : null;
}

/**
 * Etiketin ortak sınıfı — küçük, gri, satırı bölmeyen.
 *
 * Tek yerde durmasının sebebi tutarlılık: yedi ayrı yüzeyde yedi farklı gri
 * tonu, "bu bilgi önemli mi değil mi" sorusunu her ekranda yeniden sordururdu.
 */
export const KM_KAYNAK_SINIF =
  "ml-1 align-middle text-[10px] font-normal text-muted-foreground";

/**
 * Km kararı iliştirilmiş vardiya satırı — İSTEMCİ tarafının gördüğü şekil.
 *
 * Sunucu `markKmKarar` ile bu alanı yazıyor (lib/km-axis.ts); istemci yalnız
 * okuyor. `TimeEntry`e bağlanmamasının sebebi bu dosyanın sunucu bağı
 * olmaması — `lib/types.ts` km-ui'yi içe aktarıyor, tersi olsaydı döngü olurdu.
 */
export type KmKararli = {
  id: string;
  km_karar: { km: number | null; kaynak: KmKaynak };
};
