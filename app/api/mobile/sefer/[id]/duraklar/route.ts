import type { NextRequest } from "next/server";
import { requireMobileWorker, requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getSeferById, ACIK_DURUMLAR } from "@/lib/sefer-db";
import {
  listDuraklar,
  insertDurak,
  siralaDuraklar,
  durakGovdesi,
  durakOzetGovdesi,
  type DurakGirdi,
} from "@/lib/sefer-duraklari";
import { govdeOku } from "../../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/sefer/[id]/duraklar — seferin durakları (sıralı)
 * POST                                — yeni durak (YALNIZ yönetici)
 * PUT                                 — yeniden sırala (YALNIZ yönetici)
 *
 * ── KAPI ──────────────────────────────────────────────────────────────────
 * GET  → `requireMobileWorker` + SAHİPLİK: şoför yalnız KENDİ seferinin
 *        duraklarını görür; yönetici hepsini. Başkasının seferinde 403 —
 *        404 değil, çünkü sefer kimliği zaten yöneticinin verdiği bir şey ve
 *        "böyle bir sefer yok" yanlış bilgi olurdu (`/durum` ucuyla aynı kural).
 * POST/PUT → `requireMobileAdmin`: durak listesini KURMAK yöneticinin işi.
 *        Şoför onu İLERLETİR (`/duraklar/[durakId]/durum`), yeniden yazmaz.
 *
 * ── KAPANMIŞ SEFER ────────────────────────────────────────────────────────
 * Tamamlanmış/iptal edilmiş seferin planı değişmez: bitmiş bir günün kaydını
 * geriye dönük büyütmek olurdu → 409 `sefer_kapali`.
 *
 * ── 082 YOKSA ─────────────────────────────────────────────────────────────
 * GET boş liste + `ozellikKapali: true` döner (200). 404 döndürmek "sefer yok"
 * derdi, 503 ise geçici bir arıza ima ederdi; ikisi de yanlış. İstemci bu
 * bayrakla durak yüzeyini gizler.
 */

type Yol = { params: Promise<{ id: string }> };

/** Serbest hedefin sayısal alanları — gövdeden güvenli okuma. */
function sayiVeyaNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const SAAT = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Gövdeyi `DurakGirdi`ye çevirir; hatalıysa alan adını döndürür. */
function girdiCoz(g: Record<string, unknown>): { ok: true; girdi: DurakGirdi } | { ok: false; alan: string } {
  const ad = typeof g.ad === "string" ? g.ad.trim() : "";
  if (!ad) return { ok: false, alan: "ad" };

  const bolgeId = typeof g.bolgeId === "string" && g.bolgeId ? g.bolgeId : null;
  const lat = sayiVeyaNull(g.lat);
  const lng = sayiVeyaNull(g.lng);
  if ((lat === null) !== (lng === null)) return { ok: false, alan: "lat|lng" };
  if (lat !== null && (lat < -90 || lat > 90)) return { ok: false, alan: "lat" };
  if (lng !== null && (lng < -180 || lng > 180)) return { ok: false, alan: "lng" };

  const yaricap = sayiVeyaNull(g.yaricapM);
  if (yaricap !== null && (yaricap < 50 || yaricap > 5000)) return { ok: false, alan: "yaricapM" };

  const bas = typeof g.pencereBas === "string" && g.pencereBas ? g.pencereBas : null;
  const bit = typeof g.pencereBit === "string" && g.pencereBit ? g.pencereBit : null;
  if (bas && !SAAT.test(bas)) return { ok: false, alan: "pencereBas" };
  if (bit && !SAAT.test(bit)) return { ok: false, alan: "pencereBit" };
  if (bas && bit && bas > bit) return { ok: false, alan: "pencereBas>pencereBit" };

  const sure = sayiVeyaNull(g.tahminiSureDk);
  if (sure !== null && (!Number.isInteger(sure) || sure < 1 || sure > 1440)) {
    return { ok: false, alan: "tahminiSureDk" };
  }

  return {
    ok: true,
    girdi: {
      ad,
      zoneId: bolgeId,
      adres: typeof g.adres === "string" ? g.adres : null,
      latitude: lat,
      longitude: lng,
      yaricapM: yaricap,
      pencereBas: bas,
      pencereBit: bit,
      tahminiSureDk: sure,
      notlar: typeof g.notlar === "string" ? g.notlar : null,
    },
  };
}

