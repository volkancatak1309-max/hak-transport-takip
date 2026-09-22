import type { NextRequest } from "next/server";
import { requireMobileFleetView } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { audit } from "@/lib/security-log";
import {
  getTur,
  listTurlar,
  susturmaKayitlari,
  kalemKapsamda,
} from "@/lib/haftalik-aksiyon-db";
import {
  HAFTALIK_SUSTURMA_GUN,
  HAFTALIK_TAVAN,
  haftaBasi,
} from "@/lib/haftalik-aksiyon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/haftalik?hafta=YYYY-Www | ?haftaBasi=YYYY-MM-DD
 *
 * `/admin/haftalik` panelinin (migration 084) mobil karşılığı. Parametresiz
 * çağrı EN SON turu getirir — panelin varsayılanının aynısı.
 *
 * ═══ KAPI: requireMobileFleetView — PANEL PARİTESİ, KAPSAM GERÇEKTEN VAR ═══
 *
 * Panel `requireFleetView()` kullanıyor ve şef de görüyor. Rapor uçlarından
 * FARKI şu: burada kapsam GERÇEKTEN uygulanabiliyor. Kalemin öznesi (şoför ya
 * da araç) şefin filosunda değilse satır gövdeye HİÇ GİRMEZ —
 * `kalemKapsamda` ile, panelin kullandığı FONKSİYONUN TA KENDİSİYLE.
 *
 * Kural `lib/haftalik-aksiyon-db.ts`e TAŞINDI ki iki yüzey aynı kaynaktan
 * beslensin; `"use server"` bir modülden senkron fonksiyon dışa aktarılamadığı
 * için panelin action'ı da oradan okuyor.
 *
 * ═══ 🔴 "CRON KAYITLI MI" SORUSUNU BU UÇ CEVAPLAYAMAZ ═══
 *
 * Turu üreten zamanlayıcı DIŞARIDA (cron-job.org — `docs/CRON-KAYITLARI.md`).
 * Uygulamanın o kaydı görebileceği hiçbir yol yok. Bu yüzden gövde YALNIZ
 * tablodan okunabileni söyler:
 *
 *   · `sonUretim`     → en son turun `uretildi_at`i (yoksa null)
 *   · `sonHaftaBasi`  → en son turun haftası
 *   · `turSayisi`     → kaç tur üretilmiş
 *   · `tabloYok`      → 084 hiç uygulanmamış
 *
 * "Cron kurulu" ya da "cron çalışmıyor" diye bir alan YOKTUR ve
 * EKLENMEYECEKTİR: uydurma bir durum alanı, kurulu ama o hafta zaten üretilmiş
 * bir cron'u "bozuk" gösterirdi. Yorum istemcinin: satır yoksa ekran
 * "bu hafta için tur üretilmemiş" der ve `sonUretim`i gösterir.
 *
 * ⚠️ BOŞ LİSTE BİR ARIZA DEĞİLDİR. galzura-demo'da 084 tabloları KURULU ama
 * **0 satır** (ölçüldü 22.09.2026) — o kiracıda zamanlayıcı kaydı hiç
 * kurulmamış. Uç 200 + boş liste + `sonUretim: null` döner; 404 ya da 503
 * DEĞİL, çünkü uç da tablo da çalışıyor.
 *
 * HATA KODLARI:
 *   401 · 403 fleet_view_required (şoför)
 *   400 invalid (alan: hafta | haftaBasi)
 *   503 db_error (migration 084 yok)
 */

const ISO_HAFTA = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ISO hafta (`2026-W39`) → o haftanın PAZARTESİ günü (`YYYY-MM-DD`).
 *
 * `hafta_basi` kolonu Pazartesi tutuyor (`lib/haftalik-aksiyon.ts` `haftaBasi`:
 * Pazar=0 düzeltmesiyle geriye sarıyor). Burada ISO-8601 kuralı uygulanıyor:
 * 4 Ocak HER ZAMAN 1. haftanın içindedir.
 */
