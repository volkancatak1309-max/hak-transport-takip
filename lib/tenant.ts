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
import { BILINEN_ULKELER, VARSAYILAN_ULKE } from "@/lib/phone";
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

/** Env'den gelen ondalıklı sayının GEÇERLİ olup olmadığı — "custom" bayrağı. */
function envNumIsCustom(value: string | undefined): boolean {
  const n = Number(value?.trim());
  return Number.isFinite(n) && n > 0;
}

/**
 * ═════════════ MALİYET ORANLARI — €/km ve €/paket'in DÖRT GİRDİSİ ═════════════
 *
 * Dördü de sunucu tarafı env — bilinçli olarak NEXT_PUBLIC_ DEĞİL: oran
 * sunucuda çarpılıp SONUÇ prop olarak iniyor. `process.env[name]` dinamik
 * erişimi istemci paketine gömülmüyor (03.08.2026 ölçümü); o tuzağa hiç
 * girmiyoruz. Bir oranı istemcide okumak isteyen kod, sayıyı prop olarak alır.
 *
 * ⚠️ ENV ARTIK YALNIZ VARSAYILAN SAĞLAR (23.08.2026, Volkan kararı).
 * Kiracı kendi oranını PANELDEN girer (/admin/ayarlar → migration 076,
 * `tenant_cost_rates`). Öncelik zinciri tek yerde çözülür:
 *
 *        panel satırı  >  env  >  buradaki varsayılan
 *
 * Gerekçe: env değiştirmek deploy ister ve yalnız bizim erişimimizde;
 * müşterinin kendi sigorta primini güncellemek için bizden dağıtım istemesi
 * saçmadır. Bkz. lib/cost-rates-db.ts ve db/migrations/076_tenant_cost_rates.sql.
 *
 * ⚠️ ÜÇÜ TAHMİN, BİRİ ÖLÇÜM. Tüketim (L/100km) telemetriden ÖLÇÜLÜR ve
 * panelden değiştirilemez; üç parasal oran ise varsayılan geldiğinde bir
 * PİYASA VARSAYIMIDIR. Rapor her oranın yanında kaynağını yazar
 * (ÖLÇÜLDÜ / GİRİLDİ / VARSAYILAN) — "tahmini sayıyı ölçüm sanma" kuralı.
 */

/**
 * 1) YAKIT LİTRE FİYATI (EUR/L).
 *
 * Varsayılan 2,043 = Avusturya geneli ortalama dizel pompa fiyatı, 17.08.2026,
 * WKO (Kraftstoffpreise, MÖSt + USt dâhil). ⚠️ 23.08.2026'da 2,051'den
 * (27.07.2026 ölçümü) güncellendi — sayı değişti, KAYNAK aynı.
 *
 * Bu bir PİYASA ortalamasıdır; filo kartıyla akaryakıt alan müşteri kendi
 * anlaşmalı fiyatını FUEL_PRICE_EUR_PER_L ile geçer ve tüm kiracılarda (HAK61,
 * Sendigo, galzura-demo) aynı hesap çalışır.
 *
 * ⚠️ TEK KAYNAK (23.08.2026). Bu sabit eskiden İKİ yerde yaşıyordu:
 * burada 2,051 ve `lib/analytics-shared.ts`'te `DIESEL_EUR_PER_L = 1.65`
 * (sabit kodlu, env yok). Aynı litre yakıt iki ekranda %24 farklı € basıyordu
 * (30 günlük rölanti: 146 € — 181 €) ve arayüz metni "ayarlanabilir" diyordu
 * ama o değer için env YOKTU. `DIESEL_EUR_PER_L` SİLİNDİ; yakıtın parasal
 * karşılığını hesaplayan her yol artık buradan okur.
 */
export const FUEL_PRICE_EUR_PER_L = envNum(
  process.env.FUEL_PRICE_EUR_PER_L,
  2.043
);

