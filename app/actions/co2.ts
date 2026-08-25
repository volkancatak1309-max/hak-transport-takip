"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireFleetView } from "@/lib/session";
import { audit } from "@/lib/security-log";
import { co2AyariYaz, co2Panosu, type CO2Panosu } from "@/lib/co2-db";
import type { CO2Esas } from "@/lib/co2";

/**
 * CO₂ PANOSU — sunucu eylemleri (migration 089).
 *
 * ═══ 🔴 BAYRAK YOK ═══
 *
 * `/admin/yakit` sayfası `FUEL_ENABLED` yoksa `/admin`e yönlendiriyor ve CO₂
 * raporu oraya gömülü olduğu için ÜRETİMDE ERİŞİLEMİYORDU. CO₂ panosu kendi
 * sayfasında ve BAYRAKSIZ: yakıt modülü kapalı olsa bile telemetri litresi
 * ölçülüyor ve müşteri CO₂ raporunu bugün istiyor.
 *
 * Aynı ders `app/api/mobile/_rapor/csv.ts`te de yazılı: FUEL_ENABLED yakıt
 * GİRİŞİNİ kapatan bayrak, RAPORU kapatan bayrak değil.
 *
 * ═══ İKİ KAPI ═══
 *   OKUMA → `requireFleetView`
 *   AYAR  → `requireAdmin`. Esası (TTW/WTW) değiştirmek raporun tamamının
 *           anlamını değiştirir; şefe açık değil.
 */

const GUN = 86_400_000;

export async function getCO2Panosu(basGun?: string, bitGun?: string): Promise<CO2Panosu> {
  const { session } = await requireFleetView();
  await audit(session.worker_id ?? null, "page_view", "/admin/co2");

  const bit = bitGun ? new Date(`${bitGun}T23:59:59Z`) : new Date();
  const bas = basGun ? new Date(`${basGun}T00:00:00Z`) : new Date(bit.getTime() - 30 * GUN);

  return co2Panosu(bas, bit);
}

export type CO2Sonuc = { ok: true } | { ok: false; hata: string };

export async function co2AyarKaydet(girdi: {
  esas: CO2Esas;
  sebekeGkWh: number | null;
  sebekeKaynak: string | null;
  sebekeYil: number | null;
  hedefGKm: number | null;
  hedefYil: number | null;
}): Promise<CO2Sonuc> {
  const session = await requireAdmin();

  if (girdi.sebekeGkWh !== null && !(girdi.sebekeGkWh >= 0)) {
    return { ok: false, hata: "sebeke_gecersiz" };
  }
  if (girdi.hedefGKm !== null && !(girdi.hedefGKm > 0)) {
    return { ok: false, hata: "hedef_gecersiz" };
  }

  const r = await co2AyariYaz(girdi, session.worker_id ?? null);
  if (!r.ok) return { ok: false, hata: r.hata ?? "hata" };

  await audit(session.worker_id ?? null, "update", `co2_ayari:${girdi.esas}`);
  revalidatePath("/admin/co2");
  return { ok: true };
}
