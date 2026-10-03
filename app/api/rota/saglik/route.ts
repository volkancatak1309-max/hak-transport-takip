import { NextResponse } from "next/server";
import { ROTA_OPTIMIZASYONU_ENABLED } from "@/lib/tenant";
import { rotaSaglayicilari } from "@/lib/rota/saglayici";
import { VroomSaglayici } from "@/lib/rota/vroom";

/**
 * ROTA TEŞHİS UCU — panelden (Vercel) motora uçtan uca yolu GİRİŞSİZ ölçer:
 * vekil sağlığı, sırsız istek (401 beklenir), sırlı VROOM ve sırlı OSRM.
 *
 * 🔴 ÜRETİMDE 404 (`VERCEL_ENV=production`) ve modül kapalıyken 404. Önizleme
 * Vercel SSO arkasında; ölçüm: `vercel curl /api/rota/saglik --deployment <url>`.
 * Cevapta sır, adres, kullanıcı verisi YOK — yalnız durum kodu, süre ve
 * motorun kodu; test noktaları sabit (lib/rota/vroom.ts `teshis`).
 * Muhafız: scripts/check-rota.mjs R11.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONBELLEKSIZ = { "Cache-Control": "no-store" };

export async function GET() {
  if (process.env.VERCEL_ENV === "production" || !ROTA_OPTIMIZASYONU_ENABLED) {
    return new NextResponse(null, { status: 404 });
  }
  const { birincil, sebep } = rotaSaglayicilari();
  if (!(birincil instanceof VroomSaglayici)) {
    return NextResponse.json(
      { saglayici: birincil?.kod ?? null, sebep },
      { status: 503, headers: ONBELLEKSIZ }
    );
  }
  const t0 = performance.now();
  const olcum = await birincil.teshis();
  return NextResponse.json(
    {
      bolge: process.env.VERCEL_REGION ?? null,
      ...olcum,
      toplamMs: Math.round(performance.now() - t0),
    },
    { headers: ONBELLEKSIZ }
  );
}
