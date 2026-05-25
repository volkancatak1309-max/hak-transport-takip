import { z } from "zod";

export const phoneSchema = z
  .string()
  .trim()
  .min(6, "errPhone")
  .max(20, "errPhone");

export const pinSchema = z.string().regex(/^\d{4}$/, "errPin");

export const loginSchema = z.object({
  phone: phoneSchema,
  pin: pinSchema,
});

export const startShiftSchema = z.object({
  start_km: z.coerce.number().int().nonnegative("errKmNeg"),
  plate: z.string().trim().max(20).optional().nullable(),
  expected_cargo: z.coerce.number().int().nonnegative().optional().nullable(),
});

export const endShiftSchema = z.object({
  end_km: z.coerce.number().int().nonnegative("errKmNeg"),
  plate: z.string().trim().max(20).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  break_minutes: z.coerce.number().int().min(0).max(1440).optional().nullable(),
  cargo_count: z.coerce.number().int().min(0).max(100000).optional().nullable(),
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
