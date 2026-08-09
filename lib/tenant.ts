/**
 * KURULUM MODU KATMANI — müşteri başına davranış ayarları (31.07.2026).
 *
 * `lib/brand.ts` uygulamanın nasıl GÖRÜNDÜĞÜNÜ, bu dosya nasıl ÇALIŞTIĞINI
 * belirler. İkisi ayrı: marka değişimi risksizdir, davranış değişimi değildir.
 *
 * ── DEĞİŞMEZLİK SÖZLEŞMESİ ─────────────────────────────────────────────────
 * Her ayarın varsayılanı, 31.07.2026 öncesindeki HAK61 sabitinin BİREBİR
 * kendisidir. Env tanımlı değilken bu modül bugünkü davranışı üretir; HAK61
 * Vercel projesine tek bir env eklenmez. `scripts/check-tenant-defaults.mjs`
 * her varsayılanı kayıt altına alınmış eski değerle karşılaştırır ve kayarsa
 * `npm run verify`'ı kırar. Sabit koddan kalkarken DEĞERİ değil yalnız
 * KAYNAĞI değişir.
 *
 * ── NEDEN NEXT_PUBLIC_ ─────────────────────────────────────────────────────
 * İstemciye ulaşan her ayar `NEXT_PUBLIC_` önekiyle okunur. Öneksiz env
 * tarayıcıda `undefined`'dır; o durumda ayar sessizce varsayılana düşer ve
 * "Sendigo'da kapalı olması gereken modül şoförün ekranında açılır" biçiminde,
 * yalnız üretimde görünen bir hata doğardı. Yalnız SUNUCUDA okunanlar
 * (vardiya otomatı, FLEET_EPOCH) öneksizdir.
 *
 * ── SUNUCU SON SÖZÜ SÖYLER ─────────────────────────────────────────────────
 * Bayraklar görünürlüğü kapatır; kapatılan modülün sunucu eylemleri de aynı
 * bayrağı kontrol eder (mevcut `LEAVES_ENABLED` deseni). Menüden link
 * kaldırmak yetki değildir.
 *
 * ── ⚠️ HER ERİŞİM DÜZ LİTERAL OLMAK ZORUNDA ────────────────────────────────
 * Next/Turbopack `process.env.X` ifadesini derleme anında METİN olarak
 * değiştirir; `process.env[ifade]` gibi DİNAMİK bir erişimi değiştiremez ve
 * istemcide `undefined` kalır. Bu yüzden aşağıdaki yardımcılara env ADI
 * GEÇİLMEZ — çağrı yerinde düz literal okunur, fonksiyona hazır DEĞER verilir.
 * Aynı kural lib/report-de.ts:56-60'ta da yazılıdır.
 *
 * 03.08.2026'da ölçüldü: bu dosya dinamik okuyordu ve Sendigo'nun canlı
 * paketinde `r("NEXT_PUBLIC_PACKAGES_ENABLED",!0)` biçiminde duruyordu — ad
 * dize olarak kalmış, değer gömülmemişti. Sonuç: SUNUCU env'i doğru okuyor,
 * İSTEMCİ varsayılana düşüyordu (paket sayacı kapatılamadı; DRIVER_PANEL,
 * LENKZEIT_WARNING ve SAFETY_SCORE_CALIBRATED de istemcide takılı kaldı).
 * `scripts/check-tenant-defaults.mjs` artık bu imzayı build çıktısında arar.
 */

import { TENANT } from "@/lib/brand";
import { TENANT_TZ, TENANT_TZ_INVALID } from "@/lib/tz";

/** "true"/"1"/"yes" → true, "false"/"0"/"no" → false, tanımsız → varsayılan. */
function envBool(value: string | undefined, fallback: boolean): boolean {
  const raw = value?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return fallback;
}