/**
 * YAKIT FİYATI REFERANSININ ÜLKESİ — otomatik çekimin hangi satırı okuyacağı.
 *
 * Varsayılan `TENANT_DEFAULT_COUNTRY` (telefon kanonikleştirmesinin de
 * kullandığı kiracı ülkesi). Yeni bir kolon ya da yeni bir env ZORUNLU
 * DEĞİL: kiracının ülkesi zaten tek yerde tanımlı ve filo normalde orada
 * yakıt alıyor.
 *
 * Ayrı bir override bırakılmasının sebebi dar ama gerçek: merkezi Avusturya'da
 * olup ağırlıklı Almanya'da yakan bir filo, fiyat referansını DE'den almak
 * isteyebilir. O gün bu env yazılır; o güne kadar hiç dokunulmaz.
 *
 * ⚠️ Bugün yalnız 'AT' ve 'DE' için referans üretiliyor (AB Weekly Oil
 * Bulletin kapsamı, bkz. lib/fuel-price-source.ts). Başka bir ülke kodu
 * yazmak hata vermez — referans satırı bulunamaz ve zincir env/varsayılana
 * düşer, ekranda da öyle etiketlenir.
 */
export const FUEL_PRICE_COUNTRY = (
  process.env.FUEL_PRICE_COUNTRY?.trim() || VARSAYILAN_ULKE
).toUpperCase();

/** Varsayılan fiyatın kaynağı — ekrandaki küçük notta gösterilir. */
export const FUEL_PRICE_SOURCE = "WKO";
/** Varsayılan fiyatın ölçüm tarihi (ISO) — notta gösterilir. */
export const FUEL_PRICE_AS_OF = "2026-08-17";
/** Fiyat env'den mi geldi (true) yoksa varsayılan mı (false)? Not metnini seçer. */
export const FUEL_PRICE_IS_CUSTOM = envNumIsCustom(
  process.env.FUEL_PRICE_EUR_PER_L
);

/**
 * 2) FİLO ORTALAMA TÜKETİMİ (L/100km) — YEDEK/GEÇERSİZ KILMA.
 *
 * ⚠️ NORMALDE KULLANILMAZ. Maliyet raporu tüketimi önce KENDİ filosundan ÖLÇER
 * (`buildFuelReport().fleetLPer100Km` — telemetriden, üç kapıdan geçmiş
 * araçların ağırlıklı ortalaması). Bu sabit yalnız iki durumda devreye girer:
 *   · ölçüm yoksa (aralık kısa, sensör yok, RPC zaman aşımı) → YEDEK
 *   · env verilmişse → GEÇERSİZ KILMA (müşteri kendi rakamını dayatır)
 * Rapor hangisini kullandığını `lPer100Source` ile söyler.
 *
 * Neden ölçüm önce: her filonun tüketimi farklı (kasa yüksekliği, güzergâh,
 * mevsim). Sabit bir sayı dayatmak, ürünün zaten ölçebildiği bir şeyi tahmine
 * çevirirdi.
 *
 * Varsayılan 11,74 = HAK61 canlı ölçümü 23.08.2026 (30 gün, 22 araç,
 * 2.405,6 L / 20.506 km). Başka bir kiracıda ilk ölçüm gelene kadar geçerli
 * bir büyüklük mertebesi olsun diye buraya yazıldı — hedef sayı DEĞİL.
 */
export const FLEET_L_PER_100KM = envNum(process.env.FLEET_L_PER_100KM, 11.74);
export const FLEET_L_PER_100KM_IS_CUSTOM = envNumIsCustom(
  process.env.FLEET_L_PER_100KM
);

/**
 * 3) İŞÇİLİK (EUR / şoför-saati) — İŞVEREN TOPLAM MALİYETİ, brüt ücret DEĞİL.
 *
 * Varsayılan 19,10 türetimi (kaynak: WKO Kollektivvertrag Güterbeförderungs-
 * gewerbe, Arbeiter/innen, 1.1.2026):
 *     Lohngruppe 2 (LKW >3,5 t, ≤3 aks), ≤5 yıl kıdem   2.178,07 €/ay
 *     KV'nin kendi kuralı: saat = aylık / 173            → 12,59 €/sa brüt
 *     × 1,167  13./14. maaş (Sonderzahlungen, 14/12)     → 14,69 €/sa
 *     × 1,30   Lohnnebenkosten (DG-SV ~%21 + DB/DZ/KommSt ~%8)
 *                                                        ≈ 19,10 €/sa
 *
 * ⚠️ Bu bir MERTEBE tahminidir, bordro değil. Kıdem kademesi, fazla mesai
 * zammı (%50 / gece %100), Diäten ve gerçek Lohngruppe müşteriye göre değişir.
 * Her kiracı kendi rakamını LABOR_EUR_PER_HOUR ile geçmelidir.
 *
 * ⚠️ NEDEN ŞOFÖR BAŞINA ÜCRET KOLONU DEĞİL: kişi bazlı ücret bordro verisidir
 * (GDPR özel nitelik + ayrı yetki tasarımı). €/km zaten bir FİLO metriği;
 * filo ortalaması bir kiracı sabitidir ve €/L ile aynı sınıftandır.
 */
