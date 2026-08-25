import type { NextRequest } from "next/server";
import { requireMobileWorker } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import {
  getSeferById,
  ilerletSefer,
  seferGovdesi,
  SOFOR_GECISLERI,
  type SoforGecis,
} from "@/lib/sefer-db";
import { listDuraklar } from "@/lib/sefer-duraklari";
import { govdeOku } from "../../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/sefer/[id]/durum — gövde {"durum": "kabul"|"yolda"|"tamamlandi"}
 *
 * ═══ YALNIZ ATANAN ŞOFÖR ═══
 * Kapı `requireMobileWorker`, ardından satır sahipliği: `sefer.worker_id`
 * istek sahibiyle aynı değilse 403 `sefer_sizin_degil`.
 *
 * ⚠️ YÖNETİCİ DE İLERLETEMEZ (Volkan kararı). Damgaların anlamı buna bağlı:
 * "kabul 07:12" satırı ŞOFÖRÜN eylemidir. Yönetici de basabilseydi damga
 * "birileri bir şey yaptı"ya dönerdi ve sefer kaydı bir kanıt olmaktan çıkardı.
 * Yöneticinin tek durum eylemi İPTAL'dir (`PATCH /sefer/[id]`).
 *
 * ⚠️ 403 mü 404 mü: başkasının seferinde 403 döndürüyoruz, 404 değil. Sefer
 * kimliği zaten yöneticinin verdiği bir şey (şoför onu listeden görmüyorsa
 * tahmin de edemez) ve 404 "böyle bir sefer yok" derdi — yanlış bilgi.
 *
 * ═══ ÇİZGİ: atandi → kabul → yolda → tamamlandi ═══
 * Sıra atlamak da geri gitmek de 409. Kapanmış seferde (tamamlandi/iptal)
 * hiçbir geçiş yok. Yanıt gövdesi MEVCUT durumu ve BEKLENEN sonraki adımı
 * taşır: istemci "şu an kabul, sıradaki yolda" diyebilsin, tahmin etmesin.
 * "Reddet" YOLU HİÇ KURULMADI (Volkan kararı 3).
 *
 * Her geçiş yalnız KENDİ zaman damgasını yazar (lib/sefer-db.ts).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileWorker(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const govde = await govdeOku(req);
  const hedef = govde?.durum;
  if (
    !govde ||
    typeof hedef !== "string" ||
    !(SOFOR_GECISLERI as readonly string[]).includes(hedef)
  ) {
    return mobileError(400, "invalid_body", {
      alan: "durum",
      gecerli: SOFOR_GECISLERI,
      aciklama: "Reddetme yolu yoktur; iptal yalnız yöneticidedir.",
    });
  }

  const mevcut = await getSeferById(id);
  if (!mevcut) return mobileError(404, "not_found");

  if (mevcut.worker_id !== guard.actor.worker.id) {
    return mobileError(403, "sefer_sizin_degil");
  }

  try {
    const r = await ilerletSefer(id, hedef as SoforGecis);
    if (!r) return mobileError(404, "not_found");
    if (!r.ok) {
      return mobileError(409, r.kod, {
        mevcutDurum: r.mevcut,
        sonrakiDurum: r.sonraki,
        istenen: hedef,
      });
    }
    const { duraklar } = await listDuraklar(id);
    return Response.json({ ok: true, sefer: seferGovdesi(r.satir, duraklar) });
  } catch (e) {
    return mobileError(503, "db_error", { sebep: String((e as Error).message).slice(0, 120) });
  }
}
