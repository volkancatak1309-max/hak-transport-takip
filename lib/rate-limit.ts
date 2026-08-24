import "server-only";

/**
 * YOKLAMA HIZ SINIRI — süreç içi kayan pencere.
 *
 * ═══ NEDEN VERİTABANI DEĞİL ═══
 *
 * Sınırlanacak şey OKUMA yoluysa, sayacı veritabanına yazmak okumayı yazmaya
 * çevirir: dakikada bir yoklayan 200 müşteri = dakikada 200 UPDATE. Sınırın
 * amacı sunucuyu korumaktı; çözüm yükü artırmamalı.
 *
 * ═══ NE KORUR, NE KORUMAZ — AÇIKÇA ═══
 *
 * KORUR: link bir gruba yayıldığında ya da bir sekme saniyede bir yoklamaya
 * başladığında tek bir kaynağın (token/IP) sunucuyu meşgul etmesini.
 *
 * KORUMAZ: dağıtık bir saldırıyı. Sayaç SÜREÇ İÇİNDEDİR; sunucusuz ortamda
 * her örnek kendi sayacını tutar ve soğuk başlangıçta sıfırlanır. Bu bir eksik
 * değil, seçim: gerçek DDoS koruması platform katmanının işi (Vercel WAF),
 * uygulama katmanının işi kendi yolunu makul tutmak.
 *
 * ⚠️ Bu yüzden sınır TEK BAŞINA savunma değil. Girişsiz sayfanın asıl koruması
 * verinin AZLIĞI: token doğru olsa bile dönen şey konum + ETA + durumdan
 * ibarettir.
 */

type Kova = {
  /** Pencere içindeki istek anları (epoch ms), eskiden yeniye. */
  anlar: number[];
};

const kovalar = new Map<string, Kova>();

/** Kovaların sonsuza dek büyümemesi için: bu sayıyı aşınca eskiler atılır. */
const MAX_ANAHTAR = 5000;

export type SinirSonuc = {
  ok: boolean;
  /** Pencerede kalan hak (ok=false ise 0). */
  kalan: number;
  /** Kaç saniye sonra tekrar denenebilir (ok=true ise 0). */
  tekrarSn: number;
};

/**
 * Kayan pencere denetimi.
 *
 * @param anahtar  Sınırın uygulanacağı kimlik — token, IP ya da ikisi.
 * @param tavan    Pencere başına izin verilen istek sayısı.
 * @param pencereSn Pencere uzunluğu (saniye).
 */
export function sinirDenetle(
  anahtar: string,
  tavan: number,
  pencereSn: number,
  simdi = Date.now()
): SinirSonuc {
  const pencereMs = pencereSn * 1000;
  let kova = kovalar.get(anahtar);
  if (!kova) {
    // Tavan aşıldıysa en eski anahtarları at: bellek sızıntısı olmasın.
    if (kovalar.size >= MAX_ANAHTAR) {
      const silinecek = Math.ceil(MAX_ANAHTAR / 10);
      let i = 0;
      for (const k of kovalar.keys()) {
        kovalar.delete(k);
        if (++i >= silinecek) break;
      }
    }
    kova = { anlar: [] };
    kovalar.set(anahtar, kova);
  }

  // Pencerenin dışında kalanları düşür.
  const sinir = simdi - pencereMs;
  while (kova.anlar.length > 0 && kova.anlar[0] <= sinir) kova.anlar.shift();

  if (kova.anlar.length >= tavan) {
    const enEski = kova.anlar[0];
    return {
      ok: false,
      kalan: 0,
      tekrarSn: Math.max(1, Math.ceil((enEski + pencereMs - simdi) / 1000)),
    };
  }

  kova.anlar.push(simdi);
  return { ok: true, kalan: tavan - kova.anlar.length, tekrarSn: 0 };
}

/** Sınama için: sayaçları sıfırla. Üretim yolunda çağrılmaz. */
export function sinirSifirla(): void {
  kovalar.clear();
}
