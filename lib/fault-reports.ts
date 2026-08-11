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
 * Bildirimin alabileceği DURUMLAR — tek kaynak (migration 056 CHECK'iyle aynı küme).
 *
 * Ara durum ("islemde") BİLEREK yok (Volkan, 11.08.2026): onu değiştirecek bir
 * yüzey olmadan şemaya yazmak, olmayan bir iş akışını var sanmaya yol açar.
 * Küme burada yaşar; uç de muhafız da buradan okur, kimse kendi kopyasını yazmaz.
 */
export const ARIZA_DURUMLARI = ["acik", "kapali"] as const;
export type ArizaDurum = (typeof ARIZA_DURUMLARI)[number];

export type ArizaDurumSonucu =
  | { ok: true; durum: ArizaDurum }
  | { ok: false; kod: "missing_fields" | "invalid"; sebep?: "tip" | "deger" };

/**
 * Kapatma/yeniden açma ucunun gövdesindeki `durum`u ayıkla.
 *
 * TEK YÖNLÜ DEĞİL: `acik` da geçerli bir hedeftir. Yanlışlıkla kapatılan bir
 * bildirimi geri açmanın yolu olmasaydı, tek çözüm kaydı silmek olurdu —
 * yani bildirimin geçmişini yok etmek.
 *
 * Büyük/küçük harf ESNETİLMEZ: "Kapali" reddedilir ve geçerli küme yanıtta
 * söylenir. Sessizce düzeltmek istemcideki hatayı gizler; şema CHECK'i de
 * esnetmiyor, uç ondan gevşek olmamalı.
 */
export function arizaDurumunuAyikla(body: unknown): ArizaDurumSonucu {
  const input = (body ?? {}) as Record<string, unknown>;
  if (typeof input !== "object" || !("durum" in input)) {
    return { ok: false, kod: "missing_fields" };
  }
  const ham = input.durum;
  if (typeof ham !== "string") return { ok: false, kod: "invalid", sebep: "tip" };
  const durum = ham.trim();
  if (!(ARIZA_DURUMLARI as readonly string[]).includes(durum)) {
    return { ok: false, kod: "invalid", sebep: "deger" };
  }
  return { ok: true, durum: durum as ArizaDurum };
}

/**
 * Yazma hedefi olan tablo yok mu? (migration 056 uygulanmamış kurulum.)
 *
 * "Tablo yok" ile "yazma başarısız" AYNI ŞEY DEĞİL ve yöneticiye farklı iş
 * yaptırır (migration çalıştır / tekrar dene). Yakıt bloğundaki `rpc_yok`
 * ayrımıyla aynı gerekçe — 056 yeni kurulumların install SQL'inde YOK.
 */
/**
 * Sorgu, OLMAYAN BİR KOLONA mı takıldı? (migration 057 uygulanmamış kurulum.)
 *
 * `tabloYokMu`dan ayrı: tablo var ama kapatma izi kolonları (`closed_at`,
 * `closed_by`) yok demektir. O durumda uç ÇALIŞMAYA DEVAM EDER — yalnız durum
 * yazılır ve yanıt `kapatmaIzi:false` ile izin tutulmadığını söyler.
 * `readTokenVersion`in `token_version` için yaptığının aynısı (lib/mobile-auth.ts).
 */
export function kolonYokMu(error: { code?: string | null; message?: string | null }): boolean {
  const code = (error.code ?? "").toUpperCase();
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "42703" ||
    code === "PGRST204" ||
    (msg.includes("column") && (msg.includes("does not exist") || msg.includes("not find")))
  );
}

export function tabloYokMu(error: { code?: string | null; message?: string | null }): boolean {
  const code = (error.code ?? "").toUpperCase();
  const msg = (error.message ?? "").toLowerCase();
  /**
   * ⚠️ Çıplak "does not exist" YETMEZ — 11.08.2026'da muhafız yakaladı:
   * `column … does not exist` (42703) da o kalıba uyuyordu ve eksik KOLON
   * "tablo yok" diye raporlanıyordu. Yönetici 056'yı çalıştırmaya giderdi,
   * oysa eksik olan 057. Kalıp artık İLİŞKİ sözcüğünü arıyor.
   */
  if (kolonYokMu(error)) return false;
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (msg.includes("relation") && msg.includes("does not exist")) ||
    msg.includes("could not find the table")
  );
}
