/**
 * ELLE ARIZA BİLDİRİMİ — saf doğrulama katmanı (migration 056).
 *
 * `lib/vehicle-day.ts` ile aynı gerekçeyle SAF: `server-only` ve `supabaseAdmin`
 * yok, böylece `scripts/check-ariza-bildir.mjs` ucun GERÇEK ayıklama kurallarını
 * Node'da çalıştırabiliyor. Kurallar route.ts içine gömülseydi yalnız canlı
 * istekle sınanabilirlerdi.
 */

/**
 * `aciklama` üst sınırı — karakter.
 *
 * NEDEN ŞEMADA DEĞİL: sınır bir ÜRÜN kararıdır. `text` kolonuna CHECK yazmak
 * her fikir değişikliğinde migration gerektirirdi; burada tek satır.
 * NEDEN 2000: bildirimi yazan telefon klavyesinde bir insan. 2000 karakter
 * yaklaşık bir sayfa serbest metin — hiçbir gerçek arıza tarifi buna sığmaz
 * denecek kadar geniş, ama gövdeyi silah hâline getirecek kadar da değil.
 */
export const ARIZA_ACIKLAMA_MAX = 2000;

export type ArizaGirdiSonucu =
  | { ok: true; aciklama: string }
  | { ok: false; kod: "missing_fields" | "invalid" | "too_long"; sebep?: "bos" | "tip"; uzunluk?: number };

/**
 * Gövdedeki `aciklama`yı ayıkla.
 *
 * ── ÜÇ RET AYRI ŞEY ────────────────────────────────────────────────────────
 * `missing_fields` alan hiç gönderilmedi · `invalid` gönderildi ama kullanılamaz
 * (yanlış tip ya da yalnız boşluk) · `too_long` geçerli ama sınırın üstünde.
 * Tek bir "geçersiz" cevabı ekranı "ne yazsam kabul etmiyor" hâline sokardı;
 * `sebep` ve `uzunluk` ekranın DOĞRU cümleyi kurmasını sağlar.
 *
 * TRIM EDİLMİŞ metin döner: baştaki/sondaki boşluk veri değildir ve "   " ile
 * gönderilen bir bildirim boş bildirimdir.
 */
export function arizaAciklamasiniAyikla(body: unknown): ArizaGirdiSonucu {
  const input = (body ?? {}) as Record<string, unknown>;
  if (typeof input !== "object" || !("aciklama" in input)) {
    return { ok: false, kod: "missing_fields" };
  }
  const ham = input.aciklama;
  if (typeof ham !== "string") return { ok: false, kod: "invalid", sebep: "tip" };
  const aciklama = ham.trim();
  if (aciklama.length === 0) return { ok: false, kod: "invalid", sebep: "bos" };
  if (aciklama.length > ARIZA_ACIKLAMA_MAX) {
    return { ok: false, kod: "too_long", uzunluk: aciklama.length };
  }
  return { ok: true, aciklama };
}

/**
 * Yazma hedefi olan tablo yok mu? (migration 056 uygulanmamış kurulum.)
 *
 * "Tablo yok" ile "yazma başarısız" AYNI ŞEY DEĞİL ve yöneticiye farklı iş
 * yaptırır (migration çalıştır / tekrar dene). Yakıt bloğundaki `rpc_yok`
 * ayrımıyla aynı gerekçe — 056 yeni kurulumların install SQL'inde YOK.
 */
export function tabloYokMu(error: { code?: string | null; message?: string | null }): boolean {
  const code = (error.code ?? "").toUpperCase();
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("could not find the table")
  );
}
