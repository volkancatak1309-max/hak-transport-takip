/**
 * FİLO YÖNETİMİ — saf kural katmanı (migration 059).
 *
 * `lib/action-snoozes.ts` ve `lib/fault-reports.ts` ile aynı gerekçeyle SAF:
 * `server-only` ve `supabaseAdmin` YOK, böylece `scripts/check-filo-yonetimi.mjs`
 * uçların GERÇEK ayıklama kurallarını Node'da, ağa çıkmadan çalıştırabiliyor.
 * Kurallar route.ts içine gömülseydi yalnız canlı istekle sınanabilirlerdi.
 */

/**
 * KİRACI BAŞINA EN FAZLA FİLO.
 *
 * ⚠️ TEK KAYNAK DEĞİL, İKİZİ VAR: migration 059'daki
 * `check (sort_order between 1 and 5)`. Tavanın asıl uygulayıcısı ŞEMADIR
 * (satır sayısını CHECK sayamaz; 1..5 aralığı + benzersizlik beşten fazla
 * satırı fiziksel olarak imkânsız kılar). Buradaki sabit yalnız kullanıcıya
 * DÜZGÜN BİR CEVAP vermek için: aksi hâlde altıncı filo denemesi 23514/23505
 * ham veritabanı hatasıyla "sunucu arızası" gibi görünürdü.
 * İkisinin ayrışmasını scripts/check-filo-yonetimi.mjs yakalar.
 */
export const FILO_TAVANI = 5;

/**
 * Filo adı üst sınırı — karakter.
 *
 * NEDEN ŞEMADA DEĞİL: sınır bir ÜRÜN kararıdır ve `text` kolona CHECK yazmak
 * her fikir değişikliğinde migration gerektirirdi (056'daki
 * ARIZA_ACIKLAMA_MAX ile birebir aynı gerekçe).
 * NEDEN 60: ad bir çipe/başlığa basılıyor, paragrafa değil. Bugünkü en uzun
 * ad "Bordo Filo" (10); 60 karakter altı katından fazlası.
 */
export const FILO_ADI_MAX = 60;

/**
 * 023/029 CHECK kısıtlarındaki kodlar — 059 ÖNCESİ evrenin tamamı.
 *
 * Tablo yokken uçlar filoları BU listeden türetir; sıraları da buradan gelir
 * (1=bordo, 2=mavi), yani migration'dan önce ve sonra liste AYNI sırada döner.
 * Migration bu iki kodu birebir aynı sırayla tohumluyor.
 */
export const LEGACY_FILO_KODLARI = ["bordo", "mavi"] as const;

/**
 * Tek istekte taşınabilecek en fazla kalem (araç ve personel için ayrı ayrı).
 *
 * NEDEN VAR: liste doğrudan PostgREST `.in(...)` filtresine giriyor; sınırsız
 * dizi hem URL'yi hem sorguyu şişirir. 200, HAK61'in tüm filosunun (30 araç,
 * 34 kişi) altı katından fazla — gerçek bir toplu taşımayı kısıtlamaz.
 */
export const ATAMA_LISTE_TAVANI = 200;

/**
 * Filonun sunucu ürettiği varsayılan adı.
 *
 * "N. Filo" — N filonun SIRASI, kaçıncı oluşturulduğu değil. Sıra benzersiz ve
 * kalıcı olduğu için ad da kararlıdır: aynı filo her istekte aynı adı alır ve
 * iki filo asla aynı varsayılan adı taşımaz.
 */
export function varsayilanFiloAdi(sira: number): string {
  return `${sira}. Filo`;
}

/**
 * Sıradan filo KODU üret — kodu istemci SEÇEMEZ.
 *
 * İlk iki sıra, veritabanında zaten yazılı olan eski kodlardır ('bordo',
 * 'mavi'); onları yeniden üretmek 30 araç satırının değişmeden kalmasını
 * garanti eder. 3-5 için `filo3`/`filo4`/`filo5`.
 *
 * NEDEN AD'DAN TÜRETİLMİYOR: "Kuzey Bölge" → "kuzey-bolge" gibi bir slug
 * Türkçe karakterde bozulur, çakışabilir ve AD DEĞİŞİNCE KOD ESKİR — oysa kod
 * 30 araç satırında yazılı ve değişmemesi gereken şey tam olarak odur.
 * Ad ile kod bilinçli olarak AYRI: 059 sonrası ad serbestçe değişir, kod asla.
 */
