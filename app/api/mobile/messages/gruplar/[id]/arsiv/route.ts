import type { NextRequest } from "next/server";
import { requireMobileWorkerScoped } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { grupArsivle } from "@/lib/messaging-groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/messages/gruplar/[id]/arsiv — ARŞİVLE (grup SİLİNMEZ).
 *
 * Gövde isteğe bağlı: `{ arsivle: boolean }` — varsayılan `true`.
 * `false` arşivden çıkarır (DB tetikleyicisi arşiv kalkınca yazmaya yeniden
 * izin verir — 073 doğrulamasında ölçüldü).
 *
 * ── NEDEN SİLME DEĞİL ───────────────────────────────────────────────────────
 * Grup akışı bir OPERASYON KAYDIDIR; sevkiyat talimatları orada. Deponun
 * felsefesi de bu (messages.deleted_at, legal_hold, action_snoozes.cancelled_at):
 * "silmek kim ne yaptı bilgisini de yok eder". Arşivlenen grup herkes için
 * SALT OKUNUR olur, geçmiş bozulmaz.
 *
 * Sert silme yalnız patrona açık, AYRI ve izlenen bir eylem olacak — varsayılan
 * asla o değil. Bugün böyle bir uç YOK.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const guard = await requireMobileWorkerScoped(req);
  if (!guard.ok) return guard.response;

  // Gövde İSTEĞE BAĞLI: arşivlemek tek dokunuştur, alan göndermek gerekmez.
  let arsivle = true;
  const raw = await req.text();
  if (raw.trim().length > 0) {
    try {
      const b = JSON.parse(raw) as Record<string, unknown>;
      if (typeof b.arsivle === "boolean") arsivle = b.arsivle;
    } catch {
      return mobileError(400, "invalid_json");
    }
  }

  const r = await grupArsivle(guard.actor, id, arsivle);
  if (!r.ok) return mobileError(r.status, r.code);
  return Response.json({ ok: true, grup: { konusmaId: id, ...r.data } });
}
