import { z } from "zod";

export const phoneSchema = z
  .string()
  .trim()
  .min(6, "errPhone")
  .max(20, "errPhone");

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

// New PINs (create worker / reset) must be 6 digits — 4 digits (10k keyspace)
// is brute-forceable — AND not trivially weak: a 6-digit keyspace only helps
// if the value itself isn't guessable. Used by createWorkerSchema, the reset
// generator and changePinSchema.
export const pinSchema = z
  .string()
  .regex(/^\d{6}$/, "errPin")
  .refine((p) => !isWeakPin(p), "errPinWeak");

// Login is more lenient DURING the transition so workers whose PIN is still the
// old 4-digit one are not locked out before an admin resets them to 6 digits.
// Once everyone is migrated this can be tightened to /^\d{6}$/.
export const loginPinSchema = z.string().regex(/^\d{4,6}$/, "errPin");

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

export const startShiftSchema = z.object({
  start_km: z.coerce.number().int().nonnegative("errKmNeg").max(MAX_ODOMETER, "errKmRange"),
  plate: z.string().trim().max(20).optional().nullable(),
  expected_cargo: z.coerce.number().int().nonnegative().max(MAX_COUNT).optional().nullable(),
  vehicle_id: z.string().uuid().optional().nullable(),
});

export const endShiftSchema = z.object({
  end_km: z.coerce.number().int().nonnegative("errKmNeg").max(MAX_ODOMETER, "errKmRange"),
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
    cargo_count: z.coerce.number().int().min(0).max(MAX_COUNT).optional().nullable(),
  })
  .refine(
    (d) => d.end_km == null || d.end_km - d.start_km <= MAX_PER_SHIFT_KM,
    { message: "errKmRange", path: ["end_km"] }
  );

export const createWorkerSchema = z.object({
  name: z.string().trim().min(2, "errName").max(100),
  phone: phoneSchema,
  pin: pinSchema,
  plate: z.string().trim().max(20).optional().nullable(),
  employee_number: z.string().trim().max(20).optional().nullable(),
  is_admin: z.coerce.boolean().optional(),
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
});
