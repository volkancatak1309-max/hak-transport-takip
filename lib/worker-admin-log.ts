import "server-only";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * YÖNETİCİ YETKİSİ DEĞİŞİKLİK İZİ (migration 043) — shift_edit_log /
 * leave_edit_log / login_unlock_log ailesinin dördüncü üyesi, aynı desen.
 *
 * Neden gerekli: yetki vermek/almak sistemin en ağır kararı. "Bu kişi ne zaman
 * yönetici oldu / kim aldı" sorusunun cevabı bir yerde durmalı.
 *
 * Best-effort: tablo yoksa yazma sessizce düşer. Yetki değişikliğinin KENDİSİ
 * buna dayanmaz — iz tutulamadı diye yanlışlıkla yönetici yapılmış biri
 * düzeltilemez duruma düşmemeli. (Aynı gerekçe leave-edit-log.ts'te de yazılı.)
 */

export type WorkerAdminLogRow = {
  id: string;
  changed_at: string;
  changed_by: string | null;
  worker_id: string | null;
  /** true = yetki VERİLDİ, false = yetki ALINDI. */
  granted: boolean;
};

export async function logWorkerAdminChange(
  workerId: string,
  changedBy: string | null,
  granted: boolean
): Promise<void> {
  try {
    await supabaseAdmin.from("worker_admin_log").insert({
      worker_id: workerId,
      changed_by: changedBy,
      granted,
    });
  } catch {
    // Tablo yok / yazma hatası → sessiz geç.
  }
}

/** Bir çalışanın yetki geçmişi (yeni → eski). Tablo yoksa boş dizi. */
export async function listWorkerAdminChanges(
  workerId: string
): Promise<WorkerAdminLogRow[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("worker_admin_log")
      .select("id, changed_at, changed_by, worker_id, granted")
      .eq("worker_id", workerId)
      .order("changed_at", { ascending: false })
      .limit(20);
    if (error || !data) return [];
    return data as WorkerAdminLogRow[];
  } catch {
    return [];
  }
}
