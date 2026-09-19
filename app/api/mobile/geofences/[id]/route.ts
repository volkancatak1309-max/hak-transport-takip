import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import {
  getGeofenceById,
  patchGeofence,
  geofenceGovdesi,
  GEOFENCE_CATEGORIES,
  MusteriKapaliHatasi,
} from "@/lib/geofences-db";
import { auditChange } from "@/lib/audit-change";
import { revalidatePath } from "next/cache";
import {
  bolgeAlanlariniDogrula,
  govdeOku,
  BOLGE_AMAC_KUMESI,
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
 * ── `amac` (= `purpose`) ARTIK YAZILABİLİR (19.09.2026, Volkan kararı) ────
 * Davranış anahtarı bu uçtan değiştirilebiliyor: `{"amac":"depot"}` bölgeyi
 * vardiya tetiği yapar, `{"amac":"rule"}` tetiği kaldırır. `kategori` hâlâ
 * yalnız ROZET ve ikisi ayrı alan — bir bölge kategori olarak "depot" görünüp
 * tetik OLMAYABİLİR.
 *
 * ⚠️ AĞIR BİR ALAN. Ölçüldü (18.08.2026, hâlâ geçerli): son 30 günde 511
 * vardiyanın 346'sı (%68) depo tetiğiyle açılıyor ve canlıda yalnız 2 depo
 * bölgesi var. Yani `{"amac":"rule"}` yanlış bölgeye gönderilirse vardiyaların
 * üçte ikisi elle açılmak zorunda kalır. Üç şey riski sınırlıyor:
 *   · kapı `requireMobileAdmin` — şef ve şoför bu ucu hiç göremez,
 *   · OLUŞTURMA hâlâ 'rule' doğurur (POST `amac` KABUL ETMEZ),
 *   · değişiklik `auditChange` ile ize düşer (panelin bölge eylemiyle aynı).
 *
 * KURAL PANELDEN: amaç 'customer' DEĞİLSE müşteri alanları temizlenir
 * (`customer_name=null`, `min_dwell_s=120`) — bir bölge müşteriden kurala
 * çevrildiğinde eski müşteri adı satırda kalsaydı, rapor onu okumasa bile
 * denetim izinde yanlış bir gerçek gibi dururdu. 064 koşulmamış kurulumda
 * `amac:"customer"` sessizce kural bölgesine DÜŞMEZ: 409 `musteri_kapali`.
 *
 * ⚠️ TEK DEPO ŞARTI YOK ve bu uydurma değil, ÖLÇÜM: panelin `createGeofence` /
 * `updateGeofence` eylemlerinde kiracı başına depo sayısını sınırlayan ya da
 * çakışmayı reddeden HİÇBİR kural yok; canlıda HAK61'de 2, demo'da 2 depo
 * bölgesi var ve motor hepsini birden değerlendiriyor (lib/depot.ts). Buraya
 * panelde olmayan bir sınır koymak, iki yüzeyi ayırmak olurdu.
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
            : d.hata.alan === "amac"
              ? { gecerli: BOLGE_AMAC_KUMESI }
              : undefined,
    });
  }

  // Kayıt GERÇEKTEN var mı — yoksa 404. Boş yamayla 200 dönmek, olmayan bir
  // bölgeyi düzenlediğini sanan istemci üretirdi.
  const mevcut = await getGeofenceById(id);
  if (!mevcut) return mobileError(404, "not_found");

  if (Object.keys(d.deger).length === 0) {
    return mobileError(400, "empty_patch", {
      alanlar: ["ad", "kategori", "amac", "lat+lng", "yaricapM"],
    });
  }

  try {
    const satir = await patchGeofence(id, d.deger);
    if (!satir) return mobileError(404, "not_found");

    /**
     * DENETİM İZİ — panelin bölge eylemiyle AYNI gerekçe: bölge sınırı ve amacı
     * vardiya OTOMATININ girdisidir, yani buradaki bir değişiklik vardiya
     * kayıtlarını dolaylı olarak etkiler. `amac` yazılabilir olduğu andan
     * itibaren izsiz bırakmak, "vardiyalar neden elle açılıyor?" sorusunu
     * cevapsız bırakmak olurdu.
     */
    await auditChange(
      guard.actor.worker.id,
      "update",
      "geofences",
      id,
      mevcut as unknown as Record<string, unknown>,
      d.deger
    );
    let panelTazelendi = true;
    try {
      revalidatePath("/admin/bolgeler");
    } catch {
      panelTazelendi = false;
    }
    return Response.json({ ok: true, bolge: geofenceGovdesi(satir), panelTazelendi });
  } catch (e) {
    if (e instanceof MusteriKapaliHatasi) {
      // 409: istek geçerli, KURULUM elverişsiz (064 koşulmamış). 400 demek
      // istemciye "gövdeni düzelt" derdi — düzeltilecek bir şey yok.
      return mobileError(409, "musteri_kapali", {
        alan: "amac",
        sebep: "migration_064_yok",
      });
    }
    return mobileError(503, "db_error", { sebep: String((e as Error).message).slice(0, 120) });
  }
}
