/** İstihdam türü (migration 025) — personel formundaki "Tam zamanlı / Saatlik". */
export type EmploymentType = "full_time" | "hourly";

export type Worker = {
  id: string;
  name: string;
  phone: string;
  pin_hash: string;
  plate: string | null;
  employee_number: string | null;
  is_admin: boolean;
  /**
   * ARAÇ KULLANAN YÖNETİCİ muafiyeti (migration 041). YALNIZ is_admin=true
   * kayıtlarda anlamlıdır: true → lib/driver-scope.ts bu kaydı ELEMEZ,
   * vardiyaları şoför metriklerine ve § 26 AZG raporuna girer. Varsayılan
   * false = bugünkü davranış ("yönetici personeldir, şoför değildir").
   */
  counts_as_driver: boolean;
  is_active: boolean;
  /**
   * İşten çıkış tarihi (son çalışma günü, migration 032). null = çalışıyor.
   * Set edilirken is_active=false de yazılır → canlı yüzeyler kendiliğinden düşürür;
   * geçmiş raporlarda adı KALIR (7 yıl arşiv, § 132 BAO).
   */
  terminated_at: string | null;
  // Set true for temp PINs (admin create / reset); login forces a change at
  // /pin and changePinAction clears it (migration 019).
  must_change_pin: boolean;
  created_at: string;
  // Personel dosyası alanları (migration 025) — hepsi opsiyonel; kâğıt formlar
  // eksik gelebiliyor, boş alan "girilmedi" demektir, hata değil.
  birth_date: string | null;
  email: string | null;
  address: string | null;
  social_security_no: string | null;
  employment_start: string | null;
  employment_type: EmploymentType | null;
  license_no: string | null;
  license_expiry: string | null;
  emergency_contact_name: string | null;
  emergency_contact_relation: string | null;
  emergency_contact_phone: string | null;
};

/** Worker fields safe to send to the client — everything EXCEPT pin_hash. */
export type WorkerPublic = Omit<Worker, "pin_hash">;

/**
 * Explicit column list for any `workers` query whose result reaches the client
 * (page props, server-action return values). NEVER add pin_hash here: a bcrypt
 * hash of a short numeric PIN is trivially brute-forced offline, so it must
 * never leave the server. Use this instead of `select("*")` for client-bound
 * worker data. Server-only flows that need the hash (login) select it explicitly.
 */
export const WORKER_PUBLIC_COLUMNS =
  "id, name, phone, plate, employee_number, is_admin, counts_as_driver, is_active, terminated_at, created_at, birth_date, email, address, social_security_no, employment_start, employment_type, license_no, license_expiry, emergency_contact_name, emergency_contact_relation, emergency_contact_phone";

/**
 * Shift-start confirmation (migration 020): 'pending' = auto-started, waiting
 * for the driver's one-tap confirm; 'confirmed' = driver confirmed (or legacy
 * manual start); 'unconfirmed' = shift ended without a confirm → admin badge.
 */
export type ShiftConfirmationStatus = "pending" | "confirmed" | "unconfirmed";

/** How a shift was closed (migration 020). Null on legacy rows. */
export type ShiftEndReason = "manual" | "auto_idle" | "watchdog" | "admin";

export type TimeEntry = {
  id: string;
  worker_id: string;
  started_at: string;
  ended_at: string | null;
  start_km: number;
  end_km: number | null;
  plate: string | null;
  notes: string | null;
  break_minutes: number | null;
  cargo_count: number | null;
  undelivered_count: number | null;
  updated_at: string | null;
  updated_by: string | null;
  summary_notified_at: string | null;
  created_at: string;
  // Vehicle layer (migration 009) — all nullable / additive.
  vehicle_id: string | null;
  break_started_at: string | null;
  start_package_count: number | null;
  // Driver panel v2 (migration 020) — auto shift + confirmation + signature.
  auto_started: boolean;
  confirmation_status: ShiftConfirmationStatus;
  confirmed_at: string | null;
  auto_ended: boolean;
  end_reason: ShiftEndReason | null;
  summary_confirmed_at: string | null;
  summary_confirmed_by: string | null;
};

