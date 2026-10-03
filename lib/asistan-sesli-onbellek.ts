import "server-only";

/**
 * SESLİ ASİSTAN — ARAÇ ÖNBELLEĞİ (Faz 1c, 03.10.2026).
 *
 * 03.10 Test 2: `aksiyon_merkezi` 3,2 sn, `sofor_skorlari` 3,8 sn sürdü; konuşmada bu,
 * cevaptan önce uzun bir sessizlik demek. Hedef < 1 sn. Bu modül üç şey yapar:
 *
 *  1) 60 SN BELLEK İÇİ ÖNBELLEK — anahtar KİRACI + KULLANICI + uç/sorgu. İki yönetici
 *     birbirinin önbelleğini görmez (kapsam uçtan geliyor, kişiye göre değişebilir).
 *  2) UÇUŞTAKİ İSTEĞİ PAYLAŞMA — ön ısıtma sürerken aynı soru gelirse ikinci bir
 *     hesap başlatılmaz, süren hesabın sonucu beklenir.
 *  3) HATA SAKLANMAZ — 403/503/zaman aşımı bir sonraki soruda yeniden denenir.
 *
 * ⚠️ SINIRLAR (bilinçli): bellek SÜREÇ başınadır. Vercel'de istek başka bir örneğe
 * düşerse önbellek boştur ve araç normal hızında çalışır — yanlış veri değil, yalnız
 * yavaş cevap. Paylaşılan önbellek (Redis vb.) ve kalıcı özet tabloları Faz 2 işi.
 * Veri en fazla 60 sn eskidir; araç sonucu `veriYasiSn` ile bunu söyler.
 */

export const ONBELLEK_OMRU_MS = 60_000;
const TAVAN = 300;

type Kayit = { an: number; deger: unknown };

const bellek = new Map<string, Kayit>();
const ucusta = new Map<string, Promise<unknown>>();

/** "taze" = bellekten · "ucusta" = süren hesabın sonucu · "yok" = şimdi hesaplandı. */
export type OnbellekDurumu = "taze" | "ucusta" | "yok";

export type OnbellekSonucu<T> = { deger: T; durum: OnbellekDurumu; yasMs: number };

function temizle(simdi: number) {
  for (const [k, v] of bellek) if (simdi - v.an >= ONBELLEK_OMRU_MS) bellek.delete(k);
  // Hâlâ doluysa en eskiler atılır (Map ekleme sırasını korur).
  while (bellek.size > TAVAN) {
    const ilk = bellek.keys().next().value;
    if (ilk === undefined) break;
    bellek.delete(ilk);
  }
}

/**
 * `anahtar` null ise önbellek KULLANILMAZ (kimliği bilinmeyen çağrı paylaşılmaz).
 * `saklanir` false dönerse sonuç saklanmaz (hata gövdeleri).
 * `enFazlaYasMs` (yalnız ön ısıtma): kayıt bundan yaşlıysa ömrü dolmamış olsa da
 * YENİDEN hesaplanır — tazeleme bitene kadar eski kayıt soruları cevaplamaya devam eder,
 * böylece görüşme boyunca önbellek hiç boşalmaz.
 */
export async function onbellekli<T>(
  anahtar: string | null,
  uret: () => Promise<T>,
  saklanir: (deger: T) => boolean,
  enFazlaYasMs: number = ONBELLEK_OMRU_MS
): Promise<OnbellekSonucu<T>> {
  if (!anahtar) return { deger: await uret(), durum: "yok", yasMs: 0 };

  const simdi = Date.now();
  const kayit = bellek.get(anahtar);
  if (kayit && simdi - kayit.an < Math.min(enFazlaYasMs, ONBELLEK_OMRU_MS)) {
    return { deger: kayit.deger as T, durum: "taze", yasMs: simdi - kayit.an };
  }

  const suren = ucusta.get(anahtar);
  if (suren) return { deger: (await suren) as T, durum: "ucusta", yasMs: 0 };

  const is = (async () => {
    const deger = await uret();
    if (saklanir(deger)) {
      temizle(Date.now());
      bellek.set(anahtar, { an: Date.now(), deger });
    }
    return deger;
  })();
  ucusta.set(anahtar, is);
  try {
    return { deger: await is, durum: "yok", yasMs: 0 };
  } finally {
    ucusta.delete(anahtar);
  }
}

/** Yalnız birim testleri için. */
export function onbellegiBosalt() {
  bellek.clear();
  ucusta.clear();
}
