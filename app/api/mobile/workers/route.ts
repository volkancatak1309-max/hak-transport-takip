import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { mobileError } from "@/lib/mobile-auth";
import { parsePage, pageInfo } from "@/lib/mobile-list";
import { WORKER_PUBLIC_COLUMNS } from "@/lib/types";
import { getOwnerScope, withoutOwner } from "@/lib/owner-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WorkerRow = {
  id: string;
  name: string;
  phone: string;
  plate: string | null;
  employee_number: string | null;
  is_admin: boolean;
  is_active: boolean;
  counts_as_driver: boolean | null;
  terminated_at: string | null;
  license_expiry: string | null;
  created_at: string;
};

/**
 * GET /api/mobile/workers — personel listesi.
 *
 * KAPI: requireMobileAdmin ↔ /admin/workers sayfasının requireAdmin()'i.
 *
 * TEST KAYITLARI: withoutTestRows ile eleniyor — app/admin/workers/page.tsx:35-40
 * ile BİREBİR aynı yöntem (kimlik kümesi, doğrudan `.eq("is_test", false)` değil;
 * gerekçesi lib/test-data.ts'te). Yani panelde görünmeyen test şoförü mobilde de
 * listeye girmez.
 *
 * Kolon kümesi WORKER_PUBLIC_COLUMNS — pin_hash gibi alanlar zaten dışarıda.
 * Yanıtta ayrıca PII daraltılıyor: adres, TC/SV numarası, acil durum kişisi ve
 * doğum tarihi liste ucundan HİÇ çıkmaz; liste ekranının onlara ihtiyacı yok.
 *
 * ── PLAKA: TÜRETİLİR, ham workers.plate DEĞİL ─────────────────────────────
 * Bu uç plakayı `workers.plate` serbest metninden döndürüyordu; panelin kendi
 * listesi (app/admin/workers/page.tsx:84-92) ve mobil DETAY ucu
 * (app/api/mobile/workers/[id]/route.ts:49-56) ise tek kaynak olan
 * `vehicles.assigned_worker_id` ilişkisinden türetiyordu. Aynı uygulamanın
 * listesi ile detayı aynı kişide farklı plaka gösteriyordu.
 *
 * ÖLÇÜLDÜ (canlı HAK61, 09.08.2026, 33 kişi): 17 kişide liste ≠ detay. Listede
 * plakası dolu 13 kişi, detayda 30 — yani liste gerçek atamaların %57'sini hiç
 * göstermiyordu. Düzeltme sonrası fark 0. (Sendigo'da hiçbir araca şoför
 * atanmamış: 0 → 0, davranış değişmiyor.)
 *
 * N+1 YOK: detay ucu kişi başına bir sorgu atar, liste bunu YAPAMAZ. Sayfadaki
 * kimlikler için TEK `vehicles` sorgusu atılır ve bellekte eşlenir — panelin
 * yaptığının aynısı. Bir şoförde birden çok araç varsa plakaca ilki alınır
 * (`.order("plate")`), yani üç yüzey de aynı aracı seçer.
 *
 * ── VARSAYILAN: YALNIZ AKTİF (panel görünümüyle aynı) ─────────────────────
 * Panelin veri katmanı tüm kadroyu çekip İSTEMCİDE süzüyor ve varsayılan
 * "active" (app/admin/workers/WorkersClient.tsx:77). Sunucu 33, ekran 31
 * gösteriyor. Mobilde süzme sunucuda olmak zorunda (sayfalama), bu yüzden
 * VARSAYILAN da panelin gördüğüyle hizalandı — aksi hâlde aynı kadro için
 * panel 31, uygulama 33 derdi.
 *   ?aktif yok / =1  → yalnız aktif   (panel varsayılanı)
 *   ?aktif=0         → yalnız pasif
 *   ?aktif=all       → tümü           (panelin "Tümü" seçeneği)
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const page = parsePage(url);
  const aktifParam = url.searchParams.get("aktif") ?? "1"; // varsayılan: panel gibi yalnız aktif

  const scope = await getTestScope();
  // Patron kademesi (045) — panelin Çalışanlar listesiyle AYNI gizleme.
  // Mobil ayrı bir kapı; burada unutulsaydı web'de gizlenen kayıt telefonda
  // görünürdü ve gizleme fiilen hiç olmamış olurdu.
  const ownerScope = await getOwnerScope(guard.actor.worker.id);
  // owner-filtered: withoutOwner — aşağıda, zincir kurulduktan sonra uygulanıyor.
  let q = supabaseAdmin
    .from("workers")
    .select(WORKER_PUBLIC_COLUMNS, { count: "exact" })
    .order("name");
  // test-filtered: withoutTestRows — panelin Çalışanlar listesiyle aynı eleme.
  q = withoutTestRows(q, "id", scope.workerIds);
  q = withoutOwner(q, "id", ownerScope);
  if (aktifParam === "1") q = q.eq("is_active", true);
  else if (aktifParam === "0") q = q.eq("is_active", false);

  const { data, count, error } = await q.range(
    page.offset,
    page.offset + page.limit - 1
  );
  if (error) return mobileError(503, "db_error");

  const rows = (data ?? []) as unknown as WorkerRow[];

  // ── Atanmış plaka: sayfadaki kimlikler için TEK sorgu ────────────────────
  // `.in("assigned_worker_id", ...)` sayfayla sınırlıdır: liste tavanı 200
  // (lib/mobile-list.ts MAX_LIMIT), yani sorgu kadro büyüdükçe büyümez ve
  // PostgREST'in 1000 satır tavanına dayanamaz. Filo geneli okunsaydı büyük bir
  // kurulumda plakalar SESSİZCE eksik dönerdi; burada eksiklik mümkün değil.
  const plateByWorker = new Map<string, string>();
  if (rows.length > 0) {
    // test-filtered: withoutTestRows — test aracının plakası gerçek bir şoförün
    // satırına düşmesin. Panelin Çalışanlar listesi de aynı elemeyi yapıyor
    // (app/admin/workers/page.tsx:66-75). Detay ucunda bu eleme YOKTUR ve
    // olmamalıdır: orası anahtarlı okuma, test şoförünün kendi dosyasında kendi
    // aracını görmesi gerekir. Canlıda ölçüldü (HAK61 + Sendigo): hiçbir test
    // aracı test olmayan bir şoföre atanmamış, yani iki uç bugün AYNI sonucu
    // veriyor — eleme ileriye dönük bir kapı.
    const { data: vehData, error: vehError } = await withoutTestRows(
      supabaseAdmin
        .from("vehicles")
        .select("plate, assigned_worker_id")
        .in(
          "assigned_worker_id",
          rows.map((w) => w.id)
        )
        .neq("status", "inactive")
        .order("plate"),
      "id",
      scope.vehicleIds
    );
    // Sessiz eksik YASAK: bu sorgu düşerse plakalar boş dönerdi ve ekran
    // "hiç kimseye araç atanmamış" derdi. Liste sorgusunun hatasıyla aynı yanıt.
    if (vehError) return mobileError(503, "db_error");
    for (const v of (vehData ?? []) as {
      plate: string;
      assigned_worker_id: string;
    }[]) {
      if (!plateByWorker.has(v.assigned_worker_id)) {
        plateByWorker.set(v.assigned_worker_id, v.plate);
      }
    }
  }

  return Response.json({
    ok: true,
    filtre: { aktif: aktifParam },
    page: pageInfo(page, count ?? rows.length),
    personel: rows.map((w) => ({
      id: w.id,
      adSoyad: w.name,
      telefon: w.phone,
      personelNo: w.employee_number,
      // Detay ucuyla BİREBİR aynı kural: atanmış araç, yoksa workers.plate.
      plaka: plateByWorker.get(w.id) ?? w.plate,
      aktif: w.is_active,
      yonetici: w.is_admin,
      soforSayilir: w.counts_as_driver === true,
      ayrilisTarihi: w.terminated_at,
      ehliyetSon: w.license_expiry,
      kayitAni: w.created_at,
    })),
  });
}
