import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { audit, revokeAllSessions } from "@/lib/security-log";
import { bumpTokenVersion } from "@/lib/mobile-auth";
import {
  getKillSwitchState,
  recordAttempt,
  verifySecret,
  activateKillSwitch,
  deactivateKillSwitch,
} from "@/lib/kill-switch";

/**
 * GÜVENLİK YAZMA ÇEKİRDEĞİ — panel action'ları ve mobil uçların ORTAK yeri.
 *
 * ═══ NEDEN BU DOSYA VAR ═══
 *
 * Bu kuralların hepsi daha önce `app/actions/security.ts` ve
 * `app/actions/access.ts` içinde ÖZEL fonksiyonlardı. Mobil uçlar aynı kuralı
 * uygulamak zorunda ve `"use server"` bir modülden senkron fonksiyon dışa
 * aktarılamıyor (o dosyaların her export'u async olmak ZORUNDA) — üstelik
 * action'lar `requireOwner()` çağırıyor ve o `redirect()` atıyor; bir route
 * handler'ında redirect bir istisnaya dönüşür.
 *
 * Kopyalamak iki yüzeyi zamanla ayrıştırırdı: "yalnız BEKLEYEN satır karara
 * bağlanır", "iki saat ucu birlikte ya da hiçbiri", "önce kilit sonra cevap"
 * gibi kararlar tek yerde durmalı. Aynı gerekçe `kalemKapsamda` (084) ve
 * `kademeDenetle` (086) için de verilmişti.
 *
 * ⚠️ BU DOSYA KAPI AÇMAZ. Yetki denetimi ÇAĞIRANDA: panelde `requireOwner()`,
 * mobilde `requireMobileOwner()`. Buradaki fonksiyonlar yetkili bir çağıran
 * varsayar — tıpkı `lib/is-emri-db.ts`in politikayı çağırana bırakması gibi.
 */

export type GuvenlikSonuc = { ok: boolean; error?: string };

// ═══════════════════════ OTURUM KESME ════════════════════════════════════

/**
 * 🔴 KESME HESAP EKSENİNDE — TEK OTURUM KESİLEMEZ, ÖLÇÜLDÜ.
 *
 * Üründe oturum iptali SATIR düzeyinde değil KİŞİ düzeyinde çalışıyor:
 *
 *   web    → `isSessionRevoked(workerId, cookieVersion)` yalnız
 *            `workers.session_version` ile çerezdeki sürümü karşılaştırır.
 *            `login_sessions` satırına HİÇ bakmaz.
 *   mobil  → `token_version` da `workers` üzerinde; mobil token bir satır
 *            id'si taşımıyor (lib/security-log.ts `closeSessionsBySource`).
 *
 * Yani tek bir `login_sessions` satırını kapatmak KİMSEYİ ÇIKARMAZ: satır
 * "bitti" görünür, kişi çalışmaya devam eder. Böyle bir uç, güvenlik
 * ekranında **yalan** söyleyen bir düğme olurdu.
 *
 * Bu yüzden satır id'siyle gelen bir kesme isteği, satırın SAHİBİNİ bulup
 * o kişinin bütün oturumlarını düşürür — ve çağıran bunu AÇIKÇA kabul etmek
 * zorundadır (mobil uçta `kapsam: "hepsi"`).
 */
export async function oturumlariKes(
  workerId: string,
  actorId: string | null,
  opts: { dondur?: boolean } = {}
): Promise<GuvenlikSonuc & { sessionVersion?: number }> {
  if (!workerId) return { ok: false, error: "missing_worker" };
  // Patronun kendi oturumunu düşürmesi anlamsız ve kilitlenmeye açık.
  if (actorId && workerId === actorId) return { ok: false, error: "self" };

  try {
    const sv = await revokeAllSessions(workerId);
    // Mobil ayrı sayaç: web'i kesip mobili canlı bırakmak yarım önlem.
    // 044 çalıştırılmamışsa false döner — sessizce yutulur, web kesme geçerli.
    await bumpTokenVersion(workerId);

    if (opts.dondur) {
      const { error } = await supabaseAdmin
        .from("workers")
        .update({ is_active: false })
        .eq("id", workerId);
      if (error) return { ok: false, error: error.message };
    }

    await audit(actorId, opts.dondur ? "account_freeze" : "session_revoke", workerId, {
      freeze: Boolean(opts.dondur),
    });
    return { ok: true, sessionVersion: sv };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "error" };
  }
}

