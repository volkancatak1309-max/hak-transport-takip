import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { GECMIS_TAVANI, listFleetMoves } from "@/lib/fleets-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/fleets/[id]/gecmis?limit=50 — filonun taşıma geçmişi (099).
 *
 * `[id]` FİLO KODUDUR (kardeş uçlarla aynı: `/api/mobile/fleets/mavi/gecmis`).
 * Kapı requireMobileAdmin — geçmiş "kim neyi nereye taşıdı"yı söyler ve bu bir
 * DENETİM görünümüdür; filo şefine açmak, şefin karşı filonun kararlarını
 * okuması demek olurdu.
 *
 * ── İKİ YÖN BİRLİKTE ──────────────────────────────────────────────────────
 * Hem bu filoya GELEN hem buradan GİDEN hareketler dönüyor; her satır `yon`
 * alanıyla hangisi olduğunu söyler. Yalnız gelenleri göstermek, filonun
 * küçüldüğü günleri geçmişten silmek olurdu.
 *
 * ── FİLONUN VAR OLUP OLMADIĞI SORULMUYOR ──────────────────────────────────
 * Bilinmeyen kod 404 DEĞİL, boş liste döner. Sebebi: iz tablosu silinmiş ya da
 * yeniden adlandırılmış filoların kodlarını da taşır (`from_fleet`/`to_fleet`
 * FK'siz metin). "Artık tanımlı olmayan filonun geçmişi" meşru bir sorudur ve
 * 404 onu okunamaz yapardı.
 *
 * ── KIRPMA GİZLENMEZ ──────────────────────────────────────────────────────
 * `limit` tavanı GECMIS_TAVANI (lib/fleets-db.ts, bugün 200); istenen tavanı
 * aşarsa sessizce indirilir ve
 * yanıt UYGULANAN limiti söyler. Daha fazla satır varsa `kirpildi:true` —
 * 25.07.2026'daki sessiz 1000-satır kırpmasının dersi.
 *
 * ⚠️ 099 ÇALIŞTIRILMADAN: 503 `db_error` + `sebep:"tablo_yok"`. Boş liste
 * döndürmek "bu filo hiç taşınmadı" demek olurdu — oysa doğrusu "iz tutulmuyor".
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const url = new URL(req.url);
  const ham = url.searchParams.get("limit");
  const istenen = ham === null ? undefined : Number(ham);
  // Sayı olmayan limit sessizce varsayılana düşmez: istemci bir şey istedi ve
  // isteği anlaşılmadı, bunu bilmeli.
  if (istenen !== undefined && !Number.isFinite(istenen)) {
    return mobileError(400, "invalid", { alan: "limit", sebep: "tip" });
  }

  const sonuc = await listFleetMoves(id, istenen);
  if (!sonuc.ok) {
    return mobileError(503, "db_error", { sebep: sonuc.sebep });
  }

  return Response.json({
    ok: true,
    filo: id,
    limit: sonuc.limit,
    enFazlaLimit: GECMIS_TAVANI,
    kirpildi: sonuc.kirpildi,
    hareketler: sonuc.hareketler,
  });
}
