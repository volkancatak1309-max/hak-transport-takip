/**
 * ORAN KÜMESİ — derleme anında zorlanan kural.
 *
 * ── KURAL ─────────────────────────────────────────────────────────────────
 * Bir oran hesaplanırken pay ve payda AYNI kümeden gelir. Küme, o an her iki
 * değeri de ÖLÇÜLMÜŞ kayıtlardır. Küme dinamiktir — araç sayısına, bakıma,
 * cihaz arızasına göre kendiliğinden değişir; hiçbir yere sabit sayı yazılmaz.
 *
 * ── NEDEN TİP, NEDEN MUHAFIZ YETMEDİ ──────────────────────────────────────
 * 31.08.2026'da CO₂ panosunda bulunan kusur şuydu: `kg` toplamı 24 araçtan,
 * `km` toplamı aynı listeden ama `?? 0` ile — km'si olmayan araç kg'sini paya
 * ekleyip paydaya 0 ekliyordu. **%6,7 şişik g/km.**
 *
 * `scripts/check-oran-kume.mjs` o kalıbı yakalıyor, ama kendi başlığında
 * yazdığı gibi bir boşluğu var: **pay ve paydayı iki AYRI filtreden alan kod
 * sözdizimsel olarak temiz görünür.**
 *
 *     const kgT = araclar.filter(a => a.kg !== null).reduce(…);   // ?? 0 YOK
 *     const kmT = araclar.filter(a => a.km !== null).reduce(…);   // ?? 0 YOK
 *     gPerKm(kgT, kmT)   // ← iki AYRI küme, muhafız göremez, sayı yanlış
 *
 * Bu dosya o boşluğu kapatır: toplam, geldiği kümenin **etiketini tipte
 * taşır**; `oran()` iki ucun etiketinin aynı olmasını şart koşar. Farklıysa
 * kod DERLENMEZ. Kusur gün/hafta/ay pencerelerinde hiç tetiklenmiyordu —
 * gözle ve testle bulunamayacak bir kalıp; derleyici yakalamalı.
 *
 * ── KULLANIM ──────────────────────────────────────────────────────────────
 *     const oranK = kume("kg+km", araclar.filter(a => a.kg !== null && a.km !== null));
 *     const gKm   = oran(topla(oranK, a => a.kg), topla(oranK, a => a.km));
 *
 * Etiket yalnız TİPTE yaşar; çalışma anında `Toplam<K>` sıradan bir `number`.
 * Ne ek nesne, ne ek ayırma, ne ölçülebilir maliyet.
 *
 * Ayrıntı ve canlı ölçüm: `docs/ORAN-KUME-KURALI.md`.
 */

declare const ETIKET: unique symbol;

/**
 * Bir kümeden türetilmiş toplam. `K` o kümenin etiketi.
 *
 * `number`ın kendisidir — aritmetikte, karşılaştırmada, JSON'da normal sayı
 * gibi davranır. Fark yalnız atama uyumluluğunda: `Toplam<"kg">` bir
 * `Toplam<"km">` bekleyen yere geçmez.
 */
export type Toplam<K extends string> = number & { readonly [ETIKET]: K };

/** Etiketli küme — filtrelenmiş kayıtlar, etiketiyle birlikte. */
export type Kume<K extends string, T> = {
  readonly etiket: K;
  readonly ogeler: readonly T[];
};

/**
 * Kümeyi etiketler. Etiket, kümeyi TANIMLAYAN koşulu anlatmalı
 * (`"kg"`, `"km"`, `"kg+km"`) — "hepsi", "liste" gibi adlar kuralı
 * anlamsızlaştırır çünkü iki farklı filtre aynı etiketi alabilir.
 */
export function kume<const K extends string, T>(
  etiket: K,
  ogeler: readonly T[]
): Kume<K, T> {
  return { etiket, ogeler };
}

/**
 * Kümenin toplamı. Boş kümede `null` — "0" DEĞİL, "ölçülemedi"
 * (bkz. `lib/km-quality.ts` dersi).
 *
 * İçerideki `?? 0` güvenlidir: küme ÇAĞRIDAN ÖNCE filtrelenmiştir, yani
 * `al()` burada `null` döndürüyorsa o kayıt zaten kümeye ait değildir.
 * Kuralın kendisi bu fonksiyonun DIŞINDA, `kume()` çağrısında uygulanır.
 */
// oran-kume: küme çağrıdan önce filtreleniyor; buradaki `?? 0` yalnız tür
// kapısıdır ve oran `oran()` tarafından etiket eşitliğiyle korunuyor.
export function topla<K extends string, T>(
  k: Kume<K, T>,
  al: (x: T) => number | null
): Toplam<K> | null {
  if (k.ogeler.length === 0) return null;
  let s = 0;
  for (const x of k.ogeler) s += al(x) ?? 0;
  return s as Toplam<K>;
}

/**
 * 🔴 Pay ve payda AYNI etiketten olmak ZORUNDA.
 *
 * `NoInfer` olmadan TypeScript `K`'yı iki argümandan birden çıkarsar ve
 * `"kg" | "km"` birleşimini kabul ederdi — kural sessizce delinirdi.
 * `NoInfer` ile `K` YALNIZ `pay`dan çıkarsanır, `payda` ona uymak zorunda
 * kalır. (TS 5.4+; bu depoda 5.9.3.)
 *
 * Payda 0 ya da uçlardan biri `null` ise sonuç `null` — sıfıra bölme ve
 * "0 oran" yerine dürüst bilinmezlik.
 */
export function oran<K extends string>(
  pay: Toplam<K> | null,
  payda: Toplam<NoInfer<K>> | null
): number | null {
  if (pay === null || payda === null || payda === 0) return null;
  return pay / payda;
}

/**
 * Ölçekli oran — `g/km`, `L/100km` gibi katsayılı oranlar için.
 * Aynı etiket kuralı geçerli; `carpan` yalnız birim çevirisidir.
 */
export function oranOlcekli<K extends string>(
  pay: Toplam<K> | null,
  payda: Toplam<NoInfer<K>> | null,
  carpan: number
): number | null {
  const o = oran(pay, payda);
  return o === null ? null : o * carpan;
}
