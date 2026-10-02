import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { mesajSil } from "@/lib/mesaj-moderasyon";
import { audit } from "@/lib/security-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/mobile/messages/mesaj/[mesajId] — YÖNETİCİ SİLMESİ (111).
 *
 * ── NEDEN `/mesaj/` ÖN EKİ ─────────────────────────────────────────────────
 * `/api/mobile/messages/[id]` zaten var ve `[id]` KONUŞMA ya da ŞOFÖR
 * kimliği. Mesaj düzeyindeki işler o adres alanına giremez — aynı uuid
 * biçimi üç ayrı varlığı adreslerdi. Next statik bölümü (`mesaj`) dinamik
 * `[id]`den önce eşler; `duyuru` ve `gruplar` da aynı yolla yaşıyor.
 *
 * ── KAPI ───────────────────────────────────────────────────────────────────
 * Yalnız yönetici (`requireMobileAdmin`): şef ve şoför 403 `admin_required`.
 * Çekirdek (`mesajSil`) aynı denetimi ikinci kez yapıyor — panel eylemi de
 * oradan geçtiği için kural tek yerde.
 *
 * Yumuşak silme: satır ve metni DB'de kalır, okuma yolu metni göndermez ve
 * herkes "kaldırıldı" izini görür. Grup ve birebir; arşivli grupta da.
 * Zaten silinmişse 200 + `zatenSilinmisti: true` (idempotent).
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ mesajId: string }> }) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;
  const { mesajId } = await ctx.params;

  const r = await mesajSil(guard.actor, mesajId);
  if (!r.ok) return mobileError(r.status, r.code);

  if (!r.data.zatenSilinmisti) {
    await audit(guard.actor.worker.id, "message_delete", `mesaj:${mesajId} kaynak=mobil`);
  }
  return Response.json({ ok: true, mesajId, ...r.data });
}
