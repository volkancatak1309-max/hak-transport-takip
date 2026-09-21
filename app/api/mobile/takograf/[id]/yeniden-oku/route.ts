import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { audit } from "@/lib/security-log";
import { dosya, ayristirVeYaz, altSayim } from "@/lib/takograf-db";
import { TAKOGRAF_KOVA, muhurSebepKodu } from "@/lib/takograf";
import { servisYapilandirildi } from "@/lib/takograf-servis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Yükleme ucuyla aynı gerekçe: dış servise senkron çağrı (35 sn tavan). */
export const maxDuration = 300;

/**
 * POST /api/mobile/takograf/[id]/yeniden-oku
 *
 * Servis erişilemediğinde ya da ayrıştırıcı güncellendiğinde dosyayı YENİDEN
 * okur. Panelin `takografYenidenOku` eyleminin birebir karşılığı ve AYNI
 * çekirdeği (`ayristirVeYaz`) çağırıyor.
 *
 * ⚠️ DOSYA YENİDEN YÜKLENMEZ — arşivden geri OKUNUR. Denetimde geçerli olan
 * baytların üzerinde çalışılır; istemcinin elindeki kopya değil.
 *
 * ⚠️ `tamam` durumundaki satırlarda da çalışır. Ayrıştırıcı sürümü
 * güncellendiğinde eski bir dosyayı yeniden okumak MEŞRU bir istektir; panel
 * de ayrım yapmıyor.
 *
 * ═══ 🔴 PANELDEN FARKI: SONUÇ SÖYLENİYOR ═══
 *
 * Panel `{ ok: true }` dönüyor ve ayrıştırmanın TUTUP TUTMADIĞINI söylemiyor —
 * ekran satırı yeniden yüklediği için orada görünüyor. Mobil istemcinin öyle
 * bir şansı yok: "yeniden oku"ya basıp `ok:true` alan bir kullanıcı işin
 * bittiğini sanır, oysa servis erişilemediyse durum hâlâ `bekliyor`dur.
 * Bu yüzden uç satırı YENİDEN OKUYUP sonucu gövdede taşıyor.
 *
 * ⚠️ SERVİS ERİŞİLEMEZSE HTTP YİNE 200: iş yapıldı (dosya okundu, servise
 * soruldu, sonuç işlendi). Başarısız olan ayrıştırmadır, istek değil — ve o
 * `ayristirma.durum` ile görünür. 503 döndürmek, çalışan bir yolu arızalı
 * göstermek olurdu.
 *
 * HATA KODLARI:
 *   401 · 403 admin_required · 404 not_found
 *   503 arsivden_okunamadi — dosya Storage'dan indirilemedi
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const d = await dosya(id);
  if (!d) return mobileError(404, "not_found");

  const { data, error } = await supabaseAdmin.storage.from(TAKOGRAF_KOVA).download(d.depoYolu);
  if (error || !data) {
    return mobileError(503, "arsivden_okunamadi", { ayrinti: error?.message });
  }

  await ayristirVeYaz(id, new Uint8Array(await data.arrayBuffer()));
  await audit(guard.actor.worker.id, "update", `takograf_yeniden_oku:${id} kaynak=mobil`);

  // Sonucu SÖYLEMEK için satır yeniden okunuyor (başlık §).
  const son = await dosya(id);
  const sayim = await altSayim(id);

  let panelTazelendi = true;
  try {
    revalidatePath("/admin/takograf");
    revalidatePath(`/admin/takograf/${id}`);
  } catch {
    panelTazelendi = false;
  }

  return Response.json({
    ok: true,
    id,
    ayristirma: {
      durum: son?.ayristirmaDurumu ?? d.ayristirmaDurumu,
      hata: son?.ayristirmaHata ?? null,
      surum: son?.ayristiriciSurum ?? null,
    },
    muhur: {
      durum: son?.muhurDurumu ?? d.muhurDurumu,
      sebepKodu: muhurSebepKodu(son?.muhurSebep ?? null),
    },
    sayim,
    /**
     * Servis hiç yapılandırılmamışsa durum kalıcı olarak `bekliyor` kalır ve
     * bu bir ARIZA değil, bir KURULUM eksiğidir. İstemci ikisini ayırabilsin.
     */
    servisYapilandirildi: servisYapilandirildi(),
    panelTazelendi,
  });
}
