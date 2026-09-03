import "server-only";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { loginSchema, loginPinSchema } from "@/lib/validation";
import { phoneVariants } from "@/lib/phone";
import { DRIVER_PANEL_ENABLED } from "@/lib/tenant";
import {
  MAX_FAILURES,
  ATTEMPT_WINDOW_MS,
  lockMs,
  lockIdentifier,
} from "@/lib/login-lock";

/**
 * GİRİŞ ÇEKİRDEĞİ — kimlik bilgisi doğrulamanın TEK KAYNAĞI.
 *
 * Bu kod app/actions/auth.ts içinde, dışa aktarılmamış yardımcılar olarak
 * yaşıyordu. Mobil giriş ucu (app/api/mobile/auth/login) aynı kuralı işletmek
 * zorunda: aynı PIN karşılaştırması, aynı kilit merdiveni, aynı zamanlama
 * koruması, aynı kiracı kapısı. İkinci bir kopya çıkarsaydı eşik bir tarafta
 * değişip diğerinde kalır ve mobil, tarayıcıdan daha gevşek bir kapı olurdu.
 *
 * BURAYA TAŞINIRKEN DAVRANIŞ DEĞİŞMEDİ — adım sırası, hata sınıfları ve kilit
 * yazma anları birebir korundu. Değişen tek şey, IP'nin artık PARAMETRE olarak
 * gelmesi: `next/headers` yalnız server action'da çalışır, route handler kendi
 * `req.headers`'ını verir. Çekirdek böylece her iki çağırma biçiminden bağımsız.
 *
 * Çekirdeğin YAPMADIĞI şey: oturum açmak. Çerez yazmak (iron-session) tarayıcı
 * yolunun, token üretmek (lib/mobile-auth.ts) mobil yolun işi. Çekirdek yalnız
 * "bu telefon+PIN geçerli mi, bu kişi girebilir mi" sorusunu cevaplar.
 */

// A fixed valid bcrypt hash compared against when the phone is unknown or the
// account is inactive, so a failed login takes ~the same time regardless of
// which case it is. Closes timing-based account enumeration. Its plaintext is
// irrelevant — the compare is only there to burn equivalent CPU.
const DUMMY_PIN_HASH =
  "$2b$10$Qvy2kwozHmqx5Uv2kbISjuV0Dy00KwKR0mbfKIM7G/qiOqdcOFMgC";

/**
 * Çekirdeğin `workers`'tan okuduğu alanlar.
 *
 * `counts_as_driver` eklendi (mobil yanıtı bunu taşıyor). Güvenli: migration 041
 * iki canlı müşteride de uygulanmış ve kolon kurulum SQL'inde de var
 * (db/install/*-full.sql), yani her kurulum yolunda mevcut.
 *
 * `token_version` ise BİLEREK burada YOK: migration 044 HENÜZ ÇALIŞTIRILMADI ve
 * olmayan bir kolonu istemek bu sorguyu tümden hataya düşürüp TARAYICI GİRİŞİNİ
 * kırardı. Mobil taraf sürümü ayrıca ve kolon-yokluğuna dayanıklı biçimde okur
 * (lib/mobile-auth.ts → readTokenVersion).
 */
const WORKER_COLUMNS =
  "id, name, phone, pin_hash, plate, is_admin, is_active, must_change_pin, counts_as_driver";

export type AuthWorker = {
  id: string;
  name: string;
  phone: string;
  pin_hash: string;
  plate: string | null;
  is_admin: boolean;
  is_active: boolean;
  must_change_pin: boolean | null;
  counts_as_driver: boolean | null;
};

