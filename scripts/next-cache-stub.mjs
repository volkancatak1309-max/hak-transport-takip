/**
 * `next/cache` yerine geçen ASGARİ depo — yalnız canlı doğrulama betikleri için.
 *
 * NEDEN GEREKLİ: `revalidatePath()` Next'in istek kapsamı (static generation
 * store) dışında **fırlatır** — "Invariant: static generation store missing".
 * Sunucu eylemleri (`app/actions/**`) yazdıktan sonra bunu çağırıyor; stub
 * olmadan yazma yollarının HİÇBİRİ betikten ölçülemez.
 *
 * NEDEN KURGU DEĞİL: `revalidatePath` bir ÖNBELLEK işaretidir, iş kuralı değil.
 * Ne veritabanına dokunur ne de dönüş değeri okunur. Betikte no-op olması,
 * ölçülen davranışı hiçbir yerde değiştirmiyor — yalnızca tarayıcı olmadığı
 * için anlamsız olan bir yan etkiyi susturuyor.
 *
 * ⚠️ `unstable_cache` GEÇİŞLİ: sarmalanan fonksiyon aynen çağrılır. Önbelleği
 * taklit etmek, betikte bayat sonuç döndürerek ölçümü yalanlardı.
 */
export function revalidatePath() {}
export function revalidateTag() {}
export function unstable_cache(fn) {
  return fn;
}
export function unstable_noStore() {}
export const unstable_expirePath = () => {};
export const unstable_expireTag = () => {};
