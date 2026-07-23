"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireFleetView, requireAdmin } from "@/lib/session";
import { getFleetScope } from "@/lib/fleet-scope";
import { isLeaveTypeKey } from "@/lib/leave-types";
import { LEAVES_ENABLED } from "@/lib/features";
import {
  findOverlappingLeaves,
  getLeaveById,
  LEAVE_COLS,
  type LeaveRow,
} from "@/lib/leaves";
import { logLeaveEdit } from "@/lib/leave-edit-log";
import { startOfDayViennaFromYmd, endOfDayViennaFromYmd } from "@/lib/format";

/**
 * İZİN AKSİYONLARI (Modül 1) — ONAY AKIŞI.
 *
 *  • Patron (is_admin) izin GİRER → doğrudan status='approved' (tam renk).
 *  • Filo şefi izin TALEP EDER → status='pending' (silik); patron onaylayınca
 *    aktifleşir. Şefin yazması TEK yeni non-admin yazma yüzeyi olduğundan:
 *      - sunucuda `scope.isFleetWorker(worker_id)` ASSERT edilir (yük taşıyan
 *        güvenlik kapısı; başka filodan personele talep açılamaz),
 *      - status ve created_by SUNUCUDA zorlanır (istemci 'approved' yazamaz).
 *  • approve/reject → yalnız patron (requireAdmin).
 *  • Şef yalnız KENDİ pending talebini düzeltebilir/silebilir; onaylıya dokunamaz.
 *
 * worker_leaves YAZMA hataları GÖRÜNÜR döner (asıl veri tablosu; sessiz düşerse
 * yönetici "oldu" sanır). Yalnız leave_edit_log best-effort'tur.
 */

export type LeaveActionResult = {
  ok: boolean;
  error?: string;
  /** İzin aralığında o şoförün vardiyası var → engel değil, teyit iste. */
  needConfirm?: boolean;
  conflictShifts?: number;
  id?: string;
};

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date");

const leaveInput = z.object({
  worker_id: z.string().uuid(),
  leave_type: z.string().refine(isLeaveTypeKey, "leave_type"),
  start_date: YMD,
  end_date: YMD,
  note: z.string().trim().max(500).optional().nullable(),
  /** Vardiya çakışması teyidi geçildi → yine de kaydet. */
  force: z.boolean().optional(),
  /** Düzenleme ise mevcut kaydın id'si. */
  id: z.string().uuid().optional(),
});

export type LeaveInput = z.input<typeof leaveInput>;

/** İzin aralığında o şoförün kaç vardiyası var (Viyana günleri). */
async function countShiftsInRange(
  workerId: string,
  startYmd: string,
  endYmd: string
): Promise<number> {
  const start = startOfDayViennaFromYmd(startYmd);
  const end = endOfDayViennaFromYmd(endYmd);
  if (!start || !end) return 0;
  const { count } = await supabaseAdmin
    .from("time_entries")
    .select("id", { count: "exact", head: true })
    .eq("worker_id", workerId)
    .gte("started_at", start.toISOString())
    .lte("started_at", end.toISOString());
  return count ?? 0;
}

/**
 * İzin girişi/talebi (create) VE düzenleme (update) tek giriş noktası.
 * Rolü requireFleetView belirler: patron → approved, şef → pending (+ scope
 * assert). `input.id` doluysa düzenlemedir.
 */