/** Dondurulmuş hesabı geri açar. Oturumlar kapalı kalır. */
export async function hesabiGeriAc(
  workerId: string,
  actorId: string | null
): Promise<GuvenlikSonuc> {
  try {
    const { error } = await supabaseAdmin
      .from("workers")
      .update({ is_active: true })
      .eq("id", workerId);
    if (error) return { ok: false, error: error.message };
    await audit(actorId, "account_unfreeze", workerId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "error" };
  }
}

// ═══════════════════════ ONAY KARARI ═════════════════════════════════════

export type OnayTablosu = "device_approvals" | "country_approvals";

/**
 * Bekleyen bir cihaz/ülke onayını karara bağlar.
 *
 * ⚠️ `.eq("status","pending")` KURALIN KENDİSİ: iki sekmesi açık bir patron
 * aynı satıra iki kez basarsa ikincisi sessizce hiçbir şey yapmaz. Koşulu
 * kaldırmak, verilmiş bir kararın üstüne ikinci bir karar yazardı.
 *
 * `etkilenen` döner: 0 ise satır YA yoktu YA zaten karara bağlanmıştı —
 * çağıran bu ikisini ayırt edip 404/409 üretebilir.
 */
export async function onayKarari(
  tablo: OnayTablosu,
  id: string,
  onayla: boolean,
  actorId: string | null
): Promise<GuvenlikSonuc & { etkilenen?: number }> {
  if (!id) return { ok: false, error: "missing_id" };
  try {
    const { data, error } = await supabaseAdmin
      .from(tablo)
      .update({
        status: onayla ? "approved" : "denied",
        decided_at: new Date().toISOString(),
        decided_by: actorId,
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("id");
    if (error) return { ok: false, error: error.message };

    const etkilenen = (data ?? []).length;
    if (etkilenen === 0) return { ok: false, error: "not_pending", etkilenen: 0 };

    await audit(actorId, onayla ? "access_approve" : "access_deny", `${tablo}:${id}`);
    return { ok: true, etkilenen };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "error" };
  }
}

// ═══════════════════════ ERİŞİM SAATLERİ ═════════════════════════════════

/** "HH:MM" biçimi ve geçerli saat/dakika. Boş dize → null (kısıt kaldır). */
export function saatAyikla(v: string | null | undefined): string | null | "gecersiz" {
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
 * İki saat ucunu birlikte denetler.
 *
 * ⚠️ TEK UÇ BOŞ KABUL EDİLMEZ: yalnız başlangıcı verip bitişi boş bırakmak
 * "07:00'den sonra serbest" gibi okunur ama kod diğer ucu varsayılandan alır
 * ve patronun kastetmediği bir aralık doğar. İkisi birlikte ya da hiçbiri.
 */
export function saatleriDenetle(
  start: string | null | undefined,
  end: string | null | undefined
): { hata: "bicim" | "tek_uc" } | { hata: null; start: string | null; end: string | null } {
  const s = saatAyikla(start);
  const e = saatAyikla(end);
  if (s === "gecersiz" || e === "gecersiz") return { hata: "bicim" };
  if ((s === null) !== (e === null)) return { hata: "tek_uc" };
  return { hata: null, start: s, end: e };
}

export async function saatleriYaz(
  workerId: string,
  start: string | null,
  end: string | null,
  actorId: string | null
): Promise<GuvenlikSonuc> {
  if (!workerId) return { ok: false, error: "missing_worker" };
  try {
    const { error } = await supabaseAdmin
      .from("workers")
      .update({ access_hours_start: start, access_hours_end: end })
      .eq("id", workerId);
    if (error) return { ok: false, error: error.message };
    await audit(actorId, "access_hours", workerId, { start, end });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "error" };
  }
}

/**
 * KAPILARDAN MUAFİYET (048) — kişi bazında aç/kapa.
 *
 * MUAF: cihaz onayı · ülke onayı · saat kilidi.
 * MUAF DEĞİL: ölü adam anahtarı — orada tek istisna patrondur ve öyle
 * kalmalı, yoksa "sistemi kapat" birkaç kişiyi içeride bırakan bir düğmeye
 * dönerdi.
 *
 * Değişiklik eski/yeni değeriyle ize düşer — SQL'le yapılan düşmez.
 */
export async function muafiyetYaz(
  workerId: string,
  exempt: boolean,
  actorId: string | null
): Promise<GuvenlikSonuc> {
  if (!workerId) return { ok: false, error: "missing_worker" };
  try {
    const { data: once } = await supabaseAdmin
      .from("workers")
      .select("id, name, gate_exempt")
      .eq("id", workerId)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("workers")
      .update({ gate_exempt: exempt })
      .eq("id", workerId);
    if (error) return { ok: false, error: error.message };

    const { auditChange } = await import("@/lib/audit-change");
    await auditChange(actorId, "update", "workers", workerId,
      once as Record<string, unknown> | null, { gate_exempt: exempt });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "error" };
  }
}

