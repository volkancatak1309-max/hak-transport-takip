import type { NextRequest } from "next/server";
import { requireMobileWorker, requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope, dropTestRows } from "@/lib/test-data";
import { startOfDayViennaFromYmd, viennaDayKey } from "@/lib/format";
import {
  listSeferByDay,
  insertSefer,
  acikSeferVarMi,
  seferGovdesi,
  type SeferRow,
} from "@/lib/sefer-db";
import { listDuraklarBatch, insertDurak } from "@/lib/sefer-duraklari";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/mobile/sefer?tarih=YYYY-MM-DD  — günün seferleri
 * POST /api/mobile/sefer                   — yeni sefer (YALNIZ yönetici)
 *
 * ── KAPI İKİ UÇTA FARKLI, BİLEREK ─────────────────────────────────────────
 * GET  → `requireMobileWorker`: şoför de kendi seferini görmek zorunda.
 *        Yönetici GÜNÜN HEPSİNİ, şoför YALNIZ KENDİNİNKİNİ görür — kapsam
 *        token'dan değil, her istekte DB'den tazelenen `is_admin`den çıkar.
 *        ⚠️ FİLO ŞEFİ de şoför muamelesi görür: yalnız kendi seferleri. Şefin
 *        filosunun seferlerini görmesi AYRI bir karardır (farklı kapsam,
 *        farklı sorgu) ve bu turun kapsamında değil.
 * POST → `requireMobileAdmin`: sefer oluşturmak yalnız yöneticinin işi
 *        (Volkan kararı 2). Şoför ve şef 403 `admin_required`.
 *
 * ── TARİH ─────────────────────────────────────────────────────────────────
 * `?tarih` verilmezse KİRACI takviminde bugün. Verilirse `YYYY-MM-DD` ve
 * takvimde GERÇEKTEN var olmalı — `2026-02-31` sessizce 3 Mart'a kaymaz,
 * 400 döner (`/driver-scores` ve `/analytics` ile aynı sözleşme).
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function tarihCoz(url: URL): { ok: true; tarih: string } | { ok: false } {
  const ham = url.searchParams.get("tarih");
  if (ham === null || ham === "") return { ok: true, tarih: viennaDayKey(new Date()) };
  // Takvim denetimi KAYNAKTA: var olmayan gün null döner (lib/format.ts).
  if (!YMD.test(ham) || !startOfDayViennaFromYmd(ham)) return { ok: false };
  return { ok: true, tarih: ham };
}

