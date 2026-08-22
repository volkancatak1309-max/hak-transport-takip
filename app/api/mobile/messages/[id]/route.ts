import type { NextRequest } from "next/server";
import { requireMobileWorkerScoped } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase";
import {
  erisimCoz,
  hedefSoforMu,
  konusmaGetir,
  konusmaGecmisi,
  govdeCoz,
  sonMesajiIsle,
} from "@/lib/messaging";
import { READ_RECEIPTS_ENABLED } from "@/lib/tenant";
import { parsePage, pageInfo } from "@/lib/mobile-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/mobile/messages/[id] — TEK KONUŞMA.
 *
 * ⚠️ `[id]` KONUŞMA kimliği DEĞİL, konuşmanın sahibi ŞOFÖRÜN kimliğidir.
 * Gerekçe lib/messaging.ts başında: konuşma satırı ilk mesaja kadar yoktur,
 * şoför her zaman vardır. Tek kararlı adres o.
 *
 *   GET  → geçmiş, sayfalı (en yeni üstte)
 *   POST → mesaj gönder (konuşma yoksa açılır)
 *
 * Kapı `erisimCoz`: şoför yalnız kendi kimliği, şef kapsamı, patron herkes.
 * Yazılan `sender_role` KAPIDAN türer — gövdeden değil.
 */

async function ortakKapi(req: NextRequest, hedef: string) {
  const guard = await requireMobileWorkerScoped(req);
  if (!guard.ok) return { hata: guard.response } as const;
  const erisim = await erisimCoz(guard.actor, hedef);
  if (!erisim.ok) return { hata: mobileError(erisim.status, erisim.code) } as const;
  return { actor: guard.actor, erisim } as const;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const k = await ortakKapi(req, id);
  if ("hata" in k) return k.hata;

  const hedefOk = await hedefSoforMu(id);
  if (!hedefOk.ok) return mobileError(hedefOk.status, hedefOk.code);

  // OKUMA konuşma YARATMAZ — "geçmişe baktım" ile "konuşma başlattım" aynı
  // şey değil; yaratsaydı liste boş konuşmalarla dolardı.
  const konusma = await konusmaGetir(id, false);
  if (!konusma.ok) return mobileError(503, konusma.code);

  const page = parsePage(new URL(req.url));

  if (konusma.id === null) {
    return Response.json({
      ok: true,
      sofor: { id, adSoyad: hedefOk.ad },
      konusmaId: null,
      mesajlar: [],
      okunduBilgisi: READ_RECEIPTS_ENABLED,
      sayfa: pageInfo(page, 0),
    });
  }

  // Sorgu lib/messaging.ts'te — panel ekrani AYNI fonksiyonu cagiriyor.
  const g = await konusmaGecmisi(konusma.id, page);
  if (!g.ok) return mobileError(503, g.code);

  return Response.json({
    ok: true,
    sofor: { id, adSoyad: hedefOk.ad },
    konusmaId: konusma.id,
    okunduBilgisi: READ_RECEIPTS_ENABLED,
    mesajlar: g.mesajlar,
    sayfa: pageInfo(page, g.total),
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const k = await ortakKapi(req, id);
  if ("hata" in k) return k.hata;
  const { actor, erisim } = k;

  const hedefOk = await hedefSoforMu(id);
  if (!hedefOk.ok) return mobileError(hedefOk.status, hedefOk.code);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }
  const inp = (body ?? {}) as Record<string, unknown>;
  const govde = govdeCoz(inp.govde ?? inp.body);
  if (!govde.ok) return mobileError(400, govde.code);

  const konusma = await konusmaGetir(id, true);
  if (!konusma.ok || !konusma.id) return mobileError(503, "db_error");

  const { data, error } = await supabaseAdmin
    .from("messages")
    .insert({
      conversation_id: konusma.id,
      sender_worker_id: actor.worker.id,
      // KAPIDAN türer, gövdeden DEĞİL: istemci kendini yönetici ilan edemez.
      sender_role: erisim.role,
      body: govde.body,
    })
    .select("id, created_at")
    .single();
  if (error) return mobileError(500, "write_failed", { detail: error.message });

  await sonMesajiIsle(konusma.id, govde.body, erisim.role, data.created_at as string);

  return Response.json({
    ok: true,
    mesaj: {
      id: data.id,
      konusmaId: konusma.id,
      gonderenId: actor.worker.id,
      gonderenRol: erisim.role,
      govde: govde.body,
      an: data.created_at,
    },
  });
}
