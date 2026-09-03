import "server-only";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { assertOwnerWritable } from "@/lib/owner-scope";
import { adminSetPinSchema, changePinSchema } from "@/lib/validation";
import { bumpTokenVersion, readTokenVersion } from "@/lib/mobile-auth";
import { auditChange } from "@/lib/audit-change";
import { verifyOwnPin } from "@/lib/auth-core";

/**
 * PERSONEL HESABI YAZMA ÇEKİRDEĞİ — panel ve mobil TEK yerden yazar.
 *
 * lib/leave-decision-db.ts, lib/fault-reports-db.ts, lib/fleets-db.ts ile aynı
 * desen: karar ve yazma burada, kimlik doğrulama ve sunum çağıranda.
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * 11.08.2026'da mobil PIN ve pasifleştirme uçları yazıldığında mantık
 * KOPYALANMIŞTI. Sebep teknikti: `app/actions/workers.ts`teki action'lar ilk
 * satırlarında `requireAdmin()` çalıştırıyor ve o kapı yetkisizde `redirect()`
 * FIRLATIYOR (lib/session.ts:167). Mobil istekte oturum çerezi yok — kimlik
 * `Authorization: Bearer` ile geliyor — yani action doğrudan çağrılsaydı her
 * mobil istek 307'ye düşerdi. Kopyanın bedeli açıktı: PIN kuralı değişirse iki
 * yer güncellenmeli, biri unutulursa panel ve telefon FARKLI davranırdı.
 *
 * Çözüm kapıyı mantıktan ayırmak: kapı çağıranda kalır (panelde requireAdmin,
 * mobilde requireMobileAdmin), yazma buraya iner.
 *
 * ── BU DOSYA KİMLİK DOĞRULAMASI YAPMAZ ────────────────────────────────────
 * `aktorId` yalnız İZ ve PATRON KAPISI içindir. "Bu kişi yönetici mi" sorusunu
 * çağıran ZATEN sormuş olmalıdır; burada tekrar sorulmaz. Tek istisna
 * `assertOwnerWritable`: o bir yetki değil, HEDEF kaydın korumasıdır (045) ve
 * her iki çağıranda da aynı noktada duruyordu, bu yüzden çekirdeğe girdi.
 *
 * ── REVALIDATE BURADA DEĞİL ───────────────────────────────────────────────
 * `revalidatePath` bilerek DIŞARIDA: panelin server action'ında olduğu gibi
 * çıplak çağrılması gerekiyor (bugünkü davranış), mobil uçta ise istek bağlamı
 * olmayan koşumlarda fırlayabildiği için try/catch isteniyor. İkisini tek
 * imzada birleştirmek, panelin bugünkü davranışını değiştirirdi.
 */

/** Ortak red sebepleri — çağıran bunları kendi diline çevirir. */
export type HesapHatasi =
  /** Hedef patron kaydı ve aktör patron değil (045). Çağıran "bulunamadı" der. */
  | "owner_protected"
  | "not_found"
  | "write_failed";

// ── PIN ─────────────────────────────────────────────────────────────────────

export type PinSonuc =
  | { ok: true; tokenIptal: boolean }
  | { ok: false; sebep: HesapHatasi | "invalid_pin"; /** zod mesaj anahtarı */ pinKod?: string };

/**
 * YÖNETİCİ BİR ÇALIŞANA YENİ PIN ATAR.
 *
 * Adım sırası `setWorkerPinAction`ın 21.07.2026'dan beri yürüyen sırasının
 * AYNISIDIR ve sıra önemlidir:
 *   1. patron kapısı  — gövde okunmadan önce (kaydın varlığı sızmasın)
 *   2. şema           — adminSetPinSchema (6 hane; 123456 serbest, diğer zayıf
 *                       kalıplar yasak — tek kaynak lib/validation.ts)
 *   3. kayıt var mı
 *   4. bcrypt.hash(pin, 10)
 *   5. yazma
 *   6. token iptali   — eski PIN'le alınmış mobil anahtarlar ölür
 *
 * MEVCUT PIN HİÇBİR ZAMAN OKUNMAZ: `pin_hash` bcrypt'tir. Bu fonksiyon yalnız
 * ÜZERİNE YAZAR ve yeni PIN'i GERİ DÖNDÜRMEZ — çağıran zaten elinde tutuyor,
 * dönüş gövdesine koymak onu loglara sokardı.
 *
 * İZ YOK — action da yazmıyordu (parite). PIN değişimi `auditChange`'e
 * girseydi maskeleme kuralları ayrıca düşünülmeliydi; bu bilinçli bir eksik.
 */
