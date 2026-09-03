import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileManualStart } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { startShiftForWorkerCore } from "@/lib/shift-start";
import { SHIFT_PER_DAY } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/shifts/start-for — YÖNETİCİ / FİLO ŞEFİ BAŞKASI ADINA AÇAR.
 *
 * Gövde: `{ "workerId": "<uuid>", "baslangic": "2026-09-03T06:30:00+02:00",
 *           "aracId": "<uuid>" }` — `aracId` opsiyonel (verilmezse şoförün
 * atanmış aracı).
 *
 * Panelin "VARDİYAYI BAŞLAT" diyaloğunun (Günün Panosu) karşılığıdır. Yetki
 * kapısı ve başlatma gövdesi panelle ORTAK:
 *   kapı   → lib/manual-start-scope.ts (requireMobileManualStart / requireManualStartAuth)
 *   gövde  → lib/shift-start.ts:startShiftForWorkerCore
 *
 * ── NEDEN AYRI UÇ, `/start`e BAYRAK DEĞİL ───────────────────────────────────
 * İki eylemin YETKİSİ farklı: `/start` token sahibinin kendi vardiyası için
 * hiçbir ek yetki istemez; bu ise patron VEYA filo şefi olmayı ve hedefin
 * kapsamda olmasını ister. Tek uçta birleştirmek, "workerId gönderilmediyse
 * kendine, gönderildiyse başkasına" gibi bir dal demekti — ve o dalın bir gün
 * yanlış tarafa düşmesi, bir şoförün başkası adına vardiya açması olurdu.
 * İki uç, iki kapı: yanlış tarafa düşecek dal YOK.
 *
 * ── BAŞLANGIÇ ANI ÇAĞIRANDAN GELİR ──────────────────────────────────────────
 * `/start`ten en büyük farkı budur. Orada `started_at` SUNUCUDA türetilir (depo
 * girişi → 14 günlük ortalama → now) ve şoför saat seçemez. Burada telafi
 * yapılıyor: otomatik tetik çalışmadı, yönetici "mesaiye 06:30'da başladı"
 * diyor. Sunucu yine de sınırları uygular: bugünün Viyana günü içinde ve
 * gelecekte olmayan bir an (60 sn tolerans) — `not_today` / `future_time`.
 *
 * ⚠️ ISO OFSETİ İSTEMCİDEN GELMELİ. "2026-09-03T06:30" gibi ofsetsiz bir dize
 * sunucunun kendi diliminde yorumlanır ve Viyana'da yazın 2 saat kayar. Panel
 * bunu tarayıcının duvar-saatinden türetiyor; mobil de kendi diliminden tam
 * ofsetli ISO göndermeli.
 *
 * ── DEPO KİLİDİ UYGULANMAZ ──────────────────────────────────────────────────
 * Araç şu an sahada olabilir (telemetri düştüğü için zaten buradayız);
 * yönetici/şef bilerek override ediyor. Kilit koysaydık telafinin amacına
 * aykırı olurdu. Bunun bedeli `start_source` ile GÖRÜNÜR: 'chief' ile açılan
 * vardiya panelin Dikkat kalemine düşer.
 *
 * ── HATA KODLARI ────────────────────────────────────────────────────────────
 *   401 missing_token / invalid_token / revoked / inactive   (ortak kapı)
 *   403 unauthorized          — ne patron ne filo şefi
 *       out_of_scope          — şef, hedef şoför onun filosunda değil
 *       vehicle_out_of_scope  — şef, seçilen araç kapsamı dışında
 *       inactive_worker       — hedef kadroda değil
 *       not_a_driver          — hedef yönetici ve `counts_as_driver` değil
 *   400 invalid_json · missing_fields · invalid_time · future_time · not_today
 *   404 no_vehicle
 *   409 active · day_done · vehicle_unavailable
 *   500 write_failed
 */
const BAD_REQUEST = new Set(["invalid_time", "future_time", "not_today"]);
const FORBIDDEN = new Set([
  "inactive_worker",
  "not_a_driver",
  "vehicle_out_of_scope",
]);
const CONFLICT = new Set(["active", "day_done", "vehicle_unavailable"]);

function statusFor(error: string): number {
  if (BAD_REQUEST.has(error)) return 400;
  if (FORBIDDEN.has(error)) return 403;
  if (error === "no_vehicle") return 404;
  if (CONFLICT.has(error)) return 409;
  return 500;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return mobileError(400, "invalid", { alan: "govde", sebep: "nesne_degil" });
  }
  const g = body as Record<string, unknown>;

  const workerId = g.workerId ?? g.personelId;
  if (typeof workerId !== "string" || !workerId.trim()) {
    return mobileError(400, "missing_fields", { alan: "workerId" });
  }
  const baslangic = g.baslangic ?? g.startedAt;
  if (typeof baslangic !== "string" || !baslangic.trim()) {
    return mobileError(400, "missing_fields", { alan: "baslangic" });
  }
  const aracId = g.aracId ?? g.vehicleId;
  if (aracId !== undefined && aracId !== null && typeof aracId !== "string") {
    return mobileError(400, "invalid", { alan: "aracId", sebep: "metin_degil" });
  }

  // ⚠️ KAPI GÖVDEDEN SONRA — hedef kimliği bilinmeden karar verilemez. Bu
  // sıra bir sızıntı açmıyor: kapı hedefin VARLIĞINA bakmıyor, aktörün o
  // hedef için yetkili olup olmadığına bakıyor; olmayan bir workerId de
  // kapsam dışıdır ve aynı 403'ü alır.
  const guard = await requireMobileManualStart(req, workerId.trim());
  if (!guard.ok) return guard.response;

  const r = await startShiftForWorkerCore(guard.auth, {
    workerId: workerId.trim(),
    startedAt: baslangic,
    vehicleId: (aracId as string | undefined) || undefined,
  });

  if (!r.ok) {
    const status = statusFor(r.error);
    return status === 500
      ? mobileError(500, "write_failed", { detail: r.error })
      : mobileError(status, r.error);
  }

  let panelTazelendi = true;
  try {
    revalidatePath("/panel");
    revalidatePath("/admin");
    revalidatePath("/admin/workers");
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
    /** İZ — `start_source` kolonuna yazılan değer. 'chief' Dikkat kalemi üretir. */
    kaynak: guard.auth.role,
    kiraci: { gunlukVardiya: SHIFT_PER_DAY },
    panelTazelendi,
  });
}
