import "server-only";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { ACCESS_GATES_ENABLED } from "@/lib/tenant";

/**
 * ÖLÜ ADAM ANAHTARI (migration 046) — KAPI 4.
 *
 * Aktifken patron HARİÇ herkes dışarıda kalır: açık oturumlar düşer, yeni giriş
 * reddedilir. Patron tek düğmeyle geri açar.
 *
 * ── "HESAPLARI DONDUR" NEDEN is_active=false YAZMIYOR ──────────────────────
 * İstenen sonuç "kimse giremesin"di; bunu iki yoldan yapabilirdik:
 *
 *   (a) Tüm workers satırlarına is_active=false yazmak
 *   (b) Kapı olarak uygulamak — veri değişmez, giriş yolu kapanır
 *
 * (b) seçildi ve sebebi geri alınabilirlik: (a)'da anahtarı kapatırken
 * "önceden ZATEN pasif olan kimdi" bilgisi kaybolur ve herkesi aktif yaparak
 * geri dönmek, işten ayrılmış personeli sisteme geri sokar. Bu depo aynı sınıf
 * hatayı 22.07.2026'da yaşadı (otomatik kapanış 20 şoförü kilitledi) ve oradan
 * çıkan kural açık: TOPLU, GERİ ALINAMAZ VERİ YAZMA YOK.
 *
 * Dışarıdan bakan fark yok: iki yolda da hesap giriş yapamaz. Fark yalnız
 * anahtarı kapattığın anda ortaya çıkar — (b)'de sistem bir önceki hâline
 * BİREBİR döner.
 *
 * ── SIR ────────────────────────────────────────────────────────────────────
 * Gizli sorunun cevabı hiçbir dosyada, kodda ya da env'de DÜZ METİN durmaz;
 * yalnız bcrypt hash'i kill_switch_secret tablosundadır (migration 046).
 */

/** Kapalıyken hiçbir sorgu atılmadan dönen durum. */
export type KillSwitchState = {
  active: boolean;
  activatedAt: string | null;
  activatedBy: string | null;
  reason: string | null;
  /** Gizli soru kilitliyse bitiş anı (ISO); değilse null. */
  lockedUntil: string | null;
  /** Kilide kalan yanlış hakkı (kilitliyken 0). */
  kalanHak: number;
};

const KAPALI: KillSwitchState = {
  active: false,
  activatedAt: null,
  activatedBy: null,
  reason: null,
  lockedUntil: null,
  kalanHak: 3,
};

/** Üst üste bu kadar yanlış → kilit. */
const HAK = 3;
/** Kilit süresi. */
const KILIT_MS = 24 * 60 * 60 * 1000;

/**
 * ANAHTAR AÇIK MI — giriş yolundaki SICAK sorgu, olabildiğince ucuz tutuldu.
 *
 * Hata durumunda `false` (fail-open) döner ve bu BİLİNÇLİ: geçici bir DB
 * hatası tüm kadroyu kapı dışında bırakmamalı. Anahtar bir ACİL DURUM aracıdır,
 * bir yetki kapısı değil — yanlış tarafa düşerse zarar büyüktür.
 */
