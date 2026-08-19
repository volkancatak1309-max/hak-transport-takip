import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { getGeofenceById, setGeofenceActive, geofenceGovdesi } from "@/lib/geofences-db";
import { govdeOku } from "../../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/geofences/[id]/aktif — gövde {"aktif": true|false}
 *
 * Panelin `toggleGeofence`iyle aynı tek alanlık güncelleme.
 *
 * ═══ DEPO KAPATMA UYARISI ═══
 *
 * `purpose='depot'` bir bölge KAPATILIRKEN yanıt `uyari: "depo_vardiya_tetigi"`
 * taşır. Gerekçe ölçülü: `activeDepotZones()` yalnız `active=true` bölgeleri
 * döndürüyor, yani son açık depo bölgesini kapatmak şunları BİRDEN durdurur —
 *   · otomatik vardiya başlatma (son 30 günde 511 vardiyanın 346'sı, %68)
 *   · manuel başlatmadaki depo kilidi (kilit kalkar, her yerden açılabilir)
 *   · vardiya başlangıç anının depo girişinden türetilmesi
 * ve bunların HİÇBİRİ hata vermez; sistem sessizce dejenere olur.
 *
 * ⚠️ UYARI ENGEL DEĞİL. İşlem YAPILIR, uyarı yanıtta döner; istemci onay
 * diyaloğunu gösterip geri almayı teklif eder. Sunucuda engellemek, tek depolu
 * bir kurulumda yöneticinin kendi bölgesini kapatamaması demekti.
 *
 * ⚠️ Uyarı KATEGORİYE değil `purpose`a bakar: mobilden açılmış "depot"
 * kategorili bir bölge vardiya tetiği DEĞİLDİR ve boş yere uyarı üretmez.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const govde = await govdeOku(req);
  if (!govde || typeof govde.aktif !== "boolean") {
    return mobileError(400, "invalid_body", { alan: "aktif", bicim: "boolean" });
  }
  const aktif = govde.aktif;

  const mevcut = await getGeofenceById(id);
  if (!mevcut) return mobileError(404, "not_found");

  try {
    const satir = await setGeofenceActive(id, aktif);
    if (!satir) return mobileError(404, "not_found");

    // Uyarı KAPATMADA ve yalnız gerçek davranış anahtarında.
    const uyari = !aktif && mevcut.purpose === "depot" ? "depo_vardiya_tetigi" : undefined;

    return Response.json({
      ok: true,
      bolge: geofenceGovdesi(satir),
      ...(uyari ? { uyari } : {}),
    });
  } catch (e) {
    return mobileError(503, "db_error", { sebep: String((e as Error).message).slice(0, 120) });
  }
}
