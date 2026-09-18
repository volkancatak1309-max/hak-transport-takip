import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { mobileTenant } from "@/lib/mobile-user";
import { gecerliGun, gunMetrikleri, sonGunler } from "@/lib/vehicle-day";
import { aracOzeti, gunIzi } from "@/lib/vehicle-day-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/vehicles/[id]/metrikler?tarih=YYYY-MM-DD
 * Motor saati · rölanti — bir GÜNÜN cihaz izinden türeyen metrikleri.
 *
 * ⚠️ `gpsKm` KALDIRILDI (18.09.2026, "tek km" kararı). Araç detayının km'si
 * artık TEK kaynaktan gelir: `GET /api/mobile/vehicles/[id]/ozet` → `km` +
 * `kmKaynak` (çekirdek: cihaz → sayaç → null). İz km'si aynı gün için farklı
 * bir sayı veriyordu ve ikisi ekranda yan yana duruyordu.
 *
 * ⚠️ İSTEMCİ BORCU: yayınlanmış mobil sürüm hâlâ "GPS km" karosu çiziyor;
 * alan gelmediği için karo "—" gösterir. Karo bir sonraki mobil sürümde
 * KALDIRILMALI (yerine `ozet.km`).
 *
 * KAPI: requireMobileAdmin — kardeş araç uçlarıyla aynı katman.
 * VERİ: `computeEngineHours` + `computeDistanceKm` + `computeIdleTime` — panelin
 * araç detay sayfasında YAN YANA çağrılan üç fonksiyonun aynısı, tek
 * `listVehicleTrack` sonucunu paylaşarak (panel de öyle yapıyor).
 *
 * ── HESAPLANAMAYAN SIFIR DEĞİLDİR ──────────────────────────────────────────
 * "0 dk rölanti" ile "rölantiyi ölçemedik" aynı piksel, iki ayrı gerçek. Kapılar:
 *   nokta < 2             → ikisi de null, sebep `veri_yok`
 *   hiç kontak verisi yok → motor + rölanti null, sebep `kontak_yok`
 *   hiç hız verisi yok    → rölanti null, sebep `hiz_yok`
 * `sebep` bloğu her metrik için ayrı yazılır; `null` tek başına hangisi
 * olduğunu söyleyemezdi.
 *
 * `belirsiz` = hesaplardan biri veri boşluğu atladı ya da bir kontak aralığını
 * kırptı: sayı yaklaşıktır, "~" ile gösterilmeli.
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

  const iz = await gunIzi(id, tarih);
  if (!iz) return mobileError(400, "invalid_date");

  return Response.json({
    ok: true,
    aracId: arac.id,
    plaka: arac.plaka,
    tarih,
    saatDilimi: mobileTenant().saatDilimi,
    pencere: iz.pencere,
    ...gunMetrikleri(iz.track),
  });
}
