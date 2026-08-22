import type { NextRequest } from "next/server";
import { requireMobileWorker } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { endShiftForWorker } from "@/lib/shift-end";
import { PACKAGES_ENABLED } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/shifts/current/end — ŞOFÖR KENDİ VARDİYASINI KAPATIR.
 *
 * Mobilin auth dışı İKİNCİ yazma ucu (ilki paket girişi). Panelin kapanış
 * formunun karşılığıdır ve kuralları KOPYALAMAZ: `lib/shift-end.ts` hem bu ucun
 * hem `endShiftAction`'ın TEK kaynağıdır. Bitiş km'sinin cihazdan türetilmesi,
 * paket muhasebesi, `checkUndelivered` tavanı, paket modülü bayrağı, migration
 * öncesi kolona düşüş ve sefer köprüsü — hepsi orada, tek yerde.
 *
 * ── HANGİ VARDİYA ───────────────────────────────────────────────────────────
 * Gövde vardiya kimliği ALMAZ ve alamamalı. Kapatılan vardiya, TOKEN'DAKİ
 * kişinin açık vardiyasıdır; `endShiftForWorker` sorguyu `worker_id`'ye
 * anahtarlar. Gövdeden kimlik kabul etseydik bir şoför başkasının vardiyasını
 * kapatabilirdi — kapı bir kontrol satırıyla değil, İSTEĞİN ŞEKLİYLE kapalı.
 * Bu yüzden "yanlış şoför 403 alır" diye bir dal yok: yanlış şoför zaten kendi
 * vardiyasına bakar ve açık vardiyası yoksa 409 `no_active` alır.
 *
 * ── KAPI: ŞOFÖR, YÖNETİCİ MUAFİYETLİ ────────────────────────────────────────
 * `requireMobileWorker` + KARDEŞ KAPILARIN AYNI CÜMLESİ (migration 041 muafiyeti,
 * bkz. shifts/current/packages/route.ts:55): direksiyona geçmeyen yönetici
 * (`is_admin=true, counts_as_driver=false`) 403 `not_a_driver` alır; gerçekten
 * araç kullanan yönetici KENDİ vardiyasını kapatabilir. Filo şefi de bir
 * çalışandır — açık vardiyası varsa kapatır.
 *
 * ── HATA KODLARI ────────────────────────────────────────────────────────────
 * Dizgeler panelinkiyle BİREBİR aynı (tek kaynaktan geliyorlar); değişen yalnız
 * HTTP kodudur:
 *   401 missing_token / invalid_token / revoked / inactive   (ortak kapı)
 *   403 not_a_driver
 *   400 invalid_json · validation · undelivered_required
 *       undelivered_invalid · undelivered_over:<geri>:<alınan>
 *       undelivered_no_total · undelivered_max:<tavan>
 *   409 no_active            — kapatılacak açık vardiya yok
 *   503 db                   — vardiya okunamadı
 *   500 write_failed         — ham DB yazma hatası (detay `detail` alanında)
 */

/** Paket tavanı hataları 400'dür; kapanışın kendisi başarısızsa 500. */
const CLIENT_ERRORS = new Set([
  "validation",
  "undelivered_required",
  "undelivered_invalid",
  "undelivered_no_total",
]);

function statusFor(error: string): number {
  if (error === "no_active") return 409;
  if (error === "db") return 503;
  if (CLIENT_ERRORS.has(error)) return 400;
  // `undelivered_over:12:10` ve `undelivered_max:5000` önekli: istemci hatası.
  if (error.startsWith("undelivered_over:") || error.startsWith("undelivered_max:")) {
    return 400;
  }
  // Şemadan gelen serbest doğrulama mesajı da istemci hatasıdır; ama ham DB
  // mesajını 400 diye göstermek yanlış yönlendirir. Ayrımı burada YAPMIYORUZ:
  // bilinmeyen her dizge 500 sayılır ve `error` gövdede aynen döner. Sessizce
  // 400 demek, sunucu arızasını istemcinin suçu gibi gösterirdi.
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

  // Gövde İSTEĞE BAĞLI: paket modülü kapalı kiracıda kapatma tek dokunuştur ve
  // gönderilecek alan yoktur. Boş gövde `{}` sayılır; bozuk JSON reddedilir.
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

  const r = await endShiftForWorker(worker.id, {
    plate: input.plaka ?? input.plate ?? null,
    notes: input.not ?? input.notes ?? null,
    break_minutes: input.molaDk ?? input.break_minutes ?? null,
    cargo_count: input.teslim ?? input.cargo_count ?? null,
    undelivered_count: input.teslimEdilemeyen ?? input.undelivered_count ?? null,
  });

  if (!r.ok) {
    const status = statusFor(r.error);
    return status === 500
      ? mobileError(500, "write_failed", { detail: r.error })
      : mobileError(status, r.error);
  }

  return Response.json({
    ok: true,
    vardiya: {
      id: r.entryId,
      bitis: r.endedAt,
      /** null = ölçülemedi (araçta telemetri yok). "0 km" DEĞİL — bkz. lib/km-quality.ts. */
      bitisKm: r.endKm,
    },
    paket: PACKAGES_ENABLED
      ? { teslim: r.delivered, teslimEdilemeyen: r.undelivered }
      : null,
  });
}
