import "server-only";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { loginSchema } from "@/lib/validation";
import { canonicalPhone, phoneVariants } from "@/lib/phone";
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
  /**
   * ══ GEÇİCİ TEŞHİS (20.08.2026) — İŞ BİTİNCE KALDIRILACAK ══════════════
   *
   * Neden var: şoför girişi GERÇEK TELEFONDA iki kez düştü, oysa aynı gövde
   * `curl` ile 200 dönüyordu. Emülasyon ve masaüstü bu farkı göremiyor;
   * gerçekte uçtan ne geldiğini görmenin başka yolu yok.
   *
   * ⚠️ NE LOGLANIR, NE LOGLANMAZ:
   *   • Telefon ve PIN'in KENDİSİ ASLA loglanmaz.
   *   • Yalnız RAKAM OLMAYAN karakterlerin kodları basılır — görünmez
   *     karakter/boşluk avı için yeter, numarayı ele vermez.
   *   • PIN'den yalnız uzunluk ve "hepsi rakam mı" bilgisi çıkar.
   *   • Kanonik numaradan yalnız SON 4 hane.
   * Kasadaki kural: sırrı koda, kasaya, loga yazma.
   */
  const hamTel = typeof input.phone === "string" ? input.phone : "";
  const hamPin = typeof input.pin === "string" ? input.pin : "";
  const rakamDisi = (v: string) =>
    [...v].map((c, i) => (/\d/.test(c) ? null : `${i}:${c.charCodeAt(0)}`)).filter(Boolean);
  const teshis = (asama: string, ek: Record<string, unknown> = {}) =>
    console.log(
      `[login-teshis] ${asama} | telUzunluk=${hamTel.length} telRakamDisi=${JSON.stringify(rakamDisi(hamTel))}` +
        ` pinUzunluk=${hamPin.length} pinRakamDisi=${JSON.stringify(rakamDisi(hamPin))}` +
        ` ${Object.entries(ek).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")}`
    );

  const parsed = loginSchema.safeParse({ phone: input.phone, pin: input.pin });
  if (!parsed.success) {
    teshis("ZOD-DUSTU", { alanlar: parsed.error.issues.map((i) => i.path.join(".")) });
    return { ok: false, reason: "validation" };
  }

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
  // ("+43660…"). Şoför hangisini yazarsa yazsın kaydı bulmalı. Varyantlar
  // birbirini dışlar (aynı numaranın iki yazımı), bu yüzden en fazla bir
  // kayıt döner; yine de savunmacı biçimde ilki alınır.
  const { data: matches, error } = await supabaseAdmin
    .from("workers")
    .select(WORKER_COLUMNS)
    .in("phone", phoneVariants(parsed.data.phone))
    .limit(2);

  if (error) {
    teshis("DB-HATASI", { mesaj: error.message.slice(0, 60) });
    return { ok: false, reason: "db" };
  }
  const worker = (matches?.[0] ?? null) as AuthWorker | null;
  const kanonik = parsed.data.phone;
  teshis("KAYIT-ARAMA", {
    kanonikSon4: canonicalPhone(kanonik).slice(-4),
    varyantSayisi: phoneVariants(kanonik).length,
    eslesenKayit: matches?.length ?? 0,
    workerAktif: worker?.is_active ?? null,
  });

  // Always run exactly one bcrypt compare — against the real hash, or a dummy
  // when the phone is unknown — so timing doesn't reveal whether the phone
  // exists. Unknown phone, inactive account and wrong PIN ALL return the same
  // generic "invalid": no account enumeration.
  const pinOk = await bcrypt.compare(
    parsed.data.pin,
    worker?.pin_hash ?? DUMMY_PIN_HASH
  );
  const authed = !!worker && worker.is_active && pinOk;
  teshis("PIN-KARSILASTIRMA", { pinOk, kayitVar: !!worker, sonuc: authed });

  if (!authed || !worker) {
    return failureResult(await registerFailure(identifier));
  }

  // ŞOFÖR PANELİ KAPALI MÜŞTERİ (Sendigo): şoförün gideceği bir yer yok.
  // Kayıtları AZG/vardiya raporu için sistemde DURUR — takip araç ekseninde
  // yürür — ama panele giremezler. Hata mesajı bilerek diğerleriyle AYNI
  // ("invalid"): "bu telefon kayıtlı ama yetkisiz" demek hesap sayımına
  // (account enumeration) kapı açardı, yukarıdaki tüm tasarım bunu önlüyor.
  //
  // Mobil uç da aynı kapıdan geçer: mobil, şoför panelinin yerine geçen yüzey
  // olduğu için paneli kapatmış bir kiracıda mobil de şoföre kapalıdır.
  if (!DRIVER_PANEL_ENABLED && !worker.is_admin) {
    return failureResult(await registerFailure(identifier));
  }

  await clearFailures(identifier);
  return { ok: true, worker };
}
