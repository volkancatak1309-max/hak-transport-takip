import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { audit } from "@/lib/security-log";
import { dosya, indirmeBaglantisi } from "@/lib/takograf-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** İmzalı bağlantının ömrü — panelin varsayılanıyla aynı, AÇIKÇA geçiliyor. */
const OMUR_SN = 300;

/**
 * GET /api/mobile/takograf/[id]/indir — ORİJİNAL dosyanın imzalı bağlantısı.
 *
 * ⚠️ BAYT BAYT YÜKLENDİĞİ GİBİ — hiçbir dönüşüm yok. Denetimde geçerli olan
 * budur; bizim ayrıştırdığımız JSON değil. Panelin
 * `takografIndirmeBaglantisi` eyleminin birebir karşılığı.
 *
 * ═══ NEDEN DOSYANIN KENDİSİ DEĞİL, BAĞLANTI ═══
 *
 * Uç dosyayı proxy'lemiyor; kısa ömürlü imzalı bir URL döndürüyor. Bir .ddd
 * 5 MB'a kadar çıkabiliyor ve onu fonksiyon üzerinden akıtmak, indirmeyi
 * fonksiyon süresine ve belleğine bağlamak olurdu. Storage zaten bu iş için
 * var. Aynı desen `lib/teslimat-db.ts` `imzaliKanitlar` ve panelin kanıt
 * fotoğraflarında da kullanılıyor.
 *
 * ⚠️ ÖMÜR KISA (300 sn) ve bu bilinçli: kova ÖZEL. Kalıcı bir adres vermek,
 * linki eline geçiren herkese süresiz erişim vermek olurdu.
 *
 * ═══ İZ ═══
 *
 * `tacho_download` — panelin kullandığı eylem adının aynısı. Takograf
 * indirmesi kişisel veri erişimidir (sürücü faaliyet geçmişi); "kim, hangi
 * dosyayı, ne zaman indirdi" sorusunun altı ay sonra cevabı olmak zorunda.
 *
 * HATA KODLARI:
 *   401 · 403 admin_required · 404 not_found
 *   503 baglanti_uretilemedi
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const d = await dosya(id);
  if (!d) return mobileError(404, "not_found");

  const url = await indirmeBaglantisi(d.depoYolu, OMUR_SN);
  if (!url) return mobileError(503, "baglanti_uretilemedi");

  await audit(guard.actor.worker.id, "tacho_download", `takograf_indir:${id} kaynak=mobil`);

  return Response.json({
    ok: true,
    url,
    ad: d.dosyaAdi,
    bayt: d.bayt,
    /** İstemci indirdiğini doğrulayabilsin — arşivdeki dosyanın parmak izi. */
    sha256: d.sha256,
    sonKullanmaSn: OMUR_SN,
  });
}
