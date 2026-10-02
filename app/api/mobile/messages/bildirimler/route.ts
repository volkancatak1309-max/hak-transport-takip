import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { bildirimListesi } from "@/lib/mesaj-moderasyon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/messages/bildirimler?durum=open|resolved — BİLDİRİLEN
 * MESAJLAR (111). YALNIZ YÖNETİCİ; şef ve şoför 403 `admin_required`.
 *
 * Panel `/admin/mesajlar/bildirilen` ekranıyla AYNI çekirdek
 * (`bildirimListesi`). Kayıtlar MESAJ başına toplanmış: aynı mesajı üç kişi
 * bildirdiyse tek kayıt, içinde üç bildirim. Silinmiş mesajın metni dönmez
 * (`govde: null`), kim/ne zaman sildi döner.
 *
 * `durum` verilmezse `open`. Tavan 500 bildirim satırı — dolarsa
 * `kirpildi: true` (sessiz kırpma yok).
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const ham = new URL(req.url).searchParams.get("durum");
  if (ham !== null && ham !== "open" && ham !== "resolved") {
    return mobileError(400, "invalid", { alan: "durum" });
  }
  const durum = ham === "resolved" ? "resolved" : "open";

  const r = await bildirimListesi(guard.actor, durum);
  if (!r.ok) return mobileError(r.status, r.code);
  return Response.json({ ok: true, durum, ...r.data });
}
