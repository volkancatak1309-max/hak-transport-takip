import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { bildirimCoz } from "@/lib/mesaj-moderasyon";
import { audit } from "@/lib/security-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/messages/bildirimler/[mesajId]/coz — ÇÖZÜLDÜ İŞARETLE (111).
 *
 * Bir mesajın BÜTÜN açık bildirimleri birlikte çözülür: yönetici için iş
 * mesaj başına. Mesajı silmek ya da göndereni pasife almak bildirimi
 * KENDİLİĞİNDEN çözmez — üç eylem bağımsız; yönetici ikisini birden yapıp
 * sonra çözebilsin diye.
 *
 * Yalnız yönetici. Zaten çözülmüşse 200 + `cozulen: 0`; mesaj hiç
 * bildirilmemişse 404.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ mesajId: string }> }) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;
  const { mesajId } = await ctx.params;

  const r = await bildirimCoz(guard.actor, mesajId);
  if (!r.ok) return mobileError(r.status, r.code);

  if (r.data.cozulen > 0) {
    await audit(guard.actor.worker.id, "message_report_resolve", `mesaj:${mesajId} kaynak=mobil`);
  }
  return Response.json({ ok: true, mesajId, ...r.data });
}
