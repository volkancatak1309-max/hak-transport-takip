import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import type { LeaveTypeKey, LeaveStatus } from "@/lib/leave-types";

/**
 * İZİN VERİ ERİŞİMİ (Modül 1).
 *
 * Bu modüldeki OKUMALAR best-effort: worker_leaves tablosu yoksa (migration 031
 * henüz çalıştırılmadıysa) boş küme döner, çağıran akış eskisi gibi çalışır.
 * YAZMA, app/actions/leaves.ts'te yapılır ve hataları GÖRÜNÜR olur (asıl veri
 * tablosu; sessiz düşerse yönetici "oldu" sanır — kritik).
 *
 * Fleet-scope + test filtresi çağıranda uygulanır (admin sayfası onlyFleet ile);
 * buradaki `approvedLeaveWorkerIdsForDay` KASITLI kapsamsızdır: auto-shift motoru
 * tüm filoları tarar ve izinli assigned_worker'ı ele almalıdır (bkz. auto-shift).
 */

export type LeaveRow = {
  id: string;
  worker_id: string;
  leave_type: LeaveTypeKey;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  status: LeaveStatus;
  note: string | null;
  created_by: string | null;
  approved_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export const LEAVE_COLS =
  "id, worker_id, leave_type, start_date, end_date, status, note, created_by, approved_by, decided_at, created_at, updated_at";

/**
 * Bugünün VİYANA takvim tarihi (YYYY-MM-DD) — `date` kolonlarıyla karşılaştırma
 * için. `en-CA` locale'i YYYY-MM-DD üretir; Intl TZ'yi DST-güvenli çözer, ham
 * `new Date().getDate()` sunucu UTC'de olduğu için yazın bir gün kayardı.
 */
export function todayYmdVienna(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Vienna" });
}

/**
 * Belirtilen Viyana gününde ONAYLI (status='approved') izni olan şoförlerin id
 * kümesi. PENDING talepler DAHİL DEĞİL — talep onaylanana kadar "gerçek" değildir
 * (Günün Panosu'na ve auto-shift baskılamasına yalnız onaylı izin etki eder).
 *
 * Kapsamsız + best-effort: tablo yoksa boş küme.
 */
export async function approvedLeaveWorkerIdsForDay(
  dayYmd: string = todayYmdVienna()
): Promise<Set<string>> {
  try {
    // test-visible: bu bir KİMLİK KÜMESİ, gösterilen bir liste değil. Çağıranlar
    // ("bu şoför bugün izinli mi") kendi satır kümelerini zaten eliyor; küme
    // yalnız eşleşme için okunuyor. Filtre konulsaydı test hesabının izni
    // görünmez olurdu — test hesabının amacı tam da akışı gerçek gibi denemek.
    const { data, error } = await supabaseAdmin
      .from("worker_leaves")
      .select("worker_id")
      .eq("status", "approved")
      .lte("start_date", dayYmd)
      .gte("end_date", dayYmd);
    if (error || !data) return new Set();
    return new Set((data as { worker_id: string }[]).map((r) => r.worker_id));
  } catch {
    return new Set();
  }
}

/**
 * Aynı şoför için [startYmd, endYmd] ile ÖRTÜŞEN, reddedilmemiş izinler.
 * İzin girişinde çakışma kontrolü için (app/actions/leaves.ts). `excludeId`
 * düzenlenen kaydın kendisini eler. Best-effort: hata → boş dizi.
 */
export async function findOverlappingLeaves(
  workerId: string,
  startYmd: string,
  endYmd: string,
  excludeId?: string
): Promise<LeaveRow[]> {
  try {
    let q = supabaseAdmin
      .from("worker_leaves")
      .select(LEAVE_COLS)
      .eq("worker_id", workerId)
      .neq("status", "rejected")
      .lte("start_date", endYmd)
      .gte("end_date", startYmd);
    if (excludeId) q = q.neq("id", excludeId);
    const { data, error } = await q;
    if (error || !data) return [];
    return data as LeaveRow[];
  } catch {
    return [];
  }
}

/** Tek izin kaydı. Yoksa/hatada null. */
export async function getLeaveById(id: string): Promise<LeaveRow | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("worker_leaves")
      .select(LEAVE_COLS)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return data as LeaveRow;
  } catch {
    return null;
  }
}