export async function govdeOku(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const j = await req.json();
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * TEST ELEMESİ — `seferler`in kendi `is_test` kolonu yok (migration 066,
 * bilerek). Eleme depodaki ortak süzgeçle, `worker_id` üzerinden yapılır;
 * ikinci bir bayrak iki ayrı gerçek doğururdu.
 */
async function testiEle(satirlar: SeferRow[]): Promise<SeferRow[]> {
  const scope = await getTestScope();
  return dropTestRows(satirlar, (s) => ({ worker: s.worker_id }), scope);
}

export async function GET(req: NextRequest) {
  const guard = await requireMobileWorker(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const t = tarihCoz(url);
  if (!t.ok) return mobileError(400, "invalid_tarih", { alan: "tarih", bicim: "YYYY-MM-DD" });

  const yonetici = guard.actor.worker.is_admin === true;

  try {
    const satirlar = await listSeferByDay(t.tarih, yonetici ? undefined : guard.actor.worker.id);
    // Yönetici görünümünde test şoförünün seferi listeye girmesin; şoför kendi
    // satırını her hâlükârda görür (kendi verisi).
    const gorunen = yonetici ? await testiEle(satirlar) : satirlar;

    /**
     * DURAKLAR TEK SORGUDA (082) — sefer başına değil. Gövdeye yalnız ÖZET
     * giriyor (kaç durak, kaçı bitti, sıradaki hangisi); satırlar
     * `/sefer/[id]/duraklar` ucundan alınır. Listeyi durak satırlarıyla
     * şişirmek, telefonun hiç göstermeyeceği yüzlerce satır demekti.
     */
    const { harita } = await listDuraklarBatch(gorunen.map((s) => s.id));

    return Response.json({
      ok: true,
      tarih: t.tarih,
      /** Kapsam yanıtta: istemci "hepsini mi görüyorum" sorusunu tahmin etmesin. */
      kapsam: yonetici ? "filo" : "kendi",
      seferler: gorunen.map((s) => seferGovdesi(s, harita.get(s.id) ?? [])),
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

  // ── tarih
  const ham = typeof govde.tarih === "string" ? govde.tarih : "";
  const tarih = ham === "" ? viennaDayKey(new Date()) : ham;
  if (!YMD.test(tarih) || !startOfDayViennaFromYmd(tarih)) {
    return mobileError(400, "invalid_field", { alan: "tarih", bicim: "YYYY-MM-DD" });
  }

  // ── şoför
  const soforId = typeof govde.soforId === "string" ? govde.soforId : "";
  if (!soforId) return mobileError(400, "invalid_field", { alan: "soforId", sebep: "zorunlu" });
  const { data: w } = await supabaseAdmin
    .from("workers")
    .select("id, is_active")
    .eq("id", soforId)
    .maybeSingle();
  if (!w) return mobileError(404, "worker_not_found", { alan: "soforId" });
  // Pasif hesaba sefer atamak, yarın kimsenin açmayacağı bir satır üretir.
  if (w.is_active !== true) {
    return mobileError(409, "worker_pasif", { alan: "soforId" });
  }

  // ── isteğe bağlı alanlar
  const sayiVeyaNull = (v: unknown, alan: string) => {
    if (v === undefined || v === null) return { ok: true as const, deger: null };
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) return { ok: false as const, alan };
    return { ok: true as const, deger: n };
  };
  const ph = sayiVeyaNull(govde.paketHedef, "paketHedef");
  if (!ph.ok) return mobileError(400, "invalid_field", { alan: ph.alan, sebep: "negatif_olmayan_tamsayi" });

  const notlar =
    govde.notlar === undefined || govde.notlar === null
      ? null
      : typeof govde.notlar === "string"
        ? govde.notlar.trim().slice(0, 500)
        : null;

  const aracId = typeof govde.aracId === "string" && govde.aracId ? govde.aracId : null;
  const bolgeId = typeof govde.bolgeId === "string" && govde.bolgeId ? govde.bolgeId : null;

  // ── İŞ KURALI 1: aynı şoföre aynı gün ikinci AÇIK sefer YOK
  const acik = await acikSeferVarMi(soforId, tarih);
  if (acik) {
    return mobileError(409, "acik_sefer_var", {
      mevcutSeferId: acik.id,
      mevcutDurum: acik.durum,
      tarih,
      aciklama:
        "Bu şoförün bu gün için açık bir seferi var. Kapanınca (tamamlandi/iptal) yenisi açılabilir.",
    });
  }

  try {
    const satir = await insertSefer({
      tarih,
      worker_id: soforId,
      vehicle_id: aracId,
      /**
       * ⚠️ `zone_id` ARTIK YAZILMIYOR (082) — `bolgeId` 1 NUMARALI DURAĞA
       * dönüşüyor. Sebep panel tarafıyla aynı: iki gerçek olmasın. Sözleşme
       * korunuyor, çünkü yanıttaki `bolgeId` durak listesinden çözülüyor.
       */
      zone_id: null,
      paket_hedef: ph.deger,
      notlar,
      created_by: guard.actor.worker.id,
    });

    let durakKuruldu = true;
    if (bolgeId) {
      const { data: z } = await supabaseAdmin
        .from("geofences")
        .select("name")
        .eq("id", bolgeId)
        .maybeSingle();
      // FK denetimi ARTIK BURADA: bölge yoksa sefer açılmış olur ve durak
      // yazılamaz. Bu yüzden bölge ÖNCE doğrulanıyor.
      if (!z) {
        return mobileError(400, "invalid_field", { alan: "bolgeId", sebep: "bulunamadi" });
      }
      const r = await insertDurak(satir.id, {
        ad: String((z as { name: string }).name).trim() || "Hedef",
        zoneId: bolgeId,
      });
      durakKuruldu = r.ok;
    }

    const duraklar = durakKuruldu && bolgeId ? (await listDuraklarBatch([satir.id])).harita.get(satir.id) : [];
    return Response.json(
      {
        ok: true,
        sefer: seferGovdesi(satir, duraklar ?? []),
        /** Hedef verildiği hâlde durak yazılamadıysa (082 yok) SESSİZ kalmıyoruz. */
        ...(bolgeId && !durakKuruldu ? { uyari: "durak_kurulamadi" } : {}),
      },
      { status: 201 }
    );
  } catch (e) {
    const m = String((e as Error).message);
    // FK ihlali: verilen araç/bölge yok. 503 değil 400 — girdi hatası.
    if (m.includes(":23503:")) {
      return mobileError(400, "invalid_field", { alan: "aracId|bolgeId", sebep: "bulunamadi" });
    }
    return mobileError(503, "db_error", { sebep: m.slice(0, 120) });
  }
}
