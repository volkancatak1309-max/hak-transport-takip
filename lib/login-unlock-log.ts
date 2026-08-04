import "server-only";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GİRİŞ KİLİDİ KALDIRMA İZİ (migration 042) — shift_edit_log / leave_edit_log
 * ailesinin üçüncü üyesi, aynı desen.
 *
 * Neden gerekli: düğme bir güvenlik önlemini elle geçersiz kılıyor. Sözleşmede
 * taahhüt edilmiş bir korumayı kimin, kim için, ne zaman kaldırdığı sorusunun
 * cevabı olmalı.
 *
 * Best-effort: tablo yoksa yazma sessizce düşer. Kilidi AÇMA işleminin kendisi
 * buna dayanmaz — iz tutulamadı diye yönetici kilitli bir şoförü açamaz duruma
 * düşmemeli. (Aynı gerekçe leave-edit-log.ts'te de yazılı.)
 */

export type LoginUnlockLogRow = {
  id: string;
  unlocked_at: string;
  unlocked_by: string | null;
  worker_id: string | null;
  cleared_rows: number;
};

export async function logLoginUnlock(
  workerId: string,
  unlockedBy: string | null,
  clearedRows: number
): Promise<void> {
  try {
    await supabaseAdmin.from("login_unlock_log").insert({
      worker_id: workerId,
      unlocked_by: unlockedBy,
      cleared_rows: clearedRows,
    });
  } catch {
    // Tablo yok / yazma hatası → sessiz geç.
  }
}

/** Bir çalışanın kilit-kaldırma geçmişi (yeni → eski). Tablo yoksa boş dizi. */
export async function listLoginUnlocks(
  workerId: string
): Promise<LoginUnlockLogRow[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("login_unlock_log")
      .select("id, unlocked_at, unlocked_by, worker_id, cleared_rows")
      .eq("worker_id", workerId)
      .order("unlocked_at", { ascending: false })
      .limit(20);
    if (error || !data) return [];
    return data as LoginUnlockLogRow[];
  } catch {
    return [];
  }
}
