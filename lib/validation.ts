import { z } from "zod";

export const phoneSchema = z
  .string()
  .trim()
  .min(6, "Telefon numarası eksik")
  .max(20, "Telefon numarası çok uzun");

export const pinSchema = z
  .string()
  .regex(/^\d{4}$/, "PIN 4 haneli rakam olmalı");

export const loginSchema = z.object({
  phone: phoneSchema,
  pin: pinSchema,
});

export const startShiftSchema = z.object({
  start_km: z.coerce.number().int().nonnegative("Başlangıç km negatif olamaz"),
  plate: z.string().trim().max(20).optional().nullable(),
});

export const endShiftSchema = z.object({
  end_km: z.coerce.number().int().nonnegative("Bitiş km negatif olamaz"),
  plate: z.string().trim().max(20).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const createWorkerSchema = z.object({
  name: z.string().trim().min(2, "Ad en az 2 karakter olmalı").max(100),
  phone: phoneSchema,
  pin: pinSchema,
  plate: z.string().trim().max(20).optional().nullable(),
  is_admin: z.coerce.boolean().optional(),
});
