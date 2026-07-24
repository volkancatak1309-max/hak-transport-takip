"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/session";
import { todayYmdVienna } from "@/lib/leaves";

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
  revalidatePath("/admin");
  revalidatePath("/panel");
  return { ok: true };
}

export async function clearDepotExemptionAction(
  workerId: string
): Promise<DepotExemptResult> {
  await requireAdmin();
  const { error } = await supabaseAdmin
    .from("depot_exemptions")
    .delete()
    .eq("worker_id", workerId)
    .eq("exempt_date", todayYmdVienna());
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  revalidatePath("/panel");
  return { ok: true };
}
