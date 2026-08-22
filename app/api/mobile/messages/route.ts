import type { NextRequest } from "next/server";
import { requireMobileWorkerScoped } from "@/lib/mobile-scope";
import { konusmaListesi } from "@/lib/messaging";
import { READ_RECEIPTS_ENABLED } from "@/lib/tenant";
import { parsePage, pageInfo } from "@/lib/mobile-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/messages — KONUŞMA LİSTESİ.
 *
 *   patron    → tüm şoförler
 *   filo şefi → kapsamındaki şoförler (072'den sonra araçsızlar da dâhil)
 *   şoför     → YALNIZ kendi tek satırı
 *
 * Sorgunun KENDİSİ lib/messaging.ts konusmaListesi'nde — panel ekranı
 * (/admin/mesajlar) aynı fonksiyonu çağırıyor. İki kopya olsaydı ilk kural
 * değişikliğinde aynı filo iki yüzeyde farklı liste görürdü.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileWorkerScoped(req);
  if (!guard.ok) return guard.response;
  const { worker, isChief, fleetScope } = guard.actor;

  const page = parsePage(new URL(req.url));
  const rol: "admin" | "fleet_chief" | "driver" =
    worker.is_admin ? "admin" : isChief ? "fleet_chief" : "driver";
  const kapsam = isChief ? fleetScope.workerIds : null;

  const r = await konusmaListesi(guard.actor, rol, kapsam, page);
  if (!r.ok) return Response.json({ ok: false, error: r.code }, { status: 503 });

  return Response.json({
    ok: true,
    kapsam: { rol, filo: rol === "fleet_chief" ? kapsam?.length ?? 0 : null },
    okunduBilgisi: READ_RECEIPTS_ENABLED,
    // Uç sözleşmesi DEĞİŞMEDİ: alan adları ve sıralama aynı. `telefon` EKLENDİ
    // (arama yönlendirmesi için) — ek alan eski istemciyi bozmaz.
    konusmalar: r.satirlar,
    sayfa: pageInfo(page, r.total),
  });
}
