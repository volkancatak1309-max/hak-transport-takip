import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileWorker } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { startShiftSelf } from "@/lib/shift-start";
import { DRIVER_VEHICLE_CHOICE, SHIFT_PER_DAY } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/shifts/start — ŞOFÖR KENDİ VARDİYASINI ELLE BAŞLATIR.
 *
 * Gövde İSTEĞE BAĞLI: `{}` ya da `{ "aracId": "<uuid>" }`.
 *
 * Panelin bekleme ekranındaki "VARDİYAYI BAŞLAT" düğmesinin karşılığıdır ve
 * kuralları KOPYALAMAZ: `lib/shift-start.ts:startShiftSelf` hem bu ucun hem
 * `startShiftManualAction`ın TEK kaynağıdır. Depo kapısı, `started_at`ın depo
 * girişinden türetilmesi, günde-tek-vardiya yeniden açması, `uq_time_entries_one_open`
 * 23505 yakalaması ve 038 bayrakları — hepsi orada, tek yerde.
 *
 * ── HANGİ VARDİYA, KİMİN ────────────────────────────────────────────────────
 * Gövde `workerId` ALMAZ ve almamalı. Açılan vardiya TOKEN'DAKİ kişinin
 * vardiyasıdır. Başkası adına açmak AYRI bir uçtur (`/start-for`) ve AYRI bir
 * yetki ister — kapı bir kontrol satırıyla değil, İSTEĞİN ŞEKLİYLE kapalı
 * (kapanış ucundaki `current/end` ile aynı ilke).
 *
 * ── KAPI: ŞOFÖR, YÖNETİCİ MUAFİYETLİ ────────────────────────────────────────
 * `requireMobileWorker` + KARDEŞ KAPILARIN AYNI CÜMLESİ (migration 041 muafiyeti,
 * bkz. shifts/current/end/route.ts): direksiyona geçmeyen yönetici
 * (`is_admin=true, counts_as_driver=false`) 403 `not_a_driver` alır; gerçekten
 * araç kullanan yönetici KENDİ vardiyasını açabilir. Filo şefi de bir
 * çalışandır — kendi vardiyasını açar.
 *
 * ⚠️ Bu cümle `startShiftForWorkerCore`un hedefe uyguladığı kuralın AYNISIDIR
 * ve burada ÇAĞIRANA uygulanıyor: kendisi için açan yönetici de "şoför sayılan"
 * yönetici olmak zorunda. Yoksa panelin roster'ında görünmeyen bir kişi
 * telefondan kendine vardiya açar ve Analiz/AZG'ye gerçek vardiya gibi girerdi.
 *
 * ── GEÇİCİ ARAÇ (`aracId`) ──────────────────────────────────────────────────
 * Verilirse vardiya O araçla açılır; şoförün atanmış aracı DEĞİŞMEZ. Kiracı
 * ayarı `DRIVER_VEHICLE_CHOICE='assigned'` iken panel seçiciyi göstermiyor;
 * uç yine de kabul eder çünkü ayar bir GÖRÜNÜM kararıdır, bir yetki değil —
 * ve geçici araç tam da "atama yanlış/eksik" durumunda gerekiyor. Yanıt hangi
 * modda olunduğunu `aracSecimi` ile söyler ki istemci alanı gösterip
 * göstermeyeceğini kendi ekranında karar verebilsin.
 *
 * ── HATA KODLARI ────────────────────────────────────────────────────────────
 * Dizgeler panelinkiyle BİREBİR aynı (tek kaynaktan geliyorlar); değişen yalnız
 * HTTP kodudur:
 *   401 missing_token / invalid_token / revoked / inactive   (ortak kapı)
 *   403 not_a_driver · inactive_worker
 *   404 no_vehicle           — atanmış/seçilen araç yok
 *   409 active               — zaten açık vardiyan var
 *       day_done             — bugün kapanmış vardiya bulunamadı (SHIFT_PER_DAY='one')
 *       vehicle_unavailable  — araç bakımda/pasif
 *       outside_depot        — araç KESİN depo dışında, muafiyet yok
 *   400 invalid_json
 *   500 write_failed         — ham DB yazma hatası (detay `detail` alanında)
 */
const CONFLICT = new Set(["active", "day_done", "vehicle_unavailable", "outside_depot"]);

function statusFor(error: string): number {
  if (error === "inactive_worker") return 403;
  if (error === "no_vehicle") return 404;
  if (CONFLICT.has(error)) return 409;
  // Bilinmeyen her dizge 500 sayılır ve `error` gövdede aynen döner. Sessizce
  // 400 demek, sunucu arızasını istemcinin suçu gibi gösterirdi (kapanış
  // ucundaki `statusFor` ile aynı ilke).
  return 500;
}

export async function POST(req: NextRequest) {
  const guard = await requireMobileWorker(req);
  if (!guard.ok) return guard.response;
  const { worker } = guard.actor;

  // Yönetici kapısı — KARDEŞ KAPILARIN AYNI CÜMLESİ (bkz. dosya başı).
  if (worker.is_admin && !worker.counts_as_driver) {
    return mobileError(403, "not_a_driver");
  }

  // Gövde İSTEĞE BAĞLI: atanmış araçla açmak tek dokunuştur ve gönderilecek
  // alan yoktur. Boş gövde `{}` sayılır; bozuk JSON reddedilir.
  let body: unknown = {};
  const raw = await req.text();
  if (raw.trim().length > 0) {
    try {
      body = JSON.parse(raw);
    } catch {
      return mobileError(400, "invalid_json");
    }
  }
  const input = (body ?? {}) as Record<string, unknown>;

  const aracId = input.aracId ?? input.vehicleId;
  if (aracId !== undefined && aracId !== null && typeof aracId !== "string") {
    return mobileError(400, "invalid", { alan: "aracId", sebep: "metin_degil" });
  }

  const r = await startShiftSelf(worker.id, {
    overrideVehicleId: (aracId as string | undefined) || undefined,
  });

  if (!r.ok) {
    const status = statusFor(r.error);
    return status === 500
      ? mobileError(500, "write_failed", { detail: r.error })
      : mobileError(status, r.error);
  }

  // Panelin sayfa önbelleği. try/catch: tazeleme başarısız olsa da VARDİYA
  // AÇILDI — 503 dönmek şoföre "olmadı" der ve ikinci kez denetirdi.
  let panelTazelendi = true;
  try {
    revalidatePath("/panel");
    revalidatePath("/admin");
  } catch {
    panelTazelendi = false;
  }

  return Response.json({
    ok: true,
    vardiya: {
      id: r.entryId,
      /** true = yeni satır AÇILMADI, bugünün kapanmış vardiyası yeniden açıldı. */
      yenidenAcildi: r.reopened,
    },
    /** Kiracı davranışı — istemci ekranını buna göre kurar, tahmin etmez. */
    kiraci: { aracSecimi: DRIVER_VEHICLE_CHOICE, gunlukVardiya: SHIFT_PER_DAY },
    panelTazelendi,
  });
}
