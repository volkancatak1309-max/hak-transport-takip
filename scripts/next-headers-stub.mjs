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
 */
const bosDepo = {
  get: () => undefined,
  getAll: () => [],
  has: () => false,
  set: () => {},
  delete: () => {},
  [Symbol.iterator]: function* () {},
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
