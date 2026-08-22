import type { NextRequest } from "next/server";
import { requireMobileWorkerScoped } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase";
import {
  erisimCoz,
  hedefSoforMu,
  konusmaGetir,
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

  const { data, error, count } = await supabaseAdmin
    .from("messages")
    .select("id, sender_worker_id, sender_role, body, broadcast_id, created_at", {
      count: "exact",
    })
    .eq("conversation_id", konusma.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) return mobileError(503, "db_error");

  const mesajlar = (data ?? []) as {
    id: string;
    sender_worker_id: string | null;
    sender_role: string;
    body: string;
    broadcast_id: string | null;
    created_at: string;
  }[];

  // ── ✓✓ — makbuzlar TEK sorguda ────────────────────────────────────────────
  // Bayrak kapalıyken makbuz sorgusu HİÇ atılmaz ve alan null döner:
  // "bilinmiyor", "okunmadı" değil.
  let okuyanlar = new Map<string, { workerId: string; an: string }[]>();
  if (READ_RECEIPTS_ENABLED && mesajlar.length > 0) {
    const { data: rec } = await supabaseAdmin
      .from("message_receipts")
      .select("message_id, worker_id, read_at")
      .in("message_id", mesajlar.map((m) => m.id));
    okuyanlar = new Map();
    for (const r of (rec ?? []) as {
      message_id: string; worker_id: string; read_at: string;
    }[]) {
      const l = okuyanlar.get(r.message_id) ?? [];
      l.push({ workerId: r.worker_id, an: r.read_at });
      okuyanlar.set(r.message_id, l);
    }
  }

  return Response.json({
    ok: true,
    sofor: { id, adSoyad: hedefOk.ad },
    konusmaId: konusma.id,
    okunduBilgisi: READ_RECEIPTS_ENABLED,
    mesajlar: mesajlar.map((m) => ({
      id: m.id,
      gonderenId: m.sender_worker_id,
      gonderenRol: m.sender_role,
      govde: m.body,
      duyuruMu: m.broadcast_id !== null,
      an: m.created_at,
      /** null = okundu bilgisi kapalı. [] = kimse okumadı. */
      okuyanlar: READ_RECEIPTS_ENABLED ? okuyanlar.get(m.id) ?? [] : null,
    })),
    sayfa: pageInfo(page, count ?? mesajlar.length),
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