/**
 * TELEFON → KAYIT eşleştirmesi. **TEK KAYNAK.**
 *
 * Giriş (`verifyCredentials`) ve kiracı sorgusu ucu
 * (`/api/mobile/kiraci-sorgu`) AYNI eşleştirmeyi kullanmak ZORUNDA. İkisi ayrı
 * yazılsaydı biri `phoneVariants`i, öteki düz `eq("phone")`yi kullanır ve
 * "sorguda var, girişte yok" durumu doğardı: yönlendirme kullanıcıyı doğru
 * kiracıya gönderir, o kiracı da "telefon veya PIN hatalı" derdi. Kullanıcı
 * için bu, hiç yönlendirilmemekten daha kötüdür — hangi kapının kapalı olduğunu
 * bile göremez.
 *
 * ⚠️ KOLON LİSTESİ ÇAĞIRANDAN GELİR, eşleştirme buradan. Sorgu ucu `pin_hash`
 * OKUMAZ; hash'i hiç çekmemek, çekip atmaktan iyidir (ileride eklenecek bir
 * teşhis logu onu basamaz).
 *
 * `.limit(2)` ve ilk satırın alınması bilinçli: `workers.phone` tabloda UNIQUE
 * ama VARYANTLAR unique değildir — aynı kişi "+43660…" ve "+430660…" olarak iki
 * satırda durabilir. Böyle bir kurulumda sorgu iki satır döner; ikisi de aynı
 * kişidir ve ilkini almak doğru cevabı verir.
 */
export async function findWorkerByPhone(
  rawPhone: string,
  columns: string
): Promise<{ ok: true; row: Record<string, unknown> | null } | { ok: false }> {
  const { data, error } = await supabaseAdmin
    .from("workers")
    .select(columns)
    .in("phone", phoneVariants(rawPhone))
    .limit(2);
  if (error) return { ok: false };
  // `unknown` üzerinden: kolon listesi ÇALIŞMA ANINDA geldiği için supabase-js
  // satır tipini çıkaramıyor ve `GenericStringError` varsayıyor. Tip güvenliği
  // çağıranda kuruluyor (AuthWorker / iki bayrak) — burada dar bir kaçış.
  const row = (data?.[0] ?? null) as unknown as Record<string, unknown> | null;
  return { ok: true, row };
}

/**
 * KİMLİK KAPISI — "bu hesap bu kurulumda giriş yapabilir mi", PIN'den BAĞIMSIZ.
 *
 * İki koşul da KURULUMA ait KALICI olgulardır, o anki oturuma değil:
 *   • `is_active`  — hesap kapatılmışsa hiçbir PIN açmaz.
 *   • şoför paneli — kapalı kiracıda (Sendigo) şoförün gideceği yer yoktur;
 *     kayıtları AZG/vardiya raporu için durur ama panele/mobile giremez.
 *
 * BURAYA GİRMEYENLER (bilinçli): erişim kapıları 046 — cihaz onayı, ülke,
 * saat aralığı, ölü adam anahtarı. Onlar OTURUM ekseninde ve o AN'a bağlı;
 * kimlik "bu numara buraya ait mi" sorusunun cevabını değiştirmezler. Kiracı
 * sorgusu ucu bu ayrımın üstüne kuruludur (bkz. docs/KIRACI-SORGU-UCU.md § 5).
 *
 * Tek fonksiyon olmasının sebebi: kural iki yerde işletiliyor (giriş + sorgu
 * ucu) ve biri değişip öteki kalırsa kullanıcı sonsuz döngüye düşer —
 * yönlendirme "buraya git" der, giriş "sen kimsin" der.
 * `scripts/check-kiraci-sorgu.mjs` iki tarafın da bunu çağırdığını denetler.
 */
export function workerCanSignIn(w: {
  is_active: boolean;
  is_admin: boolean;
}): boolean {
  return w.is_active === true && (DRIVER_PANEL_ENABLED || w.is_admin === true);
}

export type CredentialResult =
  | { ok: true; worker: AuthWorker }
  | {
      ok: false;
      reason: "validation" | "db" | "invalid" | "locked";
      /** Yalnız reason === "locked": kalan saniye. */
      retryAfter?: number;
      /** Yalnız reason === "locked": kilidin bitiş anı (ISO). */
      lockedUntil?: string;
    };

