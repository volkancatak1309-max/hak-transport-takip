/**
 * Telefon numarası normalizasyonu — tek kaynak.
 *
 * 23.07.2026 olayı: iki şoför giriş yapamıyordu. Sebep, workers.phone alanının
 * Unicode yön işaretleriyle SARILMIŞ olmasıydı: U+202A (LRE) + "+43…" + U+202C
 * (PDF). Numara ekranda doğru görünüyor, ama `eq("phone", "+436505381313")`
 * sorgusu 0 kayıt döndürüyordu. Bu karakterler numarayı iOS/Android kişi
 * listesinden ya da Excel/WhatsApp'tan kopyalayıp yapıştırınca gelir.
 *
 * ── İKİNCİ SORUN: ULUSAL TRUNK SIFIRI ──────────────────────────────────────
 * Kayıtların bir kısmı Avusturya ulusal trunk sıfırını taşıyor (+430660…),
 * kalanı taşımıyor (+43660…). İkisi AYNI numara; E.164'te doğrusu sıfırsız
 * olandır. 030_phone_sanitize.sql bu farkı BİLEREK düzeltmedi — o gün varyant
 * eşleştirmesi yeni kurulmuştu ve veriyi de aynı anda oynatmak riskliydi.
 * 075_phone_trunk_zero.sql onu kapatıyor.
 *
 * ── 22.08.2026: AVUSTURYA'YA GÖMÜLÜ DEĞİL, ÜLKE TABLOSUNA GÖRE ─────────────
 * Eski hâl üç yerde Avusturya varsayıyordu; canlı fonksiyonla ölçüldü:
 *   "05531234567"    (TR yerel) → "+435531234567"   ← YANLIŞ ülkeye çevirdi
 *   "+4901701234567" (DE trunk) → değişmedi          ← trunk sıfırı kaldı
 *   "+41079123456"   (CH trunk) → değişmedi          ← trunk sıfırı kaldı
 * Genel bir "ülke kodundan sonraki sıfırı at" kuralı ÇÖZÜM DEĞİL: İtalya'da
 * (+39) baştaki sıfır numaranın PARÇASIDIR, atılırsa numara bozulur. Bu yüzden
 * tablo AÇIK YAZILIR ve tabloda olmayan ülkeye DOKUNULMAZ (fail-safe: bilmediğin
 * numarayı bozma). Yeni ülke bir satır.
 */

/** Ülke kaydı: `cc` = ülke kodu, `trunkSifir` = E.164'te baştaki 0 düşer mi. */
type UlkeKurali = { readonly iso: string; readonly cc: string; readonly trunkSifir: boolean };

/**
 * Bilinen ülkeler. Sıralama önemsiz — arama en UZUN eşleşmeye göre yapılır
 * (aksi hâlde "+1…" ile "+41…" karışabilirdi).
 *
 * trunkSifir=true  → ulusal yazımda baştaki 0 vardır, E.164'te düşer.
 * trunkSifir=false → baştaki 0 (varsa) numaranın parçasıdır ya da ülkede
 *                    ulusal önek yoktur; DOKUNMA.
 */
const ULKE_TABLOSU: readonly UlkeKurali[] = [
  { iso: "AT", cc: "43", trunkSifir: true },
  { iso: "DE", cc: "49", trunkSifir: true },
  { iso: "CH", cc: "41", trunkSifir: true },
  { iso: "TR", cc: "90", trunkSifir: true },
  { iso: "GB", cc: "44", trunkSifir: true },
  { iso: "FR", cc: "33", trunkSifir: true },
  { iso: "NL", cc: "31", trunkSifir: true },
  { iso: "BE", cc: "32", trunkSifir: true },
  // Ulusal önek YOK ya da baştaki sıfır numaranın parçası. Bilerek listede:
  // "tabloda yoksa dokunma" kuralıyla aynı sonucu verseler de bu satırlar
  // kaydın kendisi — ileride birisi "hepsinden sıfırı at" demesin.
  { iso: "IT", cc: "39", trunkSifir: false },
  { iso: "ES", cc: "34", trunkSifir: false },
  { iso: "US", cc: "1", trunkSifir: false },
];

/** Tanınan ISO kodları — lib/tenant.ts kurulum denetiminde kullanır. */
export const BILINEN_ULKELER: readonly string[] = ULKE_TABLOSU.map((u) => u.iso);

/**
 * Yerel yazılmış numaranın (0660…, "+" yok) hangi ülkeye ait sayılacağı.
 *
 * ⚠️ ERİŞİM DÜZ LİTERAL — `process.env[ad]` DEĞİL. Next/Turbopack yalnız
 * literali derleme anında değerle değiştirir; dinamik erişim istemcide
 * `undefined` kalır ve ayar sessizce varsayılana düşer (03.08.2026'da Sendigo'da
 * ölçüldü, bkz. lib/tenant.ts başlığı). Varsayılan "AT" — 22.08.2026 öncesi
 * koda gömülü olan değerin birebir kendisi.
 */
export const VARSAYILAN_ULKE: string = (
  process.env.NEXT_PUBLIC_TENANT_DEFAULT_COUNTRY ?? "AT"
)
  .trim()
  .toUpperCase();

function ulkeKodundan(govde: string): UlkeKurali | undefined {
  let bulunan: UlkeKurali | undefined;
  for (const u of ULKE_TABLOSU) {
    if (govde.startsWith(u.cc) && (!bulunan || u.cc.length > bulunan.cc.length)) bulunan = u;
  }
  return bulunan;
}

