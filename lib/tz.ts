/**
 * SAAT DİLİMİ KATMANI — kiracı başına TEK KAYNAK (09.08.2026).
 *
 * ── NEDEN VAR ──────────────────────────────────────────────────────────────
 * Mobil uygulama saatleri CİHAZIN saat diliminde çiziyordu; panel ise
 * `Europe/Vienna`'yı kendi içinde sabitlemişti. Sonuç ölçüldü: panelde 06:17
 * görünen vardiya, UTC+3'teki bir telefonda 07:17 çıkıyordu — aynı olay, iki
 * ekranda iki farklı saat. Gün sınırı da kayıyordu: 372 vardiyanın geceyi aşan
 * sayısı cihaz dilimine göre 23, Viyana'ya göre 22 idi.
 *
 * Çözümün YANLIŞ yolu panelin sabitini mobile kopyalamaktı — bu ikinci bir
 * gerçek kaynağı üretir ve ikisi ilk fırsatta ayrışır. Doğru yol tek kaynak:
 * kiracı saat dilimini burada tanımlar, panel de mobil uç da BURADAN okur.
 *
 * ── DEĞİŞMEZLİK SÖZLEŞMESİ ─────────────────────────────────────────────────
 * Env tanımlı DEĞİLKEN üretilen değer `"Europe/Vienna"`dır — yani 09.08.2026
 * öncesinde 19 dosyada düz metin olarak yazılı olan dizenin BİREBİR kendisi.
 * HAK61, Sendigo ve galzura-demo üçü de Avusturya'da çalışıyor; üçüne de env
 * EKLENMEZ ve hiçbir sayı değişmez. `scripts/check-tenant-defaults.mjs` bunu
 * her `npm run verify`'da denetler.
 *
 * ── ⚠️ NEDEN NEXT_PUBLIC_ VE NEDEN DÜZ LİTERAL ─────────────────────────────
 * `lib/format.ts` bu değeri okuyor ve 65 dosyadan, bunların yirmisi İSTEMCİ
 * bileşeni olmak üzere içe aktarılıyor. Yani değerin tarayıcı paketine gömülmesi
 * ŞART → `NEXT_PUBLIC_` öneki zorunlu.
 *
 * Erişim ayrıca DÜZ LİTERAL olmak zorunda: Next/Turbopack yalnız
 * `process.env.X` yazımını derleme anında değerle değiştirir, `process.env[ad]`
 * dinamik erişimini değiştiremez ve tarayıcıda `undefined` bırakır. Bu tuzak
 * 03.08.2026'da Sendigo'nun canlı paketinde ölçüldü (bkz. lib/tenant.ts:27-39):
 * sunucu doğru okurken istemci sessizce varsayılana düşüyordu.
 *
 * ── NEDEN VERİTABANI DEĞİL ─────────────────────────────────────────────────
 * Kiracı ayarları bu projede zaten env katmanıdır (lib/brand.ts + lib/tenant.ts)
 * ve DB'de kiracı ayar tablosu yoktur — her kiracının AYRI veritabanı vardır.
 * Ayrıca `lib/format.ts`'in sınır fonksiyonları SENKRONDUR ve istemcide çalışır;
 * asenkron bir DB okuması onları besleyemezdi.
 *
 * ── TÜRKİYE MÜŞTERİSİ GELDİĞİNDE ───────────────────────────────────────────
 * `NEXT_PUBLIC_TENANT_TZ=Europe/Istanbul` tek satırdır ve panel + mobil aynı
 * anda döner. ⚠️ O kurulumun install SQL'indeki `at time zone 'Europe/Vienna'`
 * yazımları da (ifade indeksi + `report_coolant_daily`) o dilime çevrilmelidir.
 * Bugün ikisi de fiilen ölüdür: hiçbir canlı sorgu o ifadeyle filtrelemiyor ve
 * o RPC repoda çağrılmıyor — bu yüzden mevcut üç kurulumda DDL GEREKMEZ.
 */

/** Env'den gelen ham değer — doğrulanmamış. Yalnız tanı/muhafız için. */
const RAW = process.env.NEXT_PUBLIC_TENANT_TZ?.trim() || "";

/** 09.08.2026 öncesi 19 dosyada yazılı olan dize. Yedek DEĞİL, kayıt. */
export const DEFAULT_TZ = "Europe/Vienna";

/** IANA saat dilimi adı gerçekten çözülüyor mu? */
function gecerliMi(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/** Env verilmiş ama Intl onu çözemiyor mu? (`assertTenantConfig` patlatır.) */
export const TENANT_TZ_INVALID: boolean = RAW !== "" && !gecerliMi(RAW);

/**
 * KİRACININ SAAT DİLİMİ — panelin ve mobil ucun tek kaynağı.
 *
 * Geçersiz env varsayılana düşer: `Intl` bilinmeyen bir dilimde RangeError
 * atar ve bu, kullanıcının ekranını komple beyaza çevirirdi. Düşüş SESSİZ
 * değildir — sunucu açılışında `assertTenantConfig()` aynı durumu hata olarak
 * patlatır (lib/tenant.ts). Güvenli olan istemci, gürültülü olan sunucudur.
 */
export const TENANT_TZ: string = TENANT_TZ_INVALID || RAW === "" ? DEFAULT_TZ : RAW;
