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
