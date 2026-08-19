import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { getGeofenceById, setGeofenceArchived, geofenceGovdesi } from "@/lib/geofences-db";
import { govdeOku } from "../../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/geofences/[id]/arsiv — gövde {"arsiv": true|false}
 *
 * ═══ ASİMETRİK VE BİLİNÇLİ ═══
 *   arşivle → archived_at = now VE active = false
 *   geri al → archived_at = null, `active` DEĞİŞMEZ → bölge KAPALI döner
 *
 * Arşivlemenin aynı anda kapatması motor filtresini kendiliğinden doğru yapar:
 * `activeDepotZones()` ve kural değerlendirmesi zaten `active=true` süzüyor,
 * dolayısıyla `lib/depot.ts`e TEK SATIR dokunmadan arşivli bölge motordan
 * düşüyor. (Ölçüldü 19.08.2026: arşiv TEK BAŞINA motoru etkilemiyordu —
 * `archived_at` dolu bir depo bölgesi `activeDepotZones()` çıktısında hâlâ
 * görünüyordu.)
 *
 * Geri almanın AÇMAMASI da bilinçli: arşivden çıkarmak bir bölgeyi sessizce
 * yeniden devreye sokmamalı. Bir depo bölgesi geri alındığı anda otomatik
 * vardiya tetiği canlanırdı; açmak ayrı ve görülebilir bir eylem olsun.
 * Yanıttaki `aktif: false` + `geriAlindiKapali: true` bunu istemciye açıkça
 * söyler.
 *
 * ── SİLME YOK ─────────────────────────────────────────────────────────────
 * Arşiv, mobilde silmenin YERİNE geçer. `deleteGeofence` açılmadı: hard DELETE
 * ve canlıda `audit_log` tablosu yok (ölçüldü: PGRST205) → silinen bölgenin
 * adı/merkezi/yarıçapı hiçbir yerde kalmıyor.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const govde = await govdeOku(req);
  if (!govde || typeof govde.arsiv !== "boolean") {
    return mobileError(400, "invalid_body", { alan: "arsiv", bicim: "boolean" });
  }
  const arsiv = govde.arsiv;

  const mevcut = await getGeofenceById(id);
  if (!mevcut) return mobileError(404, "not_found");

  try {
    const satir = await setGeofenceArchived(id, arsiv);
    if (!satir) return mobileError(404, "not_found");

    // Arşivlenen bölge KAPATILIR; bu bir depo tetiğiyse istemci aynı uyarıyı
    // gösterebilsin diye alan burada da döner (`aktif` ucuyla aynı sözleşme).
    const uyari = arsiv && mevcut.purpose === "depot" ? "depo_vardiya_tetigi" : undefined;

    return Response.json({
      ok: true,
      bolge: geofenceGovdesi(satir),
      /** Geri almada true → istemci "kapalı olarak geri alındı" diyebilsin. */
      geriAlindiKapali: !arsiv,
      ...(uyari ? { uyari } : {}),
    });
  } catch (e) {
    return mobileError(503, "db_error", { sebep: String((e as Error).message).slice(0, 120) });
  }
}
