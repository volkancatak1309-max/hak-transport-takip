import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { mobileError } from "@/lib/mobile-auth";
import { parsePage, pageInfo } from "@/lib/mobile-list";
import { WORKER_PUBLIC_COLUMNS } from "@/lib/types";

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
  telegram_chat_id: string | null;
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
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const page = parsePage(url);
  const aktifParam = url.searchParams.get("aktif"); // "1" | "0" | yok

  const scope = await getTestScope();
  let q = supabaseAdmin
    .from("workers")
    .select(WORKER_PUBLIC_COLUMNS, { count: "exact" })
    .order("name");
  // test-filtered: withoutTestRows — panelin Çalışanlar listesiyle aynı eleme.
  q = withoutTestRows(q, "id", scope.workerIds);
  if (aktifParam === "1") q = q.eq("is_active", true);
  else if (aktifParam === "0") q = q.eq("is_active", false);

  const { data, count, error } = await q.range(
    page.offset,
    page.offset + page.limit - 1
  );
  if (error) return mobileError(503, "db_error");

  const rows = (data ?? []) as unknown as WorkerRow[];

  return Response.json({
    ok: true,
    page: pageInfo(page, count ?? rows.length),
    personel: rows.map((w) => ({
      id: w.id,
      adSoyad: w.name,
      telefon: w.phone,
      personelNo: w.employee_number,
      plaka: w.plate,
      aktif: w.is_active,
      yonetici: w.is_admin,
      soforSayilir: w.counts_as_driver === true,
      ayrilisTarihi: w.terminated_at,
      ehliyetSon: w.license_expiry,
      telegramBagli: !!w.telegram_chat_id,
      kayitAni: w.created_at,
    })),
  });
}