function envInt(value: string | undefined, fallback: number): number {
  const n = Number(value?.trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/** Ondalıklı pozitif sayı (envInt'in yuvarlamayan ikizi — fiyat için şart). */
function envNum(value: string | undefined, fallback: number): number {
  const n = Number(value?.trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * YAKIT LİTRE FİYATI (EUR) — "Toplam tüketim" kartının parasal karşılığı.
 *
 * Varsayılan 2,051 = Avusturya dizel ortalaması 27.07.2026 (WKO/FVMI). Bu bir
 * PİYASA ortalamasıdır; filo kartıyla akaryakıt alan müşteri kendi anlaşmalı
 * fiyatını FUEL_PRICE_EUR_PER_L ile geçer ve tüm tenant'larda (HAK61, Sendigo,
 * galzura-demo) aynı hesap çalışır.
 *
 * Sunucu tarafı env — bilinçli olarak NEXT_PUBLIC_ DEĞİL: fiyat sunucuda
 * çarpılıp sonuç prop olarak iniyor. `process.env[name]` dinamik erişimi
 * istemci paketine gömülmüyor (03.08 ölçümü), o tuzağa hiç girmiyoruz.
 */
export const FUEL_PRICE_EUR_PER_L = envNum(
  process.env.FUEL_PRICE_EUR_PER_L,
  2.051
);

/** Varsayılan fiyatın kaynağı — ekrandaki küçük notta gösterilir. */
export const FUEL_PRICE_SOURCE = "WKO/FVMI";
/** Varsayılan fiyatın ölçüm tarihi (ISO) — notta gösterilir. */
export const FUEL_PRICE_AS_OF = "2026-07-27";
/** Fiyat env'den mi geldi (true) yoksa varsayılan mı (false)? Not metnini seçer. */
export const FUEL_PRICE_IS_CUSTOM =
  Number.isFinite(Number(process.env.FUEL_PRICE_EUR_PER_L?.trim())) &&
  Number(process.env.FUEL_PRICE_EUR_PER_L?.trim()) > 0;

/**
 * PUAN EŞİĞİ: ÇALIŞILAN GÜNE GÖRE Mİ? (09.08.2026) — VARSAYILAN KAPALI.
 *
 * Açıkken eşik = 40 km × şoförün o aralıkta çalıştığı gün; kapalıyken eski
 * davranış (odometre penceresi / takvim günü).
 *
 * NEDEN KAPALI DOĞDU: ölçüm, eşiği tek başına gevşetmenin skorları ŞİŞİRDİĞİNİ
 * gösterdi — km hâlâ aralığın uçlarından geliyordu, yani 1 gün çalışan şoför
 * aracın 30 günlük km'siyle 40 km'lik çıtaya karşı değerlendiriliyordu
 * (Mustafa Karakoç 809 km / 1 gün). Kök sorun migration 052 +
 * shift_odometer_spans ile kapandıktan ve yeniden ölçüldükten SONRA açılacak.
 *
 * ═══ AÇILDI — 09.08.2026, İKİ ÖN KOŞUL DA SAĞLANDIKTAN SONRA ═══
 *
 * 1) KM DÜZELDİ (052): km artık yalnız fiilen sürülen vardiyadan geliyor.
 *    Ölçüldü: 25/28 şoförün km'si küçüldü (ort. −%53); Mustafa Karakoç
 *    809→32, Bayram Çöymen 917→50. Şişirme kaynağı kesildi.
 * 2) MUTLAK TABAN EKLENDİ (SCORE_MIN_KM_FLOOR = 300 km): ilk ölçümde bayrak
 *    tek başına açılınca liste 4→10 büyüyor ama ORTALAMA SKOR 20→15 düşüyordu
 *    — yeni girenlerin paydası küçük olduğu için tek bir sert fren skoru
 *    uçuruyordu (Ekrem Gyuler 159 km / 3 gün → 5 puan). Taban o kapıyı kapattı.
 *
 * Eşik artık: max(300 km, 40 km × çalışılan gün). Env ile hâlâ kapatılabilir.
 */
export const SCORE_THRESHOLD_WORKED_DAYS = envBool(
  process.env.SCORE_THRESHOLD_WORKED_DAYS,
  true
);

function envEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  const raw = value?.trim().toLowerCase() as T | undefined;
  return raw && allowed.includes(raw) ? raw : fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODÜL BAYRAKLARI
// Varsayılanlar 21.07.2026'da Volkan'ın verdiği kararların aynısı (eski
// lib/features.ts): HAK61 yakıt/masraf/bakım kullanmıyor, izin takvimi açık.
// ─────────────────────────────────────────────────────────────────────────────

/** Yakıt modülü (/admin/yakit, /panel/yakit). */
export const FUEL_ENABLED = envBool(process.env.NEXT_PUBLIC_FUEL_ENABLED, false);
/** Masraf modülü (/admin/masraflar, /panel/masraflar). */
export const EXPENSE_ENABLED = envBool(process.env.NEXT_PUBLIC_EXPENSE_ENABLED, false);
/** Bakım modülü (yakıt sayfasını paylaşır). */
export const MAINTENANCE_ENABLED = envBool(
  process.env.NEXT_PUBLIC_MAINTENANCE_ENABLED,
  false
);
/**
 * İzin takvimi (/admin/izinler). ⚠️ AÇMADAN ÖNCE migration 031 çalıştırılmış
 * olmalı — tablo yoksa okuma boş döner ama YAZMA hata verir.
 */
export const LEAVES_ENABLED = envBool(process.env.NEXT_PUBLIC_LEAVES_ENABLED, true);

// ─────────────────────────────────────────────────────────────────────────────
// KURULUM MODU
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ŞOFÖR PANELİ (/panel/*).
 *
 * Kapalıyken: şoför rotaları /admin'e yönlenir, giriş yalnız yöneticiye açıktır
 * ve üst çubukta şoför menüsü çıkmaz. Sendigo'da kimse telefondan girmiyor —
 * takip tamamen araç ekseninde.
 *
 * ⚠️ Kapalıyken vardiyayı BAŞLATIP BİTİRECEK bir insan kalmaz; bu yüzden
 * SHIFT_AUTO_END açık olmak ZORUNDADIR (aşağıda fail-closed doğrulanır).
 */
export const DRIVER_PANEL_ENABLED = envBool(
  process.env.NEXT_PUBLIC_DRIVER_PANEL_ENABLED,
  true
);

/**
 * YÖNETİCİ ÜST ÇUBUĞUNDA "ŞOFÖR PANELİ" GEÇİŞİ (03.08.2026)
 *
 * Kapalı (VARSAYILAN = HAK61'in bugünkü hâli): yönetici üst çubuğunda böyle bir
 * buton YOKTUR. HAK61'de yöneticiler direksiyona geçmiyor — canlı ölçüm: üç
 * yönetici hesabının ikisinde 0 vardiya, üçüncüsündeki 2 satır 2026 Mayıs/
 * Haziran'dan kalma demo kayıtları (biri 2 dakikada 20.000 km).
 *
 * Açık: yöneticinin hesabı aynı zamanda ŞOFÖR hesabı olan müşteride (Sendigo —
 * Gökhan hem yönetici hem sürücü) yönetim ve panel arasında tek dokunuşla
 * gidilir. Filo şefinin migration 029'dan beri kullandığı geçişin AYNISIDIR,
 * yalnız kime görüneceği genişler.
 *
 * ⚠️ Bu ayar yalnız BAĞLANTIYI gösterir. Yöneticinin açtığı vardiyanın şoför
 * metriklerinden elenmesi (lib/driver-scope.ts) DEĞİŞMEZ ve bu ayara bağlı
 * değildir — o ayrı bir karardır.
 */
export const ADMIN_DRIVER_PANEL_LINK = envBool(
  process.env.NEXT_PUBLIC_ADMIN_DRIVER_PANEL_LINK,
  false
);

export type DriverVehicleChoice = "assigned" | "free";

/**
 * ŞOFÖR VARDİYAYI HANGİ ARAÇLA AÇAR? (03.08.2026)
 *
 *  • `assigned` — HAK61'in BUGÜNKÜ davranışı ve VARSAYILAN. Vardiya, şoförün
 *    kalıcı olarak atandığı araçla (vehicles.assigned_worker_id) açılır.
 *    Başlat butonu ve "başka araç" seçicisi yalnız atanmış araç VARSA görünür;
 *    ataması olmayan şoför bekleme ekranında "aracın atanmamış" uyarısını görür.
 *
 *  • `free` — araç↔şoför SABİT ATAMASI OLMAYAN filo (Sendigo). Aynı aracı gece
 *    ve gündüz farklı şoförler kullanıyor, dolayısıyla kalıcı atama yok:
 *    vardiyayı açan kişi plakayı O AN seçer. Seçim yalnız o vardiya için
 *    geçerlidir (time_entries.vehicle_id); kalıcı atama YAZILMAZ.
 *
 * Sunucu tarafı iki modda da AYNI: startShiftManualAction zaten override araç
 * kabul ediyor ve atanmış araç yoksa override ile açabiliyor. Bu ayar yalnız
 * ŞOFÖRE NE GÖSTERİLDİĞİNİ belirler — yeni bir yazma yolu açmaz.
 */
export const DRIVER_VEHICLE_CHOICE: DriverVehicleChoice = envEnum(
  process.env.NEXT_PUBLIC_DRIVER_VEHICLE_CHOICE,
  ["assigned", "free"] as const,
  "assigned"
);

/**
 * PAKET SAYACI (alınan / teslim edilen / teslim edilemeyen).
 *
 * HAK61 paket dağıtımı yapıyor ve vardiya kapanışının çekirdeği bu üç sayıdır.
 * Sendigo ilaç lojistiği: sevkiyat paket adediyle ölçülmüyor. Kapalıyken
 * kapanış formundaki alanlar, yönetici düzenleme dialogundaki karşılıkları ve
 * PDF/rapor sütunları görünmez; VERİ MODELİ AYNEN DURUR (kolonlar silinmez,
 * geçmiş kayıtlar okunabilir kalır).
 */
export const PACKAGES_ENABLED = envBool(
  process.env.NEXT_PUBLIC_PACKAGES_ENABLED,
  true
);

/**
 * LENKZEIT UYARISI (4 sa ön uyarı / 4,5 sa zorunlu mola, VO (EG) 561/2006).
 *
 * lib/azg-rules.ts'e göre 2,5 t altı, sınır geçmeyen filoda AB sürüş-dinlenme
 * tüzüğü UYGULANMAZ — yani bu uyarı hukuken gereksiz. Yine de HAK61'de AÇIK
 * bırakıldı (Volkan, 31.07.2026): şoförler bu uyarıya alışkın ve kaldırmak
 * "HAK61'e dokunma" kuralının istisnası olurdu. Sendigo'da kapalı.
 */
export const LENKZEIT_WARNING_ENABLED = envBool(
  process.env.NEXT_PUBLIC_LENKZEIT_WARNING_ENABLED,
  true
);

/**
 * GÜVENLİK SKORU KALİBRASYONU.
 *
 * K sabiti (lib/metric-thresholds.ts) HAK61 filosunun canlı medyanına ve
 * HAK61 Teltonika eşik parametrelerine göre seçildi. Başka bir filoda aynı K
 * ile üretilen skor mutlak bir anlam taşımaz. Kapalıyken skor ham/görece
 * okunur, "kalibre edilmiş" iddiası taşımaz.
 */
export const SAFETY_SCORE_CALIBRATED = envBool(
  process.env.NEXT_PUBLIC_SAFETY_SCORE_CALIBRATED,
  true
);

/**
 * FİLO ETİKETLERİ. DB'deki kod adları (`bordo` / `mavi`) ve FLEET_STYLE
 * DEĞİŞMEZ — yalnız kullanıcıya gösterilen metin. Boş bırakılırsa i18n
 * sözlüğündeki bugünkü karşılıklar ("Bordo Filo" / "Mavi Filo") kullanılır.
 */
export const FLEET_LABELS: Record<string, string> = {
  bordo: process.env.NEXT_PUBLIC_FLEET_BORDO_LABEL?.trim() || "",
  mavi: process.env.NEXT_PUBLIC_FLEET_MAVI_LABEL?.trim() || "",
};

/**
 * KULLANILAN FİLOLAR — hangi filo kullanıcıya SEÇENEK olarak sunulur.
 *
 * 31.07.2026 (Sendigo kabul testi): tek filolu kurulumda Araçlar sayfasında
 * "Bordo Filo 0" çipi duruyordu — o filoya hiç araç girmeyecek, kavramın
 * kendisi o müşteride yok. Etiket env'i (yukarıdaki FLEET_LABELS) yalnız ADI
 * değiştiriyor, filoyu gizlemiyordu.
 *
 * DB'DEKİ KOD ADLARI DEĞİŞMEZ: `vehicles.fleet` hâlâ 'bordo'/'mavi' tutar ve
 * migration 023'ün CHECK kısıtı olduğu gibi kalır. Buradaki liste yalnız
 * ARAYÜZ süzgeci: gösterilmeyen filoya yeni araç atanamaz, ama veri düzeyinde
 * hiçbir şey kısıtlanmaz (eski kayıt varsa okunmaya devam eder).
 *
 * Varsayılan HAK61'in bugünkü hâli: iki filo da açık.
 */
export const ACTIVE_FLEETS: string[] = (() => {
  const raw = process.env.NEXT_PUBLIC_FLEETS?.trim();
  if (!raw) return ["bordo", "mavi"];
  const known = ["bordo", "mavi"];
  const picked = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => known.includes(s));
  // Tanınmayan/boş liste sessizce filoyu yok etmesin — bugünkü davranışa döner.
  return picked.length > 0 ? picked : ["bordo", "mavi"];
})();

/** Bu filo arayüzde gösterilsin mi (bkz. ACTIVE_FLEETS). */
export function isFleetVisible(fleet: string | null | undefined): boolean {
  return fleet ? ACTIVE_FLEETS.includes(fleet) : true;
}

// ─────────────────────────────────────────────────────────────────────────────
// KİMLİK MASKELEME (yalnız sunucu)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * KİMLİĞİ MASKELENMİŞ KURULUM — 07.08.2026, galzura-demo.
 *
 * Demo ortamı GERÇEK araçların telemetrisini okur ama plakaları, şoför adlarını
 * ve VIN'leri TAKMADIR. Bu, tek yönlü bir sözdür: veritabanına takma değer
 * yazmak yetmez, cihazdan gelen gerçek kimliğin oraya SONRADAN sızmaması da
 * gerekir.
 *
 * ⚠️ ENV DEĞİL, MÜŞTERİ KODUNDAN TÜRETİLİR — bilinçli. Bir env satırı Vercel'de
 * unutulabilir ve unutulduğunda varsayılan "maskeleme kapalı" olurdu: ilk sync
 * turunda gerçek VIN demo veritabanına düşer, maskeleme sessizce çökerdi.
 * Müşteri kodu (NEXT_PUBLIC_TENANT) zaten marka için ZORUNLU olduğundan
 * unutulması mümkün değil. Fail-closed olan taraf budur.
 *
 * HAK61 ve Sendigo bu kümede DEĞİL → maskeleme kapalı → davranışları değişmez.
 */
const IDENTITY_MASKED_TENANTS = new Set(["galzura-demo"]);

export const IDENTITY_MASKED: boolean = IDENTITY_MASKED_TENANTS.has(TENANT);

/**
 * Cihazın bildirdiği VIN `vehicles.vin` boşken oraya yazılsın mı?
 * (lib/telemetry.ts → maybeBackfillVin; iki çağıran: /api/flespi/sync ve
 * /api/flespi/ingest — kapı bu yüzden fonksiyonun İÇİNDE.)
 *
 * Varsayılan maskelenmemiş kurulumda `true` — yani HAK61 ve Sendigo'da
 * 07.08.2026 öncesiyle BİREBİR aynı davranış (koşulsuz backfill).
 * Env yalnız kaçış kapısıdır; maskeli kurulumda açmak için bilerek
 * `VIN_BACKFILL_ENABLED=true` yazmak gerekir.
 */
export const VIN_BACKFILL_ENABLED = envBool(
  process.env.VIN_BACKFILL_ENABLED,
  !IDENTITY_MASKED
);

/**
 * GEÇMİŞ DOLGU UCU (/api/flespi/backfill) açık mı?
 *
 * `IDENTITY_MASKED` ile AYNI kaynaktan türer ve bu bilinçli: dolgu ucu, geçmişi
 * geriye dönük üreten ve normalde bilinçli olarak kapalı tutulan üç korumayı
 * (olay cooldown'u, rölanti imleci, vardiyanın bugün-kapsamı) atlayan bir
 * araçtır. Böyle bir aracın GERÇEK bir müşteri kurulumunda bulunmasının hiçbir
 * meşru sebebi yok — HAK61'de çalıştırılması geçmiş vardiyaları ve alarmları
 * uydurulmuş kayıtlarla kirletirdi.
 *
 * Env ile AÇILAMAZ (kaçış kapısı yok): türetilmiş sabit. Kurulum kodundan başka
 * hiçbir şey bu ucu HAK61/Sendigo'da canlandıramaz.
 */
export const DEMO_BACKFILL_ENABLED: boolean = IDENTITY_MASKED;

// ─────────────────────────────────────────────────────────────────────────────
// GÜVENLİK KATMANI (migration 045) — hepsi VARSAYILAN KAPALI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ANA ŞALTER — giriş oturumu kaydı, eylem izi, oturum sürümü denetimi ve
 * /admin/guvenlik ekranının tamamı buna bağlı.
 *
 * ⚠️ VARSAYILANI `false` ve bu bilinçli. Katman migration 045'i gerektiriyor;
 * HAK61 ve Sendigo'da o migration çalıştırılmadığı sürece tablolar YOK. Bayrak
 * kapalıyken kod hiçbir yeni sorgu atmaz — yani 045 çalıştırılmamış bir
 * kurulumda "tablo yok" hatası bile üretilemez. Çift koruma: bayrak + eksik
 * tabloya dayanıklı okuma.
 *
 * Env ile açılır (`SECURITY_LAYER_ENABLED=true`); yalnız sunucuda okunur.
 */
export const SECURITY_LAYER_ENABLED = envBool(
  process.env.SECURITY_LAYER_ENABLED,
  false
);

/**
 * ANA ŞALTERİN İSTEMCİYE GÖRÜNEN AYNASI — yalnız GEREKSİZ AĞ İSTEĞİNİ ÖNLER.
 *
 * Neden iki bayrak: PDF ve CSV tarayıcıda üretiliyor, yani "indirdi" eylemini
 * ize yazmanın tek yolu istemciden bir sunucu action'ı çağırmak. Yukarıdaki
 * şalter `NEXT_PUBLIC_` değil (olmamalı da — sunucu kararı sunucuda kalsın),
 * dolayısıyla istemci onu OKUYAMAZ. Ayna olmasaydı HAK61 ve Sendigo'da her PDF
 * indirmede hiçbir şey yazmayacak bir istek sunucuya gidip dönerdi — yani
 * "davranış değişmedi" sözü ölçülebilir biçimde bozulurdu.
 *
 * ⚠️ SON SÖZ BUNDA DEĞİL: `logExportAction` sunucuda yine `SECURITY_LAYER_ENABLED`
 *    denetler. Bu ayna yanlış `true` verilse bile hiçbir şey yazılmaz; yanlış
 *    `false` verilirse yalnız dışa-aktarma izi eksik kalır — bu yüzden
 *    check-demo-env onu ayrıca denetliyor (sessiz düşüş olmasın).
 */
export const SECURITY_LAYER_PUBLIC = envBool(
  process.env.NEXT_PUBLIC_SECURITY_LAYER_ENABLED,
  false
);

/**
 * TEK OTURUM KİLİDİ — bir hesap aynı anda TEK cihazda açık kalabilir; ikinci
 * giriş birincisini düşürür (workers.session_version artırılarak).
 *
 * Varsayılanı `false`: HAK61'de bir şoför hem telefondan hem depodaki
 * tabletten girebiliyor ve bu bugünkü davranıştır. `true` yapmak onu kırardı.
 * Yalnız SECURITY_LAYER_ENABLED açıkken anlamlıdır.
 */
export const SINGLE_SESSION = envBool(process.env.SINGLE_SESSION, false);

/**
 * DIŞA AKTARMA (CSV) AÇIK MI?
 *
 * Varsayılanı `true` — bugün dört ekranda CSV indirme var ve çalışıyor.
 * Kapatıldığında buton gizlenir VE sunucu tarafındaki veri kaynağı da reddeder
 * (yalnız butonu gizlemek, action doğrudan çağrılınca korumaz).
 */
export const EXPORT_ENABLED = envBool(
  process.env.NEXT_PUBLIC_EXPORT_ENABLED,
  true
);

/**
 * PDF FİLİGRANI — boş dize = filigran YOK (HAK61/Sendigo'nun bugünkü hâli).
 * Dolu verilirse rapor sayfalarına çapraz olarak
 * "<metin> — <kullanıcı> — <tarih saat>" basılır.
 */
export const PDF_WATERMARK = (
  process.env.NEXT_PUBLIC_PDF_WATERMARK ?? ""
).trim();

// ─────────────────────────────────────────────────────────────────────────────
// ERİŞİM KAPILARI (migration 046) — dördü de TEK şaltere bağlı
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DÖRT KAPININ ANA ŞALTERİ: cihaz onayı, ülke onayı, saat kilidi, ölü adam
 * anahtarı. Kapalıyken hiçbiri tek sorgu atmaz ve giriş akışı bugünküyle
 * birebir aynı kalır.
 *
 * ⚠️ Neden dört ayrı bayrak DEĞİL: dördü tek bir güvenlik duruşunun parçası ve
 * ayrı ayrı açılmaları anlamlı bir kurulum üretmiyor (cihaz onayı açıkken ülke
 * onayı kapalı olmak neyi çözer?). Dört env daha eklemek, dördünden birinin
 * Vercel'de unutulup katmanın SESSİZCE yarım çalışması demekti — 045'te
 * NEXT_PUBLIC ayna bayrağında bir kez yaşandı, muhafız betiğiyle kapatıldı.
 * Tek şalter, tek denetim noktası.
 *
 * ⚠️ 046 migration'ını GEREKTİRİR ve 045'in üstüne biner (muafiyet ölçütü
 * workers.is_owner). Migration çalışmadan açılırsa her kapı kendi eksik-tablo
 * dalına düşer ve GİRİŞİ ENGELLEMEZ (fail-open) — bkz. lib/access-gates.ts.
 */
export const ACCESS_GATES_ENABLED = envBool(
  process.env.ACCESS_GATES_ENABLED,
  false
);

/**
 * ONAY BEKLEMEDEN SERBEST ÜLKELER (ISO 3166-1 alpha-2, virgülle).
 * Kişi bazında workers.allowed_countries bunu EZER.
 */
export const ACCESS_COUNTRIES: string[] = (
  process.env.ACCESS_COUNTRIES ?? "TR,AT"
)
  .split(",")
  .map((c) => c.trim().toUpperCase())
  .filter(Boolean);

/**
 * GİRİŞ SERBEST SAAT ARALIĞI — "HH:MM" (Europe/Istanbul).
 *
 * ⚠️ SAAT DİLİMİ İSTANBUL, panelin geri kalanı VİYANA. Bu bilinçli bir istek
 * (Volkan, 08.08.2026) ama sonucu şudur: 07:00-21:00 İstanbul = 06:00-20:00
 * Viyana. Filo Avusturya'da çalıştığı için aralık kişi bazında daraltılırken
 * bu bir saatlik kayma akılda tutulmalı.
 *
 * Kişi bazında workers.access_hours_start/end bunu EZER.
 */
export const ACCESS_HOURS_START = (
  process.env.ACCESS_HOURS_START ?? "07:00"
).trim();
export const ACCESS_HOURS_END = (
  process.env.ACCESS_HOURS_END ?? "21:00"
).trim();

// ─────────────────────────────────────────────────────────────────────────────
// VARDİYA OTOMATI (yalnız sunucu — lib/auto-shift.ts)
// ─────────────────────────────────────────────────────────────────────────────

export type ShiftStartTrigger = "depot_entry" | "first_ignition" | "off";
export type ShiftAutoEndMode = "off" | "depot_idle";

/**
 * VARDİYA BAŞLANGICI.
 *
 *  • `depot_entry`    — araç depo bölgesine girip kontağı AÇIKKEN bekliyorsa
 *                       mesai başlar (HAK61, 25.07.2026'dan beri; VARSAYILAN).
 *  • `first_ignition` — Viyana gününün İLK kontak açılışı mesai başlangıcıdır.
 *                       Araçlar geceyi depoda geçiren filolar için: sabah
 *                       çalıştırma zaten mesai başlangıcıdır ve depo geofence'i
 *                       teğet geçme/telemetri boşluğu sorunlarına açık değildir.
 *  • `off`            — OTOMATİK BAŞLATMA YOK. Vardiyayı yalnız insan açar
 *                       (şoför paneli ya da yönetici/şef "adına başlat").
 *
 * ── `off` NEDEN VAR (03.08.2026, Sendigo) ──────────────────────────────────
 * Sendigo'da bir aracı gece/gündüz iki ayrı şoför kullanıyor; araç-şoför sabit
 * ataması yok. Otomatik motor ise ARAÇ ekseninde çalışır ve vardiyayı aracın
 * ATANMIŞ şoförüne açar (lib/auto-shift.ts) — atama olmayınca aracı atlar,
 * atama varsa da yanlış kişiye açardı. Şoför paneli ile otomatik motor aynı
 * anda açıkken ikisi aynı gün için iki ayrı yol denerdi; `off` bu ikiliği
 * kaynağında keser. HAK61 varsayılanı `depot_entry` — değişmedi.
 */
export const SHIFT_START_TRIGGER: ShiftStartTrigger = envEnum(
  process.env.SHIFT_START_TRIGGER,
  ["depot_entry", "first_ignition", "off"] as const,
  "depot_entry"
);

/**
 * OTOMATİK KAPANMA.
 *
 *  • `off`        — vardiyayı YALNIZ personel kapatır. 22.07.2026'da alınan ve
 *                   20 şoförü kilitleyen olaydan sonra konan kural (HAK61).
 *  • `depot_idle` — kontak kapalı + araç depoda + `SHIFT_AUTO_END_IDLE_MIN`
 *                   dakika hareketsizlik → vardiya kapanır.
 *
 * ⚠️ Şoför paneli kapalıyken `off` olamaz: kapatacak kimse kalmaz ve vardiyalar
 * gece boyu açık kalır. `assertTenantConfig()` bunu fail-closed denetler.
 */
export const SHIFT_AUTO_END: ShiftAutoEndMode = envEnum(
  process.env.SHIFT_AUTO_END,
  ["off", "depot_idle"] as const,
  "off"
);

/**
 * `depot_idle` için hareketsizlik eşiği (dakika).
 *
 * Varsayılan 30, çünkü lib/auto-shift.ts'teki bugünkü sabit (uykuda duran
 * DEFAULT_IDLE_END_MINUTES) 30'dur ve değişmezlik sözleşmesi varsayılanın
 * BUGÜNKÜ değer olmasını gerektirir. Sendigo'nun 20 dakikası bir kod
 * varsayılanı değil, o kurulumun env satırıdır.
 */
export const SHIFT_AUTO_END_IDLE_MIN = envInt(
  process.env.SHIFT_AUTO_END_IDLE_MIN,
  30
);

/**
 * Araç gün sonuna kadar depoya dönmezse vardiya SON HAREKET anında kapanır —
 * gece boyu açık kalmaz. Yalnız `depot_idle` modunda geçerlidir.
 */
export const SHIFT_AUTO_END_MIDNIGHT_FALLBACK = envBool(
  process.env.SHIFT_AUTO_END_MIDNIGHT_FALLBACK,
  true
);

/**
 * FİLO BAŞLANGIÇ TARİHİ — "tüm zamanlar" aralığının tabanı ve önceki-dönem
 * karşılaştırmasının alt sınırı (lib/analytics.ts). Bu tarihten önce veri yok
 * sayılır; yanlış olması veriyi bozmaz, yalnız anlamsız boş bir dönem üretir.
 */
export const FLEET_EPOCH_ISO =
  process.env.FLEET_EPOCH?.trim() || "2026-06-01T00:00:00.000Z";

/**
 * KURULUM TUTARLILIK DENETİMİ — fail-closed.
 *
 * Yanlış env bileşimi sessiz bir veri kaybına dönüşebilir (şoför paneli yok +
 * otomatik kapanma yok = hiç kapanmayan vardiyalar). Bunu üretimde fark etmek
 * yerine kurulumda patlatıyoruz. Sunucu açılışında bir kez çağrılır.
 */
export function assertTenantConfig(): void {
  // Saat dilimi (09.08.2026). `lib/tz.ts` geçersiz env'i istemcide varsayılana
  // düşürür — çünkü `Intl` bilinmeyen dilimde RangeError atar ve o, kullanıcının
  // ekranını komple beyaza çevirirdi. Düşüş SESSİZ olmasın diye gürültü BURADA:
  // sunucu açılışta patlar, yani kusur kurulumda görülür, üretimde değil.
  if (TENANT_TZ_INVALID) {
    throw new Error(
      `Kurulum hatası: NEXT_PUBLIC_TENANT_TZ="${process.env.NEXT_PUBLIC_TENANT_TZ}" ` +
        "geçerli bir IANA saat dilimi değil (ör. 'Europe/Vienna', 'Europe/Istanbul'). " +
        `Panel ve mobil şu an varsayılana (${TENANT_TZ}) düşmüş durumda.`
    );
  }
  if (!DRIVER_PANEL_ENABLED && SHIFT_AUTO_END === "off") {
    throw new Error(
      "Kurulum hatası: NEXT_PUBLIC_DRIVER_PANEL_ENABLED=false iken SHIFT_AUTO_END='off' olamaz — " +
        "vardiyayı kapatacak kimse kalmaz. SHIFT_AUTO_END='depot_idle' yapın."
    );
  }
  // Simetrik kapı (03.08.2026): panel kapalıyken otomatik BAŞLATMA da kapalıysa
  // vardiyayı açacak tek yol yöneticinin elle başlatmasıdır — yani hiç kimse
  // unutursa o gün hiç kayıt oluşmaz. Sessiz veri kaybı; kurulumda patlasın.
  // Panel AÇIKKEN bu bileşim meşrudur (Sendigo: şoför kendi açar) ve tetiklenmez.
  if (!DRIVER_PANEL_ENABLED && SHIFT_START_TRIGGER === "off") {
    throw new Error(
      "Kurulum hatası: NEXT_PUBLIC_DRIVER_PANEL_ENABLED=false iken SHIFT_START_TRIGGER='off' olamaz — " +
        "vardiyayı başlatacak kimse kalmaz. Paneli açın ya da otomatik bir tetik seçin."
    );
  }
}
