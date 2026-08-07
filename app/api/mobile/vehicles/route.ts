import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { listVehiclesWithStatus } from "@/lib/vehicles";
import { parsePage, pageInfo } from "@/lib/mobile-list";
import { fleetLabeller } from "@/lib/mobile-labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/vehicles — araç listesi.
 *
 * KAPI: requireMobileAdmin ↔ /admin/araclar sayfasının requireAdmin()'i.
 * Filo şefi panelde bu sayfaya giremiyor; mobilde de 403 alır (bilinçli parite).
 *
 * VERİ: listVehiclesWithStatus() — panelin okuduğu fonksiyonun aynısı; test
 * araçlarının elenmesi de onun içinde (dropTestRows). Burada hiçbir durum ya da
 * sayı yeniden türetilmiyor.
 *
 * Sayfalama bellekte: listVehiclesWithStatus zaten tüm filoyu (≈30 araç) tek
 * seferde okuyor ve canlı durumu açık vardiyalardan türetiyor — sorguyu bölmek
 * durum hesabını bozardı. Filo ölçeği bunu güvenli kılıyor.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const page = parsePage(url);
  const filo = url.searchParams.get("filo");
  const durum = url.searchParams.get("durum");

  const fleetName = await fleetLabeller();
  let all = await listVehiclesWithStatus();
  if (filo) all = all.filter((v) => v.fleet === filo);
  if (durum) all = all.filter((v) => v.live_status === durum);

  const slice = all.slice(page.offset, page.offset + page.limit);

  return Response.json({
    ok: true,
    page: pageInfo(page, all.length),
    araclar: slice.map((v) => ({
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
        /** Cihazlı araç tanımı auto-shift ile aynı: device_id VEYA imei dolu. */
        var: v.flespi_device_id != null || !!v.imei,
      },
      depoLitre: v.tank_capacity_l,
    })),
  });
}
