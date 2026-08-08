import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { readRequestContext, type HeaderBag } from "@/lib/request-context";
import { isOwnerWorker } from "@/lib/owner-scope";
import { isKillSwitchActive } from "@/lib/kill-switch";
import {
  ACCESS_GATES_ENABLED,
  ACCESS_COUNTRIES,
  ACCESS_HOURS_START,
  ACCESS_HOURS_END,
} from "@/lib/tenant";

/**
 * ERİŞİM KAPILARI (migration 046) — dört kapı, tek değerlendirme noktası.
 *
 *   1. ÖLÜ ADAM ANAHTARI  aktifse patron dışında kimse giremez        → RED
 *   2. SAAT KİLİDİ        aralık dışında giriş yok, açık oturum düşer → RED
 *   3. ÜLKE ONAYI         liste dışı ülke patron onayına düşer        → BEKLET
 *   4. CİHAZ ONAYI        tanınmayan cihaz patron onayına düşer       → BEKLET
 *
 * ── SIRA TESADÜFİ DEĞİL ────────────────────────────────────────────────────
 * En sert olan önce. Anahtar açıkken "cihazınız onay bekliyor" demek yanlış
 * bilgi olurdu — o kişi cihaz onaylansa da giremeyecek. Aynı şekilde saat
 * dışındaysa onay kaydı AÇILMAZ: sabah 03:00'te giren biri için patronun
 * onaylayacağı bir şey yok, sorun cihaz değil saat.
 *
 * ── RED ile BEKLET FARKI ───────────────────────────────────────────────────
 * RED    → oturum hiç kurulmaz, giriş ekranında hata görünür.
 * BEKLET → oturum kurulur ama `access_gate` işaretlidir; tüm kapılar kullanıcıyı
 *          /erisim ekranına gönderir. Fark önemli: bekleyen kullanıcının kim
 *          olduğunu bilmemiz gerekiyor (onay satırı ona ait), reddedilenin
 *          kimliğini taşımaya gerek yok.
 *
 * ── PATRON HER KAPIDAN MUAF ────────────────────────────────────────────────
 * Dördü de patronu es geçer. Aksi hâlde kendi kurduğu kapının arkasında kalır
 * ve onaylayacak kimse olmaz — özellikle ölü adam anahtarında bu, sistemi
 * kalıcı olarak kapatmak demekti.
 *
 * ── BAYRAK KAPALIYKEN SIFIR SORGU ──────────────────────────────────────────
 * `ACCESS_GATES_ENABLED` kapalıyken ilk satırda `{ ok: true }` döner: HAK61 ve
 * Sendigo'da tek sorgu bile atılmaz, giriş akışı bugünküyle birebir aynı.
 *
 * ── MIGRATION YOKSA KAPI AÇIK ──────────────────────────────────────────────
 * Bayrak açık ama 046 çalıştırılmamışsa tablolar yoktur; her okuma kendi
 * try/catch'inde ve hepsi GİRİŞE İZİN VEREREK düşer. Bir kapı, kurulum eksik
 * diye tüm kadroyu dışarıda bırakamaz.
 */

export type AccessGate = "kill" | "hours" | "country" | "device";

/** Oturum kurulmadan reddedilen kapılar. */
export type RejectGate = "kill" | "hours";
/** Oturum kurulup /erisim'de bekletilen kapılar. */
export type PendingGate = "device" | "country";

/**
 * AYRIK BİRLEŞİM — "hangi kapı hangi modda olabilir" kuralı TİPTE yazılı.
 *
 * `mode` ile `gate`i tek bir nesnede tutsaydık `{mode:"pending", gate:"kill"}`
 * gibi anlamsız bir değer tip denetiminden geçerdi ve çağıran taraf onu
 * `session.access_gate`e yazmaya çalışırdı. Nitekim ilk yazımda tam olarak bu
 * oldu: tsc `'kill' is not assignable to '"device" | "country"'` diye kırdı.
 * Kuralı yoruma yazmak yerine tipe yazmak, o hatayı imkânsız kılar.
 */
export type AccessVerdict =
  | { ok: true }
  | { ok: false; mode: "reject"; gate: RejectGate; detail?: string }
  | { ok: false; mode: "pending"; gate: PendingGate; detail?: string };

