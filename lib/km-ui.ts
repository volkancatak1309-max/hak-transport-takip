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

// ─────────────────────────────────────────────────────────────────────────────
// RAPOR KESİMİ (13. madde Adım 5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bu vardiya YENİ eksene mi ait — raporlar için TEK KARAR NOKTASI.
 *
 * Ölçüt vardiyanın `started_at`'i: kesim gününün 00:00'ından itibaren (dâhil)
 * yeni eksen. Karşılaştırma ISO dizeleri üzerinde YAPILIR ve bu bilinçli —
 * `started_at` UTC damgalı bir ISO, kesim ise yerel bir gün. İkisini Date'e
 * çevirip saat dilimi aritmetiğine girmek, ayın ilk vardiyasını kiracının
 * diliminde bir yana, sunucununkinde öbür yana düşürebilirdi. Dize
 * karşılaştırması gün sınırını TEK ve kararlı tutuyor.
 *
 * ⚠️ Sınır DÂHİL: kesim günü başlayan vardiya YENİ eksende.
 */
export function kmKesimSonrasiMi(
  startedAt: string,
  kesim: string
): boolean {
  return startedAt.slice(0, 10) >= kesim;
}

/**
 * Bir rapor aralığı kesimi KAPSIYOR ya da tamamen SONRASINDA mı?
 *
 * Dipnot yalnız bu durumda basılır. Tamamen kesim ÖNCESİNDE kalan bir rapor
 * (ör. Ağustos 2026) hiçbir şey değişmediği için dipnot da görmez — belge
 * bayt-bayt eskisiyle aynı kalmalı.
 */
export function kmDipnotGerekli(
  aralikBitisISO: string,
  kesim: string
): boolean {
  return aralikBitisISO.slice(0, 10) >= kesim;
}

/** CSV'nin `km_kaynak` kolonu — kesim öncesi satırlar ayrı bir değer taşır. */
export type KmRaporKaynak = KmKaynak | "sayac_eski";

/**
 * Rapor satırının km'si ve kaynağı — CSV ve PDF AYNI fonksiyondan okur.
 *
 * Kesim öncesi: `kmDiff` sonucu, kaynak `sayac_eski`. "sayac"tan ayrı bir
 * değer olması önemli: ikisi de sayaç farkı ama biri BUGÜNKÜ kuralın seçtiği,
 * diğeri ESKİ dönemin dondurulmuş davranışı. Tek değere toplamak, bir gün
 * kesim kalktığında "bu satır neden sayaçtı" sorusunu cevapsız bırakırdı.
 */
export function kmRaporDegeri(
  e: {
    started_at: string;
    start_km: number | null;
    end_km: number | null;
    km_measured?: boolean;
    km_karar?: { km: number | null; kaynak: KmKaynak };
  },
  kesim: string
): { km: number | null; kaynak: KmRaporKaynak } {
  if (!kmKesimSonrasiMi(e.started_at, kesim)) {
    // ESKİ DAVRANIŞ BİREBİR — `kmDiff`in kendisi (lib/format.ts) burada
    // KOPYALANMADI, kuralı satır içinde tekrar etmemek için aynı üç koşul:
    // km_measured=false → null · uçlardan biri null → null · aksi hâlde fark.
    if (e.km_measured === false) return { km: null, kaynak: "sayac_eski" };
    if (e.start_km === null || e.end_km === null) {
      return { km: null, kaynak: "sayac_eski" };
    }
    return { km: e.end_km - e.start_km, kaynak: "sayac_eski" };
  }
  // Kesim sonrası: çekirdeğin kararı. Karar iliştirilmemişse (eski çağıran)
  // sessizce sayaç eksenine düşmez — "bilinmiyor" der.
  if (!e.km_karar) return { km: null, kaynak: "bilinmiyor" };
  return { km: e.km_karar.km, kaynak: e.km_karar.kaynak };
}
