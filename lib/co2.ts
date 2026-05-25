import type { FuelType } from "@/lib/types";

// kg CO₂ per litre burned (EU well-to-tank tailpipe convention).
export const CO2_FACTORS: Record<FuelType, number> = {
  diesel: 2.64,
  benzin: 2.31,
  lpg: 1.51,
  elektro: 0,
};

export function co2Kg(liters: number, fuelType: FuelType): number {
  return liters * (CO2_FACTORS[fuelType] ?? CO2_FACTORS.diesel);
}

export type CO2Vehicle = {
  plate: string;
  liters: number;
  km: number;
  lPer100: number | null;
  co2Kg: number;
  gPerKm: number | null;
};

export type CO2ReportData = {
  monthLabel: string;
  generatedAt: string;
  totalLiters: number;
  totalCo2: number;
  totalKm: number;
  avgGPerKm: number | null;
  vehicles: CO2Vehicle[];
};
