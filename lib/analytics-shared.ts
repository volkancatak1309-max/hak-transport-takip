/**
 * /admin/analiz — istemci-güvenli türler + sabitler (DB erişimi yok, "server-only"
 * DEĞİL). lib/analytics.ts (server-only, Supabase sorguları) bunları içe aktarıp
 * yeniden dışa verir; AnalizClient.tsx yalnız BU dosyadan import eder — aksi
 * halde server-only zinciri (supabaseAdmin/flespi) istemci paketine sızar.
 */

export type AnalyticsRangeKey = "gun" | "hafta" | "ay" | "ozel" | "tumzaman";

export type DateRange = { start: Date; end: Date };

/**
 * Güvenlik skoru ceza ağırlıkları — ceza bu ağırlıklarla toplanır ve
 * `100 × K/(K + ceza/1000km)` eğrisine girer (lib/analytics.ts).
 * AYARLANABİLİR — firma politikasına göre değiştirilebilir, tek kaynak burası.
 *
 * ═══ harsh_acceleration 12 → 3 (12.08.2026, Volkan kararı — ÖLÇÜMLE) ═══
 *
 * SORUN: ağırlıklar EŞİTKEN (üç harsh_* de 12) skor fiilen TEK OLAY TİPİNİN
 * SAYACINA dönüşmüştü. Canlı ölçüm (30 gün, HAK61):
 *     harsh_acceleration  2.605 olay × 12 = 31.260 ceza  → toplamın %48,5'i
 *     harsh_cornering       954        12 = 11.448       → %17,8
 *     overspeeding          377        25 =  9.425       → %14,6
 *     harsh_braking         638        12 =  7.656       → %11,9
 *     idling                800         5 =  4.000       → %6,2
 *     jamming                28        25 =    700       → %1,1
 * Bir şoförün 986 km'de aldığı 5.948 cezanın 4.764'ü (%80) tek tipten geliyordu.
 *
 * ÖLÇÜLEN FREKANS ORANI: hızlanma / fren = 2.605 / 638 = 4,1×. Ağırlık o oranla
 * ters ölçeklendi: 12 / 4,1 = 2,9 → 3. Sonuç hızlanmayı frenle EŞİT toplam
 * katkıya getiriyor (%19,0'a karşı %18,7) — amaç buydu.
 *
 * ⚠️ AĞIRLIK KİMİN SKORLANACAĞINI DEĞİŞTİRMEZ: kapı km tabanlıdır
 * (SCORE_MIN_KM_*). Ölçüldü — her ağırlıkta aynı sayıda şoför skorlanıyor,
 * yalnız puan DEĞERLERİ değişiyor.
 *
 * ⚠️ SIRADAKİ: hızlanma inince en büyük katkı harsh_cornering'e geçiyor (%27,9).
 * Aynı sınıf bir kusur DEĞİL — viraj frenin 1,5 katı, hızlanma 4,1 katıydı;
 * 1,5× normal dağılım, 4,1× tahakküm. İlkeli tam çözüm TÜM ağırlıkları temel
 * orana göre normalize etmektir ve her skoru oynatır — ayrı karar, ayrı tur.
 *
 * ⚠️ AĞIRLIK ≠ CİHAZ EŞİĞİ: bir olayın ne zaman "sert hızlanma" sayılacağı
 * Teltonika FMC003'ün setparam'larında (AVL 253/254), bu repoda DEĞİL. Buradaki
 * sayı yalnız cihazın verdiği kararın skora katkısını belirler.
 */
export const SAFETY_SCORE_WEIGHTS: Record<string, number> = {
  overspeeding: 25,
  jamming: 25,
  harsh_braking: 12,
  harsh_acceleration: 3,
  harsh_cornering: 12,
  idling: 5,
};