// ═══════════════════════ ÖLÜ ADAM ANAHTARI ═══════════════════════════════

/**
 * AŞAMA 2 METNİ — birebir bu, büyük/küçük ve kenar boşluğu hoşgörülür.
 * Panel formu da bu sabiti kullanır; iki yüzeyde iki farklı kelime olamaz.
 */
export const ANAHTAR_ONAY_METNI = "ONAYLIYORUM";

/**
 * AŞAMA 3 SORUSU — panelde ekranda basılı duruyordu (`GuvenlikClient.tsx`).
 * Mobil istemci de aynı soruyu göstermek zorunda; iki yerde iki farklı soru,
 * cevabı bilen kişinin yanlış kutuya yazmasıyla biter.
 *
 * ⚠️ SORU SIR DEĞİL, CEVAP SIR. Soru metni gövdede taşınabilir; cevap yalnız
 * bcrypt hash olarak `kill_switch_secret.answer_hash`ta durur.
 */
export const ANAHTAR_SORUSU = "Apolet no?";

/**
 * 046'nın TOHUM hash'i — `db/migrations/046_access_gates.sql` içinde açıkça
 * yazılı, yani gizli bir değer DEĞİL.
 *
 * Neden kodda: kurulumun hâlâ FABRİKA cevabında olup olmadığını söyleyebilmek
 * için. Bir güvenlik ekranının en az söylemesi gereken şey, kilidin hâlâ
 * kutudan çıktığı gibi olduğudur. Karşılaştırma hash'e hash olarak yapılır;
 * cevabın kendisi hiçbir yerde yok.
 */
export const ANAHTAR_TOHUM_HASH =
  "$2b$10$vOjXw4BeoSHqOzOGvQZ2ke4zVHwWtAx5WsLE7k6I4CoLqrKtfQxDy";

export type AnahtarKurulumu = {
  /** `kill_switch_secret` satırı var mı (046 koştu mu). */
  sirVar: boolean;
  /** Hash HÂLÂ migration'ın tohum değeri mi — kurulum eksiği uyarısı. */
  sirVarsayilan: boolean;
  soru: string;
};

/**
 * Anahtarın KURULUM durumu — cevabı okumadan.
 *
 * `answer_hash` yalnız tohum hash'iyle KARŞILAŞTIRILIR ve hiçbir yere
 * yazılmaz/dönülmez. `servisYapilandirildi` (091) ile aynı fikir: "arıza" ile
 * "hiç kurulmamış" ayrı şeylerdir ve istemci ikisini ayırabilmelidir.
 */
export async function anahtarKurulumu(): Promise<AnahtarKurulumu> {
  try {
    const { data, error } = await supabaseAdmin
      .from("kill_switch_secret")
      .select("answer_hash")
      .limit(1)
      .maybeSingle();
    if (error || !data?.answer_hash) {
      return { sirVar: false, sirVarsayilan: false, soru: ANAHTAR_SORUSU };
    }
    return {
      sirVar: true,
      sirVarsayilan: data.answer_hash === ANAHTAR_TOHUM_HASH,
      soru: ANAHTAR_SORUSU,
    };
  } catch {
    return { sirVar: false, sirVarsayilan: false, soru: ANAHTAR_SORUSU };
  }
}

