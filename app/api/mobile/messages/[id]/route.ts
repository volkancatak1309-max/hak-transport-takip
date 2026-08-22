import type { NextRequest } from "next/server";
import { requireMobileWorkerScoped } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase";
import {
  hedefCoz,
  erisimCozKonusma,
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
 * /api/mobile/messages/[id] — TEK KONUŞMA (birebir VEYA grup).
 *
 * ⚠️ `[id]` HEM konuşma kimliği HEM şoför kimliği olabilir. `hedefCoz` ikisini
 * TEK SORGUYLA çözüyor (`id.eq.X or worker_id.eq.X`): grubun şoförü yok, ama
 * birebir konuşma satırı da ilk mesaja kadar yok — bu yüzden iki adres de
 * geçerli olmak zorunda. URL 071'den beri değişmedi.
 *
 *   GET  → geçmiş, sayfalı (en yeni üstte)
 *   POST → mesaj gönder (birebirde konuşma yoksa açılır)
 *
 * Yetki `erisimCozKonusma`: patron her konuşma; şef ve şoför grupta ÜYE ise,
 * birebirde kendi/kapsam kuralı. `sender_role` KAPIDAN türer — gövdeden değil.
 *
 * ── ARŞİV VE ÇIKARILMIŞ ÜYE ────────────────────────────────────────────────
 * Arşivlenmiş grupta HİÇ KİMSE yazamaz (409 `conversation_archived`), gruptan
 * çıkarılmış üye de yazamaz (409 `read_only`) — ama ikisi de OKUYABİLİR.
 * Çıkarılmış üyenin geçmişi `left_at` anında kesilir; süzgeç çekirdekte.
 */

async function kapi(req: NextRequest, adres: string) {
  const guard = await requireMobileWorkerScoped(req);
  if (!guard.ok) return { hata: guard.response } as const;

  const h = await hedefCoz(adres, guard.actor.worker.id);
  if (!h.ok) return { hata: mobileError(h.status, h.code) } as const;

  const e = await erisimCozKonusma(guard.actor, h.hedef);
  if (!e.ok) return { hata: mobileError(e.status, e.code) } as const;

  return { actor: guard.actor, hedef: h.hedef, erisim: e } as const;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const k = await kapi(req, id);
  if ("hata" in k) return k.hata;
  const { hedef, erisim } = k;

  const page = parsePage(new URL(req.url));

  const ortak = {
    tur: hedef.tur,
    baslik: hedef.baslik,
    // Geriye dönük alan: birebirde muhatabın kimliği, grupta null.
    sofor: hedef.tur === "birebir" ? { id: hedef.soforId, adSoyad: hedef.baslik } : null,
    arsivlendiMi: hedef.arsivlendiMi,
    yazabilir: erisim.yazabilir,
    okunduBilgisi: READ_RECEIPTS_ENABLED,
  };

  // Konuşma henüz açılmamış (birebir, hiç mesaj yok) — hata değil, boş geçmiş.
  if (hedef.konusmaId === null) {
    return Response.json({
      ok: true,
      ...ortak,
      konusmaId: null,
      mesajlar: [],
      sayfa: pageInfo(page, 0),
    });
  }

  const g = await konusmaGecmisi(hedef.konusmaId, page, hedef.pencereSonu);
  if (!g.ok) return mobileError(503, g.code);

  return Response.json({
    ok: true,
    ...ortak,
    konusmaId: hedef.konusmaId,
    mesajlar: g.mesajlar,
    sayfa: pageInfo(page, g.total),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const k = await kapi(req, id);
  if ("hata" in k) return k.hata;
  const { actor, hedef, erisim } = k;

  // ── YAZMA KAPISI — TETİKLEYİCİYE DÜŞMEDEN temiz hata ──────────────────────
  // Şemada da kilit var (073, SQLSTATE HK001) ama ona düşmek 500 üretirdi.
  // Kapı burada, cevap 409.
  if (!erisim.yazabilir) {
    return mobileError(409, hedef.arsivlendiMi ? "conversation_archived" : "read_only");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }
  const inp = (body ?? {}) as Record<string, unknown>;
  const govde = govdeCoz(inp.govde ?? inp.body);
  if (!govde.ok) return mobileError(400, govde.code);

  // Grupta konuşma zaten var; birebirde ilk mesajda açılır.
  let konusmaId = hedef.konusmaId;
  if (konusmaId === null) {
    const c = await konusmaGetir(hedef.soforId as string, true);
    if (!c.ok || !c.id) return mobileError(503, "db_error");
    konusmaId = c.id;
  }

  const { data, error } = await supabaseAdmin
    .from("messages")
    .insert({
      conversation_id: konusmaId,
      sender_worker_id: actor.worker.id,
      // KAPIDAN türer, gövdeden DEĞİL: istemci kendini yönetici ilan edemez.
      sender_role: erisim.role,
      body: govde.body,
    })
    .select("id, created_at")
    .single();
  if (error) {
    // Tetikleyici arşiv kilidi. Kapı yukarıda tutuyor; buraya düşmek ancak
    // grup TAM BU ARADA arşivlenirse mümkün — sessiz başarı ASLA.
    if (error.code === "HK001") return mobileError(409, "conversation_archived");
    return mobileError(500, "write_failed", { detail: error.message });
  }

  await sonMesajiIsle(konusmaId, govde.body, erisim.role, data.created_at as string);

  return Response.json({
    ok: true,
    mesaj: {
      id: data.id,
      konusmaId,
      gonderenId: actor.worker.id,
      gonderenRol: erisim.role,
      govde: govde.body,
      an: data.created_at,
    },
  });
}
