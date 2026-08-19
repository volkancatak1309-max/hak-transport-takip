import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import {
  getGeofenceById,
  patchGeofence,
  geofenceGovdesi,
  GEOFENCE_CATEGORIES,
} from "@/lib/geofences-db";
import {
  bolgeAlanlariniDogrula,
  govdeOku,
  MOBIL_YARICAP_MIN,
  MOBIL_YARICAP_MAX,
} from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/mobile/geofences/[id] — KISMİ düzenleme (ad / kategori / merkez / yarıçap).
 *
 * ── KISMİ NE DEMEK ────────────────────────────────────────────────────────
 * Gövdede OLMAYAN alan DEĞİŞMEZ. Bu, ekranın tek alanlık düzenlemelerini
 * (yalnız adı değiştir, yalnız sürgüyü oynat) ayrı uçlara bölmeden mümkün
 * kılar. Doğrulama POST ile AYNI fonksiyondan geçer (`bolgeAlanlariniDogrula`)
 * — iki yerde iki farklı sınır olsaydı, oluştururken kabul edilen bir yarıçap
 * düzenlerken reddedilirdi.
 *
 * ⚠️ MERKEZ BÜTÜNDÜR: `lat` ve `lng` ya birlikte gelir ya hiç. Yalnız birini
 * yazmak bölgeyi haritada bambaşka bir noktaya taşırdı.
 *
 * ── `purpose` DEĞİŞTİRİLEMEZ ──────────────────────────────────────────────
 * Davranış anahtarı mobilden yazılmıyor; `kategori` yalnız rozeti değiştirir.
 * Bir bölgeyi telefondan "depoya çevirmek" ya da depo olmaktan çıkarmak
 * mümkün DEĞİL — gerekçe lib/geofences-db.ts başlığında ölçümle yazılı.
 *
 * ── ARŞİVLİ BÖLGE ─────────────────────────────────────────────────────────
 * Düzenlenebilir (yasak değil): geri almadan önce adını düzeltmek meşru bir
 * istek. Arşiv durumu bu uçtan DEĞİŞMEZ — o, `/arsiv` ucunun işi.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const govde = await govdeOku(req);
  if (!govde) return mobileError(400, "invalid_body", { bicim: "json_nesne" });

  const d = bolgeAlanlariniDogrula(govde, false);
  if (!d.ok) {
    return mobileError(400, "invalid_field", {
      ...d.hata,
      sinir:
        d.hata.alan === "yaricapM"
          ? { min: MOBIL_YARICAP_MIN, max: MOBIL_YARICAP_MAX }
          : d.hata.alan === "kategori"
            ? { gecerli: GEOFENCE_CATEGORIES }
            : undefined,
    });
  }

  // Kayıt GERÇEKTEN var mı — yoksa 404. Boş yamayla 200 dönmek, olmayan bir
  // bölgeyi düzenlediğini sanan istemci üretirdi.
  const mevcut = await getGeofenceById(id);
  if (!mevcut) return mobileError(404, "not_found");

  if (Object.keys(d.deger).length === 0) {
    return mobileError(400, "empty_patch", {
      alanlar: ["ad", "kategori", "lat+lng", "yaricapM"],
    });
  }

  try {
    const satir = await patchGeofence(id, d.deger);
    if (!satir) return mobileError(404, "not_found");
    return Response.json({ ok: true, bolge: geofenceGovdesi(satir) });
  } catch (e) {
    return mobileError(503, "db_error", { sebep: String((e as Error).message).slice(0, 120) });
  }
}
