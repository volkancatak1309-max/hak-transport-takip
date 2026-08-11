import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { ATAMA_LISTE_TAVANI, atamaGirdisiniAyikla } from "@/lib/fleets";
import { moveToFleet } from "@/lib/fleets-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/fleets/[id]/atamalar — araç ve/veya personeli bu filoya taşı.
 *
 * Gövde `{ aracIdleri?: string[], personelIdleri?: string[] }`. Kapı
 * requireMobileAdmin — kardeş uçlarla aynı katman.
 *
 * ── NEDEN TEK UÇTA İKİSİ ──────────────────────────────────────────────────
 * Ekranda yapılan iş TEK bir karardır: "şunlar artık bu filoda". İki ayrı uca
 * bölmek, telefon bağlantısı ikisi arasında koptuğunda yarım uygulanmış bir
 * taşıma bırakırdı. Araç kümesi ve personelin araçları BİRLEŞTİRİLİP TEK
 * güncellemeyle yazılıyor — aynı araç iki yoldan gelse de bir kez taşınır.
 *
 * ── PERSONEL TAŞIMA = ARACINI TAŞIMA ──────────────────────────────────────
 * Personelin filosu ayrı bir kolonda TUTULMUYOR; aracından türetiliyor
 * (lib/fleet-scope.ts, 22.07.2026). Dolayısıyla bu uç kişinin ATANMIŞ aracını
 * taşır ve yanıtta HANGİ araç üzerinden taşındığını söyler. Aracı olmayan kişi
 * `tasindi:false, sebep:"arac_yok"` ile döner — sessizce başarılı sayılmaz.
 * Bugün HAK61'de 5 aktif kişi bu durumda (3'ü yönetici, ölçüldü 11.08.2026).
 *
 * ── NEDEN 059'SUZ DA ÇALIŞIR ──────────────────────────────────────────────
 * Bu uç `vehicles.fleet` yazıyor ve o kolon BUGÜN VAR. Migration yalnız yeni
 * filo KODLARINI mümkün kılar; var olan iki filo arasında taşıma migration
 * beklemez. Hedef filo tanınmıyorsa 404 `not_found`.
 *
 * ── DEĞİŞMEYEN ŞEY SÖYLENİR ───────────────────────────────────────────────
 * Zaten hedefte olan araç güncellemenin dışında bırakılır ve `zatenOrada`
 * listesinde döner; bulunamayan kimlik `bulunamadi`da. "Hepsi taşındı" deyip
 * sessizce iki aracı atlamak, sayının gerçekten değiştiğini ölçme kuralının
 * ihlali olurdu.
 *
 * ⚠️ ŞOFÖR ATAMASINA DOKUNULMAZ: `assigned_worker_id` yazılmaz. Filo değiştiren
 * araç aynı şoförde kalır — taşımanın şoför atamasını sıfırlaması, iki ayrı
 * kararı tek düğmeye bağlamak olurdu.
 *
 * ⚠️ HIZ SINIRI (rate limit) YOK — kardeş uçlarla aynı durum.
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

  const ayikla = atamaGirdisiniAyikla(body);
  if (!ayikla.ok) {
    return mobileError(400, ayikla.kod, {
      alan: ayikla.alan,
      ...(ayikla.sebep ? { sebep: ayikla.sebep } : {}),
      ...(ayikla.gecersiz ? { gecersiz: ayikla.gecersiz } : {}),
      ...(ayikla.kod === "too_long"
        ? { enFazla: ATAMA_LISTE_TAVANI, uzunluk: ayikla.uzunluk }
        : {}),
    });
  }

  const sonuc = await moveToFleet(id, ayikla.aracIdleri, ayikla.personelIdleri);
  if (!sonuc.ok) {
    if (sonuc.sebep === "filo_yok") return mobileError(404, "not_found");
    // Hedef filo çözüldükten SONRA veritabanı reddetti: araya giren bir
    // değişiklik filoyu ortadan kaldırmış. Tekrar denenebilir bir çakışma.
    if (sonuc.sebep === "gecersiz_filo") {
      return mobileError(409, "conflict", { sebep: "gecersiz_filo" });
    }
    return mobileError(503, "db_error", { sebep: sonuc.sebep });
  }

  return Response.json({
    ok: true,
    filo: sonuc.filo,
    arac: sonuc.arac,
    personel: sonuc.personel,
  });
}
