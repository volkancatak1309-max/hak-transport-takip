import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { getVehicleDetail } from "@/lib/vehicles";
import { mobileError } from "@/lib/mobile-auth";
import { fleetLabeller } from "@/lib/mobile-labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/vehicles/[id] — araç detayı.
 *
 * KAPI: requireMobileAdmin ↔ /admin/araclar/[id] sayfasının requireAdmin()'i.
 * VERİ: getVehicleDetail(id) — detay sayfasının okuduğu fonksiyonun aynısı.
 * Bugünün km / paket / vardiya özeti ve ceza listesi oradan olduğu gibi gelir.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const d = await getVehicleDetail(id);
  if (!d) return mobileError(404, "not_found");

  const v = d.vehicle;
  const fleetName = await fleetLabeller();
  return Response.json({
    ok: true,
    arac: {
      id: v.id,
      plaka: v.plate,
      marka: v.make,
      model: v.model,
      yil: v.year,
      filo: v.fleet,
      filoEtiketi: fleetName(v.fleet),
      durum: v.status,
      canliDurum: v.live_status,
      sofor: v.driver_name,
      soforId: v.driver_id,
      soforCanli: v.driver_is_live,
      canliSoforler: v.live_drivers,
      muayeneSon: v.inspection_due,
      sigortaSon: v.insurance_due,
      cihaz: {
        flespiId: v.flespi_device_id,
        imei: v.imei,
        vin: v.vin,
        var: v.flespi_device_id != null || !!v.imei,
      },
      depoLitre: v.tank_capacity_l,
      notlar: v.notes,
    },
    bugun: {
      km: d.today.km,
      baslangicKm: d.today.startKm,
      bitisKm: d.today.endKm,
      ilkBaslangic: d.today.firstStart,
      sonBitis: d.today.lastEnd,
      paketAlinan: d.today.startPackages,
      paketTeslim: d.today.endPackages,
    },
    sonVardiyalar: d.recent.map((r) => ({
      id: r.id,
      tarih: r.date,
      sofor: r.driver_name,
      baslangicKm: r.start_km,
      bitisKm: r.end_km,
      km: r.km,
      kapandi: r.ended,
    })),
    cezalar: d.penalties,
  });
}
