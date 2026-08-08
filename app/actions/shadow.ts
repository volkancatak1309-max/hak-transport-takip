"use server";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession, requireOwner } from "@/lib/session";
import { audit } from "@/lib/security-log";
import { SECURITY_LAYER_ENABLED } from "@/lib/tenant";

/**
 * GÖLGE MODU (dalga 3) — patron, bir yöneticinin gördüğü paneli onun
 * gözünden görür.
 *
 * ── ÜÇ KURAL ───────────────────────────────────────────────────────────────
 * 1. SALT OKUMA, sunucuda zorlanır (lib/session.ts → enforceShadowReadOnly).
 *    İstemcide düğme gizlemek yetmez; action doğrudan çağrılabilir.
 * 2. İZ PATRON ADINA yazılır. `session.worker_id` patronun kalır, yalnız
 *    `shadow_of` eklenir — yani audit_log'daki her satır gerçekte kimin
 *    baktığını gösterir. Kimliği değiştirseydik log kirlenir, "Furkan bu
 *    sayfaya baktı" diyen sahte satırlar doğardı.
 * 3. PATRON PATRONU GÖLGELEYEMEZ. Amaç bir yöneticinin görüşünü denetlemek;
 *    iki patronun birbirini taklit edebilmesi, kademenin kendisini anlamsız
 *    kılardı (biri diğerinin adına iz bırakamaz ama görünürlüğünü ele geçirir).
 */

export type ShadowResult = { ok: boolean; error?: string };

export async function enterShadowAction(workerId: string): Promise<ShadowResult> {
  const session = await requireOwner();
  if (!SECURITY_LAYER_ENABLED) return { ok: false, error: "layer_disabled" };
  if (!workerId) return { ok: false, error: "missing_worker" };
  if (workerId === session.worker_id) return { ok: false, error: "self" };

  const { data, error } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_admin, is_owner, is_active")
    .eq("id", workerId)
    .maybeSingle();
  if (error || !data) return { ok: false, error: "not_found" };
  // Patron patronu gölgeleyemez.
  if (data.is_owner === true) return { ok: false, error: "owner_target" };
  // Gölgelenecek kişi YÖNETİCİ olmalı: şoför panelini patron zaten görebiliyor
  // ve oradaki "gördüğü ekran" sorusu yönetici yüzeyleri kadar ayrışmıyor.
  if (data.is_admin !== true) return { ok: false, error: "not_admin" };

  session.shadow_of = workerId;
  session.shadow_name = (data.name as string | null) ?? undefined;
  await session.save();

  await audit(session.worker_id ?? null, "shadow_enter", workerId, {
    hedef: data.name as string,
  });
  redirect("/admin");
}

/**
 * Gölgeden çıkış.
 *
 * ⚠️ requireOwner() ÇAĞIRMAZ ve bu bilinçli: kapılar gölge modunda istemciden
 * gelen action'ları reddediyor (salt okuma), yani çıkış da reddedilir ve
 * patron kendi kurduğu gölgenin içinde kalırdı. Oturumu doğrudan okuyup
 * yalnız `shadow_of` alanını temizliyor — yetki genişletmeyen tek işlem.
 */
export async function exitShadowAction(): Promise<void> {
  const session = await getSession();
  if (!session.worker_id || !session.shadow_of) redirect("/admin");

  const hedef = session.shadow_of;
  session.shadow_of = undefined;
  session.shadow_name = undefined;
  await session.save();

  await audit(session.worker_id ?? null, "shadow_exit", hedef ?? null);
  redirect("/admin/guvenlik");
}
