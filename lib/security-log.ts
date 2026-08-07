import "server-only";
import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase";
import { readRequestContext } from "@/lib/request-context";
import { SECURITY_LAYER_ENABLED, SINGLE_SESSION } from "@/lib/tenant";

/**
 * GÜVENLİK İZİ (migration 045) — giriş oturumları + eylem izi.
 *
 * ── İKİ KAT KORUMA ─────────────────────────────────────────────────────────
 * 1. Her fonksiyon `SECURITY_LAYER_ENABLED` kapalıyken İLK SATIRDA çıkar.
 *    HAK61 ve Sendigo'da bayrak tanımsız → hiçbir yeni sorgu atılmaz, tek bir
 *    başlık bile okunmaz. Ölçülebilir fark sıfırdır.
 * 2. Bayrak açık ama migration 045 çalıştırılmamışsa tablo yoktur; her yazma
 *    kendi try/catch'inde ve HİÇBİRİ çağıranı düşürmez. Giriş, güvenlik izi
 *    yazılamadı diye başarısız olamaz — bu, deponun yerleşik deseni
 *    (bkz. saveIdleEpisodes / saveVehicleEvents çağrıları).
 *
 * ── NE KAYDEDİLMEZ ─────────────────────────────────────────────────────────
 * PIN, PIN hash'i, oturum çerezi ya da tam istek gövdesi ASLA yazılmaz.
 * `meta` alanına yalnız çağıranın açıkça verdiği küçük anahtarlar girer.
 */

/** PostgreSQL undefined_table / undefined_column — migration 045 yok demek. */
function isMissingRelation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "42703") return true;
  return /login_sessions|audit_log|session_version|is_owner/.test(err.message ?? "");
}

// ─────────────────────────────────────────────────────────────────────────────
// GİRİŞ OTURUMU
// ─────────────────────────────────────────────────────────────────────────────

export type OpenedSession = {
  /** login_sessions.id — çerezde taşınır, çıkışta kapatmak için. */
  id: string | null;
  /** Bu girişten sonra geçerli olan workers.session_version. */
  sessionVersion: number;
  newDevice: boolean;
  concurrent: boolean;
};

const KAPALI: OpenedSession = {
  id: null,
  sessionVersion: 0,
  newDevice: false,
  concurrent: false,
};

/**
 * Başarılı girişte çağrılır. Oturum satırını açar, "yeni cihaz" ve "çoklu
 * oturum" işaretlerini hesaplar ve SINGLE_SESSION açıksa önceki oturumları
 * düşürür.
 *
 * ASLA throw etmez — güvenlik izi yazılamadığı için giriş engellenemez.
 */
export async function openLoginSession(workerId: string): Promise<OpenedSession> {
  if (!SECURITY_LAYER_ENABLED) return KAPALI;
  try {
    const ctx = readRequestContext(await headers());

    // Bu cihaz izi bu kişide daha önce görüldü mü?
    const { data: gecmis, error: gecmisErr } = await supabaseAdmin
      .from("login_sessions")
      .select("id")
      .eq("worker_id", workerId)
      .eq("device_hash", ctx.deviceHash)
      .limit(1);
    if (gecmisErr && isMissingRelation(gecmisErr)) return KAPALI;
    const newDevice = (gecmis?.length ?? 0) === 0;

    // Şu an açık başka oturumu var mı?
    const { data: acik } = await supabaseAdmin
      .from("login_sessions")
      .select("id")
      .eq("worker_id", workerId)
      .is("ended_at", null);
    const acikIds = (acik ?? []).map((r) => r.id as string);
    const concurrent = acikIds.length > 0;

    // ── TEK OTURUM KİLİDİ ───────────────────────────────────────────────
    // Önce eski oturumları KAPAT, sonra sayacı artır. Sıra önemli: sayaç
    // artınca eski çerez zaten ölür, ama kaydı da doğru sebeple kapatmalıyız.
    let sessionVersion = 0;
    if (SINGLE_SESSION && concurrent) {
      await supabaseAdmin
        .from("login_sessions")
        .update({ ended_at: new Date().toISOString(), ended_reason: "single_session" })
        .in("id", acikIds);
    }
    // Sayaç: SINGLE_SESSION'da artırılır (eski çerezler ölsün), değilse okunur.
    const { data: w } = await supabaseAdmin
      .from("workers")
      .select("session_version")
      .eq("id", workerId)
      .maybeSingle();
    const mevcut = (w?.session_version as number | null) ?? 0;
    if (SINGLE_SESSION && concurrent) {
      sessionVersion = mevcut + 1;
      await supabaseAdmin
        .from("workers")
        .update({ session_version: sessionVersion })
        .eq("id", workerId);
    } else {
      sessionVersion = mevcut;
    }

    const { data: ins } = await supabaseAdmin
      .from("login_sessions")
      .insert({
        worker_id: workerId,
        ip: ctx.ip,
        user_agent: ctx.userAgent,
        device_hash: ctx.deviceHash,
        city: ctx.city,
        country: ctx.country,
        new_device: newDevice,
        concurrent,
      })
      .select("id")
      .maybeSingle();

    return { id: (ins?.id as string) ?? null, sessionVersion, newDevice, concurrent };
  } catch {
    return KAPALI;
  }
}

