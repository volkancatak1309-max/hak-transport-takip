import type { NextRequest } from "next/server";
import { requireMobileWorkerScoped } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { uyeCikar } from "@/lib/messaging-groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/mobile/messages/gruplar/[id]/uyeler/[workerId] — ÜYE ÇIKAR.
 *
 * ⚠️ SATIR SİLİNMEZ, `left_at` işaretlenir (migration 073). Çıkarılan kişi
 * grubu listesinde görmeye ve geçmişi O ANA KADAR okumaya devam eder; yeni
 * mesajları görmez ve yazamaz.
 *
 * WhatsApp davranışı + filo gerekçesi: o şoföre o grupta bir TALİMAT verildi
 * ("yarın 06:30 A deposu"). Gruptan çıkarmak, ona söylenmiş şeyi ekranından
 * silmemeli — 071'deki "kaza yaptım kaydını sessizce yok etme" sorununun
 * aynısı.
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; workerId: string }> }
) {
  const { id, workerId } = await ctx.params;
  const guard = await requireMobileWorkerScoped(req);
  if (!guard.ok) return guard.response;

  const r = await uyeCikar(guard.actor, id, workerId);
  if (!r.ok) return mobileError(r.status, r.code);
  return Response.json({ ok: true, ...r.data });
}