/** `x-forwarded-for` / `x-real-ip` başlıklarından çağıranın IP'si. */
export function clientIpFromHeaders(h: {
  get(name: string): string | null;
}): string {
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

/**
 * Records a failed attempt and (re)arms the lock if the threshold is crossed.
 *
 * Kilidi KURAN denemenin sonucunu da döner (`lockedUntil`): eskiden bu deneme
 * düz "hatalı PIN" cevabı alıyordu, kilit ancak BİR SONRAKİ denemede fark
 * ediliyordu. Kullanıcı için bu "PIN'i yanlış yazdım" ile "artık kilitliyim"
 * arasındaki farkı görünmez kılıyordu; sayaç da bir deneme geç başlıyordu.
 * Bilgi sızıntısı yok: kilit ip|phone üzerinde tutulur ve numara kayıtlı olsa
 * da olmasa da aynı şekilde kurulur.
 */
async function registerFailure(
  identifier: string
): Promise<{ attempts: number; lockedUntil: string | null }> {
  const { data: row } = await supabaseAdmin
    .from("login_attempts")
    .select("attempts, last_attempt_at")
    .eq("identifier", identifier)
    .maybeSingle();

  const now = Date.now();
  const stale =
    !!row?.last_attempt_at &&
    now - new Date(row.last_attempt_at).getTime() > ATTEMPT_WINDOW_MS;
  const attempts = (stale ? 0 : row?.attempts ?? 0) + 1;
  const nowIso = new Date(now).toISOString();
  const lockedUntil =
    attempts >= MAX_FAILURES
      ? new Date(now + lockMs(attempts)).toISOString()
      : null;

  await supabaseAdmin.from("login_attempts").upsert(
    {
      identifier,
      attempts,
      last_attempt_at: nowIso,
      locked_until: lockedUntil,
    },
    { onConflict: "identifier" }
  );
  return { attempts, lockedUntil };
}

/** Başarısız denemenin dönen hâli: kilit kurulduysa geri sayımla. */
function failureResult(res: { lockedUntil: string | null }): CredentialResult {
  if (!res.lockedUntil) return { ok: false, reason: "invalid" };
  const remainingMs = new Date(res.lockedUntil).getTime() - Date.now();
  if (remainingMs <= 0) return { ok: false, reason: "invalid" };
  return {
    ok: false,
    reason: "locked",
    retryAfter: Math.ceil(remainingMs / 1000),
    lockedUntil: res.lockedUntil,
  };
}

async function clearFailures(identifier: string): Promise<void> {
  await supabaseAdmin.from("login_attempts").delete().eq("identifier", identifier);
}

/**
 * Telefon + PIN doğrular. Kilit sayacını okur, günceller ve başarıda temizler.
 *
 * Adım sırası güvenliğin parçası, değiştirilmemeli:
 *  1) şema doğrulaması  2) kilit kapısı (bcrypt'ten ÖNCE — kilitliyken CPU
 *  yakılmaz)  3) kayıt arama  4) TEK bcrypt karşılaştırması (kayıt yoksa dummy
 *  hash ile — zamanlama üzerinden hesap sayımı kapalı)  5) kiracı kapısı.
 */
export async function verifyCredentials(input: {
  phone: unknown;
  pin: unknown;
  ip: string;
}): Promise<CredentialResult> {
  const parsed = loginSchema.safeParse({ phone: input.phone, pin: input.pin });
  if (!parsed.success) return { ok: false, reason: "validation" };

  // Kilit sayacı kanonik numaraya bağlanır: aynı şoförün "+43660…" ve
  // "+430660…" yazımları tek bir sayaçta toplanır, ayrı ayrı hak kazanmaz.
  // Kimliğin biçimi lib/login-lock.ts'te — kilidi kaldıran yönetici eylemi
  // satırı aynı şekle göre buluyor.
  const identifier = lockIdentifier(input.ip, parsed.data.phone);

  // Locked out? Reject before any DB lookup or bcrypt work.
  const { data: gate } = await supabaseAdmin
    .from("login_attempts")
    .select("locked_until")
    .eq("identifier", identifier)
    .maybeSingle();
  if (gate?.locked_until) {
    const remainingMs = new Date(gate.locked_until).getTime() - Date.now();
    if (remainingMs > 0) {
      return {
        ok: false,
        reason: "locked",
        retryAfter: Math.ceil(remainingMs / 1000),
        lockedUntil: gate.locked_until as string,
      };
    }
  }

  // Tek bir `eq` yerine varyant listesi: workers.phone alanında Avusturya
  // ulusal trunk sıfırı bazı kayıtlarda var ("+430660…"), bazılarında yok
  // ("+43660…"). Şoför hangisini yazarsa yazsın kaydı bulmalı. Eşleştirme
  // `findWorkerByPhone`ta — kiracı sorgusu ucu de AYNI fonksiyonu çağırıyor.
  const found = await findWorkerByPhone(parsed.data.phone, WORKER_COLUMNS);
  if (!found.ok) return { ok: false, reason: "db" };
  const worker = found.row as AuthWorker | null;

  // Always run exactly one bcrypt compare — against the real hash, or a dummy
  // when the phone is unknown — so timing doesn't reveal whether the phone
  // exists. Unknown phone, inactive account and wrong PIN ALL return the same
  // generic "invalid": no account enumeration.
  const pinOk = await bcrypt.compare(
    parsed.data.pin,
    worker?.pin_hash ?? DUMMY_PIN_HASH
  );

  // ÜÇ RET SEBEBİ TEK DALDA — ve bu bilinçli. Bilinmeyen telefon, pasif hesap,
  // yanlış PIN ve "şoför paneli kapalı müşteride şoför" (Sendigo) AYNI cevabı
  // alır: "invalid". Ayrıştırmak, "bu telefon kayıtlı ama yetkisiz" demek olurdu
  // ve hesap sayımına (account enumeration) kapı açardı — yukarıdaki dummy-hash
  // düzeneğinin tamamı bunu önlemek için var.
  //
  // Kurulum kapısı artık `workerCanSignIn`da: kiracı sorgusu ucu de AYNI
  // yordamı çağırıyor, böylece "sorgu evet der, giriş hayır der" durumu
  // yapısal olarak imkânsız (bkz. scripts/check-kiraci-sorgu.mjs).
  //
  // ⚠️ SIRA KORUNDU: bcrypt karşılaştırması kapıdan ÖNCE ve HER YOLDA tam bir
  // kez koşar. Kapıyı öne almak, panele kapalı bir kiracıda "kayıtlı numara"yı
  // hızlı cevapla ele verirdi.
  if (!worker || !pinOk || !workerCanSignIn(worker)) {
    return failureResult(await registerFailure(identifier));
  }

  await clearFailures(identifier);
  return { ok: true, worker };
}

/**
 * KENDİ PIN'İNİ DOĞRULAR — "bu oturumun sahibi mevcut PIN'i biliyor mu".
 *
 * ═══ NEDEN BURADA, KENDİ DOSYASINDA DEĞİL ═══════════════════════════════════
 *
 * `POST /api/mobile/me/pin` mevcut PIN'i soruyor ve bu, girişten SONRA gelen
 * ikinci bir PIN kapısıdır. Kendi sayacını kursaydı ortaya GİRİŞTEN GEVŞEK bir
 * kapı çıkardı: çalınmış bir access token'la sınırsız PIN denemesi yapılabilir,
 * yani token hırsızlığı PIN hırsızlığına yükseltilebilirdi. Bu yüzden kapı
 * girişin KENDİ sayacını kullanır — `login_attempts`, aynı `identifier`, aynı
 * `MAX_FAILURES`, aynı `LOCK_STEPS_MS` merdiveni. Sayaç ortaktır: giriş
 * ekranında yapılan hatalarla uygulama içinde yapılanlar TEK havuzda toplanır.
 *
 * `registerFailure` / `failureResult` / `clearFailures` bu dosyada dışa
 * aktarılmamış yardımcılar. Onları export etmek yerine kapıyı buraya koymak
 * bilinçli: dışarı açılan her yardımcı, ileride başka bir yerde YARIM bir
 * merdiven kurulmasının davetidir.
 *
 * ── MEVCUT PIN'E `loginPinSchema` UYGULANIR, `pinSchema` DEĞİL ─────────────
 * Kullanıcının BUGÜNKÜ PIN'i eski 4 haneli olabilir (bkz. loginPinSchema notu).
 * Katı şemayı mevcut PIN'e uygulamak, tam da yeni PIN'e geçmek isteyen o
 * kullanıcıyı kapıda çevirirdi. Katı kural YENİ PIN'e uygulanır — orası
 * `changePinSchema`nın işi ve o kural panelle ortaktır.
 *
 * ── ZAMANLAMA ──────────────────────────────────────────────────────────────
 * `verifyCredentials`teki dummy-hash düzeneği BURADA GEREKMİYOR: kimlik zaten
 * token'dan çözülmüş, "bu hesap var mı" sorusu sorulmuyor. Yine de kayıt
 * okunamazsa dummy ile bir karşılaştırma koşulur — hesap silinmiş/okunamıyorken
 * cevabın anında dönmesi gereksiz bir sinyaldir.
 */
export type OwnPinResult =
  | { ok: true; phone: string; pinHash: string }
  | {
      ok: false;
      reason: "validation" | "db" | "invalid" | "locked";
      retryAfter?: number;
      lockedUntil?: string;
    };

export async function verifyOwnPin(input: {
  workerId: string;
  pin: unknown;
  ip: string;
}): Promise<OwnPinResult> {
  const parsed = loginPinSchema.safeParse(input.pin);
  if (!parsed.success) return { ok: false, reason: "validation" };

  // Telefon SAYACIN ANAHTARI olduğu için önce okunur: kilit kimliği
  // ip|telefon biçiminde (lib/login-lock.ts) ve giriş yolu da aynı satıra
  // yazıyor. worker_id ile anahtarlamak ikinci bir sayaç kurmak olurdu.
  const { data, error } = await supabaseAdmin
    .from("workers")
    .select("phone, pin_hash")
    .eq("id", input.workerId)
    .maybeSingle();
  if (error) return { ok: false, reason: "db" };

  const phone = (data?.phone as string | undefined) ?? "";
  const hash = (data?.pin_hash as string | undefined) ?? DUMMY_PIN_HASH;

  // Telefonu olmayan kayıt sayaca bağlanamaz. Bu kurulumda olamaz
  // (workers.phone NOT NULL) ama olursa kapı KAPALI kalır: sayaçsız bir PIN
  // kapısı, merdivensiz bir kapıdır.
  if (!phone) return { ok: false, reason: "db" };

  const identifier = lockIdentifier(input.ip, phone);

  // Kilit kapısı bcrypt'ten ÖNCE — kilitliyken CPU yakılmaz (giriş ile aynı sıra).
  const { data: gate } = await supabaseAdmin
    .from("login_attempts")
    .select("locked_until")
    .eq("identifier", identifier)
    .maybeSingle();
  if (gate?.locked_until) {
    const remainingMs = new Date(gate.locked_until).getTime() - Date.now();
    if (remainingMs > 0) {
      return {
        ok: false,
        reason: "locked",
        retryAfter: Math.ceil(remainingMs / 1000),
        lockedUntil: gate.locked_until as string,
      };
    }
  }

  const pinOk = await bcrypt.compare(parsed.data, hash);
  if (!data || !pinOk) {
    const f = await registerFailure(identifier);
    return failureResult(f) as OwnPinResult;
  }

  await clearFailures(identifier);
  return { ok: true, phone, pinHash: hash };
}