const IZIN: AccessVerdict = { ok: true };

// ─────────────────────────────────────────────────────────────────────────────
// SAAT
// ─────────────────────────────────────────────────────────────────────────────

/** Şu anın Europe/Istanbul'daki "HH:MM" karşılığı. */
function simdiHHMM(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

/** DB `time` kolonu "07:00:00" döner; "07:00"a indirger. Geçersizse null. */
function hhmm(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{2}):(\d{2})/.exec(v.trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

/**
 * Aralık içinde miyiz? Gece devreden aralık (22:00-06:00) DESTEKLENİR:
 * start > end ise aralık gece yarısını sarar.
 */
export function saatIcinde(now: string, start: string, end: string): boolean {
  if (start === end) return true; // sıfır uzunluk = kısıt yok say
  return start < end
    ? now >= start && now < end
    : now >= start || now < end; // gece yarısını saran aralık
}

// ─────────────────────────────────────────────────────────────────────────────
// DEĞERLENDİRME
// ─────────────────────────────────────────────────────────────────────────────

type WorkerGateRow = {
  allowed_countries: string[] | null;
  access_hours_start: string | null;
  access_hours_end: string | null;
  /** Migration 048 — kapı 1/2/3'ten muaf. Kapı 4'ü (anahtar) ETKİLEMEZ. */
  gate_exempt: boolean | null;
};

/** Kapı kolonlarını okur. Kolonlar yoksa (046 yok) null döner → kısıt yok. */
async function readWorkerGates(workerId: string): Promise<WorkerGateRow | null> {
  const { data, error } = await supabaseAdmin
    .from("workers")
    .select("allowed_countries, access_hours_start, access_hours_end, gate_exempt")
    .eq("id", workerId)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as WorkerGateRow;
}

/**
 * Bekleyen onay satırını açar (varsa dokunmaz).
 *
 * `pending` bir satır zaten varsa YENİSİ AÇILMAZ — tekil indeks bunu şemada da
 * zorluyor. Aksi hâlde her giriş denemesi patron ekranına yeni bir satır atardı.
 * `denied` bir satır varsa da yeniden `pending`e ÇEVRİLMEZ: reddedilen bir
 * cihaz, tekrar denemekle onaya dönmemeli.
 */
async function ensureDeviceRequest(
  workerId: string,
  ctx: ReturnType<typeof readRequestContext>
): Promise<"approved" | "pending" | "denied"> {
  const { data, error } = await supabaseAdmin
    .from("device_approvals")
    .select("status")
    .eq("worker_id", workerId)
    .eq("device_hash", ctx.deviceHash)
    .maybeSingle();
  // Tablo yok → kapı açık (migration beklemede).
  if (error && /device_approvals/.test(error.message ?? "")) return "approved";
  if (error) return "approved";

  const mevcut = (data?.status as string | undefined) ?? null;
  if (mevcut === "approved") return "approved";
  if (mevcut === "denied") return "denied";
  if (mevcut === "pending") return "pending";

  await supabaseAdmin.from("device_approvals").insert({
    worker_id: workerId,
    device_hash: ctx.deviceHash,
    first_ip: ctx.ip,
    first_city: ctx.city,
    first_country: ctx.country,
    user_agent: ctx.userAgent,
  });
  return "pending";
}

async function ensureCountryRequest(
  workerId: string,
  country: string
): Promise<"approved" | "pending" | "denied"> {
  const { data, error } = await supabaseAdmin
    .from("country_approvals")
    .select("status")
    .eq("worker_id", workerId)
    .eq("country", country)
    .maybeSingle();
  if (error) return "approved"; // tablo yok / hata → kapı açık

  const mevcut = (data?.status as string | undefined) ?? null;
  if (mevcut === "approved") return "approved";
  if (mevcut === "denied") return "denied";
  if (mevcut === "pending") return "pending";

  await supabaseAdmin
    .from("country_approvals")
    .insert({ worker_id: workerId, country });
  return "pending";
}

/**
 * DÖRT KAPIYI SIRAYLA DEĞERLENDİRİR.
 *
 * `h` istek başlıkları: sunucu action'ında `await headers()`, route handler'da
 * `req.headers`. Kapılar IP/ülke/cihaz izini oradan okur.
 */
export async function evaluateAccess(
  workerId: string,
  h: HeaderBag,
  at: Date = new Date()
): Promise<AccessVerdict> {
  if (!ACCESS_GATES_ENABLED) return IZIN;
  try {
    // Patron dördünden de muaf — kendi kapısının arkasında kalmasın.
    if (await isOwnerWorker(workerId)) return IZIN;

    // ── KAPI 4 (önce): ölü adam anahtarı ────────────────────────────────
    if (await isKillSwitchActive()) {
      return { ok: false, mode: "reject", gate: "kill" };
    }

    const ctx = readRequestContext(h);
    const kisi = await readWorkerGates(workerId);

    // ── MUAFİYET (migration 048) — SIRA BURADA, TESADÜFİ DEĞİL ──────────
    // Ölü adam anahtarından SONRA, diğer üç kapıdan ÖNCE geliyor. Yani muaf
    // kişi yeni cihazdan, herhangi bir ülkeden ve saat dışında girebilir; ama
    // anahtar çekilmişse O DA DÜŞER. Muafiyet anahtarın önüne geçseydi
    // "sistemi kapat" düğmesi, kapattığını sandığın ama birkaç kişinin içeride
    // kaldığı bir düğmeye dönerdi — acil durum aracı olmaktan çıkardı.
    //
    // ⚠️ Muafiyet GÖRÜNÜRLÜK VERMEZ: bu kişi /admin/guvenlik'i açamaz
    // (requireOwner) ve patronu personel listelerinde göremez (045 ayrı eksen).
    if (kisi?.gate_exempt === true) return IZIN;

    // ── KAPI 3: saat kilidi ─────────────────────────────────────────────
    const bas = hhmm(kisi?.access_hours_start) ?? ACCESS_HOURS_START;
    const bit = hhmm(kisi?.access_hours_end) ?? ACCESS_HOURS_END;
    // Kişide İKİSİ DE null ise kiracı varsayılanı geçerlidir; kişi bazında
    // yalnız biri doluysa diğer uç yine varsayılandan gelir.
    if (!saatIcinde(simdiHHMM(at), bas, bit)) {
      return { ok: false, mode: "reject", gate: "hours", detail: `${bas}–${bit}` };
    }

    // ── KAPI 2: ülke onayı ──────────────────────────────────────────────
    // Başlık yoksa (yerel geliştirme / Vercel dışı) ülke DENETLENMEZ.
    const ulke = (ctx.country ?? "").trim().toUpperCase();
    if (ulke) {
      const serbest = kisi?.allowed_countries ?? ACCESS_COUNTRIES;
      if (!serbest.map((c) => c.toUpperCase()).includes(ulke)) {
        const durum = await ensureCountryRequest(workerId, ulke);
        if (durum !== "approved") {
          return { ok: false, mode: "pending", gate: "country", detail: ulke };
        }
      }
    }

    // ── KAPI 1: cihaz onayı ─────────────────────────────────────────────
    const cihaz = await ensureDeviceRequest(workerId, ctx);
    if (cihaz !== "approved") {
      return { ok: false, mode: "pending", gate: "device" };
    }

    return IZIN;
  } catch {
    // Kapı değerlendirilemedi → GİRİŞE İZİN. Bir altyapı hatası kadroyu
    // kapı dışında bırakmamalı (bkz. dosya başlığı).
    return IZIN;
  }
}

/**
 * Bekleme ekranındaki "… onayında" satırı için patron adı.
 *
 * ELLE İSİM YAZILMAZ — küme is_owner bayrağından türetilir (lib/driver-scope.ts
 * ile aynı kural). Patron yoksa ya da okunamazsa null döner ve ekran adsız
 * ama anlaşılır bir metin gösterir.
 */
export async function ownerDisplayName(): Promise<string | null> {
  if (!ACCESS_GATES_ENABLED) return null;
  try {
    // owner-visible: bekleme ekranı BİLEREK patronun adını gösterir — kullanıcı
    // kime başvuracağını bilmeli. Görünmezlik kuralı (045) personel
    // LİSTELERİ içindir, "onay merciini söyle" mesajı için değil.
    const { data, error } = await supabaseAdmin
      .from("workers")
      .select("name")
      .eq("is_owner", true)
      .order("name")
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return (data.name as string) ?? null;
  } catch {
    return null;
  }
}
