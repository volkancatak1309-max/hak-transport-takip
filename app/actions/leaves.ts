"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireFleetView, requireAdmin } from "@/lib/session";
import { getFleetScope } from "@/lib/fleet-scope";
import { LEAVES_ENABLED } from "@/lib/features";
import { getLeaveById } from "@/lib/leaves";
import { logLeaveEdit } from "@/lib/leave-edit-log";
import { decideLeave } from "@/lib/leave-decision-db";
import type { LeaveKarar } from "@/lib/leave-decision";
import {
  parseLeaveInput,
  submitLeave,
  type LeaveInput,
} from "@/lib/leave-submit-db";

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

export type { LeaveInput };

/**
 * PANEL YÜZEYİNİN İZİN YAZMA KAPISI — çerez oturumu + redirect'li
 * requireFleetView.
 *
 * Kuralların KENDİSİ burada DEĞİL: `lib/leave-submit-db.ts` `submitLeave`.
 * Aynı çekirdeği mobil uç (POST /api/mobile/leaves) de çağırıyor; rol→status
 * eşlemesi, hedef kapıları, örtüşme, vardiya teyidi, iz ve önbellek tazeleme
 * tek yerde yaşıyor ki iki yüzey ayrışmasın. Burada kalan tek şey PANELE ÖZGÜ
 * olan: hangi kapı ve hangi hata biçimi (`LeaveActionResult`).
 *
 * ⚠️ SIRA KORUNDU: doğrulama `requireFleetView()`ten ÖNCE koşar. Kapıyı öne
 * almak sessiz bir davranış değişikliği olurdu — geçersiz gövde gönderen
 * yetkisiz kullanıcı bugün `invalid` alıyor, /panel'e ATILMIYOR. Bu yüzden
 * çekirdek iki parça: `parseLeaveInput` (saf) + `submitLeave` (kapı sonrası).
 */
export async function submitLeaveAction(
  input: LeaveInput
): Promise<LeaveActionResult> {
  if (!LEAVES_ENABLED) return { ok: false, error: "disabled" };

  const parsed = parseLeaveInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.hata };

  // Rol: patron veya filo şefi (aksi requireFleetView /panel'e yönlendirir).
  const { session, fleet, isChief } = await requireFleetView();
  const scope = await getFleetScope(fleet);

  const sonuc = await submitLeave(parsed.data, {
    workerId: session.worker_id ?? null,
    isChief,
    scope,
  });
  if (!sonuc.ok) {
    if (sonuc.needConfirm) {
      return { ok: false, needConfirm: true, conflictShifts: sonuc.conflictShifts };
    }
    return { ok: false, error: sonuc.hata };
  }
  return { ok: true, id: sonuc.id };
}

/**
 * PANEL YÜZEYİNİN KARAR KAPISI — çerez oturumu + redirect'li requireAdmin.
 *
 * Kararın KENDİSİ burada DEĞİL: `lib/leave-decision-db.ts` `decideLeave`.
 * Aynı çekirdeği mobil uç (app/api/mobile/leaves/[id]/onay) da çağırıyor;
 * status eşlemesi, iz ve önbellek tazeleme tek yerde yaşıyor ki iki yüzey
 * ayrışmasın. Burada kalan tek şey PANELE ÖZGÜ olan: hangi kapı ve hangi
 * hata biçimi (`LeaveActionResult`).
 *
 * `LEAVES_ENABLED` denetimi requireAdmin'den ÖNCE — 11.08.2026 öncesi sırayla
 * birebir aynı: modül kapalıysa yetkisiz kullanıcı /panel'e atılmaz, sessizce
 * `disabled` alır.
 */
async function decideLeaveFromPanel(
  id: string,
  karar: LeaveKarar
): Promise<LeaveActionResult> {
  if (!LEAVES_ENABLED) return { ok: false, error: "disabled" };
  const session = await requireAdmin();
  const sonuc = await decideLeave(id, karar, session.worker_id ?? null);
  if (!sonuc.ok) {
    if (sonuc.sebep === "yok") return { ok: false, error: "not_found" };
    if (sonuc.sebep === "kapali") return { ok: false, error: "disabled" };
    return { ok: false, error: "db" };
  }
  return { ok: true, id };
}

/** Patron: bekleyen talebi ONAYLAR → status='approved'. */
export async function approveLeaveAction(id: string): Promise<LeaveActionResult> {
  return decideLeaveFromPanel(id, "onay");
}

/** Patron: talebi/iznii REDDEDER → status='rejected' (kayıt iz için DURUR). */
export async function rejectLeaveAction(id: string): Promise<LeaveActionResult> {
  return decideLeaveFromPanel(id, "ret");
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