export async function GET(req: NextRequest, { params }: Yol) {
  const guard = await requireMobileWorker(req);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const sefer = await getSeferById(id);
  if (!sefer) return mobileError(404, "not_found");
  const yonetici = guard.actor.worker.is_admin === true;
  if (!yonetici && sefer.worker_id !== guard.actor.worker.id) {
    return mobileError(403, "sefer_sizin_degil");
  }

  const { duraklar, tabloYok } = await listDuraklar(id);
  return Response.json({
    ok: true,
    seferId: id,
    ozellikKapali: tabloYok,
    ozet: durakOzetGovdesi(duraklar),
    duraklar: duraklar.map(durakGovdesi),
  });
}

export async function POST(req: NextRequest, { params }: Yol) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const sefer = await getSeferById(id);
  if (!sefer) return mobileError(404, "not_found");
  if (!ACIK_DURUMLAR.includes(sefer.durum)) {
    return mobileError(409, "sefer_kapali", { mevcutDurum: sefer.durum });
  }

  const govde = await govdeOku(req);
  if (!govde) return mobileError(400, "invalid_body", { bicim: "json_nesne" });

  const c = girdiCoz(govde);
  if (!c.ok) return mobileError(400, "invalid_field", { alan: c.alan });

  // Bölge verilmişse GERÇEKTEN var olmalı: FK hatası 503'e değil 400'e ait.
  if (c.girdi.zoneId) {
    const { data } = await supabaseAdmin
      .from("geofences")
      .select("id")
      .eq("id", c.girdi.zoneId)
      .maybeSingle();
    if (!data) return mobileError(400, "invalid_field", { alan: "bolgeId", sebep: "bulunamadi" });
  }

  const r = await insertDurak(id, c.girdi);
  if (!r.ok) {
    if (r.sebep === "tablo_yok") return mobileError(409, "ozellik_kapali", { migration: "082" });
    if (r.sebep === "sira_cakismasi") return mobileError(409, "sira_cakismasi");
    return mobileError(400, "invalid_field", { alan: r.mesaj ?? "durak" });
  }
  return Response.json({ ok: true, durak: durakGovdesi(r.durak) }, { status: 201 });
}

/**
 * PUT — YENİDEN SIRALAMA. Gövde: `{"sira": ["<durakId>", ...]}`
 *
 * ⚠️ LİSTE TAM OLMALI. Eksik bir kimlik listesi, adı geçmeyen durakların
 * numarasını belirsiz bırakırdı ("sona mı gitsin, yerinde mi kalsın?").
 * Eksik/yabancı/tekrarlı kimlik → 400 `eksik_id`, hiçbir şey yazılmaz.
 */
export async function PUT(req: NextRequest, { params }: Yol) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const sefer = await getSeferById(id);
  if (!sefer) return mobileError(404, "not_found");
  if (!ACIK_DURUMLAR.includes(sefer.durum)) {
    return mobileError(409, "sefer_kapali", { mevcutDurum: sefer.durum });
  }

  const govde = await govdeOku(req);
  const sira = govde?.sira;
  if (!Array.isArray(sira) || sira.some((x) => typeof x !== "string")) {
    return mobileError(400, "invalid_body", { alan: "sira", bicim: "durak_id_dizisi" });
  }

  const r = await siralaDuraklar(id, sira as string[]);
  if (!r.ok) {
    if (r.sebep === "tablo_yok") return mobileError(409, "ozellik_kapali", { migration: "082" });
    if (r.sebep === "eksik_id") {
      return mobileError(400, "eksik_id", {
        aciklama: "Sıra listesi seferin TÜM duraklarını tam olarak bir kez içermeli.",
      });
    }
    return mobileError(503, "db_error", { sebep: r.mesaj?.slice(0, 120) });
  }
  return Response.json({
    ok: true,
    ozet: durakOzetGovdesi(r.duraklar),
    duraklar: r.duraklar.map(durakGovdesi),
  });
}