function isoHaftadanPazartesi(yil: number, hafta: number): string {
  const dortOcak = new Date(Date.UTC(yil, 0, 4));
  const dow = dortOcak.getUTCDay() || 7; // Pazar=0 → 7
  const birinciPazartesi = new Date(dortOcak);
  birinciPazartesi.setUTCDate(dortOcak.getUTCDate() - (dow - 1));
  const hedef = new Date(birinciPazartesi);
  hedef.setUTCDate(birinciPazartesi.getUTCDate() + (hafta - 1) * 7);
  return hedef.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const guard = await requireMobileFleetView(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const haftaHam = url.searchParams.get("hafta");
  const haftaBasiHam = url.searchParams.get("haftaBasi");

  let haftaBasiGunu: string | undefined;
  if (haftaHam) {
    const m = ISO_HAFTA.exec(haftaHam);
    if (!m) {
      return mobileError(400, "invalid", {
        alan: "hafta",
        bicim: "YYYY-Www",
        ornek: "2026-W39",
      });
    }
    haftaBasiGunu = isoHaftadanPazartesi(Number(m[1]), Number(m[2]));
  } else if (haftaBasiHam) {
    if (!YMD.test(haftaBasiHam)) {
      return mobileError(400, "invalid", { alan: "haftaBasi", bicim: "YYYY-MM-DD" });
    }
    /**
     * ⚠️ VERİLEN GÜN PAZARTESİYE ÇEKİLİR. Salı gönderen istemci sessizce boş
     * liste alırdı: `hafta_basi` tekil ve yalnız Pazartesi tutuluyor.
     */
    haftaBasiGunu = haftaBasi(haftaBasiHam);
  }

  const [{ tur, aksiyonlar, tabloYok }, { turlar }] = await Promise.all([
    getTur(haftaBasiGunu),
    listTurlar(12),
  ]);

  if (tabloYok) {
    return mobileError(503, "db_error", { sebep: "tablo_yok", migration: "084" });
  }

  const gorunur = aksiyonlar.filter((a) => kalemKapsamda(a, guard.actor.fleetScope));

  // ── Özne adları TEK sorguda (panelin N+1 kaçınması birebir)
  const workerIds = [...new Set(gorunur.map((a) => a.workerId).filter(Boolean))] as string[];
  const vehicleIds = [...new Set(gorunur.map((a) => a.vehicleId).filter(Boolean))] as string[];
  const [w, v, susturmalar] = await Promise.all([
    workerIds.length
      ? supabaseAdmin.from("workers").select("id, name").in("id", workerIds)
      : Promise.resolve({ data: [] }),
    vehicleIds.length
      ? supabaseAdmin.from("vehicles").select("id, plate").in("id", vehicleIds)
      : Promise.resolve({ data: [] }),
    susturmaKayitlari(),
  ]);
  const ad = new Map(((w.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
  const plaka = new Map(
    ((v.data ?? []) as { id: string; plate: string }[]).map((r) => [r.id, r.plate])
  );

  await audit(guard.actor.worker.id, "page_view", `haftalik${haftaBasiGunu ? `:${haftaBasiGunu}` : ""} kaynak=mobil`);

  const sonTur = turlar[0] ?? null;

  return Response.json({
    ok: true,
    tur: tur
      ? {
          haftaBasi: tur.haftaBasi,
          uretildiAt: tur.uretildiAt,
          aksiyonSayisi: tur.aksiyonSayisi,
          elenenSayisi: tur.elenenSayisi,
          /**
           * Bildirim ÜÇ DURUMLU: `null` = denenmedi (turu cron dışı bir yol
           * üretti) · `0` = denendi, kayıtlı cihaz yok · `n` = gönderildi.
           * İkisini aynı göstermek "bildirim çalışmıyor" yanılgısını üretir.
           */
          bildirim: {
            alici: tur.bildirimAlici,
            jeton: tur.bildirimJeton,
            hata: tur.bildirimHata,
          },
          /** Kural başına `{aday, gecen, esik, atlandi}` — "çalışmadı" ≠ "geçen yok". */
          tarama: tur.tarama,
        }
      : null,
    aksiyonlar: gorunur.map((a) => ({
      id: a.id,
      kural: a.kural,
      oncelik: a.oncelik,
      baslik: a.baslik,
      gerekce: a.gerekce,
      kanit: a.kanit,
      hedefYol: a.hedefYol,
      durum: a.durum,
      kapatan: a.kapatan,
      kapatildiAt: a.kapatildiAt,
      kapatmaNotu: a.kapatmaNotu,
      ozne: {
        workerId: a.workerId,
        vehicleId: a.vehicleId,
        ad: a.workerId
          ? (ad.get(a.workerId) ?? null)
          : a.vehicleId
            ? (plaka.get(a.vehicleId) ?? null)
            : null,
      },
      /** "İlgisiz" kapatıldıysa bu kural+özne ne zamana kadar susturuldu. */
      susturmaBitis:
        a.durum === "ilgisiz" && a.kapatildiAt
          ? new Date(Date.parse(a.kapatildiAt) + HAFTALIK_SUSTURMA_GUN * 86_400_000).toISOString()
          : null,
    })),
    /** Geçmiş haftalar — seçici için. */
    haftalar: turlar.map((t) => ({
      haftaBasi: t.haftaBasi,
      aksiyonSayisi: t.aksiyonSayisi,
      uretildiAt: t.uretildiAt,
    })),
    /**
     * ÜRETİM DURUMU — YALNIZ TABLODAN OKUNABİLEN. Zamanlayıcı kaydı hakkında
     * hiçbir iddia yok (başlık §).
     */
    uretim: {
      sonUretim: sonTur?.uretildiAt ?? null,
      sonHaftaBasi: sonTur?.haftaBasi ?? null,
      turSayisi: turlar.length,
      /** İstenen hafta için tur var mı — boş liste ile "hafta yok" ayrımı. */
      istenenHaftaVar: Boolean(tur),
      istenenHaftaBasi: haftaBasiGunu ?? null,
    },
    /** Susturulmuş kural+özne çiftleri — istemci "neden bu kalem yok" diyebilsin. */
    susturmalar,
    /** Şef ise filo kodu; patron için null. */
    fleet: guard.actor.fleet,
    /** İstemci sayıları GÖMMESİN. */
    tavan: HAFTALIK_TAVAN,
    susturmaGun: HAFTALIK_SUSTURMA_GUN,
  });
}