/** Çıkışta / oturum düşürülünce satırı kapatır. Sessizce başarısız olabilir. */
export async function closeLoginSession(
  sessionId: string | null | undefined,
  reason: "logout" | "single_session" | "revoked" | "expired"
): Promise<void> {
  if (!SECURITY_LAYER_ENABLED || !sessionId) return;
  try {
    await supabaseAdmin
      .from("login_sessions")
      .update({ ended_at: new Date().toISOString(), ended_reason: reason })
      .eq("id", sessionId)
      .is("ended_at", null);
  } catch {
    /* iz yazılamadı — çıkış yine de olur */
  }
}

/** Korumalı sayfa isteklerinde oturumun canlılığını ileri taşır. */
export async function touchLoginSession(sessionId: string | null | undefined): Promise<void> {
  if (!SECURITY_LAYER_ENABLED || !sessionId) return;
  try {
    await supabaseAdmin
      .from("login_sessions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", sessionId)
      .is("ended_at", null);
  } catch {
    /* yok say */
  }
}

/**
 * Çerezdeki oturum sürümü hâlâ geçerli mi?
 *
 * `true` → oturum ÖLÜ (çerez iptal edilmiş). Katman kapalıyken DAİMA `false`
 * döner, yani hiçbir ek sorgu atılmaz ve hiçbir oturum düşürülmez.
 * DB hatasında da `false` — geçici bir hata yüzünden çalışan insanları
 * kapı dışında bırakmayız (kilit fail-closed DEĞİL, bilinçli fail-open:
 * bu bir yetki kapısı değil, bir iptal mekanizmasıdır).
 */
export async function isSessionRevoked(
  workerId: string,
  cookieVersion: number | undefined
): Promise<boolean> {
  if (!SECURITY_LAYER_ENABLED) return false;
  try {
    const { data, error } = await supabaseAdmin
      .from("workers")
      .select("session_version")
      .eq("id", workerId)
      .maybeSingle();
    if (error || !data) return false;
    const dbVersion = (data.session_version as number | null) ?? 0;
    return dbVersion !== (cookieVersion ?? 0);
  } catch {
    return false;
  }
}

/** Bir kişinin tüm oturumlarını düşürür (patron düğmesi). Yeni sürümü döner. */
export async function revokeAllSessions(workerId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("workers")
    .select("session_version")
    .eq("id", workerId)
    .maybeSingle();
  const next = ((data?.session_version as number | null) ?? 0) + 1;
  await supabaseAdmin.from("workers").update({ session_version: next }).eq("id", workerId);
  await supabaseAdmin
    .from("login_sessions")
    .update({ ended_at: new Date().toISOString(), ended_reason: "revoked" })
    .eq("worker_id", workerId)
    .is("ended_at", null);
  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// EYLEM İZİ
// ─────────────────────────────────────────────────────────────────────────────

export type AuditAction =
  | "page_view"
  | "export_csv"
  | "export_pdf"
  | "session_revoke"
  | "account_freeze"
  | "account_unfreeze";

/**
 * Eylem izi yazar. ASLA throw etmez ve katman kapalıyken hiçbir şey yapmaz.
 * `meta` küçük tutulmalı — istek gövdesi ya da kişisel veri konmaz.
 */
export async function audit(
  workerId: string | null,
  action: AuditAction,
  target?: string | null,
  meta?: Record<string, unknown>
): Promise<void> {
  if (!SECURITY_LAYER_ENABLED) return;
  try {
    const ctx = readRequestContext(await headers());
    await supabaseAdmin.from("audit_log").insert({
      worker_id: workerId,
      action,
      target: target ?? null,
      meta: meta ?? null,
      ip: ctx.ip,
    });
  } catch {
    /* iz yazılamadı — eylem yine de tamamlanır */
  }
}