export function filoKoduUret(sira: number): string {
  return sira <= LEGACY_FILO_KODLARI.length
    ? LEGACY_FILO_KODLARI[sira - 1]
    : `filo${sira}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// AD AYIKLAMA (POST ve PATCH)
// ─────────────────────────────────────────────────────────────────────────────

export type FiloAdiSonucu =
  | { ok: true; ad: string | null }
  | {
      ok: false;
      kod: "missing_fields" | "invalid" | "too_long";
      alan: "ad";
      sebep?: "tip";
      uzunluk?: number;
    };

/**
 * Gövdedeki `ad`ı ayıkla. `null` dönmesi HATA DEĞİL: "varsayılana dön" demek.
 *
 * ── BOŞ AD = VARSAYILAN, RET DEĞİL ─────────────────────────────────────────
 * Ürün kuralı: "ad boşsa sunucu üretir". Bu kural İKİ uçta da aynı işler —
 * yeni filo adsız açılabilir (adı "3. Filo" olur) ve var olan filonun adı
 * boşaltılarak varsayılana DÖNDÜRÜLEBİLİR. `null` burada "adı sil" anlamına
 * gelir; sorgu katmanı `fleets.name = null` yazar ve görünen ad yeniden
 * türetilir (migration 059'un NULL gerekçesi).
 *
 * ── `zorunlu` NEDEN VAR ────────────────────────────────────────────────────
 * POST'ta `ad` alanı HİÇ gönderilmeyebilir (adsız filo aç). PATCH'te ise
 * gönderilmemesi bir kusurdur: yeniden adlandırma isteğinin tek yükü odur,
 * yoksa uç hiçbir şey yapmadan "tamam" derdi — sessiz hiçlik.
 */
export function filoAdiniAyikla(
  body: unknown,
  opts: { zorunlu: boolean }
): FiloAdiSonucu {
  const nesne =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;

  if (!nesne || !("ad" in nesne)) {
    if (opts.zorunlu) return { ok: false, kod: "missing_fields", alan: "ad" };
    return { ok: true, ad: null };
  }

  const ham = nesne.ad;
  // null AÇIKÇA "varsayılana dön" demek — tip hatası değil.
  if (ham === null) return { ok: true, ad: null };
  if (typeof ham !== "string") {
    return { ok: false, kod: "invalid", alan: "ad", sebep: "tip" };
  }

  const ad = ham.trim();
  // Baştaki/sondaki boşluk veri değil; "   " ile gönderilen ad boş addır.
  if (ad.length === 0) return { ok: true, ad: null };
  if (ad.length > FILO_ADI_MAX) {
    return { ok: false, kod: "too_long", alan: "ad", uzunluk: ad.length };
  }
  return { ok: true, ad };
}

// ─────────────────────────────────────────────────────────────────────────────
// ATAMA AYIKLAMA (araç / personel taşıma)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PostgreSQL'in kabul ettiği uuid şekli. Sürüm/varyant bitleri DENETLENMEZ
 * (veritabanı da denetlemiyor), yalnız şekil.
 *
 * ⚠️ BU DENETİM ŞART: uuid olmayan bir dize `.in("id", [...])` ile uuid
 * kolonuna giderse PostgreSQL 22P02 (`invalid input syntax for type uuid`)
 * fırlatır ve İSTEĞİN TAMAMI 503'e döner — yani bir bozuk kimlik, geçerli 20
 * aracın taşınmasını da engellerdi. Burada erken reddedilir ve HANGİ kimliğin
 * bozuk olduğu söylenir.
 */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type AtamaAlani = "aracIdleri" | "personelIdleri";

export type AtamaGirdiSonucu =
  | { ok: true; aracIdleri: string[]; personelIdleri: string[] }
  | {
      ok: false;
      kod: "missing_fields" | "invalid" | "too_long";
      alan: AtamaAlani | "govde";
      sebep?: "tip" | "deger";
      uzunluk?: number;
      /** Şekli bozuk kimliklerin ilk birkaçı — ekran hangisini düzelteceğini bilsin. */
      gecersiz?: string[];
    };

/** Bir kimlik listesini ayıkla: dizi mi, elemanlar dize mi, uuid şeklinde mi. */
function kimlikListesi(
  ham: unknown,
  alan: AtamaAlani
): { ok: true; idler: string[] } | Extract<AtamaGirdiSonucu, { ok: false }> {
  if (ham === undefined || ham === null) return { ok: true, idler: [] };
  if (!Array.isArray(ham)) {
    return { ok: false, kod: "invalid", alan, sebep: "tip" };
  }
  if (ham.length > ATAMA_LISTE_TAVANI) {
    return { ok: false, kod: "too_long", alan, uzunluk: ham.length };
  }
  if (ham.some((x) => typeof x !== "string")) {
    return { ok: false, kod: "invalid", alan, sebep: "tip" };
  }
  const dizeler = (ham as string[]).map((x) => x.trim());
  const bozuk = dizeler.filter((x) => !UUID.test(x));
  if (bozuk.length > 0) {
    return {
      ok: false,
      kod: "invalid",
      alan,
      sebep: "deger",
      gecersiz: bozuk.slice(0, 5),
    };
  }
  // Tekilleştirme SIRAYI KORUR: yanıt istemcinin gönderdiği düzende okunur.
  // Aynı kimliğin iki kez gelmesi hata değil (çoklu seçim arayüzünde olağan).
  return { ok: true, idler: [...new Set(dizeler)] };
}

/**
 * `{ aracIdleri?: string[], personelIdleri?: string[] }` gövdesini ayıkla.
 *
 * ── İKİSİ DE BOŞSA RET ─────────────────────────────────────────────────────
 * Taşınacak hiçbir şey olmayan istek 400 alır. 200 dönseydi ekran "taşındı"
 * derdi ve hiçbir şey olmamış olurdu — sessiz hiçlik. Alanın hiç gönderilmemiş
 * olmasıyla boş dizi gönderilmiş olması arasında fark GÖZETİLMEZ: ikisinin de
 * sonucu "yapılacak iş yok".
 */
export function atamaGirdisiniAyikla(body: unknown): AtamaGirdiSonucu {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, kod: "missing_fields", alan: "govde" };
  }
  const input = body as Record<string, unknown>;

  const arac = kimlikListesi(input.aracIdleri, "aracIdleri");
  if (!arac.ok) return arac;
  const personel = kimlikListesi(input.personelIdleri, "personelIdleri");
  if (!personel.ok) return personel;

  if (arac.idler.length === 0 && personel.idler.length === 0) {
    return { ok: false, kod: "missing_fields", alan: "govde" };
  }
  return { ok: true, aracIdleri: arac.idler, personelIdleri: personel.idler };
}