/** One "+1 PAKET" tap with its GPS fix (migration 020, audit trail). */
export type ShiftPackage = {
  id: string;
  time_entry_id: string;
  worker_id: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  recorded_at: string;
  created_at: string;
};

/** A shift photo (FOTO ÇEK) with location + time stamp (migration 020). */
export type ShiftPhoto = {
  id: string;
  time_entry_id: string;
  worker_id: string;
  storage_path: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  taken_at: string;
  created_at: string;
};

export type DriverReportType =
  | "vehicle_fault"
  | "address_issue"
  | "damaged_package"
  | "other";

/** A one-tap driver problem report (SORUN BİLDİR, migration 020). */
export type DriverReport = {
  id: string;
  worker_id: string;
  time_entry_id: string | null;
  vehicle_id: string | null;
  report_type: DriverReportType;
  latitude: number | null;
  longitude: number | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
};

// --- Vehicle layer ---

export type VehicleBaseStatus = "active" | "maintenance" | "inactive";

/** Fleet membership (migration 023): two named fleets — bordo & mavi — color
 *  the vehicle everywhere (map pill, list badge, filters), working or idle. */
export type VehicleFleet = "bordo" | "mavi";

export type Vehicle = {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  year: number | null;
  status: VehicleBaseStatus;
  assigned_worker_id: string | null;
  inspection_due: string | null;
  insurance_due: string | null;
  notes: string | null;
  created_at: string;
  // flespi / Teltonika hardware tracker (migration 013) — additive, nullable.
  flespi_device_id: number | null;
  // Device IMEI for the flespi stream push ingest (migration 016) — nullable.
  imei: string | null;
  // Device-reported VIN (migration 021), backfilled from telemetry — nullable.
  vin: string | null;
  // Fleet separation (migration 023) — not null, defaults to 'mavi'.
  fleet: VehicleFleet;
  // Depo hacmi (litre) — yakıt raporunun % → litre / L100km çevrimi için tek
  // kaynak. Supabase'de dolu (28 araç 60-80 L); null ise rapor %-bazlı kalır.
  tank_capacity_l: number | null;
};

/** Live operational status — derived, never stored. NO green/red. */
export type VehicleLiveStatus = "sevkiyatta" | "molada" | "bosta" | "bakimda";

export type VehicleWithStatus = Vehicle & {
  live_status: VehicleLiveStatus;
  /** Current driver (active shift) or, if idle, the assigned/primary driver. */
  driver_name: string | null;
  driver_id: string | null;
  /** Whether driver_name is the live (active-shift) driver vs. just assigned. */
  driver_is_live: boolean;
  /**
   * Bu araçta ŞU AN açık vardiyası olan TÜM şoförler (22.07.2026).
   * Geçici araç seçimi serbest bırakıldığı için bir araca iki kişi
   * binebiliyor; yönetici ikisini de görmeli, `driver_name` yalnız
   * ilkini taşıyordu ve eksik bilgi veriyordu.
   */
  live_drivers: string[];
};

