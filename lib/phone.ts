/**
 * Telefon numarası normalizasyonu — tek kaynak.
 *
 * 23.07.2026 olayı: Meltem Yıldırım ve Hamdi Kurubaş giriş yapamıyordu. Sebep,
 * workers.phone alanının Unicode yön işaretleriyle SARILMIŞ olmasıydı:
 * U+202A (LRE) + "+43…" + U+202C (PDF). Numara ekranda doğru görünüyor, ama
 * `eq("phone", "+436505381313")` sorgusu 0 kayıt döndürüyordu. Bu karakterler
 * numarayı iOS/Android kişi listesinden ya da Excel/WhatsApp'tan kopyalayıp
 * yapıştırınca gelir; eski normalizePhone yalnız boşluk/tire/parantez siliyordu.
 *
 * İkinci sorun: kayıtların 19/34'ü Avusturya ulusal trunk sıfırını taşıyor
 * (+430660… ), geri kalanı taşımıyor (+43660…). İkisi aynı numara. Şoför hangi
 * biçimi yazarsa yazsın girebilmeli — bu yüzden giriş varyantlarla aranır.
 */

/**
 * Görünmeyen ve biçimsel karakterleri atar: yön işaretleri (LRE/RLE/PDF/LRM/
 * RLM/izolatlar), sıfır genişlikli boşluklar, BOM, NBSP, her tür boşluk,
 * parantez, nokta, eğik çizgi ve tire benzeri tüm çizgiler (U+2010–2015, U+2212).
 * Geriye yalnız "+" ve rakamlar kalır.
 */
export function sanitizePhone(raw: string): string {
  return (raw ?? "")
    .normalize("NFKC")
    // Yön işaretleri (U+202A/U+202C…), sıfır genişlikli boşluklar, BOM, NBSP,
    // boşluk, tire, parantez, harf — hepsi bu tek adımda düşer. Bilerek beyaz
    // liste: yeni bir görünmez karakter türü çıkarsa da kendiliğinden elenir.
    .replace(/[^\d+]/g, "")
    .replace(/(?!^)\+/g, ""); // "+" yalnız başta anlamlı
}

/**
 * Kanonik biçim: sanitize + Avusturya ulusal trunk sıfırını at.
 * "+4306608110302" → "+436608110302", "06602005656" → "+436602005656".
 */
export function canonicalPhone(raw: string): string {
  let p = sanitizePhone(raw);
  if (/^00/.test(p)) p = "+" + p.slice(2); // 0043… → +43…
  if (/^0\d/.test(p)) p = "+43" + p.slice(1); // 0660… → +43660… (yerel yazım)
  p = p.replace(/^\+430(?=\d)/, "+43"); // +430660… → +43660…
  return p;
}

/**
 * Bir girdinin DB'de eşleşebileceği tüm makul biçimler — sıfırlı ve sıfırsız.
 * DB'de her iki biçim de bulunduğu için giriş sorgusu bunların hepsini dener.
 */
export function phoneVariants(raw: string): string[] {
  const sanitized = sanitizePhone(raw);
  const canonical = canonicalPhone(raw);
  const withTrunk = canonical.replace(/^\+43(?=\d)/, "+430");
  return [...new Set([sanitized, canonical, withTrunk].filter(Boolean))];
}
