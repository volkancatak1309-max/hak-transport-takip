import "server-only";

/**
 * SINIRLI FAN-OUT — "araç başına bir sorgu"yu kaç TANESİ aynı anda koşar?
 *
 * ═══ SORUN (canlıda ölçüldü, 09.08.2026, HAK61 üretim) ═══
 *
 * Yakıt raporu 30 aracın hepsini `Promise.all(vehicles.map(...))` ile AYNI ANDA
 * çağırıyordu. Duvar saati makul görünüyordu (5-7 sn) ama statement timeout
 * duvar saatine değil, TEK TEK İFADEYE uygulanır — ve eşzamanlılık her ifadenin
 * KENDİ süresini uzatır. Ölçüm (30 gün, 30 araç, aynı veriler):
 *
 *   eşzamanlılık   duvar saati   çağrı p50   EN KÖTÜ ÇAĞRI   8 sn'e pay
 *          30        7.683 ms     4.957 ms       7.683 ms       1,04×   ← kenar
 *          12        5.573 ms       927 ms       2.422 ms       3,3×
 *           8        5.469 ms       886 ms       1.924 ms       4,2×
 *           6        5.163 ms       679 ms       1.443 ms       5,5×   ← seçildi
 *           4        5.983 ms       515 ms       1.458 ms       5,5×
 *           2        7.824 ms       450 ms       1.001 ms       8,0×
 *
 * 30 eşzamanlıda en kötü ifade 7.683 ms, tavan 8.000 ms: pay %4. Soğuk cache'te
 * eklenen disk okuması bu payı yiyor — canlı turda 30 aracın 12'si 57014 aldı,
 * rapor 18 araçla açıldı ve EKSİK OLDUĞUNU SÖYLEMEDİ. Asıl kusur buydu.
 *
 * ═══ NEDEN 6 ═══
 *
 * Sınırlamak yavaşlatmıyor, HIZLANDIRIYOR: 6'da duvar saati 30'a göre %33 daha
 * kısa. Sebep, örnek sayısının değişmemesi (her turda 687.084 örnek / 52 dolum,
 * altı eşzamanlılık seviyesinde de birebir aynı): iş miktarı sabit, 30 ifade
 * birbirinin CPU'sunu bölüşüp hepsi birden yavaşlıyordu. 6, ölçülen en iyi
 * duvar saatini pay tavanıyla (5,5×) birlikte veren nokta. 4'te duvar saati
 * geri tırmanıyor, 12'de pay 3,3×'e iniyor.
 *
 * ═══ NEDEN KÜTÜPHANE DEĞİL ═══
 *
 * p-limit tek satırlık bir işi bağımlılık yapıyor. Buradaki havuz sırayı korur
 * (out[i] girdi sırasıyla eşleşir) ve hata yutmaz — çağıran `Promise.all` ile
 * aynı semantiği görür, tek fark eşzamanlılık tavanı.
 */
export const DB_FANOUT_LIMIT = 6;

/**
 * `items`in her elemanına `fn` uygular, aynı anda en fazla `limit` tanesi
 * uçuşta olacak şekilde. Sonuç dizisi GİRDİ SIRASINDADIR.
 *
 * `fn` hata fırlatırsa `Promise.all` gibi davranır: ilk hata dışarı çıkar.
 * Sorgu hatalarını satır olarak döndüren Supabase istemcisinde bu yol zaten
 * kullanılmaz — hata `{ error }` olarak döner ve çağıran sınıflandırır.
 *
 * Dönüş tipi `PromiseLike`: supabase-js'in sorgu kurucusu gerçek bir Promise
 * DEĞİL, thenable'dır (`.catch`/`.finally` yok). `await` ikisini de çözer, ama
 * imza `Promise` derse RPC çağrıları doğrudan geçirilemez.
 */
export async function mapBounded<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => PromiseLike<R>,
  limit: number = DB_FANOUT_LIMIT
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Bir Supabase yanıtının statement timeout (57014) olup olmadığı. */
export function isTimeoutError(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    (error.code ?? "") === "57014" ||
    msg.includes("statement timeout") ||
    msg.includes("canceling statement")
  );
}

/**
 * ZAMAN AŞIMINDA TEK SEFERLİK TEKRAR.
 *
 * NEDEN İŞE YARIYOR — zaman aşımı VERİYE değil, o anki BUFFER DURUMUNA bağlı.
 * Ölçüldü (09.08.2026, HAK61, shift_odometer_spans, 30 gün):
 *   1. çağrı (soğuk): 8.290 ms → 57014 TIMEOUT
 *   2. çağrı (sıcak): 1.198 ms → 373 vardiya
 * İlk çağrı sayfaları diske gidip getirir; ikincisi aynı sayfaları bellekte
 * bulur. Yani ilk çağrı BOŞA GİTMEZ, ısıtma turudur.
 *
 * NEDEN İKİ DEĞİL BİR TEKRAR: ikinci deneme de düşerse sorun geçici değildir
 * (aralık gerçekten çok geniş / instance yük altında) ve üçüncü deneme yalnız
 * kullanıcıyı 24 saniye bekletir. Bir tekrar, ölçülen kusuru kapatan en küçük
 * müdahaledir.
 *
 * YALNIZ zaman aşımında tekrar edilir. PGRST202 (migration yok) ya da başka bir
 * hata tekrar etmekle düzelmez; onları tekrarlamak arızayı gizlerdi.
 */
export async function retryOnTimeout<R extends { error: { code?: string | null; message?: string | null } | null }>(
  run: () => PromiseLike<R>
): Promise<R> {
  const first = await run();
  if (!isTimeoutError(first.error)) return first;
  return await run();
}
