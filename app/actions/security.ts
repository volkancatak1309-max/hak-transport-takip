"use server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireOwner } from "@/lib/session";
import { audit, revokeAllSessions } from "@/lib/security-log";
import { bumpTokenVersion } from "@/lib/mobile-auth";
import { SECURITY_LAYER_ENABLED } from "@/lib/tenant";

/**
 * PATRON EYLEMLERİ (045) — /admin/guvenlik ekranının yazma yolu.
 *
 * Her action `requireOwner()` ile başlar. UI'da düğmeyi gizlemek kozmetiktir;
 * son sözü bu kapı söyler (action doğrudan çağrılabilir).
 */

export type SecurityActionResult = { ok: boolean; error?: string };

/**
 * OTURUMLARI SONLANDIR (+ isteğe bağlı HESABI DONDUR).
 *
 * Üç şeyi birden yapar, çünkü ikisi ayrı kalırsa yarım bir güvenlik önlemi olur:
 *   1. workers.session_version++ → o kişinin TÜM web çerezleri anında ölür
 *   2. açık login_sessions satırları 'revoked' ile kapatılır
 *   3. workers.token_version++  → MOBİL token'ları da ölür (migration 044)
 *
 * `freeze` verilirse ayrıca `is_active=false`: hesap donar ve yeniden
 * giremez. `is_active` YENİ bir kolon değil — 001'den beri var ve tüm kapılar
 * (verifyMobileRequest, getManagedFleet, verifyCredentials) zaten okuyor.
 */
export async function revokeSessionsAction(
  workerId: string,
  freeze: boolean
): Promise<SecurityActionResult> {
  const session = await requireOwner();
  if (!SECURITY_LAYER_ENABLED) return { ok: false, error: "layer_disabled" };
  if (!workerId) return { ok: false, error: "missing_worker" };

  // Patronun kendi oturumunu düşürmesi anlamsız ve kilitlenmeye açık.
  if (workerId === session.worker_id) return { ok: false, error: "self" };

  try {
    await revokeAllSessions(workerId);
    // Mobil taraf ayrı sayaç: web'i kesip mobili canlı bırakmak yarım önlem.
    // 044 çalıştırılmamışsa false döner — sessizce yutulur, web kesme geçerli.
    await bumpTokenVersion(workerId);

    if (freeze) {
      const { error } = await supabaseAdmin
        .from("workers")
        .update({ is_active: false })
        .eq("id", workerId);
      if (error) return { ok: false, error: error.message };
    }

    await audit(
      session.worker_id ?? null,
      freeze ? "account_freeze" : "session_revoke",
      workerId,
      { freeze }
    );
    revalidatePath("/admin/guvenlik");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "error" };
  }
}

/** Dondurulmuş hesabı geri açar (is_active=true). Oturumlar kapalı kalır. */
export async function unfreezeAccountAction(
  workerId: string
): Promise<SecurityActionResult> {
  const session = await requireOwner();
  if (!SECURITY_LAYER_ENABLED) return { ok: false, error: "layer_disabled" };
  try {
    const { error } = await supabaseAdmin
      .from("workers")
      .update({ is_active: true })
      .eq("id", workerId);
    if (error) return { ok: false, error: error.message };
    await audit(session.worker_id ?? null, "account_unfreeze", workerId);
    revalidatePath("/admin/guvenlik");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "error" };
  }
}