export async function submitLeaveAction(
  input: LeaveInput
): Promise<LeaveActionResult> {
  if (!LEAVES_ENABLED) return { ok: false, error: "disabled" };

  const parsed = leaveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const data = parsed.data;
  if (data.end_date < data.start_date) return { ok: false, error: "range" };

  // Rol: patron veya filo şefi (aksi requireFleetView /panel'e yönlendirir).
  const { session, fleet, isChief } = await requireFleetView();
  const scope = await getFleetScope(fleet);

  const existing = data.id ? await getLeaveById(data.id) : null;
  if (data.id && !existing) return { ok: false, error: "not_found" };

  // Hedef personel geçerli mi (yönetici hesabına / var olmayan kişiye izin yok).
  const { data: target } = await supabaseAdmin
    .from("workers")
    .select("id, is_admin, is_active")
    .eq("id", data.worker_id)
    .maybeSingle();
  if (!target) return { ok: false, error: "no_worker" };
  if (target.is_admin === true) return { ok: false, error: "admin_target" };

  // Filo şefi: yalnız KENDİ filosunun personeline + düzenlemede yalnız kendi
  // PENDING talebine dokunabilir (fail-closed).
  if (isChief) {
    if (!scope.isFleetWorker(data.worker_id)) return { ok: false, error: "scope" };
    if (existing) {
      if (
        existing.created_by !== session.worker_id ||
        existing.status !== "pending" ||
        !scope.isFleetWorker(existing.worker_id)
      ) {
        return { ok: false, error: "forbidden" };
      }
    }
  }

  // Örtüşme: aynı şoför için aynı günlere düşen (reddedilmemiş) izin engellenir.
  const overlaps = await findOverlappingLeaves(
    data.worker_id,
    data.start_date,
    data.end_date,
    data.id
  );
  if (overlaps.length > 0) return { ok: false, error: "overlap" };

  // Vardiya çakışması: ENGEL DEĞİL, teyit. force gelmediyse teyit iste.
  if (!data.force) {
    const shifts = await countShiftsInRange(
      data.worker_id,
      data.start_date,
      data.end_date
    );
    if (shifts > 0) return { ok: false, needConfirm: true, conflictShifts: shifts };
  }

  const nowIso = new Date().toISOString();
  // Onay akışı: şef → pending; patron → approved (kendi onaylar).
  const approved = !isChief;

  if (existing) {
    // Düzenleme: patron her alanı, şef yalnız kendi pending'ini (worker_id sabit).
    const patch: Record<string, unknown> = {
      leave_type: data.leave_type,
      start_date: data.start_date,
      end_date: data.end_date,
      note: data.note ?? null,
      updated_at: nowIso,
    };
    if (!isChief) patch.worker_id = data.worker_id;
    const { data: upd, error } = await supabaseAdmin
      .from("worker_leaves")
      .update(patch)
      .eq("id", data.id!)
      .select(LEAVE_COLS)
      .maybeSingle();
    if (error || !upd) return { ok: false, error: "db" };
    await logLeaveEdit(
      data.id!,
      session.worker_id ?? null,
      "update",
      existing as unknown as Record<string, unknown>,
      upd as unknown as Record<string, unknown>
    );
    revalidatePath("/admin/izinler");
    revalidatePath("/admin");
    return { ok: true, id: data.id };
  }

  const row = {
    worker_id: data.worker_id,
    leave_type: data.leave_type,
    start_date: data.start_date,
    end_date: data.end_date,
    status: approved ? "approved" : "pending",
    note: data.note ?? null,
    created_by: session.worker_id ?? null,
    approved_by: approved ? session.worker_id ?? null : null,
    decided_at: approved ? nowIso : null,
  };
  const { data: ins, error } = await supabaseAdmin
    .from("worker_leaves")
    .insert(row)
    .select(LEAVE_COLS)
    .maybeSingle();
  if (error || !ins) return { ok: false, error: "db" };
  // Şef mi patron mu — status='pending'/'approved' zaten ayırt eder; action
  // her hâlde 'create' (DB CHECK ve LeaveEditAction ile tutarlı).
  await logLeaveEdit(
    (ins as LeaveRow).id,
    session.worker_id ?? null,
    "create",
    null,
    ins as unknown as Record<string, unknown>
  );
  revalidatePath("/admin/izinler");
  revalidatePath("/admin");
  return { ok: true, id: (ins as LeaveRow).id };
}

/** Patron: bekleyen talebi ONAYLAR → status='approved'. */
export async function approveLeaveAction(id: string): Promise<LeaveActionResult> {
  if (!LEAVES_ENABLED) return { ok: false, error: "disabled" };
  const session = await requireAdmin();
  const before = await getLeaveById(id);
  if (!before) return { ok: false, error: "not_found" };
  const nowIso = new Date().toISOString();
  const { data: upd, error } = await supabaseAdmin
    .from("worker_leaves")
    .update({
      status: "approved",
      approved_by: session.worker_id ?? null,
      decided_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", id)
    .select(LEAVE_COLS)
    .maybeSingle();
  if (error || !upd) return { ok: false, error: "db" };
  await logLeaveEdit(
    id,
    session.worker_id ?? null,
    "approve",
    before as unknown as Record<string, unknown>,
    upd as unknown as Record<string, unknown>
  );
  revalidatePath("/admin/izinler");
  revalidatePath("/admin");
  return { ok: true, id };
}

/** Patron: talebi/iznii REDDEDER → status='rejected' (kayıt iz için DURUR). */
export async function rejectLeaveAction(id: string): Promise<LeaveActionResult> {
  if (!LEAVES_ENABLED) return { ok: false, error: "disabled" };
  const session = await requireAdmin();
  const before = await getLeaveById(id);
  if (!before) return { ok: false, error: "not_found" };
  const nowIso = new Date().toISOString();
  const { data: upd, error } = await supabaseAdmin
    .from("worker_leaves")
    .update({
      status: "rejected",
      approved_by: session.worker_id ?? null,
      decided_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", id)
    .select(LEAVE_COLS)
    .maybeSingle();
  if (error || !upd) return { ok: false, error: "db" };
  await logLeaveEdit(
    id,
    session.worker_id ?? null,
    "reject",
    before as unknown as Record<string, unknown>,
    upd as unknown as Record<string, unknown>
  );
  revalidatePath("/admin/izinler");
  revalidatePath("/admin");
  return { ok: true, id };
}

/** Silme: patron her izni; şef yalnız KENDİ pending talebini. İz önce yazılır. */
export async function deleteLeaveAction(id: string): Promise<LeaveActionResult> {
  if (!LEAVES_ENABLED) return { ok: false, error: "disabled" };
  const { session, fleet, isChief } = await requireFleetView();
  const before = await getLeaveById(id);
  if (!before) return { ok: false, error: "not_found" };

  if (isChief) {
    const scope = await getFleetScope(fleet);
    if (
      before.created_by !== session.worker_id ||
      before.status !== "pending" ||
      !scope.isFleetWorker(before.worker_id)
    ) {
      return { ok: false, error: "forbidden" };
    }
  }

  // İz SİLMEDEN ÖNCE (E3 sırası): kayıt uçsa da "kim sildi" durur.
  await logLeaveEdit(
    id,
    session.worker_id ?? null,
    "delete",
    before as unknown as Record<string, unknown>,
    null
  );
  const { error } = await supabaseAdmin.from("worker_leaves").delete().eq("id", id);
  if (error) return { ok: false, error: "db" };
  revalidatePath("/admin/izinler");
  revalidatePath("/admin");
  return { ok: true, id };
}
