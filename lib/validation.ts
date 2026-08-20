import { z } from "zod";
import { sanitizePhone } from "@/lib/phone";

// Uzunluk ölçümü SANITIZE SONRASI yapılır: görünmez yön işaretleriyle sarılı
// bir numara ("‪+43…‬") aksi halde 2 karakter uzun sayılırdı ve 20
// sınırına dayanan uzun numaralarda "errPhone" verirdi. Şema temizlenmiş
// değeri döndürmez — çağıran taraf canonicalPhone() uygular — burada amaç
// yalnızca doğrulamanın görünmez karakterlerden etkilenmemesi.
export const phoneSchema = z
  .string()
  .trim()
  .refine((v) => {
    const n = sanitizePhone(v).length;
    return n >= 6 && n <= 20;
  }, "errPhone");

// Trivially guessable 6-digit PINs, rejected at creation/change time only.
// Covered: all-same-digit (000000…999999), ascending/descending runs
// (123456, 234567, …, 654321, …) and obvious repeat patterns (123123 etc.).
// NOT applied at login (loginPinSchema stays lenient) so an existing weak or
// 4-digit PIN never locks a driver out before they set a new one.
const WEAK_PIN_PATTERNS = new Set(["123123", "112233", "121212", "123321", "456456"]);

export function isWeakPin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return false; // format is enforced separately
  if (/^(\d)\1{5}$/.test(pin)) return true; // 000000 … 999999
  if ("0123456789".includes(pin) || "9876543210".includes(pin)) return true; // 123456 / 654321
  return WEAK_PIN_PATTERNS.has(pin);
}

// New PINs must be 6 digits — 4 digits (10k keyspace) is brute-forceable — AND
// not trivially weak: a 6-digit keyspace only helps if the value itself isn't
// guessable. This strict rule is used verbatim by changePinSchema (the forced
// PIN-change screen). createWorkerSchema uses a create-time VARIANT that also
// whitelists the sanctioned temp default (see DEFAULT_TEMP_PIN below); the reset
// generator (randomPin) applies the same non-weak rule via isWeakPin directly.
export const pinSchema = z
  .string()
  .regex(/^\d{6}$/, "errPin")
  .refine((p) => !isWeakPin(p), "errPinWeak");

// Saha standardı: yeni şoför OLUŞTURMA akışı geçici PIN 123456 ile başlar;
// must_change_pin=true → sürücü ilk girişte zorunlu değiştirir. isWeakPin bu değeri
// ZAYIF sayar (ardışık artan) — bilerek: sürücü onu KENDİ kalıcı PIN'i yapamaz
// (changePinSchema → pinSchema hâlâ reddeder). Yalnızca YÖNETİCİNİN atadığı
// akışlarda (oluşturma + PIN belirleme) sanctioned geçici değer olarak izinlidir.
export const DEFAULT_TEMP_PIN = "123456";

/**
 * YÖNETİCİNİN bir şoföre atadığı PIN (oluşturma ve "PIN Belirle").
 *
 * pinSchema'dan tek farkı 123456'ya izin vermesi: saha standardı, yönetici bunu
 * telefonda şoföre sözlü iletiyor ve kâğıda yazmıyor. Diğer zayıf kalıplar
 * (000000, 111111, 654321, 121212 …) HÂLÂ reddedilir — 123456 istisnası
 * "zayıf PIN serbest" demek değildir.
 *
 * Şoförün KENDİ seçtiği kalıcı PIN buradan geçmez: changePinSchema katı
 * pinSchema'yı kullanır, yani 123456 kalıcı PIN olamaz.
 */
export const adminSetPinSchema = z
  .string()
  .regex(/^\d{6}$/, "errPin")
  .refine((p) => p === DEFAULT_TEMP_PIN || !isWeakPin(p), "errPinWeak");

