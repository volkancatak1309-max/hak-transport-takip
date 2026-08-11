import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { aracOzeti } from "@/lib/vehicle-day-db";
import {
  ARIZA_ACIKLAMA_MAX,
  arizaAciklamasiniAyikla,
  tabloYokMu,
} from "@/lib/fault-reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/vehicles/[id]/ariza-bildir — ELLE arıza bildirimi (U7).
 *
 * Mobilin auth dışı İKİNCİ yazma ucu (birincisi şoför paket girişi). Cihazdan
 * gelen arıza kodlarının yanına İNSANIN beyanını koyar.
 *
 * ── NEDEN vehicle_dtc'YE YAZMIYOR ─────────────────────────────────────────
 * `vehicle_dtc` cihazın gerçeğidir ve flespi akışı her anlık görüntüde onu
 * uzlaştırır (`saveDtc` + `reconcileDtc`). Oraya elle girilen satır bir sonraki
 * senkron turunda `cleared_at` ile kapanır ya da kaybolur — yani bildirim
 * SESSİZCE yok olurdu. Ayrı tablo (`vehicle_fault_reports`, migration 056) bu
 * yüzden var; iki kaynak aynı ekranda yan yana gösterilebilir, aynı satırda değil.
 *
 * ── KAPI: requireMobileAdmin ──────────────────────────────────────────────
 * Kardeş araç uçlarıyla (`/vehicles/[id]`, `…/rota`, `…/olaylar` …) AYNI katman.
 * Panelde `/admin/araclar` requireAdmin ile korunuyor; filo şefi ve şoför oraya
 * giremiyor, burada da 403 `admin_required` alırlar. Şoförün de bildirebilmesi
 * ayrı bir karardır (farklı kapı, farklı kapsam) ve bu turun kapsamında değil.
 *
 * ── YAZMA ANAHTARLI ───────────────────────────────────────────────────────
 * `vehicle_id` YOLDAN gelir, gövdeden değil; `reported_by` OTURUMDAN gelir,
 * gövdeden değil. Gövdenin tek alanı `aciklama`. Yani "başkası adına, başka
 * araca bildirim" diye bir istek KURULAMAZ — alanları yok.
 *
 * `durum` gövdeden alınmaz: yeni bildirim tanım gereği `acik`tır (şema
 * varsayılanı). Kapatma ayrı bir yüzeydir ve bugün YOK.
 *
 * ── SINIRLAR ──────────────────────────────────────────────────────────────
 * Ayıklama `lib/fault-reports.ts`te (saf, muhafız orayı çalıştırıyor):
 * alan yoksa `missing_fields`; string değilse ya da trim sonrası boşsa
 * `invalid` + `sebep`; 2000 karakteri aşarsa `too_long` + `uzunluk`.
 *
 * ⚠️ HIZ SINIRI (rate limit) YOK — paket ucuyla aynı durum. Kapı yönetici
 * kimliği olduğu için yüzey dar, ama bu bir sınır değil bir eksiktir.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  // Araç GERÇEKTEN var mı — yoksa yabancı anahtar hatası 503'e düşer ve
  // "sunucu arızası" gibi okunurdu. 404 doğru cümle.
  const arac = await aracOzeti(id);
  if (!arac) return mobileError(404, "not_found");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }

  const ayikla = arizaAciklamasiniAyikla(body);
  if (!ayikla.ok) {
    return mobileError(400, ayikla.kod, {
      alan: "aciklama",
      ...(ayikla.sebep ? { sebep: ayikla.sebep } : {}),
      ...(ayikla.kod === "too_long"
        ? { enFazla: ARIZA_ACIKLAMA_MAX, uzunluk: ayikla.uzunluk }
        : {}),
    });
  }

  const { data, error } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .insert({
      vehicle_id: id,
      reported_by: guard.actor.worker.id,
      aciklama: ayikla.aciklama,
    })
    .select("id, vehicle_id, reported_by, aciklama, durum, created_at")
    .maybeSingle();

  if (error) {
    // "Tablo yok" ≠ "yazma başarısız": ilki migration 056'nın çalıştırılmadığı
    // kurulumdur ve yöneticiye BAŞKA iş yaptırır. Sessizce db_error demek,
    // eksik kurulumu geçici arıza gibi göstermek olurdu.
    return mobileError(503, "db_error", {
      sebep: tabloYokMu(error) ? "tablo_yok" : "yazma_hatasi",
    });
  }
  if (!data) return mobileError(503, "db_error", { sebep: "yazma_hatasi" });

  const row = data as {
    id: string;
    vehicle_id: string;
    reported_by: string;
    aciklama: string;
    durum: string;
    created_at: string;
  };
  return Response.json(
    {
      ok: true,
      bildirim: {
        id: row.id,
        aracId: row.vehicle_id,
        plaka: arac.plaka,
        bildirenId: row.reported_by,
        aciklama: row.aciklama,
        durum: row.durum,
        olusturma: row.created_at,
      },
    },
    { status: 201 }
  );
}
