import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import {
  LEAVE_KARARLARI,
  KARAR_NOTU_MAX,
  leaveKararindanAyikla,
} from "@/lib/leave-decision";
import { decideLeave } from "@/lib/leave-decision-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/leaves/[id]/onay — izin talebini ONAYLA ya da REDDET.
 *
 * Gövde `{ karar: "onay"|"ret", not?: string }`.
 *
 * ── MOBİLİN AUTH DIŞI ÜÇÜNCÜ YAZMA UCU ────────────────────────────────────
 * (Birincisi şoför paket girişi, ikincisi elle arıza bildirimi.) 11.08.2026'ya
 * kadar mobilde izin YAZAN hiçbir uç yoktu: panelin `approveLeaveAction` /
 * `rejectLeaveAction`'ı server action ve `hak_session` ÇEREZİNE bağlı, mobil
 * Bearer jetonuyla çağrılamıyordu. Aksiyon Merkezi'ndeki Onayla/Reddet
 * düğmeleri bu yüzden ÇİZİLİYOR AMA PASİFTİ. Bu uç onları çalıştırır.
 *
 * ── KOPYALAMA YOK ─────────────────────────────────────────────────────────
 * Kararın mantığı `lib/leave-decision-db.ts` `decideLeave` içinde; panelin
 * server action'ı da AYNI fonksiyonu çağırıyor. Burada yalnız mobil kapı ve
 * mobil hata biçimi var. İki yüzeyde iki kopya mantık olsaydı biri iz bırakır
 * öteki bırakmaz hâle gelirdi — zamanla, sessizce.
 *
 * ── KAPI: requireMobileAdmin ──────────────────────────────────────────────
 * Panelin `requireAdmin()`inin JSON dönen ikizi: YALNIZ PATRON. Filo şefi 403
 * `admin_required` alır — kendi açtığı talebi onaylayamaz (Volkan kararı,
 * 10.08.2026; panoda `onayBekleyen.izin` şefte zaten 0 dönüyor).
 *
 * ── NEDEN POST, NEDEN /onay ───────────────────────────────────────────────
 * Karar bir OLAY: "şu talebe şu kararı verdim". Kaynağın alanını değiştiren
 * kısmi bir güncelleme (PATCH) gibi görünse de yan etkileri var (iz satırı,
 * panel önbelleği tazeleme) ve `not` gövdesi kaydın kendisine yazılmıyor.
 * Yol segmenti Türkçe — kardeş yazma ucu `…/vehicles/[id]/ariza-bildir` ile
 * aynı düzen.
 *
 * ⚠️ Hız sınırı (rate limit) YOK — kardeş uçlarla aynı durum.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }

  const ayikla = leaveKararindanAyikla(body);
  if (!ayikla.ok) {
    return mobileError(400, ayikla.kod, {
      alan: ayikla.alan,
      ...(ayikla.sebep ? { sebep: ayikla.sebep } : {}),
      ...(ayikla.alan === "karar" ? { gecerli: LEAVE_KARARLARI } : {}),
      ...(ayikla.kod === "too_long"
        ? { enFazla: KARAR_NOTU_MAX, uzunluk: ayikla.uzunluk }
        : {}),
    });
  }

  const sonuc = await decideLeave(
    id,
    ayikla.karar,
    guard.actor.worker.id,
    ayikla.not
  );
  if (!sonuc.ok) {
    // 404: kaydın varlığını doğrulamayan cevap (/shifts/[id] ile aynı gerekçe).
    if (sonuc.sebep === "yok") return mobileError(404, "not_found");
    // İzin modülü bu kurulumda KAPALI (lib/tenant.ts) — "yazma hatası" demek,
    // kapalı bir modülü geçici arıza gibi göstermek olurdu.
    if (sonuc.sebep === "kapali") return mobileError(503, "disabled");
    return mobileError(503, "db_error", { sebep: "yazma_hatasi" });
  }

  const l = sonuc.satir;
  return Response.json({
    ok: true,
    /** Karar gerçekten bir şeyi değiştirdi mi (aynı karar ikinci kez → false). */
    degisti: sonuc.degisti,
    izin: {
      id: l.id,
      personelId: l.worker_id,
      tur: l.leave_type,
      baslangic: l.start_date,
      bitis: l.end_date,
      durum: l.status,
      kararAni: l.decided_at,
      kararVerenId: l.approved_by,
      // Karar notu KAYDIN kendisine yazılmaz, ize yazılır (leave_edit_log,
      // field='karar_notu'). `not` alanı TALEBİ AÇANIN notudur ve dokunulmadı.
      not: l.note,
    },
  });
}
