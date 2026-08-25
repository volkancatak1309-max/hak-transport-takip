import type { NextRequest } from "next/server";
import { requireMobileWorker } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { getSeferById, ACIK_DURUMLAR } from "@/lib/sefer-db";
import { getDurak, ilerletDurak, durakGovdesi, listDuraklar, durakOzetGovdesi } from "@/lib/sefer-duraklari";
import { govdeOku } from "../../../../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/sefer/[id]/duraklar/[durakId]/durum
 * Gövde: {"durum": "varildi"|"tamamlandi"|"atlandi", "sebep": "..."}
 *
 * ═══ YALNIZ ATANAN ŞOFÖR ═══
 * Kapı `requireMobileWorker`, ardından satır sahipliği: seferin `worker_id`si
 * istek sahibiyle aynı değilse 403 `sefer_sizin_degil`.
 *
 * ⚠️ YÖNETİCİ DE İLERLETEMEZ — `/sefer/[id]/durum` ucundaki kararın aynısı.
 * Damgaların anlamı buna bağlı: "vardım 09:12" ŞOFÖRÜN eylemidir. Yöneticinin
 * durak üzerindeki tek durum yetkisi SIFIRLAMAKTIR
 * (`PATCH /duraklar/[durakId]` → `{"durumSifirla": true}`).
 *
 * ═══ ÇİZGİ İLERİ YÖNLÜ ═══
 * bekliyor → varildi → tamamlandi ; bekliyor|varildi → atlandi (SEBEBİYLE).
 * `bekliyor → tamamlandi` de meşrudur: şoför "vardım"a basmadan işi bitirebilir
 * ve o zaman varış damgası BOŞ kalır — ölçmediğimiz bir anı uydurmuyoruz.
 * Geri dönüş yok; atlanan durağa yeniden gidilecekse yönetici YENİ BİR DURAK
 * açar (080'in "yeniden teslim denemesi yeni bir duraktır" kuralı).
 *
 * Yanıt gövdesi MEVCUT durumu ve İZİNLİ geçişleri taşır: istemci tahmin etmesin.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; durakId: string }> }
) {
  const guard = await requireMobileWorker(req);
  if (!guard.ok) return guard.response;
  const { id, durakId } = await params;

  const govde = await govdeOku(req);
  const hedef = govde?.durum;
  if (
    !govde ||
    typeof hedef !== "string" ||
    !["varildi", "tamamlandi", "atlandi"].includes(hedef)
  ) {
    return mobileError(400, "invalid_body", {
      alan: "durum",
      gecerli: ["varildi", "tamamlandi", "atlandi"],
      aciklama: "Geri dönüş yolu yoktur; sıfırlama yalnız yöneticidedir.",
    });
  }

  const durak = await getDurak(durakId);
  if (!durak || durak.sefer_id !== id) return mobileError(404, "not_found");

  const sefer = await getSeferById(id);
  if (!sefer) return mobileError(404, "not_found");
  if (sefer.worker_id !== guard.actor.worker.id) return mobileError(403, "sefer_sizin_degil");
  if (!ACIK_DURUMLAR.includes(sefer.durum)) {
    return mobileError(409, "sefer_kapali", { mevcutDurum: sefer.durum });
  }

  const sebep = typeof govde.sebep === "string" ? govde.sebep : null;

  // `kaynak: "sofor"` SABİT — bu yol elle basmadır. Otomatik damga yalnız
  // varış köprüsünden gelir (lib/sefer-bridge.ts).
  const r = await ilerletDurak(durakId, hedef as "varildi" | "tamamlandi" | "atlandi", {
    sebep,
    kaynak: "sofor",
  });
  if (!r.ok) {
    if (r.sebep === "tablo_yok") return mobileError(409, "ozellik_kapali", { migration: "082" });
    if (r.sebep === "yok") return mobileError(404, "not_found");
    if (r.sebep === "sebep_gerekli") {
      return mobileError(400, "sebep_gerekli", { alan: "sebep", enAz: 3 });
    }
    if (r.sebep === "gecersiz_gecis" || r.sebep === "kapali_durak") {
      return mobileError(409, r.sebep, { mevcutDurum: r.mevcut, izinliGecisler: r.izinli, istenen: hedef });
    }
    return mobileError(503, "db_error", { sebep: r.mesaj?.slice(0, 120) });
  }

  // Özet de dönüyor: istemci ilerleme sayacını ikinci bir istek atmadan
  // tazeleyebilsin ("7/12" → "8/12").
  const { duraklar } = await listDuraklar(id);
  return Response.json({
    ok: true,
    durak: durakGovdesi(r.durak),
    ozet: durakOzetGovdesi(duraklar),
  });
}