export async function isKillSwitchActive(): Promise<boolean> {
  if (!ACCESS_GATES_ENABLED) return false;
  try {
    const { data, error } = await supabaseAdmin
      .from("kill_switch")
      .select("id")
      .is("deactivated_at", null)
      .limit(1);
    if (error) return false;
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * GİZLİ SORU KİLİDİ — denemelerden TÜRETİLİR, ayrı sayaç kolonu YOK.
 *
 * Neden türetme: sayaç bir kolonda, iz başka bir tabloda dursaydı ikisi
 * kaçınılmaz olarak ayrışırdı (biri güncellenir, diğeri unutulur). Tek kaynak
 * kill_switch_attempts; kilit onun okunmasıyla hesaplanır.
 *
 * Algoritma: son başarılı denemeden sonraki başarısızlıklar ESKİDEN YENİYE
 * üçerli gruplanır. Her grubun 3. denemesi bir kilit başlatır ve 24 saat
 * sürer. Süresi dolmuş grup TÜKENMİŞ sayılır ve sayım kalanlardan devam eder —
 * yoksa kilit bir kez dolduktan sonra tek bir yanlış cevap onu yeniden
 * kilitlerdi (eski iki yanlış hâlâ "son üç" içinde olurdu).
 */
async function readLock(): Promise<{ lockedUntil: string | null; kalanHak: number }> {
  const { data, error } = await supabaseAdmin
    .from("kill_switch_attempts")
    .select("at, success")
    .eq("stage", "secret")
    .order("at", { ascending: false })
    .limit(100);
  if (error || !data) return { lockedUntil: null, kalanHak: HAK };

  const rows = data as { at: string; success: boolean }[];
  // Son BAŞARILI denemeye kadar olan başarısızlıklar (yeniden eskiye).
  const streak: string[] = [];
  for (const r of rows) {
    if (r.success) break;
    streak.push(r.at);
  }
  streak.reverse(); // eskiden yeniye

  const simdi = Date.now();
  let i = 0;
  while (i + HAK <= streak.length) {
    const bitis = new Date(streak[i + HAK - 1]).getTime() + KILIT_MS;
    if (simdi < bitis) {
      return { lockedUntil: new Date(bitis).toISOString(), kalanHak: 0 };
    }
    i += HAK; // bu grubun kilidi dolmuş — tüketildi, sonrakinden devam
  }
  return { lockedUntil: null, kalanHak: HAK - (streak.length - i) };
}

/** Patron ekranı için tam durum. Katman kapalıyken sorgu YOK. */
export async function getKillSwitchState(): Promise<KillSwitchState> {
  if (!ACCESS_GATES_ENABLED) return KAPALI;
  try {
    const [{ data: acik }, kilit] = await Promise.all([
      supabaseAdmin
        .from("kill_switch")
        .select("activated_at, activated_by, reason")
        .is("deactivated_at", null)
        .order("activated_at", { ascending: false })
        .limit(1),
      readLock(),
    ]);
    const row = (acik ?? [])[0] as
      | { activated_at: string; activated_by: string | null; reason: string | null }
      | undefined;
    return {
      active: !!row,
      activatedAt: row?.activated_at ?? null,
      activatedBy: row?.activated_by ?? null,
      reason: row?.reason ?? null,
      lockedUntil: kilit.lockedUntil,
      kalanHak: kilit.kalanHak,
    };
  } catch {
    return KAPALI;
  }
}

/** Her aşama denemesi ize girer — başarılı da, başarısız da. */
export async function recordAttempt(
  workerId: string | null,
  ip: string | null,
  stage: "confirm" | "secret",
  success: boolean
): Promise<void> {
  if (!ACCESS_GATES_ENABLED) return;
  try {
    await supabaseAdmin
      .from("kill_switch_attempts")
      .insert({ worker_id: workerId, ip, stage, success });
  } catch {
    /* iz yazılamadı — akış devam eder */
  }
}

/**
 * Gizli soruyu doğrular. Cevap hiçbir yerde düz metin tutulmadığı için
 * karşılaştırma bcrypt ile yapılır.
 *
 * Satır yoksa (migration 046 çalışmamış) `false` döner — yani anahtar
 * AÇILAMAZ. Burada fail-closed doğru yön: sırrı okuyamıyorsak sistemi
 * kapatmaya yetkimiz yok demektir.
 */
export async function verifySecret(answer: string): Promise<boolean> {
  if (!ACCESS_GATES_ENABLED) return false;
  try {
    const { data, error } = await supabaseAdmin
      .from("kill_switch_secret")
      .select("answer_hash")
      .limit(1)
      .maybeSingle();
    if (error || !data?.answer_hash) return false;
    return await bcrypt.compare(answer, data.answer_hash as string);
  } catch {
    return false;
  }
}

/**
 * Anahtarı açar ve patron HARİÇ herkesin oturumunu düşürür.
 *
 * Oturum düşürme iki sayacı birden artırır (session_version + token_version):
 * yalnız web'i kesip mobili canlı bırakmak, "sistemi kapattım" diyen birine
 * yalan söylemek olurdu.
 */
export async function activateKillSwitch(
  ownerId: string,
  reason: string | null
): Promise<{ ok: boolean; error?: string }> {
  if (!ACCESS_GATES_ENABLED) return { ok: false, error: "gates_disabled" };
  try {
    const { error } = await supabaseAdmin
      .from("kill_switch")
      .insert({ activated_by: ownerId, reason });
    // Tekil indeks: zaten açık bir kayıt varsa çakışır — bu bir hata değil,
    // "zaten aktif" demektir.
    if (error && !/duplicate|unique/i.test(error.message)) {
      return { ok: false, error: error.message };
    }
    await dropNonOwnerSessions();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "error" };
  }
}

/** Patronun tek tuşu. Veri geri yazılmaz — kapı açılır, sistem eski hâline döner. */
export async function deactivateKillSwitch(
  ownerId: string
): Promise<{ ok: boolean; error?: string }> {
  if (!ACCESS_GATES_ENABLED) return { ok: false, error: "gates_disabled" };
  try {
    const { error } = await supabaseAdmin
      .from("kill_switch")
      .update({ deactivated_at: new Date().toISOString(), deactivated_by: ownerId })
      .is("deactivated_at", null);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "error" };
  }
}

/**
 * Patron olmayan HERKESİN oturumunu düşürür.
 *
 * Sayaçlar tek tek değil, tek UPDATE ile artırılamıyor (PostgREST kolon
 * aritmetiği desteklemiyor) — bu yüzden kimlikler okunup toplu yazılıyor.
 * Kadro iki haneli olduğu için maliyet önemsiz.
 */
async function dropNonOwnerSessions(): Promise<void> {
  // owner-visible: anahtarın işi TÜM kadroyu kapsamak; patron aşağıda
  // `is_owner` koşuluyla zaten dışarıda bırakılıyor.
  // test-visible: test hesabının oturumu da düşmeli — sistem kapalıysa herkes
  // kapalıdır. Test hesabını burada elemek, kapatılmış bir sistemde çalışmaya
  // devam eden tek bir hesap bırakırdı.
  const { data, error } = await supabaseAdmin
    .from("workers")
    .select("id, session_version, token_version, is_owner");
  if (error || !data) return;

  const hedef = (data as Record<string, unknown>[]).filter(
    (w) => w.is_owner !== true
  );
  await Promise.all(
    hedef.map((w) =>
      supabaseAdmin
        .from("workers")
        .update({
          session_version: ((w.session_version as number | null) ?? 0) + 1,
          token_version: ((w.token_version as number | null) ?? 0) + 1,
        })
        .eq("id", w.id as string)
    )
  );

  // Açık oturum satırlarını da kapat (patronunkiler hariç).
  const ids = hedef.map((w) => w.id as string);
  if (ids.length > 0) {
    await supabaseAdmin
      .from("login_sessions")
      .update({ ended_at: new Date().toISOString(), ended_reason: "revoked" })
      .in("worker_id", ids)
      .is("ended_at", null);
  }
}
