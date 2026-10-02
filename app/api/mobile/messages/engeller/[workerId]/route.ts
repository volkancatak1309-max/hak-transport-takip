import type { NextRequest } from "next/server";
import { requireMobileWorkerScoped } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { engelKaldir } from "@/lib/mesaj-moderasyon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/mobile/messages/engeller/[workerId] — ENGELİ KALDIR (111).
 *
 * Yalnız KENDİ engelimi kaldırabilirim (satır `engelleyen_id = ben` ile
 * süzülüyor; başkasının engeline dokunmanın yolu yok). Satır silinir —
 * engel kişisel bir tercih, geçmişi tutulmaz. Engel yoksa da 200 +
 * `kaldirildi: false` (idempotent): "kaldır" düğmesine iki kez basmak hata
 * değil.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ workerId: string }> }) {
  const guard = await requireMobileWorkerScoped(req);
  if (!guard.ok) return guard.response;
  const { workerId } = await ctx.params;

  const r = await engelKaldir(guard.actor, workerId);
  if (!r.ok) return mobileError(r.status, r.code);
  return Response.json({ ok: true, workerId, ...r.data });
}
