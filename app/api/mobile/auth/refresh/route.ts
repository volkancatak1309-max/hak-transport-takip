import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  readToken,
  issueAccessToken,
  readTokenVersion,
  mobileError,
} from "@/lib/mobile-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/auth/refresh — refreshToken → yeni accessToken.
 *
 * Hesap durumu ve iptal sayacı KAYNAKTAN okunur, token'a güvenilmez: bu yüzden
 * pasife alınmış ya da PIN'i sıfırlanmış birinin refresh'i 401 döner.
 *
 * Refresh token DÖNDÜRÜLMEZ (rotasyon yok): rotasyon ancak sunucuda oturum
 * kaydı tutulursa anlamlı olur, katman 1'de iptal hesap ekseninde
 * (workers.token_version) yürüyor. Rotasyon gerekirse ayrı bir tablo ister.
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

  const { data, error } = await supabaseAdmin
    .from("workers")
    .select("id, is_admin, is_active")
    .eq("id", payload.sub)
    .maybeSingle();
  if (error) return mobileError(503, "db_error");
  if (!data) return mobileError(401, "invalid_token");
  if (data.is_active !== true) return mobileError(401, "inactive");

  const tv = await readTokenVersion(payload.sub);
  // Geçici DB hatasında iptal denetimi yapılamaz → fail-closed.
  if (tv.status === "error") return mobileError(503, "db_error");
  if (tv.status === "ok" && payload.tv !== tv.value) {
    return mobileError(401, "revoked");
  }
  const version = tv.status === "ok" ? tv.value : payload.tv;

  const issued = await issueAccessToken(
    payload.sub,
    data.is_admin === true,
    version
  );
  return Response.json({ ok: true, ...issued });
}
