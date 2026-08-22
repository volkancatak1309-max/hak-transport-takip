import type { NextRequest } from "next/server";
import { requireMobileWorkerScoped } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { grupKur } from "@/lib/messaging-groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/messages/gruplar — GRUP KUR.
 *
 * Gövde: `{ baslik: string, uyeler: string[] }`
 *
 * Kapı lib/messaging-groups.ts'te tek yerde: patron VEYA filo şefi; şef YALNIZ
 * kendi kapsamındaki şoförleri ekleyebilir. Şoför 403 `admin_required`.
 * Kurucu OTOMATİK üye olur — erişim üyelik ekseninde olduğu için olmasaydı
 * kendi kurduğu grubu açamazdı.
 *
 * Grupları LİSTELEMEK için ayrı uç YOK: `GET /api/mobile/messages` birebirlerle
 * birlikte grupları da döndürüyor (liste birliği, 4a).
 */
export async function POST(req: NextRequest) {
  const guard = await requireMobileWorkerScoped(req);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }
  const inp = (body ?? {}) as Record<string, unknown>;

  const r = await grupKur(guard.actor, inp.baslik ?? inp.title, inp.uyeler ?? inp.members);
  if (!r.ok) return mobileError(r.status, r.code);
  return Response.json({ ok: true, grup: r.data });
}
