import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import {
  listGeofences,
  insertGeofence,
  geofenceGovdesi,
  GEOFENCE_CATEGORIES,
  type GeofenceCategory,
} from "@/lib/geofences-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/mobile/geofences[?arsiv=1]  — bölge listesi
 * POST /api/mobile/geofences            — yeni bölge
 *
 * ── ARŞİV VARSAYILAN GİZLİ ────────────────────────────────────────────────
 * Arşiv, silmenin yerine geçen şey: bölge listeden kalkar ama kaydı durur.
 * Varsayılanda gizli olmasının sebebi listeyi temiz tutmak DEĞİL — arşivlenen
 * bölge aynı anda KAPATILDIĞI için (bkz. lib/geofences-db.ts) artık hiçbir
 * kararı etkilemiyor; listede durması "bu hâlâ çalışıyor" izlenimi verirdi.
 * `?arsiv=1` ile tamamı gelir, `archivedAt` alanı hangisinin arşivli olduğunu
 * söyler.
 *
 * ── SİLME UCU YOK (bilinçli) ──────────────────────────────────────────────
 * `deleteGeofence` mobile AÇILMADI. Silme hard DELETE ve canlıda `audit_log`
 * tablosu bulunmadığı için (ölçüldü: PGRST205) silinen bölgenin adı/merkezi/
 * yarıçapı hiçbir yerde kalmıyor — telefondan tek dokunuşla geri alınamaz bir
 * kayıp üretmek istemiyoruz. Arşiv aynı işi geri alınabilir biçimde yapıyor.
 *
 * ── KAPI ──────────────────────────────────────────────────────────────────
 * requireMobileAdmin — panelde /admin/bolgeler `requireAdmin()` ile korunuyor,
 * filo şefi giremiyor. Burada da şoför ve şef 403 `admin_required`.
 */

/**
 * MOBİL YARIÇAP SINIRI — panelinkinden DAR ve bu bilinçli.
 *
 * Panelin zod şeması 50–100.000 m'ye izin veriyor (lib/validation.ts).
 * Mobilde tavan 5.000: ekranda yarıçap bir SÜRGÜYLE seçiliyor ve 100 km'lik
 * bir aralığı parmakla 50 m hassasiyetinde ayarlamak mümkün değil — sürgünün
 * her pikseli ~260 m ederdi. Canlıdaki iki depo 500 m; 5 km zaten 10 katı.
 *
 * ⚠️ İKİ SINIR AYNI TABLOYA YAZIYOR. Panelden açılmış 5 km üstü bir bölge
 * mobilde DÜZENLENEMEZ (400 döner) ama listede ve haritada GÖRÜNÜR — sessizce
 * kırpmak, kullanıcının bilmediği bir daralma olurdu.
 */
export const MOBIL_YARICAP_MIN = 50;
export const MOBIL_YARICAP_MAX = 5000;

const AD_MAX = 80;

export type AlanHatasi = { alan: string; sebep: string };

/** Ortak alan doğrulaması — POST (zorunlu) ve PATCH (kısmi) aynı kuralları paylaşır. */
export function bolgeAlanlariniDogrula(
  g: Record<string, unknown>,
  zorunlu: boolean
): { ok: true; deger: Record<string, unknown> } | { ok: false; hata: AlanHatasi } {
  const out: Record<string, unknown> = {};

  const varMi = (k: string) => g[k] !== undefined && g[k] !== null;

  if (zorunlu || varMi("ad")) {
    const ad = typeof g.ad === "string" ? g.ad.trim() : "";
    if (!ad) return { ok: false, hata: { alan: "ad", sebep: "bos" } };
    if (ad.length > AD_MAX) return { ok: false, hata: { alan: "ad", sebep: "cok_uzun" } };
    out.name = ad;
  }

  if (zorunlu || varMi("kategori")) {
    const k = g.kategori;
    if (typeof k !== "string" || !(GEOFENCE_CATEGORIES as readonly string[]).includes(k)) {
      return { ok: false, hata: { alan: "kategori", sebep: "gecersiz" } };
    }
    out.category = k as GeofenceCategory;
  }

  // Merkez BÜTÜN olarak taşınır: yalnız lat gönderip lng'yi eski değerde
  // bırakmak, haritada bambaşka bir noktaya düşen bir bölge üretirdi.
  const latVar = varMi("lat");
  const lngVar = varMi("lng");
  if (zorunlu || latVar || lngVar) {
    if (!latVar || !lngVar) {
      return { ok: false, hata: { alan: "lat|lng", sebep: "birlikte_gerekli" } };
    }
    const lat = Number(g.lat);
    const lng = Number(g.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return { ok: false, hata: { alan: "lat", sebep: "aralik_disi" } };
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return { ok: false, hata: { alan: "lng", sebep: "aralik_disi" } };
    }
    out.center_lat = lat;
    out.center_lng = lng;
  }

  if (zorunlu || varMi("yaricapM")) {
    const r = Number(g.yaricapM);
    if (!Number.isFinite(r) || !Number.isInteger(r)) {
      return { ok: false, hata: { alan: "yaricapM", sebep: "tamsayi_degil" } };
    }
    if (r < MOBIL_YARICAP_MIN || r > MOBIL_YARICAP_MAX) {
      return { ok: false, hata: { alan: "yaricapM", sebep: "aralik_disi" } };
    }
    out.radius_m = r;
  }

  return { ok: true, deger: out };
}

/** Gövdeyi JSON olarak okur; bozuksa null. */
export async function govdeOku(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const j = await req.json();
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const arsivDahil = url.searchParams.get("arsiv") === "1";

  try {
    const satirlar = await listGeofences({ arsivDahil });
    return Response.json({
      ok: true,
      arsivDahil,
      sinir: { yaricapMinM: MOBIL_YARICAP_MIN, yaricapMaxM: MOBIL_YARICAP_MAX },
      kategoriler: GEOFENCE_CATEGORIES,
      bolgeler: satirlar.map(geofenceGovdesi),
      /** Arşivli sayısı — liste gizlerken bile "Arşiv (N)" başlığı yazılabilsin. */
      arsivSayisi: arsivDahil
        ? satirlar.filter((z) => z.archived_at !== null).length
        : (await listGeofences({ arsivDahil: true })).filter((z) => z.archived_at !== null).length,
    });
  } catch (e) {
    return mobileError(503, "db_error", { sebep: String((e as Error).message).slice(0, 120) });
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const govde = await govdeOku(req);
  if (!govde) return mobileError(400, "invalid_body", { bicim: "json_nesne" });

  const d = bolgeAlanlariniDogrula(govde, true);
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

  try {
    // `purpose` GEÇİLMİYOR → 'rule' doğar. Mobil davranış anahtarı yazmaz
    // (gerekçe lib/geofences-db.ts başlığında, ölçümle).
    const satir = await insertGeofence({
      name: d.deger.name as string,
      center_lat: d.deger.center_lat as number,
      center_lng: d.deger.center_lng as number,
      radius_m: d.deger.radius_m as number,
      category: d.deger.category as GeofenceCategory,
    });
    return Response.json({ ok: true, bolge: geofenceGovdesi(satir) }, { status: 201 });
  } catch (e) {
    return mobileError(503, "db_error", { sebep: String((e as Error).message).slice(0, 120) });
  }
}