/**
 * Rölanti israfının FİZİKSEL katsayısı: bir saat rölantide yakılan litre.
 *
 * ⚠️ FİYAT BURADA DEĞİL. 23.08.2026'ya kadar bu satırın hemen altında
 * `DIESEL_EUR_PER_L = 1.65` duruyordu — sabit kodlu, env'i olmayan İKİNCİ bir
 * yakıt fiyatı. `lib/tenant.ts`'teki FUEL_PRICE_EUR_PER_L ise 2,051'di: aynı
 * litre yakıt Analiz ekranında 146 €, Yakıt raporunda 181 € ediyordu (%24
 * sapma, 30 günlük rölanti üzerinde ölçüldü). Üstelik arayüz metni "1,65 €/L —
 * ayarlanabilir" diyordu ve o değer için env YOKTU.
 *
 * Sabit SİLİNDİ. Fiyatı çarpan her yol artık `lib/tenant.ts`'ten okur; bu dosya
 * istemci-güvenli kalmak zorunda olduğu için (AnalizClient buradan import
 * ediyor) fiyat BURAYA GERİ KONULAMAZ — sunucu-tarafı env istemci paketine
 * gömülmez, sessizce varsayılana düşerdi (03.08.2026 dersi).
 *
 * Bu katsayı ise fiyat değil fizik: cihaz/motor sınıfına bağlı, kiracıya değil.
 * AYARLANABİLİR olduğu gün tenant.ts'e taşınır, buraya değil.
 */
export const IDLE_FUEL_L_PER_HOUR = 0.9;

export const TOP10_EVENT_TYPES = [
  "harsh_acceleration",
  "harsh_cornering",
  "harsh_braking",
  "overspeeding",
  "idling",
  "jamming",
] as const;
export type Top10EventType = (typeof TOP10_EVENT_TYPES)[number];

export type VehicleLite = { id: string; plate: string; assigned_worker_id: string | null };
export type WorkerLite = { id: string; name: string };

/**
 * AYLIK PİVOT ARŞİVİ (27.07.2026) — Analiz sayfasının EN ALTINDAKİ kalıcı tablo.
 *
 * Satır = şoför, kolon = AY × alarm tipi, hücre = sayı. Sayfanın tarih aralığı
 * seçicisinden BAĞIMSIZDIR: arşiv her zaman filo başlangıcından bugüne kadar
 * TÜM ayları gösterir. Aylar biriktikçe tablo yatay genişler; geçmiş ay
 * sütunları bir daha değişmez, çünkü o ayın olayları artık kapanmıştır.
 *
 * Amaç: "kim hangi ayda kaç alarm aldı" sorusunun bir yıl sonra da cevaplanması.
 */
export type MonthlyPivotRow = {
  workerId: string | null;
  name: string;
  /** `${ayAnahtarı}|${olayTipi}` → sayı. Sıfır olan hücre HİÇ yazılmaz. */
  cells: Record<string, number>;
  /** Tüm aylar ve tipler toplamı — sıralama için. */
  total: number;
};

export type MonthlyPivot = {
  /** Artan sıralı Viyana ay anahtarları: "2026-06", "2026-07"… */
  months: string[];
  types: readonly Top10EventType[];
  rows: MonthlyPivotRow[];
};

export type DriverTally = {
  key: string;
  label: string;
  count: number;
  /** Yalnız overspeeding — o türdeki en yüksek hız. */
  maxSpeedKmh?: number;
  /** Yalnız idling — toplam epizod süresi (ms). */
  idleMs?: number;
};

export type EventTypeAgg = {
  /** Seçili aralıkta bu tipten TÜM olaylar (yalnız top-10'un toplamı değil). */
  total: number;
  rows: DriverTally[];
};