// Login is more lenient DURING the transition so workers whose PIN is still the
// old 4-digit one are not locked out before an admin resets them to 6 digits.
// Once everyone is migrated this can be tightened to /^\d{6}$/.
/**
 * ⚠️ `.trim()` ZORUNLU (20.08.2026, telefonda yaşandı).
 *
 * `phoneSchema` kırpıyordu, bu kırpmıyordu. Mobil klavye / şifre yöneticisi
 * sona bir boşluk eklediğinde regex düşüyor, `verifyCredentials` "validation"
 * dönüyor ve ekran **"Telefon veya PIN hatalı"** diyor — yani kullanıcı
 * PIN'ini doğru yazdığı hâlde "yanlış PIN" görüyor ve hatayı asla
 * çözemiyor. Masaüstünde ve `curl` ile hiç görünmez; yalnız gerçek telefonda
 * çıkar. Aynı formdaki iki alandan birinin kırpıp diğerinin kırpmaması
 * başlı başına bir tutarsızlıktı.
 */
export const loginPinSchema = z
  .string()
  .trim()
  .regex(/^\d{4,6}$/, "errPin");

export const loginSchema = z.object({
  phone: phoneSchema,
  pin: loginPinSchema,
});

// Forced PIN change (temp PIN → own PIN). New PIN goes through the strong
// pinSchema (6 digits + not weak); pin_confirm must match. Messages are i18n
// keys mapped to states by changePinAction.
export const changePinSchema = z
  .object({
    pin: pinSchema,
    pin_confirm: z.string(),
  })
  .refine((d) => d.pin === d.pin_confirm, {
    message: "errPinMismatch",
    path: ["pin_confirm"],
  });

// Sanity caps for server-side numeric inputs. Negative values and end<start are
// guarded separately; these block absurd/injected magnitudes (e.g. 2-billion-km
// odometer) that would corrupt reports/AZG. Enforced on the SERVER regardless
// of any client-side input limits.
export const MAX_ODOMETER = 2_000_000; // plausible lifetime vehicle km
export const MAX_PER_SHIFT_KM = 5_000; // one shift cannot realistically exceed this
export const MAX_COUNT = 100_000; // package / cargo counts

// A date/time string that must parse to a real date. Without this guard a
// crafted value like "çöp" passes `z.string().min(1)` and then blows up at
// `new Date(value).toISOString()` inside the actions (RangeError → 500). Here it
// is rejected as ordinary invalid input instead.
const isoDate = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: "errDate" });
const isoDateOptional = isoDate.optional().nullable();

/*
 * startShiftSchema KALDIRILDI (21.07.2026): tek tüketicisi olan startShiftAction
 * ile birlikte gitti. Vardiya artık ya kontaktan ya da panelin tek dokunuşluk
 * "VARDİYAYI BAŞLAT" butonundan açılır; ikisinde de başlangıç km'si CİHAZDAN
 * çözülür (resolveStartKm), istemciden gelen bir km alanı yoktur.
 *
 * endShiftSchema'da da end_km YOK — kapanış km'si sunucuda resolveEndKm ile
 * türetilir. İstemciden km kabul eden hiçbir şema kalmadı; kalsaydı, alan
 * arayüzden silinse bile doğrudan istekle geri girebilirdi.
 */
export const endShiftSchema = z.object({
  plate: z.string().trim().max(20).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  break_minutes: z.coerce.number().int().min(0).max(1440).optional().nullable(),
  cargo_count: z.coerce.number().int().min(0).max(MAX_COUNT).optional().nullable(),
  undelivered_count: z.coerce.number().int().min(0).max(MAX_COUNT).optional().nullable(),
});

