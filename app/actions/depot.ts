"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin, getSession } from "@/lib/session";
import { todayYmdVienna } from "@/lib/leaves";
import { auditChange } from "@/lib/audit-change";

/**
 * PANEL YOKLAMASI (Modül 7). Şoför paneli açıkken workers.panel_seen_at'i günceller.
 * "Auto vardiya açıldı ama şoför 2 saattir panele girmemiş → belki o araçta değil"
 * Dikkat kalemi bunu kullanır (G-riski post-hoc yakalama). Best-effort: kolon yoksa
 * / oturum yoksa sessiz geç. Yönlendirme YOK (getSession), yalnız günceller.
 */
export async function pingPanelAction(): Promise<void> {
  try {
    const session = await getSession();
    if (!session.worker_id) return;
    await supabaseAdmin
      .from("workers")
      .update({ panel_seen_at: new Date().toISOString() })
      .eq("id", session.worker_id);
  } catch {
    // kolon yok / oturum yok / hata → sessiz
  }
}

/**
 * DEPO MUAFİYETİ (Modül 6) — yönetici bir şoför için BUGÜNLÜK depo şartını
 * kaldırır (araç serviste, şoför başka yerden başlıyor vb.). O gün o şoförde
 * kilit uygulanmaz; vardiya yine de "konum doğrulanamadı" işaretlenir.
 *
 * YALNIZ PATRON (requireAdmin) — fail-closed. Best-effort değil: hata görünür.
 */
export type DepotExemptResult = { ok: boolean; error?: string };

export async function setDepotExemptionAction(
  workerId: string
): Promise<DepotExemptResult> {
  const session = await requireAdmin();
  const { error } = await supabaseAdmin.from("depot_exemptions").upsert(
    {
      worker_id: workerId,
      exempt_date: todayYmdVienna(),
      created_by: session.worker_id ?? null,
    },
    { onConflict: "worker_id,exempt_date" }
  );
  if (error) return { ok: false, error: error.message };
  await auditChange(session.worker_id ?? null, "create", "depot_exemptions",
    workerId, null, { worker_id: workerId, exempt_date: todayYmdVienna() });
  revalidatePath("/admin");
  revalidatePath("/panel");
  return { ok: true };
}

export async function clearDepotExemptionAction(
  workerId: string
): Promise<DepotExemptResult> {
  const session = await requireAdmin();
  const { error } = await supabaseAdmin
    .from("depot_exemptions")
    .delete()
    .eq("worker_id", workerId)
    .eq("exempt_date", todayYmdVienna());
  if (error) return { ok: false, error: error.message };
  await auditChange(session.worker_id ?? null, "delete", "depot_exemptions",
    workerId, { worker_id: workerId, exempt_date: todayYmdVienna() }, null);
  revalidatePath("/admin");
  revalidatePath("/panel");
  return { ok: true };
}