export type SafetyScoreRow = {
  workerId: string;
  name: string;
  /**
   * Güvenlik skoru 0–100, YA DA null. null = "yeterli sürüş verisi yok" (aralıkta
   * güvenilir km < eşik): ne 100 ne 0, nötr. Skor yalnız eşiği geçen şoför için
   * hesaplanır — böylece "hiç sürmemiş" ile "temiz sürmüş" karışmaz.
   */
  score: number | null;
  totalEvents: number;
  penalty: number;
  /** Ceza hangi birimle normalize edildi — skor artık yalnız km bazlı. */
  basis: "km" | "gun";
  distanceKm: number | null;
  /**
   * BU ŞOFÖR İÇİN HESAPLANAN KM EŞİĞİ — kapının kendisi (18.08.2026, eklendi).
   *
   * `score` null olduğunda "neden" sorusunun cevabı bugüne kadar hiçbir yüzeye
   * taşınmıyordu: ekranda yalnız "Yetersiz veri" yazıyor, kapının nerede olduğu
   * ve şoförün ne kadar uzakta kaldığı görünmüyordu. `distanceKm` (skorun
   * paydası) ile birlikte okununca cümle tamamlanır: "260 km ölçüldü, eşik 300".
   *
   * Eşik ŞOFÖRE GÖRE değişir — sabit değildir (bkz. scoreMinKmForWorkedDays /
   * scoreMinKmForSpan). Bu yüzden istemci onu bir sabitten türetemez; kararı
   * veren fonksiyon ne kullandıysa o taşınmalıdır.
   *
   * SALT RAPORLAMA: skoru hesaplayan hiçbir dal bu alanı okumaz.
   */
  minKm: number;
  activeDays: number;
  trend: "up" | "down" | "flat" | null;
  prevScore: number | null;
};

export type IdleWasteRow = {
  key: string;
  name: string;
  totalMs: number;
  episodeCount: number;
  liters: number;
  euro: number;
};

export type IdleWasteSummary = { rows: IdleWasteRow[]; totalMs: number; totalEuro: number };

/**
 * SAHİPSİZ OLAY KÖPRÜSÜ (20.08.2026) — "sessiz eksik yasak" kuralının gereği.
 *
 * Analiz sayfasının KPI'ı "toplam olay" der; skor tablosu bundan AZINI toplar.
 * Aradaki fark, 15.08 eksen düzeltmesinden beri hiçbir şoföre yazılmayan
 * olaylardır: araç vardiya açılmadan kullanılmışsa o anda direksiyonda kimin
 * olduğu BİLİNMİYOR ve uydurma atıf yapılmıyor (bkz. computeSafetyScores).
 * Doğru davranış, ama fark ekranda yazılı olmadığı sürece "sayılar tutmuyor"
 * gibi görünüyordu.
 *
 * ⚠️ KİMLİK: `scorable === attributed + ownerless + outOfRoster`. Üç kova da
 * döner ki toplam her zaman kapansın; ekranda ikisini gösterip üçüncüsünü
 * yutmak, kapatmaya çalıştığımız kusurun aynısı olurdu.
 */
export type OwnerlessVehicleRow = {
  vehicleId: string;
  plate: string;
  /** Bu araçta sahipsiz kalan olay sayısı. */
  count: number;
  /** Aralıkta bu araç için AÇILMIŞ vardiya sayısı — 0 ise araç hiç kayda girmemiş. */
  shifts: number;
  /** Aracın kağıt üzerindeki şoförü; atanmamışsa null. Atıf İÇİN KULLANILMAZ. */
  assignedName: string | null;
};

export type OwnerlessEventsSummary = {
  /** Skorlanabilir olay (ağırlığı olan alarm + rölanti epizodu). */
  scorable: number;
  /** Bir şoförün vardiya penceresine düşen ve skor satırına giren olay. */
  attributed: number;
  /** Hiçbir vardiya penceresine düşmeyen olay — kimseye yazılmaz. */
  ownerless: number;
  /**
   * Penceresi bulundu ama şoför kadroda değil (test/kapsam dışı). Canlıda 0
   * olması beklenir; 0 değilse kimlik yine kapanır ama sebep GÖRÜNÜR olur.
   */
  outOfRoster: number;
  /** Sahipsiz olayların araç kırılımı, çoktan aza sıralı. */
  vehicles: OwnerlessVehicleRow[];
};
