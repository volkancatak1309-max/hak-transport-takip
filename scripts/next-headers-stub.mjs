/**
 * `next/headers` yerine geçen ASGARİ depo — yalnız canlı doğrulama betikleri için.
 *
 * NEDEN GERÇEK MODÜL DEĞİL: `cookies()` Next'in istek kapsamı (AsyncLocalStorage)
 * dışında fırlatır. Mobil uçların zinciri `i18n/request.ts` üzerinden `cookies()`e
 * uğruyor (`fleetLabeller` → `getTranslations`).
 *
 * NEDEN KURGU DEĞİL: mobil istemcinin `hak_locale` ÇEREZİ ZATEN YOK — token
 * taşıyor, çerez taşımıyor. Boş çerez deposu, üretimde o uçların gördüğü
 * durumun BİREBİR kendisidir; dil de bu yüzden kurulum varsayılanına düşer
 * (lib/mobile-user.ts ile aynı gerekçe).
 *
 * ── `QA_SESSION_COOKIE` — PANEL/ŞOFÖR EYLEMLERİNİ SINAMAK İÇİN ────────────
 * Sunucu eylemleri (`app/actions/**`) çerezden okunan iron-session'a bağlı;
 * boş depoyla hepsi giriş sayfasına yönlenir ve o katman HİÇ ölçülemez.
 * Bu değişken VERİLİRSE depo yalnız `hak_session` çerezini döndürür — mühür
 * gerçek `SESSION_PASSWORD` ile üretilir, yani kapıların kendisi ATLANMAZ,
 * yalnız tarayıcının taşıdığı çerez yerine konur.
 * ⚠️ Varsayılan DEĞİŞMEDİ: değişken yoksa depo eskisi gibi BOŞTUR ve mevcut
 * doğrulama betikleri aynen çalışır.
 */
// ⚠️ ÇAĞRI ANINDA okunuyor, modül yüklenirken DEĞİL: tek bir betik hem
// yönetici hem şoför kimliğiyle sınama yapabilsin (kimlik değişince iki ayrı
// süreç başlatmak gerekmesin).
const cerezler = () => {
  const m = process.env.QA_SESSION_COOKIE ?? "";
  return m ? [{ name: "hak_session", value: m }] : [];
};
const bosDepo = {
  get: (ad) => cerezler().find((c) => c.name === ad),
  getAll: () => cerezler(),
  has: (ad) => cerezler().some((c) => c.name === ad),
  set: () => {},
  delete: () => {},
  [Symbol.iterator]: function* () {
    yield* cerezler();
  },
};
export async function cookies() {
  return bosDepo;
}
export async function headers() {
  return new Headers();
}
export async function draftMode() {
  return { isEnabled: false, enable() {}, disable() {} };
}