export const LABOR_EUR_PER_HOUR = envNum(process.env.LABOR_EUR_PER_HOUR, 19.1);
export const LABOR_EUR_PER_HOUR_IS_CUSTOM = envNumIsCustom(
  process.env.LABOR_EUR_PER_HOUR
);
/** Varsayılanın kaynağı — ekranda "VARSAYILAN" etiketinin yanında gösterilir. */
export const LABOR_SOURCE = "WKO KV Güterbeförderung";
export const LABOR_AS_OF = "2026-01-01";

/**
 * 4) ARAÇ SABİT GİDERİ (EUR / ÇALIŞILAN araç-günü).
 *
 * ⚠️ PAYDA "ÇALIŞILAN" GÜNDÜR, takvim günü değil. Maliyet raporu bunu, o
 * aralıkta EN AZ BİR vardiya görmüş (araç, gün) çiftlerinin sayısıyla çarpar
 * (HAK61, 30 gün: 426 araç-gün / 28 araç ≈ 15,2 gün/araç). Takvim gününe
 * bölseydik park hâlindeki aracın gideri km'si olmayan bir paydaya dağılır ve
 * €/km sessizce şişerdi.
 *
 * Varsayılan 50,00 türetimi (aylık sabit gider ÷ ayda çalışılan gün):
 *     operating leasing, 3,5 t kasa/kurye sınıfı   ~550 €/ay
 *     kasko + zorunlu sigorta                      ~130 €/ay
 *     servis, lastik, vinyet, motorlu taşıt vergisi ~70 €/ay
 *                                          toplam  ~750 €/ay
 *     ÷ ~15 çalışılan gün                          ≈ 50 €/çalışılan gün
 * Leasing bandı kaynağı: kurye/servis sınıfı transporter için 400–700 €/ay
 * (leasingdeal.de / mivodo.com piyasa derlemeleri, Ağustos 2026); sigorta
 * ~130 €/ay aynı derlemelerden.
 *
 * ⚠️ Bu kalem oranların EN OYNAK olanı: sahip olunan (leasing'siz) filoda
 * amortisman çok daha düşüktür. Her kiracı kendi rakamını girmelidir.
 * Takvim-günü muhasebesi tercih edilirse: aylık gider ÷ 30 yazılır ve
 * sonucun daha düşük çıkacağı bilinir.
 */
export const VEHICLE_EUR_PER_DAY = envNum(process.env.VEHICLE_EUR_PER_DAY, 50);
export const VEHICLE_EUR_PER_DAY_IS_CUSTOM = envNumIsCustom(
  process.env.VEHICLE_EUR_PER_DAY
);
/**
 * Varsayılanın kaynağı. Tek bir resmî yayın yok — kurye/servis sınıfı 3,5 t
 * transporter için piyasa leasing bandı (400-700 €/ay) + sigorta (~130 €/ay)
 * derlemesi. Bu yüzden etiketi "piyasa derlemesi": kaynağı olmayan bir sayıya
 * kaynak uydurmuyoruz, oranların EN OYNAĞI olduğunu ekranda söylüyoruz.
 */
export const VEHICLE_DAY_SOURCE = "piyasa derlemesi";
export const VEHICLE_DAY_AS_OF = "2026-08";

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

export type ShiftPerDay = "one" | "many";

