import type { NextRequest } from "next/server";
import { requireMobileWorkerScoped } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { uyeEkle } from "@/lib/messaging-groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/messages/gruplar/[id]/uyeler — ÜYE EKLE.
 *
 * Gövde: `{ uyeler: string[] }`
 *
 * ⚠️ ŞEF KAPSAM DENETİMİ, grup KURMA yoluyla AYNI fonksiyondan geçer
 * (lib/messaging-groups.ts `uyeleriDogrula`). İki ayrı yere yazsaydık biri
 * unutulur ve şef, kapsam dışı birini "sonradan ekleme" yolundan içeri alırdı.
 *
 * Daha önce ÇIKARILMIŞ biri yeniden eklenirse `left_at` temizlenir ve yeni
 * satır AÇILMAZ (PK çifti) — "kaç kez çıkarıldı" gürültüsü üyelik sorgusunu
 * belirsizleştirirdi.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  const r = await uyeEkle(guard.actor, id, inp.uyeler ?? inp.members);
  if (!r.ok) return mobileError(r.status, r.code);
  return Response.json({ ok: true, ...r.data });
}