export const editEntrySchema = z
  .object({
    id: z.string().uuid(),
    started_at: isoDate,
    ended_at: isoDateOptional,
    start_km: z.coerce.number().int().nonnegative("errKmNeg").max(MAX_ODOMETER, "errKmRange"),
    end_km: z.coerce.number().int().min(0).max(MAX_ODOMETER, "errKmRange").optional().nullable(),
    plate: z.string().trim().max(20).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
    break_minutes: z.coerce.number().int().min(0).max(1440).optional().nullable(),
    // cargo_count (teslim edilen) ARTIK FORMDAN GELMİYOR (22.07.2026):
    // alınan − geri getirilen olarak sunucuda hesaplanır, böylece yönetici
    // tarafı da şoför tarafıyla aynı matematiği kullanır. Şema alanı, eski
    // istemcilerden gelen gönderimlerde patlamamak için opsiyonel kaldı.
    cargo_count: z.coerce.number().int().min(0).max(MAX_COUNT).optional().nullable(),
    // Kaynak alanlar — düzeltilebilir olması gereken ikisi (bkz. teşhis):
    // türetilmiş alan düzenlenebilirken kaynak alanlar düzenlenemiyordu.
    start_package_count: z.coerce.number().int().min(0).max(MAX_COUNT).optional().nullable(),
    undelivered_count: z.coerce.number().int().min(0).max(MAX_COUNT).optional().nullable(),
  })
  .refine(
    (d) => d.end_km == null || d.end_km - d.start_km <= MAX_PER_SHIFT_KM,
    { message: "errKmRange", path: ["end_km"] }
  );

// Opsiyonel "YYYY-MM-DD" — boş string null'a çözülür (input type=date boş kalabilir).
const optionalDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "errDate")
  .optional()
  .nullable();

export const createWorkerSchema = z.object({
  name: z.string().trim().min(2, "errName").max(100),
  phone: phoneSchema,
  // Yöneticinin atadığı PIN — "PIN Belirle" ile aynı kural (bkz.
  // adminSetPinSchema): 123456 serbest, diğer zayıf kalıplar yasak.
  pin: adminSetPinSchema,
  plate: z.string().trim().max(20).optional().nullable(),
  employee_number: z.string().trim().max(20).optional().nullable(),
  is_admin: z.coerce.boolean().optional(),
  // Araç kullanan yönetici muafiyeti (migration 041). Yalnız is_admin=true
  // kayıtta etkisi var; is_admin=false olanda sessizce anlamsızdır.
  counts_as_driver: z.coerce.boolean().optional(),
  // Personel dosyası (migration 025) — HEPSİ opsiyonel: kâğıt formlar eksik
  // gelebiliyor; zorunlu alanlar yalnız yukarıdaki mevcut üçlü (ad/telefon/PIN).
  birth_date: optionalDate,
  email: z.string().trim().email("errEmail").max(120).optional().nullable(),
  address: z.string().trim().max(200).optional().nullable(),
  social_security_no: z.string().trim().max(20).optional().nullable(),
  employment_start: optionalDate,
  employment_type: z.enum(["full_time", "hourly"]).optional().nullable(),
  license_no: z.string().trim().max(30).optional().nullable(),
  license_expiry: optionalDate,
  emergency_contact_name: z.string().trim().max(100).optional().nullable(),
  emergency_contact_relation: z.string().trim().max(50).optional().nullable(),
  emergency_contact_phone: z.string().trim().max(30).optional().nullable(),
});

/**
 * Mevcut çalışan kaydını düzenleme şeması (personel dosyası). createWorkerSchema'nın
 * PIN'siz sürümü: PIN/durum/must_change_pin bu formdan ASLA değişmez (PIN "Sıfırla"
 * ayrı akış). `plate` de yok — şoför↔araç tek kaynağı vehicles.assigned_worker_id;
 * atama `assigned_vehicle_id` üzerinden yürür (action tarafında işlenir). Tüm profil
 * alanları opsiyonel (kâğıt formlar eksik gelebilir), zorunlu olan yalnız ad/telefon.
 */