/**
 * BİR ŞOFÖR BİR GÜNDE KAÇ VARDİYA AÇABİLİR? (14.08.2026)
 *
 *  • `one` — HAK61'in BUGÜNKÜ davranışı ve VARSAYILAN. Bir Viyana gününde en
 *    fazla BİR vardiya SATIRI olur (lib/shift-day.ts). Gün kapandıktan sonra
 *    başlatma denemesi yeni satır yazmaz, o günün satırını YENİDEN AÇAR.
 *
 *  • `many` — Sendigo'nun iş modeli: gece vardiyası + gündüz çağrı işi. Aynı
 *    şoför aynı gün ikinci kez vardiya açabilir ve bu YENİ BİR SATIRDIR.
 *    Yönetici panosunda "Dikkat/Aksiyon" kalemi olarak görünür (dış bildirim yok).
 *
 * ⚠️ GEVŞEME YALNIZ İNSAN EYLEMLİ İKİ YOLDA GEÇERLİDİR: şoför panelindeki
 * başlatma (startShiftManualAction) ve yönetici/şef dialogu
 * (startShiftForWorkerAction). OTOMATİK VARDİYA MOTORU (lib/auto-shift.ts:432,
 * workersWithShiftToday) bu bayrağı OKUMAZ ve kilidi ASLA açılmaz — çöp
 * vardiyanın kaynağı tam olarak orasıydı: kontak açılıp kapandıkça gün içinde
 * 5-10 satır birikiyordu (21.07.2026 canlı ölçümü: kapanmış onaysız
 * vardiyaların yarısı 25 dakikadan kısaydı). İnsan eylemi o gürültüyü
 * üretmiyor; kontak üretiyor.
 *
 * ⚠️ ÖN KOŞULU VAR: AZG günlük tavanı panelde ŞOFÖR-GÜN ekseninde
 * hesaplanmalıdır (lib/azg-rules.ts overLimitDayCount). Satır ekseninde
 * kalsaydı 8 sa + 6 sa çalışan şoför panelde temiz, AZG PDF'inde ihlal
 * görünürdü.
 */