function ulkeIsodan(iso: string): UlkeKurali | undefined {
  return ULKE_TABLOSU.find((u) => u.iso === iso);
}

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
 * Kanonik E.164 biçimi: sanitize + uluslararası önek düzeltmesi + ülkesine
 * göre ulusal trunk sıfırının atılması.
 *
 *   "+4306601113783" → "+436601113783"    (AT — trunk sıfırı düştü)
 *   "004906601113"   → "+496601113"       (00 → "+", sonra trunk)
 *   "06601113783"    → "+436601113783"    (yerel yazım → varsayılan ülke)
 *   "+390212345678"  → "+390212345678"    (İT — baştaki 0 numaranın parçası)
 *   "+12125550123"   → "+12125550123"     (trunk yok, dokunulmadı)
 *
 * Tabloda olmayan ülke kodları DEĞİŞMEDEN geçer.
 */
export function canonicalPhone(raw: string, iso: string = VARSAYILAN_ULKE): string {
  let p = sanitizePhone(raw);
  if (!p) return "";

  if (/^00\d/.test(p)) p = "+" + p.slice(2); // 0043… → +43…

  if (p.startsWith("+")) {
    const govde = p.slice(1);
    const u = ulkeKodundan(govde);
    if (!u || !u.trunkSifir) return p;
    // `> cc.length + 1`: "+430" gibi kırık bir girdide sıfırı atıp "+43"
    // üretmeyelim — ülke kodundan ibaret bir numara ortaya çıkardı.
    if (govde[u.cc.length] === "0" && govde.length > u.cc.length + 1) {
      return "+" + u.cc + govde.slice(u.cc.length + 1);
    }
    return p;
  }

  // "+" yok. Yalnız ulusal yazım (0 ile başlayan) ülkeye bağlanır; başka bir
  // rakam dizisi ne olduğu belirsizdir ve TAHMİN EDİLMEZ, olduğu gibi kalır.
  if (/^0\d/.test(p)) {
    const u = ulkeIsodan(iso);
    if (!u) return p;
    return u.trunkSifir ? "+" + u.cc + p.slice(1) : "+" + u.cc + p;
  }
  return p;
}

/** Kanonik numaranın ulusal trunk sıfırlı ikizi ("+43660…" → "+430660…"). */
function trunkGeriEkle(canonical: string): string {
  if (!canonical.startsWith("+")) return "";
  const govde = canonical.slice(1);
  const u = ulkeKodundan(govde);
  if (!u || !u.trunkSifir) return "";
  return "+" + u.cc + "0" + govde.slice(u.cc.length);
}

/**
 * Bir girdinin DB'de eşleşebileceği tüm makul biçimler.
 *
 * NEDEN 075 VERİYİ DÜZELTTİKTEN SONRA DA GEREKLİ: bu depo tek bir veritabanına
 * bakmıyor. Sendigo ve Galzura ayrı Supabase projeleri ve 075'in orada
 * çalıştırıldığı GARANTİ DEĞİL — service_role anahtarları Vercel'de "Sensitive"
 * olduğu için buradan ölçülemiyor bile. Varyant listesi kaldırılırsa geri
 * dolgu yapılmamış bir kiracıda TÜM ŞOFÖRLER kilitlenir. Liste kalıyor: yazma
 * tarafı kanonik üretir, okuma tarafı hoşgörülü kalır.
 *
 * ⚠️ ULUSAL BİÇİM ("0660…") BİLEREK LİSTEDE DEĞİL. Ülke kodu taşımadığı için
 * çapraz eşleşir: "+43664…" ve "+49664…" ikisi de "0664…"e iner, bir Avusturya
 * girişi bir Alman kaydını açabilirdi. Ülke kodlu iki biçim (sıfırlı/sıfırsız)
 * böyle bir belirsizlik taşımaz.
 */
export function phoneVariants(raw: string, iso: string = VARSAYILAN_ULKE): string[] {
  const sanitized = sanitizePhone(raw);
  const canonical = canonicalPhone(raw, iso);
  const withTrunk = trunkGeriEkle(canonical);
  return [...new Set([sanitized, canonical, withTrunk].filter(Boolean))];
}

/**
 * SAVUNMA KATMANI — arama/WhatsApp bağlantısı üretilirken son temizlik.
 *
 * Veriye güvenmiyoruz ve bu bilinçli: numara 075 öncesinden kalmış olabilir,
 * geri dolgu yapılmamış bir kiracıdan geliyor olabilir, ya da ileride yazma
 * tarafını atlayan bir içe aktarma eklenebilir. wa.me ülke kodundan sonraki
 * fazla sıfırı ÇÖZMEZ — "wa.me/4306601113783" boşa düşer. Bağlantı bu yüzden
 * ham alandan değil kanonik değerden üretilir.
 */
export function waHref(raw: string | null | undefined): string | null {
  const n = canonicalPhone(raw ?? "").replace(/\D/g, "");
  return n ? `https://wa.me/${n}` : null;
}

/** `tel:` şeması E.164'ü olduğu gibi alır — "+" KALIR, trunk sıfırı düşer. */
export function telHref(raw: string | null | undefined): string | null {
  const p = canonicalPhone(raw ?? "");
  return p ? `tel:${p}` : null;
}