export const updateWorkerSchema = z.object({
  name: z.string().trim().min(2, "errName").max(100),
  phone: phoneSchema,
  employee_number: z.string().trim().max(20).optional().nullable(),
  /**
   * Yönetici yetkisi (04.08.2026). Eskiden YALNIZ ekleme formundaydı: bir kez
   * yönetici yapılan kişinin yetkisi panelden geri ALINAMIYORDU — yanlışlıkla
   * yönetici eklenen bir şoför öyle kalıyordu. Yazma kapıları (kendi kendini
   * düşürme + son yönetici koruması) app/actions/workers.ts'te.
   */
  is_admin: z.coerce.boolean().optional(),
  // Muafiyet işareti düzenlenebilir olmalı: mevcut bir yöneticinin direksiyona
  // geçmesi kayıt yaratmayı değil, kaydı DÜZENLEMEYİ gerektiren bir durum
  // (migration 041).
  counts_as_driver: z.coerce.boolean().optional(),
  birth_date: optionalDate,
  email: z.string().trim().email("errEmail").max(120).optional().nullable(),
  address: z.string().trim().max(200).optional().nullable(),
  social_security_no: z.string().trim().max(20).optional().nullable(),
  employment_start: optionalDate,
  employment_type: z.enum(["full_time", "hourly"]).optional().nullable(),
  license_no: z.string().trim().max(30).optional().nullable(),
  license_expiry: optionalDate,
  emergency_contact_name: z.string().trim().max(100).optional().nullable(),
  emergency_contact_relation: z.string().trim().max(50).optional().nullable(),
  emergency_contact_phone: z.string().trim().max(30).optional().nullable(),
});

export const breakToggleSchema = z.object({
  break_start: z.string().optional(),
  break_end: z.string().optional(),
});

export const assignmentStopSchema = z.object({
  label: z.string().trim().min(1, "errStopLabel").max(60),
  address: z.string().trim().min(1, "errStopAddress").max(200),
});

export const assignmentCategorySchema = z.enum([
  "lieferung",
  "abholung",
  "kurier",
  "verteilung",
]);

