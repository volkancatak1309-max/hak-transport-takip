import type { NextRequest } from "next/server";
import { requireMobileFleetView } from "@/lib/mobile-scope";
import { listLatestVehiclePositions } from "@/lib/telemetry";
import { listVehiclesWithStatus } from "@/lib/vehicles";
import { fleetLabeller } from "@/lib/mobile-labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/map — canlı araç konumları.
 *
 * KAPI: requireMobileFleetView ↔ /admin/harita sayfasının requireFleetView()'i.
 * VERİ: listLatestVehiclePositions(fleetScope) + listVehiclesWithStatus(fleetScope)
 * — haritanın okuduğu iki fonksiyonun aynısı. Konum, hız, kontak ve son sinyal
 * anı cihazdan geldiği gibi taşınır; burada hiçbir türetme yapılmaz.
 *
 * Tek istisna `sonSinyalMs`: (şimdi − recorded_at) farkı. Bu bir metrik değil,
 * istemcinin "kaç dakika önce" yazabilmesi için verilen kolaylık; ham
 * `sonSinyal` da yanıtta duruyor, istemci isterse kendisi hesaplar.
 *
 * ── FİLO RENGİ HAKKINDA ───────────────────────────────────────────────────
 * Renk DEĞERİ döndürülmüyor, çünkü bu depoda taşınabilir bir renk değeri YOK:
 * FLEET_STYLE (lib/vehicle-ui.ts) Tailwind sınıf adları taşıyor ve gerçek renk
 * `app/globals.css`'teki `--fleet-bordo` / `--fleet-mavi` CSS değişkenlerinde,
 * üstelik açık/koyu temaya göre değişiyor. Buraya bir hex yazmak İKİNCİ bir
 * kaynak yaratır ve tasarım tokenı değiştiğinde sessizce ayrışır.
 * Bunun yerine filo KODU (`bordo`/`mavi`) ve kiracıya göre çözülmüş ETİKET
 * veriliyor; renk eşlemesi mobil uygulamanın kendi temasında yapılmalı.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileFleetView(req);
  if (!guard.ok) return guard.response;
  const { fleetScope, isChief, fleet } = guard.actor;

  const fleetName = await fleetLabeller();
  const [positions, vehicles] = await Promise.all([
    listLatestVehiclePositions(fleetScope),
    listVehiclesWithStatus(fleetScope),
  ]);

  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const now = Date.now();

  const araclar = positions.map((p) => {
    const v = byId.get(p.vehicle_id);
    return {
      id: p.vehicle_id,
      plaka: p.plate,
      filo: p.fleet,
      filoEtiketi: fleetName(p.fleet),
      konum: { lat: p.latitude, lng: p.longitude },
      hizKmh: p.speed_kmh,
      yon: p.heading,
      kontak: p.ignition_on,
      sonSinyal: p.recorded_at,
      sonSinyalMs: now - new Date(p.recorded_at).getTime(),
      durum: v?.live_status ?? null,
      sofor: v?.driver_name ?? null,
      soforCanli: v?.driver_is_live ?? false,
      canliSoforler: v?.live_drivers ?? [],
    };
  });

  return Response.json({
    ok: true,
    kapsam: { isChief, fleet },
    olcumAni: new Date(now).toISOString(),
    /** Konum gönderen araç sayısı / kapsamdaki toplam araç sayısı. */
    sayim: { konumlu: araclar.length, toplamArac: vehicles.length },
    araclar,
  });
}
