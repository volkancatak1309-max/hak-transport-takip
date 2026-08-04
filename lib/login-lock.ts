import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { canonicalPhone } from "@/lib/phone";

/**
 * GİRİŞ KİLİDİ — eşikler ve kilidin okunup temizlenmesi. TEK KAYNAK.
 *
 * Mekanizma app/actions/auth.ts'te yaşıyordu ve orada kalmalıydı; buraya taşınan
 * yalnız İKİ TARAFIN DA bilmesi gereken kısım: eşik sabitleri, kademe merdiveni
 * ve `login_attempts.identifier`'ın ŞEKLİ. Yönetici panelindeki "Giriş kilidini
 * kaldır" düğmesi kilidi bulmak için o şekli bilmek zorunda; iki dosyada iki
 * ayrı kopya olsaydı biri değişip diğeri kalırdı ve düğme sessizce yanlış satırı
 * silerdi (ya da hiç bulamazdı).
 *
 * ── 04.08.2026 AYARI — koruma DURUYOR, can sıkma gidiyor ───────────────────
 * Canlıda yönetici DOĞRU PIN'i bildiği hâlde giremedi ve kilit elle temizlendi
 * (delete from login_attempts). Sebep ölçüldü: eşik 5 denemeydi ve taban kilit
 * 30 saniyeydi — ama merdiven her yeni hatada tırmandığı için 6. denemede 60
 * saniyeye çıkıyordu. Parmak kayması ve yanlış numara denemesi 5 hakkı hızla
 * tüketiyor.
 *
 * ÖNCESİ:  eşik 5  · merdiven [30s, 60s, 5dk, 15dk, 1sa]
 * SONRASI: eşik 10 · merdiven [15s, 60s, 5dk, 15dk, 1sa]
 *
 * Merdivenin ÜST basamaklarına dokunulmadı ve dokunulmamalı: asıl koruma orada.
 * 6 haneli PIN uzayı 10^6; 10 deneme + tırmanan kilitle çevrimiçi tahmin hâlâ
 * uygulanamaz. Değişen tek şey, gerçek kullanıcının ilk hatasının bedeli.
 * Bu bir müşteri ayarı DEĞİLDİR (env yok, lib/tenant.ts'e girmez): güvenlik
 * eşiği her kurulumda aynı olmalı.
 */

/** Kilit bu sayıda başarısız denemeden SONRA devreye girer. */
export const MAX_FAILURES = 10;

/** Bu süre boyunca yeni hata gelmezse sayaç sıfırlanır. */
export const ATTEMPT_WINDOW_MS = 30 * 60 * 1000;

/**
 * Kademeli kilit: eşiğe ulaşan ilk hata 15 sn, sonraki her hata bir üst basamak.
 * Taban 15 sn — bir insanın PIN'i doğru yazmak için beklemeye razı olacağı süre;
 * bir betiğin 10^6 anahtarı taraması için hâlâ imkânsız.
 */
export const LOCK_STEPS_MS = [
  15_000,
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
] as const;

export function lockMs(failures: number): number {
  const i = Math.min(
    Math.max(failures - MAX_FAILURES, 0),
    LOCK_STEPS_MS.length - 1
  );
  return LOCK_STEPS_MS[i];
}

/**
 * `login_attempts.identifier` = "<ip>|<kanonik telefon>".
 *
 * IP ile birlikte anahtarlanır: aksi hâlde saldırgan başka bir ağdan gerçek bir
 * şoförü kilitleyebilirdi. Telefon KANONİK biçimde girer (lib/phone.ts) — aynı
 * numaranın "+43660…" ve "+430660…" yazımları tek sayaçta toplanır, ayrı ayrı
 * hak kazanmaz. Kilidi ARAMANIN tek yolu bu olduğundan (IP bilinmiyor) sorgular
 * son ekten eşleşir: `identifier LIKE '%|<kanonik>'`.
 */
export function lockIdentifier(ip: string, rawPhone: string): string {
  return `${ip}|${canonicalPhone(rawPhone)}`;
}

/** Bir telefona ait TÜM kilit satırlarının LIKE kalıbı (IP'den bağımsız). */
function suffixPattern(rawPhone: string): string {
  return `%|${canonicalPhone(rawPhone)}`;
}

export type LoginLockState = {
  /** Şu an gerçekten kilitli mi (geleceğe dönük locked_until var mı). */
  locked: boolean;
  /** En geç biten kilidin sonu (ISO) — kilitli değilse null. */
  lockedUntil: string | null;
  /** Kalan saniye; kilitli değilse 0. */
  retryAfter: number;
  /** Bu telefon için kayıtlı en yüksek başarısız deneme sayısı. */
  attempts: number;
  /** Kaç ayrı IP'den kilit/deneme kaydı var (temizlenecek satır sayısı). */
  rows: number;
};

const EMPTY: LoginLockState = {
  locked: false,
  lockedUntil: null,
  retryAfter: 0,
  attempts: 0,
  rows: 0,
};

/**
 * Bir çalışanın giriş kilidi durumu. Yönetici panelinde düğmenin GÖRÜNÜP
 * görünmeyeceğini bu belirler — kilit yoksa düğme hiç basılmaz, boşuna durmaz.
 *
 * Hata durumunda EMPTY döner: tablo okunamıyorsa "kilitli değil" varsayılır ve
 * personel sayfası çalışmaya devam eder (düğme çıkmaz). Kilidin KENDİSİ giriş
 * akışında ayrıca kontrol ediliyor; buradaki okuma yalnız gösterim içindir.
 */
export async function getLoginLockState(
  rawPhone: string | null | undefined
): Promise<LoginLockState> {
  if (!rawPhone) return EMPTY;
  const { data, error } = await supabaseAdmin
    .from("login_attempts")
    .select("identifier, attempts, locked_until")
    .like("identifier", suffixPattern(rawPhone));
  if (error || !data || data.length === 0) return EMPTY;

  const rows = data as {
    identifier: string;
    attempts: number | null;
    locked_until: string | null;
  }[];
  const now = Date.now();
  let until = 0;
  for (const r of rows) {
    if (!r.locked_until) continue;
    const t = new Date(r.locked_until).getTime();
    if (t > now && t > until) until = t;
  }
  return {
    locked: until > 0,
    lockedUntil: until > 0 ? new Date(until).toISOString() : null,
    retryAfter: until > 0 ? Math.ceil((until - now) / 1000) : 0,
    attempts: rows.reduce((m, r) => Math.max(m, r.attempts ?? 0), 0),
    rows: rows.length,
  };
}

/**
 * Bir çalışanın kilidini kaldırır: o telefona ait TÜM `login_attempts` satırları
 * silinir (hangi IP'den denenmiş olursa olsun). Silinen satır sayısını döner.
 *
 * Sayaç da sıfırlanır, yalnız `locked_until` değil: aksi hâlde kilidi açılan
 * kişi bir sonraki hatasında merdivenin ORTASINDAN devam eder ve düğme işe
 * yaramamış gibi görünürdü.
 */
export async function clearLoginLock(
  rawPhone: string | null | undefined
): Promise<number> {
  if (!rawPhone) return 0;
  const { data, error } = await supabaseAdmin
    .from("login_attempts")
    .delete()
    .like("identifier", suffixPattern(rawPhone))
    .select("identifier");
  if (error || !data) return 0;
  return data.length;
}
