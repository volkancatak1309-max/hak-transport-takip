import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { mobileTenant } from "@/lib/mobile-user";
import { GUN_PENCERE_MAX } from "@/lib/vehicle-day";
import { aracOzeti, veriGunleri } from "@/lib/vehicle-day-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/vehicles/[id]/gunler?n=14 — VERİ OLAN günlerin listesi.
 *
 * Rota ekranındaki gün hapları için. "Veri olan gün" tanımı tek cümle: o kiracı
 * gününde aracın EN AZ BİR telemetri noktası var. Noktası sıfır olan gün listeye
 * girmez — hap çizilse boş bir rota açardı.
 *
 * KAPI: requireMobileAdmin ↔ /admin/araclar/[id] sayfasının requireAdmin()'i;
 * kardeş uç /api/mobile/vehicles/[id] ile AYNI katman (filo şefi 403 alır).
 *
 * ── NEDEN ARAÇ BAZLI ───────────────────────────────────────────────────────
 * Keşif belgesi 5b: aynı sayımın FİLO GENELİ hâli 1,07 M satırlık tabloda
 * statement timeout (57014) verdi. Bu uç o yola hiç girmez; her sorgusunda
 * `vehicle_id` eşitliği vardır ve (vehicle_id, recorded_at) indeksini kullanır.
 *
 * ── PENCERE TAVANI SÖYLENİR ────────────────────────────────────────────────
 * `n` 1..14 arasına kırpılır ve yanıt `pencere.gun` + `pencere.enFazla` ile ne
 * kadarına baktığını yazar. Sessiz tavan yok: ekran "14 günün 6'sında veri var"
 * diyebilmek için pencerenin kendisini bilmek zorunda.
 *
 * ── ÖLÇÜLEMEYEN GÜN GİZLENMEZ ──────────────────────────────────────────────
 * Bir günün sorgusu düşerse o gün `olculemeyen[]`e adıyla girer. "Veri yok" ile
 * "bakamadık" aynı şey değildir; ikincisi listeden sessizce düşseydi ekran
 * eksik bir takvimi tam sanırdı.
 *
 * NOKTA SAYISI TAŞINIR: canlıda 24 noktalık günler var (saatlik nabız, araç
 * gün boyu park hâlinde). Gün "veri olan gün"dür ama sürüş günü değildir —
 * ayrımı ekran `nokta` ile yapar, uç kendi başına gün eleme kararı vermez.
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

  const ham = new URL(req.url).searchParams.get("n");
  const sayi = ham === null ? GUN_PENCERE_MAX : Number(ham);
  if (!Number.isInteger(sayi) || sayi < 1) return mobileError(400, "invalid");
  const n = Math.min(sayi, GUN_PENCERE_MAX);

  const { adaylar, gunler, olculemeyen } = await veriGunleri(id, n);

  return Response.json({
    ok: true,
    aracId: arac.id,
    plaka: arac.plaka,
    saatDilimi: mobileTenant().saatDilimi,
    pencere: {
      gun: n,
      enFazla: GUN_PENCERE_MAX,
      ilkGun: adaylar[adaylar.length - 1],
      sonGun: adaylar[0],
    },
    gunler,
    olculemeyen,
  });
}