export async function setWorkerPin(
  aktorId: string | null | undefined,
  workerId: string,
  pin: string,
  mustChange: boolean
): Promise<PinSonuc> {
  if (!(await assertOwnerWritable(aktorId, workerId)).ok) {
    return { ok: false, sebep: "owner_protected" };
  }

  const parsed = adminSetPinSchema.safeParse(pin);
  if (!parsed.success) {
    return {
      ok: false,
      sebep: "invalid_pin",
      pinKod: parsed.error.issues[0]?.message ?? "errPin",
    };
  }

  const { data: worker } = await supabaseAdmin
    .from("workers")
    .select("id")
    .eq("id", workerId)
    .maybeSingle();
  if (!worker) return { ok: false, sebep: "not_found" };

  const pin_hash = await bcrypt.hash(parsed.data, 10);

  const { error } = await supabaseAdmin
    .from("workers")
    .update({ pin_hash, must_change_pin: mustChange })
    .eq("id", workerId);
  if (error) return { ok: false, sebep: "write_failed" };

  // Telefonu kaybolan şoför için asıl kurtarma yolu budur: patron PIN'i
  // sıfırlar, kayıp cihazdaki anahtar aynı anda geçersizleşir.
  // Migration 044 yoksa false döner (sessiz no-op DEĞİL — dönüşte görünür).
  const tokenIptal = await bumpTokenVersion(workerId);
  return { ok: true, tokenIptal };
}

// ── AKTİFLİK ────────────────────────────────────────────────────────────────

/**
 * Hedef durum. `"toggle"` mevcut değeri ÇEVİRİR — panelin aç/kapa düğmesinin
 * bugünkü davranışı. Açık boolean idempotenttir ve mobil onu kullanır: iki
 * telefonun aynı düğmeye basması kişiyi geri açmasın.
 */
export type AktiflikHedefi = boolean | "toggle";

export type AktiflikSonuc =
  | {
      ok: true;
      /** false = kayıt zaten hedef durumdaydı; yazma/iptal/iz YAPILMADI. */
      degisti: boolean;
      aktif: boolean;
      ayrilisTarihi: string | null;
      tokenIptal: boolean;
    }
  | { ok: false; sebep: HesapHatasi };

/**
 * ÇALIŞANI PASİFE ALIR ya da GERİ AÇAR (`workers.is_active`).
 *
 * ═══ ⚠️ PASİF ≠ İŞTEN ÇIKIŞ ═══════════════════════════════════════════════
 * Bu fonksiyon `terminated_at`e İŞTEN ÇIKIŞ YAZMAZ ve `terminateWorkerAction`
 * ile İLİŞKİLİ DEĞİLDİR:
 *   • `is_active=false` → GEÇİCİ (hastalık, uzun izin, kayıp telefon)
 *   • `terminated_at`   → KALICI (son çalışma günü, şeflik düşer)
 * Karışırsa Personel listesindeki "Ayrılanlar" bölümü sessizce yanlışa döner.
 *
 * TEK İSTİSNA — GERİ AÇARKEN `terminated_at` TEMİZLENİR (28.07.2026):
 * eskiden yalnız is_active çevriliyor, terminated_at kalıyordu ve HAYALET
 * DURUM doğuyordu ("çalışıyor ama işten çıkmış"). İzin Takvimi o kaydı iki
 * ayrı sorguyla birden yakalıyor, aynı kişi takvimde İKİ SATIR çıkıyordu.
 * Pasife ALIRKEN terminated_at'e DOKUNULMAZ.
 *
 * TOKEN İPTALİ HER İKİ YÖNDE: pasife alınanın telefonu 30 gün açık kalmamalı,
 * geri açılanın ESKİ token'ı da canlanmamalı.
 */
