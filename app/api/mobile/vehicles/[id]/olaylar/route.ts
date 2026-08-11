import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { mobileTenant } from "@/lib/mobile-user";
import {
  IDLE_TRIGGER_S,
  listVehicleEventsInWindow,
  listVehicleIdleEpisodesInWindow,
} from "@/lib/telemetry";
import { alarmKademe } from "@/lib/event-ui";
import { gecerliGun, gunOlaylari, gunPenceresi, sonGunler } from "@/lib/vehicle-day";
import { aracOzeti } from "@/lib/vehicle-day-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/vehicles/[id]/olaylar?tarih=YYYY-MM-DD
 * Bir kiracı gününün olayları — haritadaki işaretler + detaydaki zaman çizgisi.
 *
 * KAPI: requireMobileAdmin ↔ /admin/alarmlar + araç detayı (ikisi de requireAdmin).
 * VERİ: `listVehicleEventsInWindow` (nokta olayları) + `listVehicleIdleEpisodesInWindow`
 * (rölanti epizodları). Dönüşüm `/api/mobile/shifts/[id]`in alarm bloğuyla
 * BİREBİR aynı (lib/vehicle-day.ts `gunOlaylari`), tek fark pencerenin vardiya
 * değil GÜN olması — aynı sürüş iki ekranda aynı sayıyı vermeli.
 *
 * ── HIZ LİMİTİ ALANI YOK, BİLEREK ──────────────────────────────────────────
 * Referans tasarımdaki "limit 100" çipi bu veriyle ÇİZİLEMEZ: depoda hız limiti
 * ne kolon, ne sabit, ne de cihazdan okunabilen bir eşik olarak var. Cihazın
 * aşırı-hız tetiği bir Teltonika parametresidir ve DB'de değer olarak durmuyor.
 * `kalemler[].hizKmh` ARACIN o andaki hızıdır — 10.08.2026 ölçümü: `overspeeding`
 * satırlarında `speed_kmh` kolonu ile `event_value.speed` birebir aynı sayı
 * (60/60). Limit alanı üretmek uydurma olurdu; üretilmedi.
 *
 * ── RÖLANTİ EPİZODLARI DA BURADA ───────────────────────────────────────────
 * `idling` artık nokta olayı değil EPİZOT (migration 024): süresi olan bir
 * kalem. Zaman çizgisinde onlarsız gün eksik okunur. Epizot penceresinde
 * BAŞLAYANLAR listeye girer (alarmlar sayfasının kuralı) ve süresine
 * IDLE_TRIGGER_S eklenir — cihaz bayrağı fiziksel duruştan o kadar sonra kalkar.
 *
 * TAVAN YOK: iki okuma da `fetchAllRows` ile sayfalanır. Canlıda en yoğun gün
 * filo genelinde 193 olay; tek araçta iki haneli. 1000 satır tavanına
 * yaklaşılmıyor ve sessiz kırpma riski hiç doğmuyor.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const arac = await aracOzeti(id);
  if (!arac) return mobileError(404, "not_found");

  const ham = new URL(req.url).searchParams.get("tarih");
  const tarih = ham === null ? sonGunler(1)[0] : ham;
  if (!gecerliGun(tarih)) return mobileError(400, "invalid_date");
  const pencere = gunPenceresi(tarih);
  if (!pencere) return mobileError(400, "invalid_date");

  const [events, episodes] = await Promise.all([
    listVehicleEventsInWindow(id, pencere.baslangic, pencere.bitis),
    listVehicleIdleEpisodesInWindow(id, pencere.baslangic, pencere.bitis),
  ]);
  const kalemler = gunOlaylari(events, episodes, IDLE_TRIGGER_S);

  const turDagilim: Record<string, number> = {};
  for (const k of kalemler) turDagilim[k.tur] = (turDagilim[k.tur] ?? 0) + 1;

  return Response.json({
    ok: true,
    aracId: arac.id,
    plaka: arac.plaka,
    tarih,
    saatDilimi: mobileTenant().saatDilimi,
    pencere,
    adet: kalemler.length,
    kritikAdet: kalemler.filter((k) => alarmKademe(k.tur) === "kritik").length,
    turDagilim,
    kalemler,
  });
}
