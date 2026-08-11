import "server-only";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * İZİN DEĞİŞİKLİK İZİ (Modül 1) — shift_edit_log ikizi + `action` alanı.
 *
 * Neden gerekli: izin kayıtları AZG/İK açısından anlamlı; kim hangi izni açtı,
 * onayladı, sildi görünür ve geri izlenebilir olmalı. shift_edit_log deseninin
 * gizli kusuru SİLMEYİ loglamamasıydı — burada `action='delete'` ile silme de,
 * `approve`/`reject` ile onay kararları da yazılır; leave_edit_log.leave_id
 * FK'siz olduğu için izin silinse bile iz DURUR (bkz. migration 031).
 *
 * Best-effort: tablo yoksa (migration çalıştırılmadıysa) yazma sessizce düşer,
 * okuma boş döner — modülün kendisi (worker_leaves) buna DAYANMAZ; yalnız bu iz
 * kaybolur. Kayıt düzeltmek izden önce gelir.
 */

const TRACKED = [
  "worker_id",
  "leave_type",
  "start_date",
  "end_date",
  "status",
  "note",
] as const;

export type LeaveEditAction =
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "reject";

export type LeaveEditLogRow = {
  id: string;
  leave_id: string;
  changed_at: string;
  changed_by: string | null;
  changed_by_name?: string | null;
  action: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
};

function norm(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function snapshot(row: Record<string, unknown> | null): string | null {
  if (!row) return null;
  const pick: Record<string, unknown> = {};
  for (const f of TRACKED) pick[f] = row[f] ?? null;
  return JSON.stringify(pick);
}

/**
 * Bir izin değişikliğini kaydeder.
 *  • create → tek satır (field '*', new = anlık görüntü)
 *  • delete → tek satır (field '*', old = anlık görüntü)
 *  • update/approve/reject → değişen HER izlenen alan için bir satır; hiçbir alan
 *    değişmediyse (ör. approve) yine de bir 'status' satırı yazılır.
 *
 * ── KARAR NOTU (11.08.2026, mobil onay/ret ucu) ────────────────────────────
 * `decisionNote` verilirse EK bir satır yazılır: `field='karar_notu'`,
 * `new_value=<not>`. `worker_leaves.note` kolonuna YAZILMAZ — orası TALEBİ
 * AÇANIN notudur ve kararın gerekçesiyle ezilirse talebin kendi metni sessizce
 * kaybolurdu. Karar notu bir İZ'dir, izin verisinin parçası değil; bu yüzden
 * izin tablosunda değil iz tablosunda yaşıyor ve migration gerektirmiyor
 * (`field` serbest metin, `action` CHECK'i zaten approve/reject kabul ediyor).
 */
export async function logLeaveEdit(
  leaveId: string,
  changedBy: string | null,
  action: LeaveEditAction,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  decisionNote?: string | null
): Promise<void> {
  const changedAt = new Date().toISOString();
  const rows: Omit<LeaveEditLogRow, "id" | "changed_by_name">[] = [];

  if (action === "create") {
    rows.push({
      leave_id: leaveId,
      changed_at: changedAt,
      changed_by: changedBy,
      action,
      field: "*",
      old_value: null,
      new_value: snapshot(after),
    });
  } else if (action === "delete") {
    rows.push({
      leave_id: leaveId,
      changed_at: changedAt,
      changed_by: changedBy,
      action,
      field: "*",
      old_value: snapshot(before),
      new_value: null,
    });
  } else {
    for (const field of TRACKED) {
      const oldV = norm(before?.[field]);
      const newV = norm(after?.[field]);
      if (oldV === newV) continue;
      rows.push({
        leave_id: leaveId,
        changed_at: changedAt,
        changed_by: changedBy,
        action,
        field,
        old_value: oldV,
        new_value: newV,
      });
    }
    // Onay/ret her zaman iz bırakmalı, alanlar aynı görünse bile.
    if (rows.length === 0 && (action === "approve" || action === "reject")) {
      rows.push({
        leave_id: leaveId,
        changed_at: changedAt,
        changed_by: changedBy,
        action,
        field: "status",
        old_value: norm(before?.status),
        new_value: norm(after?.status),
      });
    }
  }

  // Karar notu: alan değişikliklerinden AYRI bir satır. `create`/`delete`te
  // anlamı yok (karar verilmiyor), o yüzden yalnız karar eylemlerinde yazılır.
  if (decisionNote && (action === "approve" || action === "reject")) {
    rows.push({
      leave_id: leaveId,
      changed_at: changedAt,
      changed_by: changedBy,
      action,
      field: "karar_notu",
      old_value: null,
      new_value: decisionNote,
    });
  }

  if (rows.length === 0) return;
  try {
    await supabaseAdmin.from("leave_edit_log").insert(rows);
  } catch {
    // Tablo yok / yazma hatası → sessiz geç.
  }
}

/** Bir iznin değişiklik geçmişi (yeni → eski). Tablo yoksa boş dizi. */
export async function listLeaveEdits(leaveId: string): Promise<LeaveEditLogRow[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("leave_edit_log")
      .select("id, leave_id, changed_at, changed_by, action, field, old_value, new_value")
      .eq("leave_id", leaveId)
      .order("changed_at", { ascending: false })
      .limit(50);
    if (error || !data) return [];
    const rows = data as LeaveEditLogRow[];
    const ids = [...new Set(rows.map((r) => r.changed_by).filter(Boolean))] as string[];
    if (ids.length === 0) return rows;
    const { data: workers } = await supabaseAdmin
      .from("workers")
      .select("id, name")
      .in("id", ids);
    const names = new Map(
      ((workers ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name])
    );
    return rows.map((r) => ({
      ...r,
      changed_by_name: r.changed_by ? names.get(r.changed_by) ?? null : null,
    }));
  } catch {
    return [];
  }
}