export async function setWorkerActive(
  aktorId: string | null | undefined,
  workerId: string,
  hedef: AktiflikHedefi
): Promise<AktiflikSonuc> {
  if (!(await assertOwnerWritable(aktorId, workerId)).ok) {
    return { ok: false, sebep: "owner_protected" };
  }

  const { data: worker } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_active, terminated_at")
    .eq("id", workerId)
    .maybeSingle();
  if (!worker) return { ok: false, sebep: "not_found" };

  const mevcut = worker.is_active === true;
  const hedefAktif = hedef === "toggle" ? !mevcut : hedef;
  const eskiAyrilis = (worker.terminated_at as string | null) ?? null;

  /**
   * ZATEN HEDEF DURUMDA — yazma YAPILMAZ.
   *
   * `"toggle"` bu dala ASLA giremez (tanım gereği hedef mevcudun tersidir),
   * yani PANELİN yolu değişmez. Yalnız açık boolean veren çağıran (mobil)
   * buraya düşer ve gereksiz bir `bumpTokenVersion` o kişinin telefonundaki
   * oturumu boşuna düşürmemiş olur. auditChange zaten aynı ilkeyi taşıyor:
   * hiçbir alan değişmediyse iz yazmıyor.
   */
  if (mevcut === hedefAktif) {
    return {
      ok: true,
      degisti: false,
      aktif: mevcut,
      ayrilisTarihi: eskiAyrilis,
      tokenIptal: false,
    };
  }

  const patch: Record<string, unknown> = { is_active: hedefAktif };
  if (hedefAktif) patch.terminated_at = null;

  const { error } = await supabaseAdmin
    .from("workers")
    .update(patch)
    .eq("id", workerId);
  if (error) return { ok: false, sebep: "write_failed" };

  const tokenIptal = await bumpTokenVersion(workerId);

  await auditChange(
    aktorId ?? null,
    "update",
    "workers",
    workerId,
    worker as Record<string, unknown> | null,
    { is_active: hedefAktif }
  );

  return {
    ok: true,
    degisti: true,
    aktif: hedefAktif,
    ayrilisTarihi: hedefAktif ? null : eskiAyrilis,
    tokenIptal,
  };
}

// ── KENDİ PIN'İ ─────────────────────────────────────────────────────────────

export type OwnPinSonuc =
  | {
      ok: true;
      /** false → migration 044 yok; DİĞER cihazlardaki anahtarlar ölmedi. */
      tokenIptal: boolean;
      /** İptal sonrası sürüm. Çağıran ÇAĞIRAN CİHAZA yeni token bununla mühürler. */
      tokenSurumu: number | null;
      /** Yönetici hesabı mı — çağıran yeni token'ı bu bayrakla mühürler. */
      isAdmin: boolean;
    }
  | {
      ok: false;
      sebep:
        | "mevcut_pin_gecersiz"
        | "mevcut_pin_hatali"
        | "kilitli"
        | "yeni_pin_gecersiz"
        | "ayni_pin"
        | "not_found"
        | "write_failed";
      /** Yalnız yeni_pin_gecersiz: zod mesaj anahtarı ("errPin" | "errPinWeak" | "errPinMismatch"). */
      pinKod?: string;
      /** Yalnız kilitli. */
      retryAfter?: number;
      lockedUntil?: string;
    };

/**
 * KULLANICI KENDİ PIN'İNİ DEĞİŞTİRİR — mevcut PIN + yeni PIN.
 *
 * ═══ PANELDEKİ KARŞILIĞI VE FARKI ═════════════════════════════════════════
 *
 * Panelde `changePinAction` (app/actions/auth.ts) var ve o mevcut PIN'i
 * SORMUYOR — çünkü tek girildiği yer `/pin` ekranı, yani `must_change_pin`
 * bayrağıyla zorunlu değişim. Orada kullanıcı kimliğini bir adım önce PIN'le
 * kanıtlamış oluyor ve oturum çerezi o kanıtı taşıyor.
 *
 * Mobil YOL FARKLI: access token 15 dakika, refresh token 30 GÜN yaşıyor ve
 * telefon diskinde duruyor. "Ayarlar → PIN değiştir" her an açılabilir. Mevcut
 * PIN sorulmasaydı, çalınmış bir telefon PIN'i değiştirip asıl sahibini kendi
 * hesabından KİLİTLERDİ. Bu yüzden mevcut PIN kapısı eklendi — ve o kapı
 * girişin sayacını kullanıyor (lib/auth-core.ts → verifyOwnPin), kendi sayacını
 * kurmuyor.
 *
 * ── DEĞİŞMEYEN KURALLAR (panelle ORTAK, kopyalanmadı) ─────────────────────
 *   • Yeni PIN  → `changePinSchema` — pinSchema (6 hane + zayıf değil) +
 *     `pin_confirm` eşleşmesi. `adminSetPinSchema` DEĞİL: 123456 istisnası
 *     yalnız YÖNETİCİNİN atadığı geçici PIN içindir, kullanıcı onu kendi
 *     kalıcı PIN'i yapamaz (lib/validation.ts).
 *   • "Aynı PIN"  → reddedilir. Panelde bu `bcrypt.compare(yeni, mevcutHash)`
 *     ile ölçülüyor çünkü orada mevcut PIN BİLİNMİYOR. Burada biliniyor
 *     (kullanıcı yazdı ve doğrulandı), o yüzden düz karşılaştırma AYNI
 *     sonucu verir ve bir bcrypt turu harcamaz.
 *   • `must_change_pin` → false. Zorunlu değişim akışının kapanış adımı.
 *   • `bumpTokenVersion` → panelin `changePinAction`ı da çağırıyor. PIN
 *     değişince eski PIN'le alınmış anahtarlar ölmeli.
 *
 * ── İZ YOK ────────────────────────────────────────────────────────────────
 * `setWorkerPin` ile aynı karar: PIN değişimi `auditChange`e girmiyor
 * (maskeleme kuralları ayrıca düşünülmeli). Bilinçli eksik, parite korunuyor.
 *
 * ── PATRON KAPISI ÇAĞRILMIYOR ─────────────────────────────────────────────
 * `assertOwnerWritable(x, x)` tanım gereği her zaman `ok` döner (owner-scope.ts:201,
 * "kendi kaydına dokunmak serbest"). Çağırmak sorgu bile atmayacaktı ama
 * okuyanı "burada bir kapı var" diye yanıltırdı: kendi PIN'ini değiştirmenin
 * patron korumasıyla İLGİSİ YOK.
 */
