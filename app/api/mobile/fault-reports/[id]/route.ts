import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { ARIZA_DURUMLARI, arizaDurumunuAyikla } from "@/lib/fault-reports";
import { setFaultReportStatus } from "@/lib/fault-reports-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/mobile/fault-reports/[id] — bildirimi KAPAT ya da YENİDEN AÇ.
 *
 * Gövde `{ durum: "kapali" }` ya da `{ durum: "acik" }`. Kapı requireMobileAdmin —
 * yazma ucuyla (`…/vehicles/[id]/ariza-bildir`) ve okuma yüzeyiyle aynı katman.
 *
 * ── NEDEN ARAÇ ALTINDA DEĞİL ──────────────────────────────────────────────
 * Kaynak bildirimin KENDİSİ; kimliği tek başına yeterli ve araç kimliği
 * satırda zaten yazılı. Yolu `/vehicles/[aracId]/ariza/[id]` yapmak, istemciye
 * ikinci bir kimliği taşıtır ve ikisi uyuşmazsa hangisinin doğru olduğu sorusu
 * doğardı — olmayan bir soru.
 *
 * ── NEDEN PATCH, NEDEN TEK YÖNLÜ DEĞİL ────────────────────────────────────
 * Kısmi güncelleme: satırın yalnız `durum` alanı değişir, `aciklama` ve
 * `reported_by` dokunulmaz (gövdede o alanlar YOK, gönderilse de okunmaz).
 * `acik` da geçerli bir hedeftir: yanlışlıkla kapatılan bildirimi geri açmanın
 * yolu olmasaydı tek çare kaydı silmek, yani geçmişi yok etmek olurdu.
 *
 * ── AYNI DURUMU İKİNCİ KEZ GÖNDERMEK HATA DEĞİL ───────────────────────────
 * İki telefonun aynı düğmeye basması olağandır. İstek 200 döner ve
 * `degisti:false` der — ekran "kapatıldı" bildirimini boşuna göstermesin.
 *
 * ⚠️ KAPATMA ANI KAYDEDİLMİYOR: migration 056'da `updated_at` / `kapatan`
 * kolonu YOK (şema Volkan'ın verdiği alan listesiydi). Yani "kim, ne zaman
 * kapattı" sorusunun cevabı bugün YOK. Gerekirse additive bir migration ister.
 *
 * ⚠️ Hız sınırı (rate limit) YOK — ayrı karar (Volkan, 11.08.2026).
 */
export async function PATCH(
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

  const ayikla = arizaDurumunuAyikla(body);
  if (!ayikla.ok) {
    return mobileError(400, ayikla.kod, {
      alan: "durum",
      ...(ayikla.sebep ? { sebep: ayikla.sebep } : {}),
      // Geçerli küme yanıtta: istemci hangi değerin kabul edildiğini
      // dokümana bakmadan görebilsin.
      gecerli: ARIZA_DURUMLARI,
    });
  }

  const sonuc = await setFaultReportStatus(id, ayikla.durum);
  if (!sonuc.ok) {
    // 404: kaydın varlığını doğrulamayan cevap (/shifts/[id] ile aynı gerekçe).
    if (sonuc.sebep === "yok") return mobileError(404, "not_found");
    return mobileError(503, "db_error", {
      sebep: sonuc.sebep === "tablo_yok" ? "tablo_yok" : "yazma_hatasi",
    });
  }

  return Response.json({
    ok: true,
    degisti: sonuc.degisti,
    bildirim: {
      id: sonuc.satir.id,
      aracId: sonuc.satir.vehicle_id,
      aciklama: sonuc.satir.aciklama,
      durum: sonuc.satir.durum,
      olusturma: sonuc.satir.created_at,
    },
  });
}
