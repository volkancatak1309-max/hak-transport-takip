"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase";
import { requireOwner } from "@/lib/session";
import { audit } from "@/lib/security-log";
import { clientIpFromHeaders } from "@/lib/auth-core";
import { ACCESS_GATES_ENABLED, SECURITY_LAYER_ENABLED } from "@/lib/tenant";
import {
  getKillSwitchState,
  recordAttempt,
  verifySecret,
  activateKillSwitch,
  deactivateKillSwitch,
} from "@/lib/kill-switch";

/**
 * ERİŞİM KAPILARI — PATRON EYLEMLERİ (046).
 *
 * Hepsi `requireOwner()` ile başlar. UI'da düğmeyi gizlemek kozmetiktir; son
 * sözü bu kapı söyler (action doğrudan çağrılabilir).
 */

export type AccessResult = { ok: boolean; error?: string };

/** "ONAYLIYORUM" — büyük/küçük ve baştaki/sondaki boşluk hoşgörülür. */
const ONAY_METNI = "ONAYLIYORUM";

// ─────────────────────────────────────────────────────────────────────────────
// KAPI 1 + 2 — ONAYLAR
// ─────────────────────────────────────────────────────────────────────────────

async function karar(
  tablo: "device_approvals" | "country_approvals",
  id: string,
  onayla: boolean
): Promise<AccessResult> {
  const session = await requireOwner();
  if (!ACCESS_GATES_ENABLED) return { ok: false, error: "gates_disabled" };
  if (!id) return { ok: false, error: "missing_id" };
  try {
    const { error } = await supabaseAdmin
      .from(tablo)
      .update({
        status: onayla ? "approved" : "denied",
        decided_at: new Date().toISOString(),
        decided_by: session.worker_id,
      })
      .eq("id", id)
      // Yalnız BEKLEYEN satır karara bağlanır: iki sekmesi açık bir patron
      // aynı satıra iki kez basarsa ikincisi sessizce hiçbir şey yapmaz.
      .eq("status", "pending");
    if (error) return { ok: false, error: error.message };

    await audit(
      session.worker_id ?? null,
      onayla ? "access_approve" : "access_deny",
      `${tablo}:${id}`
    );
    revalidatePath("/admin/guvenlik");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "error" };
  }
}

export async function approveDeviceAction(id: string, onayla: boolean) {
  return karar("device_approvals", id, onayla);
}

export async function approveCountryAction(id: string, onayla: boolean) {
  return karar("country_approvals", id, onayla);
}

// ─────────────────────────────────────────────────────────────────────────────
// KAPI 3 — SAAT ARALIĞI
// ─────────────────────────────────────────────────────────────────────────────

/** "HH:MM" biçimi ve geçerli saat/dakika. Boş dize → null (kısıt kaldır). */
function saatAyikla(v: string | null | undefined): string | null | "gecersiz" {
  const t = (v ?? "").trim();
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return "gecersiz";
  const sa = Number(m[1]);
  const dk = Number(m[2]);
  if (sa > 23 || dk > 59) return "gecersiz";
  return `${String(sa).padStart(2, "0")}:${m[2]}`;
}

/**
 * Kişi bazında giriş saati aralığı. İkisi de boş → kısıt kaldırılır (kiracı
 * varsayılanına döner).
 *
 * ⚠️ TEK UÇ BOŞ KABUL EDİLMEZ: yalnız başlangıcı verip bitişi boş bırakmak,
 * "07:00'den sonra serbest" gibi okunur ama kod diğer ucu varsayılandan alır ve
 * patronun kastetmediği bir aralık doğar. İkisi birlikte ya da hiçbiri.
 */
