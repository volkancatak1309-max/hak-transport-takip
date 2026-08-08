import type { NextRequest } from "next/server";
import {
  readToken,
  readTokenVersion,
  bumpTokenVersion,
  mobileError,
} from "@/lib/mobile-auth";
import { closeSessionsBySource } from "@/lib/security-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/auth/logout — refreshToken'ı geçersiz kılar.
 *
 * İptal HESAP EKSENİNDE yürür: workers.token_version bir artar ve o kişinin
 * TÜM mobil token'ları (access + refresh, her cihazda) anında ölür. Cihaz başına
 * çıkış yapılamaz — bu bilinçli bir seçim, kararı ve gerekçesi tasarım turunda
 * verildi (ayrı oturum tablosu yerine tek tamsayı kolon).
 *
 * MIGRATION 044 ÇALIŞMAMIŞSA: 503 mobile_store_missing döner ve SESSİZCE
 * BAŞARILI SAYMAZ. "Çıkış yaptım" demek ama anahtarı canlı bırakmak, kullanıcıyı
 * güvende olmadığı bir durumda güvende sanmaya iter.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }
  const refreshToken = (body as { refreshToken?: unknown } | null)?.refreshToken;
  if (typeof refreshToken !== "string" || !refreshToken) {
    return mobileError(400, "missing_fields");
  }

  const payload = await readToken(refreshToken, "refresh");
  if (!payload) return mobileError(401, "invalid_token");

  const tv = await readTokenVersion(payload.sub);
  if (tv.status === "missing_column") {
    return mobileError(503, "mobile_store_missing", {
      hint: "db/migrations/044_mobile_token_version.sql çalıştırılmadı",
    });
  }
  if (tv.status === "error") return mobileError(503, "db_error");

  // Zaten iptal edilmiş bir token'la çıkış → idempotent, tekrar artırmaya gerek
  // yok. (Kullanıcı iki cihazdan üst üste çıkış tuşuna basabilir.)
  if (payload.tv !== tv.value) {
    return Response.json({ ok: true, alreadyRevoked: true });
  }

  const bumped = await bumpTokenVersion(payload.sub);
  if (!bumped) return mobileError(503, "revoke_failed");

  // Oturum satırlarını da kapat (045). Çıkış hesap ekseninde yürüdüğü için
  // kapanış da hesap ekseninde: aksi hâlde çıkış yapmış bir telefon
  // /admin/guvenlik'te "açık oturum" olarak durmaya devam ederdi.
  await closeSessionsBySource(payload.sub, "mobile", "logout");

  return Response.json({ ok: true });
}