export type AnahtarCekSonuc = GuvenlikSonuc & {
  lockedUntil?: string | null;
  kalanHak?: number;
  asama?: "onay" | "gizli";
};

/**
 * ANAHTARI ÇEK — sistemi KAPATIR (patron hariç herkesin oturumu düşer).
 *
 * ═══ SIRA KURALIN KENDİSİ ═══
 *   1. AŞAMA 2 — "ONAYLIYORUM" metni. Her deneme ize girer.
 *   2. AŞAMA 3 — ÖNCE KİLİT denetlenir, SONRA cevap doğrulanır, HER DURUMDA
 *      iz yazılır. Kilit denetimini cevaptan sonraya bıraksaydık kilitli bir
 *      anahtarda bile cevap denenebilir, yani kilit deneme sayısını
 *      sınırlamamış olurdu.
 *
 * Cevap DÜZ METİN olarak hiçbir yerde tutulmuyor; karşılaştırma bcrypt ile
 * `kill_switch_secret` üzerinden (046).
 *
 * 🔴 HER YANLIŞ CEVAP BİR HAKKI YAKAR. Üçüncü yanlışta anahtar 24 saat
 * kilitlenir ve o süre boyunca DOĞRU cevapla bile çekilemez.
 */
export async function anahtarCek(
  actorId: string | null,
  ip: string | null,
  onayMetni: string,
  cevap: string,
  sebep: string | null
): Promise<AnahtarCekSonuc> {
  // ── AŞAMA 2 ────────────────────────────────────────────────────────────
  const onayDogru = (onayMetni ?? "").trim().toUpperCase() === ANAHTAR_ONAY_METNI;
  await recordAttempt(actorId, ip, "confirm", onayDogru);
  if (!onayDogru) return { ok: false, error: "confirm_mismatch", asama: "onay" };

  // ── AŞAMA 3 ────────────────────────────────────────────────────────────
  const durum = await getKillSwitchState();
  if (durum.lockedUntil) {
    // Kilitliyken deneme HİÇ yapılmaz — iz yazılır ama cevap değerlendirilmez.
    await recordAttempt(actorId, ip, "secret", false);
    return { ok: false, error: "locked", asama: "gizli", lockedUntil: durum.lockedUntil, kalanHak: 0 };
  }

  const dogru = await verifySecret((cevap ?? "").trim());
  await recordAttempt(actorId, ip, "secret", dogru);

  if (!dogru) {
    const sonra = await getKillSwitchState();
    return {
      ok: false,
      error: sonra.lockedUntil ? "locked" : "wrong_answer",
      asama: "gizli",
      lockedUntil: sonra.lockedUntil,
      kalanHak: sonra.kalanHak,
    };
  }

  if (!actorId) return { ok: false, error: "missing_actor" };
  const r = await activateKillSwitch(actorId, (sebep ?? "").trim() || null);
  if (!r.ok) return { ok: false, error: r.error };
  await audit(actorId, "kill_switch_on", null, { reason: (sebep ?? "").trim() || null });
  return { ok: true };
}

/**
 * ANAHTARI GERİ AL — sistemi eski hâline döndürür.
 *
 * Gizli soru İSTENMEZ ve bu bilinçli: kapatmak yıkıcı, açmak onarıcı bir
 * eylemdir. Geri almayı da üç aşamaya bağlasaydık, sistemi yanlışlıkla
 * kapatan patron kendi anahtarının arkasında kalırdı.
 */
export async function anahtarGeriAl(actorId: string | null): Promise<GuvenlikSonuc> {
  if (!actorId) return { ok: false, error: "missing_actor" };
  const r = await deactivateKillSwitch(actorId);
  if (!r.ok) return { ok: false, error: r.error };
  await audit(actorId, "kill_switch_off", null);
  return { ok: true };
}
