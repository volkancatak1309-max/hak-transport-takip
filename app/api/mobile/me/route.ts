import type { NextRequest } from "next/server";
import { verifyMobileRequest, mobileError } from "@/lib/mobile-auth";
import { buildMobileUser, mobileTenant } from "@/lib/mobile-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/me — geçerli accessToken ile kullanıcı + kiracı bilgisi.
 *
 * Ortak kapıyı (verifyMobileRequest) kullanan ilk uç; bundan sonraki tüm mobil
 * uçlar aynı deseni izleyecek.
 */
export async function GET(req: NextRequest) {
  const auth = await verifyMobileRequest(req);
  if (!auth.ok) return mobileError(auth.status, auth.code);

  return Response.json({
    ok: true,
    user: await buildMobileUser({
      id: auth.worker.id,
      name: auth.worker.name,
      is_admin: auth.worker.is_admin,
      counts_as_driver: auth.worker.counts_as_driver,
    }),
    mustChangePin: auth.worker.must_change_pin,
    tenant: mobileTenant(),
  });
}
