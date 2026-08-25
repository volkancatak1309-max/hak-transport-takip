/**
 * SİLME SONUCU — "sil, olmazsa pasifleştir" kuralının tek kaynağı.
 *
 * ═══ NEDEN ÖNCEDEN KARAR VERMİYORUZ ═══
 *
 * Bir sözlük satırının silinip silinemeyeceği, ona bağlı GEÇMİŞ kayıt olup
 * olmadığına bağlıdır ve bu ancak veritabanına sorulunca bilinir. "Kullanımda
 * mı" diye ayrı bir sayım sorgusu atmak iki tur demektir ve iki tur arasında
 * durum değişebilir (bir şoför tam o anda belge ekleyebilir). Bu yüzden
 * DENENİR: FK ihlali (23503) dönerse satır kullanımdadır ve çağıran taraf
 * kullanıcıya PASİFLEŞTİRMEYİ önerir.
 *
 * Pasifleştirme geri alınabilir; silme değildir. Kullanıcının yanlış girdiği
 * bir değeri düzeltebilmesi için ikisinden biri HER ZAMAN açık olmalı —
 * bu ürünün kuralı (bkz. scripts/check-crud-ekranlari.mjs).
 */

/** PostgreSQL yabancı anahtar ihlali. */
const FK_VIOLATION = "23503";

export type SilmeSebebi =
  /** Şema yok (migration uygulanmamış). */
  | "tablo_yok"
  /** Satır BAŞKA kayıtlarca kullanılıyor → pasifleştirme önerilir. */
  | "kullanimda"
  /** Kural gereği silinemez (kanıta bağlı kayıt gibi) — gerekçe çağıranda. */
  | "silinemez"
  | "yok"
  | "hata";

export type SilmeSonucu =
  | { ok: true }
  | { ok: false; sebep: SilmeSebebi; mesaj?: string };

export function kullanimdaMi(e: { code?: string | null }): boolean {
  return e?.code === FK_VIOLATION;
}
