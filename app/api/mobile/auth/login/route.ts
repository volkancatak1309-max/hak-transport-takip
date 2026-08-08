import type { NextRequest } from "next/server";
import { verifyCredentials, clientIpFromHeaders } from "@/lib/auth-core";
import {
  issueTokens,
  readTokenVersion,
  mobileError,
} from "@/lib/mobile-auth";
import { buildMobileUser } from "@/lib/mobile-user";
import { openLoginSession } from "@/lib/security-log";
import { evaluateAccess } from "@/lib/access-gates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/auth/login — telefon + PIN → token çifti.
 *
 * TARAYICI GİRİŞİYLE AYNI KAPI: doğrulamayı lib/auth-core.ts yapar, yani aynı
 * bcrypt karşılaştırması, aynı kilit merdiveni (10 deneme / 15 sn taban), aynı
 * dummy-hash zamanlama koruması ve aynı kiracı kapısı. Burada yeniden yazılmış
 * tek bir kural yok.
 *
 * FARKI: çerez yazmaz, redirect atmaz. Hata durumunda HTTP kodu döner —
 * 400 (eksik/biçimsiz alan), 401 (geçersiz kimlik), 429 (kilitli), 503 (DB).
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }
  const input = (body ?? {}) as { phone?: unknown; pin?: unknown };
  if (input.phone === undefined || input.pin === undefined) {
    return mobileError(400, "missing_fields");
  }

  const res = await verifyCredentials({
    phone: input.phone,
    pin: input.pin,
    ip: clientIpFromHeaders(req.headers),
  });

  if (!res.ok) {
    if (res.reason === "locked") {
      // 429 + Retry-After: standart biçim, istemci geri sayımı buradan kurar.
      return Response.json(
        {
          ok: false,
          error: "locked",
          retryAfter: res.retryAfter,
          lockedUntil: res.lockedUntil,
        },
        {
          status: 429,
          headers: { "Retry-After": String(res.retryAfter ?? 1) },
        }
      );
    }
    if (res.reason === "validation") return mobileError(400, "validation");
    if (res.reason === "db") return mobileError(503, "db_error");
    // Bilinmeyen telefon / pasif hesap / yanlış PIN → AYNI cevap.
    // Hesap sayımına (account enumeration) kapı açmamak için ayrıştırılmaz.
    return mobileError(401, "invalid_credentials");
  }

  const worker = res.worker;

  // ── ERİŞİM KAPILARI (046) ───────────────────────────────────────────────
  // Web'den FARKI: burada "beklet" diye bir hâl YOK, her kapı REDDEDER.
  // Sebebi yapısal — tarayıcıda bekleyen kullanıcıyı /erisim ekranına
  // hapsedebiliyoruz, mobilde ise token vermek demek tüm /api/mobile/* uçlarını
  // açmak demek. Yarım yetkili bir token, hiç token vermemekten kötüdür.
  const kapi = await evaluateAccess(worker.id, req.headers);
  if (!kapi.ok) {
    const kod =
      kapi.gate === "kill" ? "system_locked"
      : kapi.gate === "hours" ? "outside_hours"
      : kapi.gate === "device" ? "device_pending"
      : "country_pending";
    return mobileError(403, kod, kapi.detail ? { detail: kapi.detail } : undefined);
  }

  // GÜVENLİK İZİ (045) — mobil de bir GİRİŞ KAPISI, o yüzden buraya da yazar.
  // Yazılmazsa /admin/guvenlik "kim girdi" sorusuna eksik cevap verir: telefondan
  // yapılan giriş hiç görünmez, yani izlenmesi gereken yerde kör kalırdık.
  //
  // ⚠️ SIRA: token_version okumasından ÖNCE. SINGLE_SESSION açıkken
  // openLoginSession sayacı artırıyor; sonra okusaydık az önce geçersiz kıldığımız
  // sürümle token mühürlerdik ve istemci daha ilk istekte 401 alırdı.
  await openLoginSession(worker.id, { source: "mobile", headers: req.headers });

  const tv = await readTokenVersion(worker.id);
  if (tv.status === "error") return mobileError(503, "db_error");
  const version = tv.status === "ok" ? tv.value : 0;

  const tokens = await issueTokens(worker.id, worker.is_admin, version);

  return Response.json({
    ok: true,
    ...tokens,
    mustChangePin: worker.must_change_pin === true,
    user: await buildMobileUser({
      id: worker.id,
      name: worker.name,
      is_admin: worker.is_admin,
      counts_as_driver: worker.counts_as_driver,
    }),
  });
}
