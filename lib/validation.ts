import { z } from "zod";

export const phoneSchema = z
  .string()
  .trim()
  .min(6, "errPhone")
  .max(20, "errPhone");

// New PINs (create worker / reset) must be 6 digits — 4 digits (10k keyspace)
// is brute-forceable. Used by createWorkerSchema and the reset generator.
export const pinSchema = z.string().regex(/^\d{6}$/, "errPin");

// Login is more lenient DURING the transition so workers whose PIN is still the
// old 4-digit one are not locked out before an admin resets them to 6 digits.
// Once everyone is migrated this can be tightened to /^\d{6}$/.
export const loginPinSchema = z.string().regex(/^\d{4,6}$/, "errPin");

export const loginSchema = z.object({
  phone: phoneSchema,
  pin: loginPinSchema,
});

export const startShiftSchema = z.object({
  start_km: z.coerce.number().int().nonnegative("errKmNeg"),
  plate: z.string().trim().max(20).optional().nullable(),
  expected_cargo: z.coerce.number().int().nonnegative().optional().nullable(),
  vehicle_id: z.string().uuid().optional().nullable(),
});

export const endShiftSchema = z.object({
  end_km: z.coerce.number().int().nonnegative("errKmNeg"),
  plate: z.string().trim().max(20).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  break_minutes: z.coerce.number().int().min(0).max(1440).optional().nullable(),
  cargo_count: z.coerce.number().int().min(0).max(100000).optional().nullable(),
  undelivered_count: z.coerce.number().int().min(0).max(100000).optional().nullable(),
});

export const editEntrySchema = z.object({
  id: z.string().uuid(),
  started_at: z.string().min(1),
  ended_at: z.string().optional().nullable(),
  start_km: z.coerce.number().int().nonnegative("errKmNeg"),
  end_km: z.coerce.number().int().min(0).optional().nullable(),
  plate: z.string().trim().max(20).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  break_minutes: z.coerce.number().int().min(0).max(1440).optional().nullable(),
  cargo_count: z.coerce.number().int().min(0).max(100000).optional().nullable(),
});

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
  scheduled_at: z.string().min(1),
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
  fueled_at: z.string().min(1),
  liters: euroNumber,
  total_cost: euroNumber,
  odometer_km: z.coerce.number().int().positive("errKm"),
  fuel_type: z.enum(["diesel", "benzin", "lpg", "elektro"]),
  station_name: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const createExpenseSchema = z.object({
  spent_at: z.string().min(1),
  category: z.enum(["maut", "verpflegung", "parking", "diesel", "sonstige"]),
  amount: euroNumber,
  description: z.string().trim().max(300).optional().nullable(),
  vehicle_plate: z.string().trim().max(20).optional().nullable(),
});

export const createMaintenanceSchema = z.object({
  vehicle_plate: z.string().trim().min(1, "errPlate").max(20),
  serviced_at: z.string().min(1),
  service_type: z.enum([
    "oil_change",
    "inspection",
    "tire_change",
    "brake_check",
    "general_service",
    "repair",
    "other",
  ]),
  odometer_km: z.coerce.number().int().positive("errKm"),
  cost: euroNumberOptional,
  description: z.string().trim().max(500).optional().nullable(),
  next_service_km: z.coerce.number().int().positive().optional().nullable(),
  next_service_date: z.string().optional().nullable(),
});