export const createAssignmentSchema = z.object({
  worker_id: z.string().uuid(),
  scheduled_at: isoDate,
  category: assignmentCategorySchema,
  stops: z.array(assignmentStopSchema).min(2, "errStops").max(10),
  package_count: z.coerce.number().int().min(0).max(100000).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

// European decimals: accept "89,50" as well as "89.50".
const euroNumber = z.preprocess((v) => {
  if (typeof v === "string") {
    const n = Number(v.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : v;
  }
  return v;
}, z.number().positive("errAmount"));

const euroNumberOptional = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return undefined;
  if (typeof v === "string") {
    const n = Number(v.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : v;
  }
  return v;
}, z.number().nonnegative().optional());

export const createFuelSchema = z.object({
  vehicle_plate: z.string().trim().min(1, "errPlate").max(20),
  fueled_at: isoDate,
  liters: euroNumber,
  total_cost: euroNumber,
  odometer_km: z.coerce.number().int().positive("errKm").max(MAX_ODOMETER, "errKm"),
  fuel_type: z.enum(["diesel", "benzin", "lpg", "elektro"]),
  station_name: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const createExpenseSchema = z.object({
  spent_at: isoDate,
  category: z.enum(["maut", "verpflegung", "parking", "diesel", "sonstige"]),
  amount: euroNumber,
  description: z.string().trim().max(300).optional().nullable(),
  vehicle_plate: z.string().trim().max(20).optional().nullable(),
});

export const createMaintenanceSchema = z.object({
  vehicle_plate: z.string().trim().min(1, "errPlate").max(20),
  serviced_at: isoDate,
  service_type: z.enum([
    "oil_change",
    "inspection",
    "tire_change",
    "brake_check",
    "general_service",
    "repair",
    "other",
  ]),
  odometer_km: z.coerce.number().int().positive("errKm").max(MAX_ODOMETER, "errKm"),
  cost: euroNumberOptional,
  description: z.string().trim().max(500).optional().nullable(),
  next_service_km: z.coerce.number().int().positive().max(MAX_ODOMETER).optional().nullable(),
  next_service_date: isoDateOptional,
});

// Geofence zone (circle). radius capped at 100 km — beyond that it is not a
// meaningful local zone and is likely a typo. lat/lng bounded to valid ranges.
export const geofenceSchema = z.object({
  name: z.string().trim().min(1, "errRequired").max(80, "errRequired"),
  center_lat: z.coerce.number().min(-90, "errCoord").max(90, "errCoord"),
  center_lng: z.coerce.number().min(-180, "errCoord").max(180, "errCoord"),
  // Minimum 50 m: the detector's hysteresis band is 25 m, so a zone smaller than
  // 2× the band has an empty (or sub-GPS-accuracy) enter-region and could never
  // realistically trigger — reject it instead of silently never firing.
  radius_m: z.coerce.number().int().min(50, "errRadius").max(100_000, "errRadius"),
  rule_kind: z.enum(["forbidden", "allowed_only"]),
  // Amaç (034; 'customer' → 064). 'depot' vardiya-başlatma önerisi tetikler,
  // 'customer' ziyaret süresi ölçümünü açar.
  purpose: z.enum(["rule", "depot", "customer"]).optional().default("rule"),
  // Yalnız purpose='customer' için anlamlı. Boş string → null (form her zaman
  // gönderir; boş bırakılırsa raporda bölge adı kullanılır).
  customer_name: z
    .string()
    .trim()
    .max(80)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  // ALT SINIR 30 sn: bundan kısası GPS örnekleme aralığının altına düşer ve
  // "içeride kesintisiz kaldı" ölçülemez hâle gelir. ÜST SINIR 4 saat: daha
  // uzunu eşik değil, ziyaretin kendisi olur.
  min_dwell_s: z.coerce
    .number()
    .int()
    .min(30, "errDwell")
    .max(14_400, "errDwell")
    .optional()
    .default(120),
});

// Vehicle create/edit. Only plate is truly required (DB: plate unique not null;
// status has a default). flespi_device_id is the flespi NUMERIC device id (not
// the IMEI); imei is the 15–16 digit device IMEI used by the stream ingest.
// Empty optional fields are passed as null by the action before parsing.
export const vehicleSchema = z.object({
  plate: z.string().trim().min(1, "errPlateRequired").max(20, "errPlateRequired"),
  make: z.string().trim().max(60).optional().nullable(),
  model: z.string().trim().max(60).optional().nullable(),
  year: z.coerce.number().int().min(1950, "errYear").max(2100, "errYear").optional().nullable(),
  status: z.enum(["active", "maintenance", "inactive"]),
  // Filo ayrımı (migration 023) — form her zaman gönderir, varsayılan 'mavi'.
  fleet: z.enum(["bordo", "mavi"]),
  // Şoför↔araç eşleşmesinin TEK kaynağı. Boş seçim null gelir (araç şoförsüz).
  assigned_worker_id: z.string().uuid("errDriver").optional().nullable(),
  flespi_device_id: z.coerce
    .number()
    .int()
    .positive("errDevice")
    .max(999_999_999_999_999, "errDevice")
    .optional()
    .nullable(),
  imei: z.string().trim().regex(/^\d{15,16}$/, "errImeiFormat").optional().nullable(),
  // §57a muayene (Pickerl) + sigorta bitiş tarihleri — input type=date "YYYY-MM-DD" verir.
  inspection_due: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "errDate").optional().nullable(),
  insurance_due: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "errDate").optional().nullable(),
  // Depo hacmi (litre) — yakıt raporunun litre/L100km hesabı için. Boş bırakılabilir
  // (o araç %-bazlı kalır). Makul üst sınır: ağır ticari araç deposu ~1500 L'yi aşmaz.
  tank_capacity_l: z.coerce.number().positive("errTank").max(1500, "errTank").optional().nullable(),
});
