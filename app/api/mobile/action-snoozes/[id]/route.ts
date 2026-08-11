import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { ertelemeyiGeriAl } from "@/lib/action-snoozes-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/mobile/action-snoozes/[id] — ertelemeyi ŞİMDİ GERİ AL (058).
 *
 * Gövde YOK. Kapı requireMobileAdmin — yazma ucuyla aynı katman.
 *
 * ── NEDEN PATCH, NEDEN DELETE DEĞİL ───────────────────────────────────────
 * Satır SİLİNMİYOR: `cancelled_at` işaretleniyor. DELETE fiili istemciye
 * "kayıt gitti" der, oysa kayıt duruyor ve "kim ertelemişti, kim geri aldı"
 * sorusunun cevabını taşıyor. Kısmi güncelleme = PATCH.
 *
 * İptal edilen satır kısmi benzersiz indeksin (`where cancelled_at is null`)
 * dışına düşer, yani aynı kalem hemen yeniden ertelenebilir.
 *
 * ── AYNI SATIRI İKİNCİ KEZ GERİ ALMAK HATA DEĞİL ──────────────────────────
 * İki telefonun aynı düğmeye basması olağandır. İstek 200 döner ve
 * `degisti:false` der — ekran "geri alındı" bildirimini boşuna göstermesin.
 * İLK iptal anı TAZELENMEZ (lib/action-snoozes-db.ts).
 *
 * ⚠️ Hız sınırı (rate limit) YOK — kardeş uçlarla aynı durum.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const sonuc = await ertelemeyiGeriAl(id);
  if (!sonuc.ok) {
    // 404: kaydın varlığını doğrulamayan cevap (/shifts/[id] ile aynı gerekçe).
    if (sonuc.sebep === "yok") return mobileError(404, "not_found");
    return mobileError(503, "db_error", { sebep: sonuc.sebep });
  }

  return Response.json({
    ok: true,
    degisti: sonuc.degisti,
    erteleme: sonuc.satir,
  });
}
