import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { mobileError } from "@/lib/mobile-auth";
import { getLoginLockState } from "@/lib/login-lock";
import { workedMs, kmDiff, startOfMonthVienna } from "@/lib/format";
import { WORKER_PUBLIC_COLUMNS } from "@/lib/types";
import type { TimeEntry } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/workers/[id] — personel detayı.
 *
 * KAPI: requireMobileAdmin ↔ /admin/workers/[id] sayfasının requireAdmin()'i.
 *
 * TEST FİLTRESİ YOK — bilerek, PANEL PARİTESİ. Detay sayfası da filtre
 * uygulamıyor (app/admin/workers/[id]/page.tsx:44-48 anahtarlı okuma); test
 * hesabı listede görünmez ama id'si bilinen detay sayfası açılır. Aynı davranış.
 *
 * Aylık özet ve son vardiyalar detay sayfasının okuduğu alanlardan türer;
 * süre/km yine tek kaynak fonksiyonlarla (workedMs / kmDiff).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { data: w } = await supabaseAdmin
    .from("workers")
    .select(WORKER_PUBLIC_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (!w) return mobileError(404, "not_found");
  const worker = w as unknown as Record<string, unknown>;

  const monthStart = startOfMonthVienna();
  const [{ data: veh }, { data: monthRows }, { data: recentRows }, lock] =
    await Promise.all([
      supabaseAdmin
        .from("vehicles")
        .select("plate")
        .eq("assigned_worker_id", id)
        .neq("status", "inactive")
        .order("plate")
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("time_entries")
        .select("*")
        .eq("worker_id", id)
        .gte("started_at", monthStart.toISOString()),
      supabaseAdmin
        .from("time_entries")
        .select("*")
        .eq("worker_id", id)
        .order("started_at", { ascending: false })
        .limit(20),
      getLoginLockState(worker.phone as string | null),
    ]);

  const month = (monthRows ?? []) as TimeEntry[];
  const recent = (recentRows ?? []) as TimeEntry[];
  const sum = (xs: (number | null)[]) =>
    xs.reduce<number>((a, b) => a + (b ?? 0), 0);

  return Response.json({
    ok: true,
    personel: {
      id: worker.id,
      adSoyad: worker.name,
      telefon: worker.phone,
      personelNo: worker.employee_number,
      plaka: (veh?.plate as string | null) ?? (worker.plate as string | null),
      aktif: worker.is_active,
      yonetici: worker.is_admin,
      soforSayilir: worker.counts_as_driver === true,
      ayrilisTarihi: worker.terminated_at,
      kayitAni: worker.created_at,
      istihdam: {
        baslangic: worker.employment_start,
        tur: worker.employment_type,
      },
      ehliyet: { no: worker.license_no, sonTarih: worker.license_expiry },
      iletisim: { email: worker.email },
      telegram: {
        bagli: !!worker.telegram_chat_id,
        kullaniciAdi: worker.telegram_username,
        bagliAni: worker.telegram_linked_at,
      },
    },
    girisKilidi: {
      kilitli: lock.locked,
      bitis: lock.lockedUntil,
      kalanSn: lock.retryAfter,
      denemeler: lock.attempts,
    },
    buAy: {
      vardiya: month.length,
      calismaMs: month.reduce((a, e) => a + workedMs(e), 0),
      km: sum(month.map((e) => kmDiff(e))),
      paketTeslim: sum(month.map((e) => e.cargo_count)),
    },
    sonVardiyalar: recent.map((e) => ({
      id: e.id,
      baslangic: e.started_at,
      bitis: e.ended_at,
      acik: e.ended_at === null,
      plaka: e.plate,
      sureMs: workedMs(e),
      km: kmDiff(e),
      molaDk: e.break_minutes ?? 0,
    })),
  });
}
