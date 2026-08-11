import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { mobileTenant } from "@/lib/mobile-user";
import { gecerliGun, gunDuraklari, sonGunler } from "@/lib/vehicle-day";
import { aracOzeti, gunIzi } from "@/lib/vehicle-day-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/vehicles/[id]/duraklar?tarih=YYYY-MM-DD
 * GPS'ten tespit edilen DURAKLAR ve aralarındaki seferler (haritadaki P işareti).
 *
 * KAPI: requireMobileAdmin — kardeş araç uçlarıyla aynı katman.
 * VERİ: `lib/metrics-trips.ts` `computeTripsAndStops`. Fonksiyon depoda 2026
 * başından beri YAZILI ama hiçbir yerden çağrılmıyordu (keşif belgesi madde 4);
 * bu uç onun İLK tüketicisi. Kalıcı tablo yok, hesap izden türer.
 *
 * ── BU DURAKLAR "SEFER" TABLOSU DEĞİLDİR ───────────────────────────────────
 * Yöneticinin elle girdiği `assignments` (seferler) ile hiçbir ilgisi yok ve o
 * tabloya dokunulmuyor. Buradaki sefer, iki durak ARASINDAKİ hareket.
 *
 * ── EŞİKLER YANITTA ────────────────────────────────────────────────────────
 * `esikler` bloğu uçtan gelir: 3 km/h altı duruş sayılır, 3 dk'dan kısa bekleme
 * durak DEĞİLDİR (trafik ışığı), 40 m yarıçap aynı durak, 15 dk'lık sessizlik
 * veri boşluğudur. Ekran "neden burada durak yok" sorusunu bu sayılarla
 * cevaplayabilsin diye taşınıyor — istemciye kopyalanacak sabit değil.
 *
 * ── BELİRSİZLİK GİZLENMEZ ──────────────────────────────────────────────────
 * Veri boşluğu varsa `belirsiz:true` ve `bosluk` kaç kere olduğunu söyler:
 * cihaz susmuşken araç durmuş mu yürümüş mü BİLİNEMEZ, segmentasyon yaklaşıktır.
 * İki noktadan az izde `toplamSeferKm` null — sıfır değil.
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
    ...gunDuraklari(iz.track),
  });
}