export async function setAccessHoursAction(
  workerId: string,
  start: string,
  end: string
): Promise<AccessResult> {
  const session = await requireOwner();
  if (!ACCESS_GATES_ENABLED) return { ok: false, error: "gates_disabled" };
  if (!workerId) return { ok: false, error: "missing_worker" };

  const s = saatAyikla(start);
  const e = saatAyikla(end);
  if (s === "gecersiz" || e === "gecersiz") {
    return { ok: false, error: "Saat biçimi SS:DD olmalı (ör. 07:00)" };
  }
  if ((s === null) !== (e === null)) {
    return { ok: false, error: "İki ucu birlikte doldurun ya da ikisini de boşaltın" };
  }

  try {
    const { error } = await supabaseAdmin
      .from("workers")
      .update({ access_hours_start: s, access_hours_end: e })
      .eq("id", workerId);
    if (error) return { ok: false, error: error.message };
    await audit(session.worker_id ?? null, "access_hours", workerId, {
      start: s,
      end: e,
    });
    revalidatePath("/admin/guvenlik");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "error" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OTURUM KAYIT OYNATICI + PDF PARMAK İZİ SORGUSU (dalga 3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bir kişinin bir gününü getirir.
 *
 * İSTEK ÜZERİNE yükleniyor, sayfa açılışında değil: oynatıcı altı tabloyu
 * birden okuyor ve güvenlik ekranını her açan bunu ödemek zorunda değil.
 */
export async function getDayReplayAction(workerId: string, ymd: string) {
  const session = await requireOwner();
  if (!SECURITY_LAYER_ENABLED) return [];
  const { buildDayReplay } = await import("@/lib/replay");
  const olaylar = await buildDayReplay(workerId, ymd);
  // Oynatıcıyı KİMİN açtığı da ize girer: bir kişinin bütün gününü okumak,
  // izlenmeye değer bir eylemdir.
  await audit(session.worker_id ?? null, "page_view", "/admin/guvenlik#oynatici", {
    hedef: workerId,
    gun: ymd,
  });
  return olaylar;
}

/**
 * PDF parmak izini sorgular: işareti yapıştır, kimin ne zaman indirdiğini söyle.
 *
 * Bulunamazsa `null` — "bu iz bize ait değil" demenin tek dürüst yolu bu.
 * Tahmini bir eşleşme döndürmek, sahte bir suçlamaya dayanak olurdu.
 */
export async function lookupFingerprintAction(raw: string) {
  const session = await requireOwner();
  if (!SECURITY_LAYER_ENABLED) return null;
  const { lookupFingerprint } = await import("@/lib/pdf-fingerprint");
  const hit = await lookupFingerprint(raw);
  await audit(session.worker_id ?? null, "page_view", "/admin/guvenlik#parmakizi", {
    sorgu: (raw ?? "").slice(0, 40),
    bulundu: !!hit,
  });
  return hit;
}

// ─────────────────────────────────────────────────────────────────────────────
// KAPI 4 — ÖLÜ ADAM ANAHTARI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AŞAMA 2 — "ONAYLIYORUM" yazımı.
 *
 * Sunucuda doğrulanır, çünkü aşama 3'e geçiş istemcide karar verilseydi
 * doğrudan aktivasyon çağrılabilirdi. Her deneme ize girer.
 */
export async function killSwitchConfirmAction(text: string): Promise<AccessResult> {
  const session = await requireOwner();
  if (!ACCESS_GATES_ENABLED) return { ok: false, error: "gates_disabled" };
  const ip = clientIpFromHeaders(await headers());
  const dogru = (text ?? "").trim().toUpperCase() === ONAY_METNI;
  await recordAttempt(session.worker_id ?? null, ip, "confirm", dogru);
  return dogru ? { ok: true } : { ok: false, error: "confirm_mismatch" };
}

/**
 * AŞAMA 3 — gizli soru + aktivasyon.
 *
 * Sıra önemli ve şöyle: ÖNCE kilit denetlenir, SONRA cevap doğrulanır, HER
 * DURUMDA iz yazılır. Kilit denetimini cevaptan sonraya bıraksaydık kilitli
 * bir anahtarda bile cevap denenebilir, yani kilit deneme sayısını
 * sınırlamamış olurdu.
 *
 * Cevap DÜZ METİN olarak hiçbir yerde tutulmuyor; karşılaştırma bcrypt ile
 * kill_switch_secret üzerinden yapılır (migration 046).
 */
export async function killSwitchActivateAction(
  answer: string,
  reason: string
): Promise<AccessResult & { lockedUntil?: string; kalanHak?: number }> {
  const session = await requireOwner();
  if (!ACCESS_GATES_ENABLED) return { ok: false, error: "gates_disabled" };
  const ip = clientIpFromHeaders(await headers());

  const durum = await getKillSwitchState();
  if (durum.lockedUntil) {
    // Kilitliyken deneme HİÇ yapılmaz — iz yazılır ama cevap değerlendirilmez.
    await recordAttempt(session.worker_id ?? null, ip, "secret", false);
    return { ok: false, error: "locked", lockedUntil: durum.lockedUntil, kalanHak: 0 };
  }

  const dogru = await verifySecret((answer ?? "").trim());
  await recordAttempt(session.worker_id ?? null, ip, "secret", dogru);

  if (!dogru) {
    const sonra = await getKillSwitchState();
    return {
      ok: false,
      error: sonra.lockedUntil ? "locked" : "wrong_answer",
      lockedUntil: sonra.lockedUntil ?? undefined,
      kalanHak: sonra.kalanHak,
    };
  }

  const r = await activateKillSwitch(session.worker_id!, (reason ?? "").trim() || null);
  if (!r.ok) return { ok: false, error: r.error };
  await audit(session.worker_id ?? null, "kill_switch_on", null, {
    reason: (reason ?? "").trim() || null,
  });
  revalidatePath("/admin/guvenlik");
  return { ok: true };
}

/**
 * Patronun tek tuşu — geri açma.
 *
 * Gizli soru İSTENMEZ ve bu bilinçli: kapatmak yıkıcı, açmak onarıcı bir
 * eylemdir. Geri açmayı da üç aşamaya bağlasaydık, sistemi yanlışlıkla
 * kapatan patron kendi anahtarının arkasında kalırdı.
 */
export async function killSwitchDeactivateAction(): Promise<AccessResult> {
  const session = await requireOwner();
  if (!ACCESS_GATES_ENABLED) return { ok: false, error: "gates_disabled" };
  const r = await deactivateKillSwitch(session.worker_id!);
  if (!r.ok) return { ok: false, error: r.error };
  await audit(session.worker_id ?? null, "kill_switch_off", null);
  revalidatePath("/admin/guvenlik");
  return { ok: true };
}
