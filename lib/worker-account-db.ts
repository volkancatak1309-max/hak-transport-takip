import "server-only";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { assertOwnerWritable } from "@/lib/owner-scope";
import { adminSetPinSchema } from "@/lib/validation";
import { bumpTokenVersion } from "@/lib/mobile-auth";
import { auditChange } from "@/lib/audit-change";

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
