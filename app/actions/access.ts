"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireOwner } from "@/lib/session";
import { audit } from "@/lib/security-log";
import { clientIpFromHeaders } from "@/lib/auth-core";
import { ACCESS_GATES_ENABLED, SECURITY_LAYER_ENABLED } from "@/lib/tenant";
import { getKillSwitchState, recordAttempt } from "@/lib/kill-switch";
import {
  ANAHTAR_ONAY_METNI,
  anahtarCek,
  anahtarGeriAl,
  muafiyetYaz,
  onayKarari,
  saatleriDenetle,
  saatleriYaz,
  type OnayTablosu,
} from "@/lib/guvenlik-eylem";

/**
 * ERİŞİM KAPILARI — PATRON EYLEMLERİ (046).
 *
 * Hepsi `requireOwner()` ile başlar. UI'da düğmeyi gizlemek kozmetiktir; son
 * sözü bu kapı söyler (action doğrudan çağrılabilir).
 *
 * ═══ KURALLAR `lib/guvenlik-eylem.ts`TE ═══
 * "Yalnız BEKLEYEN satır karara bağlanır", "iki saat ucu birlikte ya da
 * hiçbiri", "önce kilit sonra cevap" — üçü de artık tek çekirdekte ve mobil
 * uçlar aynısını çağırıyor. Buradaki fonksiyonlar kapı + bayrak + tazeleme.
 */

export type AccessResult = { ok: boolean; error?: string };

// ─────────────────────────────────────────────────────────────────────────────
// KAPI 1 + 2 — ONAYLAR
// ─────────────────────────────────────────────────────────────────────────────

async function karar(tablo: OnayTablosu, id: string, onayla: boolean): Promise<AccessResult> {
  const session = await requireOwner();
  if (!ACCESS_GATES_ENABLED) return { ok: false, error: "gates_disabled" };

  const r = await onayKarari(tablo, id, onayla, session.worker_id ?? null);
  /**
   * `not_pending` PANELDE HATA DEĞİL. İki sekmesi açık bir patron aynı satıra
   * iki kez basarsa ikincisi sessizce hiçbir şey yapmalı — eski davranış
   * buydu (update 0 satır etkiler, `{ok:true}` dönerdi) ve ekran o varsayımla
   * yazıldı. Mobil uç aynı durumu 409 ile AYIRT EDİYOR; ayrım çağıranda,
   * kural çekirdekte.
   */
  if (!r.ok && r.error !== "not_pending") return { ok: false, error: r.error };
  revalidatePath("/admin/guvenlik");
  return { ok: true };
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

/**
 * Kişi bazında giriş saati aralığı. İkisi de boş → kısıt kaldırılır (kiracı
 * varsayılanına döner). Biçim ve "tek uç boş kabul edilmez" kuralı
 * `saatleriDenetle` içinde.
 */
export async function setAccessHoursAction(
  workerId: string,
  start: string,
  end: string
): Promise<AccessResult> {
  const session = await requireOwner();
  if (!ACCESS_GATES_ENABLED) return { ok: false, error: "gates_disabled" };

  const d = saatleriDenetle(start, end);
  // Tek `if` ile daraltma: iki ayrı karşılaştırma TypeScript'te ayrık birleşimi
  // daraltmıyor ve `d.start` erişilemez kalıyor (tsc yakaladı).
  if (d.hata !== null) {
    return {
      ok: false,
      error:
        d.hata === "bicim"
          ? "Saat biçimi SS:DD olmalı (ör. 07:00)"
          : "İki ucu birlikte doldurun ya da ikisini de boşaltın",
    };
  }

  const r = await saatleriYaz(workerId, d.start, d.end, session.worker_id ?? null);
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/admin/guvenlik");
  return { ok: true };
}

/**
 * KAPILARDAN MUAFİYET (migration 048) — kişi bazında aç/kapa.
 *
 * ⚠️ Muafiyet YETKİ ya da GÖRÜNÜRLÜK VERMEZ: muaf kişi /admin/guvenlik'i
 * açamaz (requireOwner) ve patronu personel listelerinde göremez (045 ayrı
 * eksen). Kapsam ve gerekçe çekirdeğin başlığında.
 */
export async function setGateExemptAction(
  workerId: string,
  exempt: boolean
): Promise<AccessResult> {
  const session = await requireOwner();
  if (!ACCESS_GATES_ENABLED) return { ok: false, error: "gates_disabled" };

  const r = await muafiyetYaz(workerId, exempt, session.worker_id ?? null);
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/admin/guvenlik");
  return { ok: true };
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
 *
 * ⚠️ PANELDE AYRI BİR ADIM, ÇEKİRDEKTE TEK AKIŞ. Ekran iki ayrı düğmeyle
 * ilerliyor (önce metin, sonra gizli soru), mobil uç ikisini tek gövdede
 * alıyor; ikisi de `anahtarCek` içindeki AYNI sırayı uyguluyor.
 */
export async function killSwitchConfirmAction(text: string): Promise<AccessResult> {
  const session = await requireOwner();
  if (!ACCESS_GATES_ENABLED) return { ok: false, error: "gates_disabled" };
  const ip = clientIpFromHeaders(await headers());
  const dogru = (text ?? "").trim().toUpperCase() === ANAHTAR_ONAY_METNI;
  await recordAttempt(session.worker_id ?? null, ip, "confirm", dogru);
  return dogru ? { ok: true } : { ok: false, error: "confirm_mismatch" };
}

/**
 * AŞAMA 3 — gizli soru + aktivasyon.
 *
 * Panel aşama 2'yi ayrı geçtiği için buraya onay metni ZATEN DOĞRU olarak
 * verilir; sıra, kilit denetimi ve iz yazımı çekirdekte.
 */
export async function killSwitchActivateAction(
  answer: string,
  reason: string
): Promise<AccessResult & { lockedUntil?: string; kalanHak?: number }> {
  const session = await requireOwner();
  if (!ACCESS_GATES_ENABLED) return { ok: false, error: "gates_disabled" };
  const ip = clientIpFromHeaders(await headers());

  const r = await anahtarCek(
    session.worker_id ?? null,
    ip,
    ANAHTAR_ONAY_METNI,
    answer,
    reason
  );
  if (!r.ok) {
    return {
      ok: false,
      error: r.error,
      lockedUntil: r.lockedUntil ?? undefined,
      kalanHak: r.kalanHak,
    };
  }
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
  const r = await anahtarGeriAl(session.worker_id ?? null);
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/admin/guvenlik");
  return { ok: true };
}

/** Anahtar durumu — ekran ilk yüklemede sunucu bileşeninden alır, bu yedek yol. */
export async function killSwitchStateAction() {
  await requireOwner();
  return getKillSwitchState();
}