export const SHIFT_PER_DAY: ShiftPerDay = envEnum(
  process.env.NEXT_PUBLIC_SHIFT_PER_DAY,
  ["one", "many"] as const,
  "one"
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
 * OKUNDU BİLGİSİ (mesajlaşma ✓✓) — VARSAYILAN AÇIK.
 *
 * Açıkken her mesajın kim tarafından ne zaman okunduğu yazılır
 * (`message_receipts`, migration 071) ve iki tarafa da gösterilir.
 *
 * ── NEDEN KAPATILABİLİR OLMAK ZORUNDA ──────────────────────────────────────
 * Avusturya §96(1)3 ArbVG ve Almanya §87 BetrVG: çalışanı izleyen teknik
 * sistemlerin kurulması işyeri konseyinin ONAYINA bağlı; konsey yoksa §10
 * AVRAG bireysel yazılı rıza istiyor. "Şoför mesajı 07:14'te okudu" kaydı bu
 * tanıma girebilecek bir izleme verisidir ve DACH'ta satışın önünü tıkayabilir.
 * Kapatıldığında mesajlaşma tam çalışır, YALNIZ okundu damgası yazılmaz ve
 * gösterilmez — okunmamış sayacı da düşer, çünkü onun kaynağı da bu tablodur.
 *
 * ⚠️ SUNUCU SON SÖZÜ SÖYLER: bayrak kapalıyken uçlar makbuz YAZMAZ. Yalnız
 * arayüzde gizlemek yetmezdi — veri yine birikirdi ve "tutmuyoruz" iddiası
 * yanlış olurdu. Kapalıyken tablo boş kalır.
 *
 * Bayrak SONRADAN kapatılırsa geçmiş makbuzlar tabloda DURUR (silinmez);
 * silmek ayrı ve bilinçli bir işlem olmalı (GDPR silme yolu).
 */
export const READ_RECEIPTS_ENABLED = envBool(
  process.env.NEXT_PUBLIC_READ_RECEIPTS_ENABLED,
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
 * VARSAYILAN ÜLKE — yerel yazılmış telefon numarası ("0660…", "+" yok) hangi
 * ülkeye ait sayılır.
 *
 * Değerin kendisi `lib/phone.ts` içinde DÜZ LİTERAL okunur; burası onu değişmezlik
 * kaydına ve kurulum denetimine bağlayan yeniden dışa aktarımdır. 22.08.2026
 * öncesi böyle bir ayar yoktu: `canonicalPhone` "+43"ü koda gömüyordu. "AT" o
 * davranışın birebir kendisidir — bu satır kayarsa yerel yazılan numaralar
 * BAŞKA bir ülkeye bağlanır ve şoför giriş yapamaz.
 */
export const TENANT_DEFAULT_COUNTRY = VARSAYILAN_ULKE;

/**
 * ═════════════ MÜŞTERİ CANLI TAKİP LİNKİ (migration 079) ═════════════
 *
 * Dördü de SUNUCU tarafı — bilerek `NEXT_PUBLIC_` DEĞİL. Girişsiz sayfa
 * sunucuda render ediliyor; bu ayarları istemci paketine gömmek, kiracının
 * yapılandırmasını linke tıklayan HERKESE okutmak olurdu.
 */

/**
 * Linkin ömrü (dakika). Varsayılan 120 — görevde yazan iki saat.
 *
 * Değer linke YAZILIR (expires_at), okuma anında bakılmaz: ayarı sonradan
 * kısaltmak, dün gönderilmiş bir linki geriye dönük öldürmemeli.
 */
export const TAKIP_LINK_TTL_MIN = envInt(process.env.TAKIP_LINK_TTL_MIN, 120);

/**
 * Girişsiz sayfada ŞOFÖRÜN ADI görünsün mü. VARSAYILAN KAPALI.
 *
 * ⚠️ HUKUKİ. Şoför adını müşteriye göstermek DACH'ta çalışan izleme kapsamına
 * girer: AT DSG §10 (çalışan verisinin işlenmesi) ve DE BetrVG §87 Abs. 1
 * Nr. 6 (teknik izleme, işçi konseyi onayı). Bunu açmak kiracının hukuk
 * kararıdır, ürünün varsayılanı olamaz. Kapalıyken sayfada isim GEÇMEZ —
 * sunucu alanı hiç göndermez, istemcide gizlemez.
 */
export const TAKIP_SOFOR_ADI = envBool(process.env.TAKIP_SOFOR_ADI, false);

/**
 * Kuş uçuşu mesafeyi yol mesafesine çeviren katsayı.
 *
 * Rota motoru YOK (ölçüldü: depoda OSRM/Valhalla/harici yönlendirme yok,
 * yalnız `lib/geo.ts` haversine). Şehir içi dağıtımda gerçek yol, kuş uçuşunun
 * tipik olarak 1,25-1,4 katıdır; 1,3 orta değer. Katsayı KİRACI ayarı çünkü
 * coğrafyaya göre değişir (nehirli/dağlık bir şehirde 1,6'ya çıkar).
 */
export const TAKIP_YOL_KATSAYISI = envNum(process.env.TAKIP_YOL_KATSAYISI, 1.3);

/**
 * Aracın kendi hızı ölçülemediğinde kullanılacak varsayılan hız (km/s).
 *
 * 35: şehir içi dağıtım aracının duraklar dahil ortalaması. Araç hareketliyse
 * ETA onun SON ölçülen hızından çıkar; bu değer yalnız "araç duruyor ya da hız
 * alanı boş" hâlinde devreye girer.
 */
export const TAKIP_VARSAYILAN_HIZ_KMS = envInt(process.env.TAKIP_VARSAYILAN_HIZ_KMS, 35);

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
  // Varsayilan ulke tabloda yoksa yerel yazim ("0660...") hicbir ulkeye
  // baglanamaz ve numara "+" siz kalir; giris o sofor icin sessizce kirilir.
  // Kurulumda patlasin.
  if (!BILINEN_ULKELER.includes(VARSAYILAN_ULKE)) {
    throw new Error(
      `Kurulum hatasi: NEXT_PUBLIC_TENANT_DEFAULT_COUNTRY="${VARSAYILAN_ULKE}" taninmiyor. ` +
        `Gecerli degerler: ${BILINEN_ULKELER.join(", ")}. Yeni bir ulke gerekiyorsa ` +
        "lib/phone.ts icindeki ULKE_TABLOSU'na bir satir ekleyin."
    );
  }
  if (!DRIVER_PANEL_ENABLED && SHIFT_START_TRIGGER === "off") {
    throw new Error(
      "Kurulum hatası: NEXT_PUBLIC_DRIVER_PANEL_ENABLED=false iken SHIFT_START_TRIGGER='off' olamaz — " +
        "vardiyayı başlatacak kimse kalmaz. Paneli açın ya da otomatik bir tetik seçin."
    );
  }
}