/** A traffic/parking penalty (Strafe) booked against a vehicle (migration 014). */
export type VehiclePenalty = {
  id: string;
  vehicle_id: string;
  penalty_date: string;
  amount: number | null;
  description: string | null;
  paid: boolean;
  paid_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type TimeEntryWithWorker = TimeEntry & {
  workers: Pick<Worker, "id" | "name" | "plate"> | null;
};

export type DriverLocation = {
  id: string;
  worker_id: string;
  time_entry_id: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recorded_at: string;
};

/**
 * Vehicle-centric GPS telemetry from a flespi / Teltonika hardware tracker
 * (migration 014). Separate from DriverLocation (phone GPS, shift-bound): a
 * hardwired tracker reports 24/7, keyed by vehicle, not gated on a shift.
 */
export type DeviceTelemetry = {
  id: string;
  vehicle_id: string;
  flespi_device_id: number;
  latitude: number;
  longitude: number;
  speed_kmh: number | null;
  heading: number | null;
  ignition_on: boolean | null;
  recorded_at: string;
  ingested_at: string;
};

export type ActiveDriver = {
  worker_id: string;
  name: string;
  plate: string | null;
  shift_started_at: string;
  /**
   * Şoförün BUGÜN zaten kapattığı vardiyaların toplam çalışma süresi (ms).
   * Yan paneldeki AZG tavan rozeti bunu açık vardiyanın süresine ekler —
   * § 9 Abs. 1 tavanı GÜNE aittir, tek vardiyaya değil (14.08.2026).
   * Opsiyonel: eski bir çağıran alanı doldurmazsa rozet eski davranışına
   * (yalnız açık vardiya) düşer, patlamaz.
   */
  prior_today_ms?: number;
  time_entry_id: string;
  // Konum artık opsiyonel: vardiyası açık ama aracı o an sinyal vermeyen şoför de
  // listede kalır (harita şoför sekmesi = açık vardiya sayacıyla aynı küme).
  //   live    = son 10 dk içinde taze ping
  //   stale   = daha eski "son bilinen konum" var
  //   waiting = bu vardiyada hiç konum yok ("konum bekleniyor")
  latitude: number | null;
  longitude: number | null;
  recorded_at: string | null;
  locStatus: "live" | "stale" | "waiting";
  route: [number, number][];
};

/**
 * A vehicle's latest hardware-tracker (flespi/Teltonika) position for the live
 * map. Vehicle-centric and shift-independent — rendered as its own map layer
 * next to (never merged with) the driver/phone layer.
 */
export type ActiveVehicle = {
  vehicle_id: string;
  plate: string;
  fleet: VehicleFleet;
  latitude: number;
  longitude: number;
  speed_kmh: number | null;
  heading: number | null;
  ignition_on: boolean | null;
  recorded_at: string;
};

/**
 * Freshness threshold for the vehicle map layer: fixes younger than this render
 * in the normal fleet color, older ones faded/gray with a "son görülme" hint —
 * the vehicle itself NEVER drops off the map. Wide because hardware trackers
 * ping rarely (or not at all) while parked with the ignition off.
 */
export const VEHICLE_FRESH_MS = 60 * 60 * 1000; // 60 min

export type AssignmentStop = { label: string; address: string };
export type AssignmentCategory = "lieferung" | "abholung" | "kurier" | "verteilung";
export type AssignmentStatus = "assigned" | "started" | "completed" | "cancelled";

export type Assignment = {
  id: string;
  worker_id: string;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  stops: AssignmentStop[];
  start_km: number | null;
  end_km: number | null;
  category: AssignmentCategory;
  package_count: number | null;
  notes: string | null;
  status: AssignmentStatus;
  cancel_reason: string | null;
  assignment_notified_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AssignmentWithWorker = Assignment & {
  worker_name: string;
  worker_plate: string | null;
};

export type ApprovalStatus = "pending" | "approved" | "rejected";
export type FuelType = "diesel" | "benzin" | "lpg" | "elektro";
export type ExpenseCategory = "maut" | "verpflegung" | "parking" | "diesel" | "sonstige";
export type MaintenanceType =
  | "oil_change"
  | "inspection"
  | "tire_change"
  | "brake_check"
  | "general_service"
  | "repair"
  | "other";

export type FuelEntry = {
  id: string;
  worker_id: string | null;
  vehicle_plate: string;
  fueled_at: string;
  liters: number;
  total_cost: number;
  cost_per_liter: number;
  odometer_km: number;
  fuel_type: FuelType;
  station_name: string | null;
  receipt_path: string;
  receipt_url: string | null;
  status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FuelEntryWithWorker = FuelEntry & {
  worker_name: string;
  consumption?: number | null; // L/100km vs the previous fill for this vehicle
};

export type ExpenseEntry = {
  id: string;
  worker_id: string | null;
  spent_at: string;
  category: ExpenseCategory;
  amount: number;
  description: string | null;
  vehicle_plate: string | null;
  receipt_path: string;
  receipt_url: string | null;
  status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ExpenseEntryWithWorker = ExpenseEntry & {
  worker_name: string;
};

export type VehicleMaintenance = {
  id: string;
  vehicle_plate: string;
  serviced_at: string;
  service_type: MaintenanceType;
  odometer_km: number;
  cost: number | null;
  description: string | null;
  next_service_km: number | null;
  next_service_date: string | null;
  receipt_path: string | null;
  receipt_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SessionData = {
  worker_id?: string;
  name?: string;
  phone?: string;
  is_admin?: boolean;
  plate?: string | null;
  // Mirrors workers.must_change_pin at login time; gates the panel until the
  // driver sets a new PIN at /pin (migration 019).
  must_change_pin?: boolean;
  /**
   * Giriş anındaki workers.session_version (migration 045). Tek oturum kilidi
   * ve "oturumları sonlandır" bunu kullanır: DB'deki sayaç artınca çerezdeki
   * değer eskir ve oturum reddedilir. Katman kapalıyken hiç yazılmaz/okunmaz.
   */
  session_version?: number;
  /** Açık login_sessions satırının id'si — çıkışta kapatmak için (045). */
  login_session_id?: string;
  /**
   * BEKLEYEN ERİŞİM KAPISI (046) — "device" | "country".
   *
   * Doluysa kullanıcı kimliğini doğrulamıştır ama İÇERİ ALINMAMIŞTIR: tüm
   * kapılar onu /erisim ekranına gönderir. Neden oturum kuruluyor da boş
   * bırakılmıyor: onay satırı KİŞİYE ait, dolayısıyla bekleyenin kim olduğunu
   * bilmemiz gerekiyor. Reddedilen (saat/anahtar) durumda oturum HİÇ kurulmaz.
   */
  access_gate?: "device" | "country";
  /**
   * GÖLGE MODU (dalga 3) — patronun "gözünden baktığı" yöneticinin id'si.
   *
   * ⚠️ `worker_id` DEĞİŞMEZ, patronun kendisi kalır. Ayrı bir alan olmasının
   * sebebi tam olarak bu: eylem izi `worker_id` ile yazıldığı için gölge
   * modundaki gezinme OTOMATİK OLARAK patron adına düşer, taklit edilenin
   * adına değil. Kimliği değiştirseydik log kirlenir ve "Furkan o sayfaya
   * baktı" diyen sahte satırlar doğardı.
   *
   * Kapsam kararları (kimin neyi gördüğü) ise bu alana bakar —
   * bkz. effectiveViewerId().
   */
  shadow_of?: string;
  /** Gölgelenen kişinin adı — şerit her sayfada sorgu atmadan yazsın diye. */
  shadow_name?: string;
};

export type GeofenceRuleKind = "forbidden" | "allowed_only";
/**
 * Bölgenin amacı = DAVRANIŞ anahtarı (migration 034, 'customer' → 064).
 *  • 'rule'     → ihlal olayı üretir (yasak / sadece-burada).
 *  • 'depot'    → panelde "mesaiyi başlat?" önerisi + otomatik vardiya tetiği.
 *  • 'customer' → müşteri sahasi: ziyaret SÜRESİ ölçülür (fatura kanıtı).
 *
 * Üçü de KURAL DEĞİL DAVRANIŞ seçer ve bilinçli olarak `category`den ayrıdır:
 * `category` mobilden serbestçe değişen bir ROZET; ölçüm ona bağlansaydı
 * telefondaki bir menü dokunuşu faturalama kanıtını sessizce durdururdu.
 */
export type GeofencePurpose = "rule" | "depot" | "customer";

/** A circular geofence zone (db/migrations/015_geofences.sql). */
export type Geofence = {
  id: string;
  name: string;
  type: "circle";
  center_lat: number;
  center_lng: number;
  radius_m: number;
  rule_kind: GeofenceRuleKind;
  purpose: GeofencePurpose;
  active: boolean;
  created_at: string;
  /** purpose='customer' — raporda görünen müşteri adı (migration 064). */
  customer_name?: string | null;
  /**
   * Ziyaret sayılmak için içeride kesintisiz kalınması gereken saniye (064).
   * Yoksa bölgenin yanından geçen her araç faturaya girerdi. Varsayılan 120.
   */
  min_dwell_s?: number | null;
};
