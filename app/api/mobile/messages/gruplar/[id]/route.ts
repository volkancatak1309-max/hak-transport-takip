import type { NextRequest } from "next/server";
import { requireMobileWorkerScoped } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { grupDetay, grupAdiDegistir } from "@/lib/messaging-groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/mobile/messages/gruplar/[id]
 *
 *   GET   → detay + üye listesi (`yonetebilir` / `yazabilir` bayraklarıyla)
 *   PATCH → ad değiştir  `{ baslik: string }`
 *
 * ── OKUMA YETKİSİ YÖNETİMDEN GENİŞ ──────────────────────────────────────────
 * Her üye — ÇIKARILMIŞ olan dâhil — grubu ve üyelerini görür (WhatsApp da
 * öyle). Yönetmek ayrı: patron ya da grubun AKTİF ÜYESİ olan filo şefi.
 * Yanıttaki `yonetebilir` tam olarak bunu söyler; istemci düğmeleri buna göre
 * çizer ama SON SÖZ sunucudadır — PATCH kendi kapısını ayrıca uygular.
 *
 * ── ARŞİV ───────────────────────────────────────────────────────────────────
 * Arşivlenmiş grupta ad değiştirmek de bir YAZMADIR → 409. Okuma serbest:
 * arşiv silme değil, dondurmadır.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const guard = await requireMobileWorkerScoped(req);
  if (!guard.ok) return guard.response;

  const r = await grupDetay(guard.actor, id);
  if (!r.ok) return mobileError(r.status, r.code);
  return Response.json({ ok: true, grup: r.data });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const guard = await requireMobileWorkerScoped(req);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }
  const inp = (body ?? {}) as Record<string, unknown>;

  const r = await grupAdiDegistir(guard.actor, id, inp.baslik ?? inp.title);
  if (!r.ok) return mobileError(r.status, r.code);
  return Response.json({ ok: true, grup: { konusmaId: id, ...r.data } });
}