export async function changeOwnPin(girdi: {
  workerId: string;
  mevcutPin: unknown;
  yeniPin: unknown;
  yeniPinTekrar: unknown;
  /** Kilit sayacının anahtarı ip|telefon — çağıran istek başlığından çözer. */
  ip: string;
}): Promise<OwnPinSonuc> {
  // 1) MEVCUT PIN — giriş sayacıyla ortak kapı (kilit merdiveni dahil).
  const dogrulama = await verifyOwnPin({
    workerId: girdi.workerId,
    pin: girdi.mevcutPin,
    ip: girdi.ip,
  });
  if (!dogrulama.ok) {
    if (dogrulama.reason === "locked") {
      return {
        ok: false,
        sebep: "kilitli",
        retryAfter: dogrulama.retryAfter,
        lockedUntil: dogrulama.lockedUntil,
      };
    }
    if (dogrulama.reason === "validation") return { ok: false, sebep: "mevcut_pin_gecersiz" };
    if (dogrulama.reason === "db") return { ok: false, sebep: "not_found" };
    return { ok: false, sebep: "mevcut_pin_hatali" };
  }

  // 2) YENİ PIN — panelin `/pin` ekranıyla BİREBİR aynı şema.
  const parsed = changePinSchema.safeParse({
    pin: girdi.yeniPin,
    pin_confirm: girdi.yeniPinTekrar,
  });
  if (!parsed.success) {
    return {
      ok: false,
      sebep: "yeni_pin_gecersiz",
      pinKod: parsed.error.issues[0]?.message ?? "errPin",
    };
  }

  // 3) AYNI PIN — "değiştirdim" diyip aynısını yazmak değişim değildir.
  if (parsed.data.pin === String(girdi.mevcutPin ?? "").trim()) {
    return { ok: false, sebep: "ayni_pin" };
  }

  // 4) YAZMA. `is_admin` de okunur: çağıran yeni token'ı onunla mühürleyecek.
  const { data: worker } = await supabaseAdmin
    .from("workers")
    .select("id, is_admin")
    .eq("id", girdi.workerId)
    .maybeSingle();
  if (!worker) return { ok: false, sebep: "not_found" };

  const pin_hash = await bcrypt.hash(parsed.data.pin, 10);
  const { error } = await supabaseAdmin
    .from("workers")
    .update({ pin_hash, must_change_pin: false })
    .eq("id", girdi.workerId);
  if (error) return { ok: false, sebep: "write_failed" };

  // 5) TOKEN İPTALİ — eski PIN'le alınmış TÜM anahtarlar ölür. Çağıran cihaz
  //    da bunlara dahildir; uç ona yeni sürümle yeni bir çift verir, yoksa
  //    kullanıcı kendi değişikliğiyle kendini dışarı atardı.
  const tokenIptal = await bumpTokenVersion(girdi.workerId);
  const surum = await readTokenVersion(girdi.workerId);

  return {
    ok: true,
    tokenIptal,
    tokenSurumu: surum.status === "ok" ? surum.value : null,
    isAdmin: worker.is_admin === true,
  };
}
