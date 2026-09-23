import "server-only";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * AI ASİSTAN — KİŞİ BAŞINA HIZ SINIRI (v1, 23.09.2026).
 *
 * ═══ NEDEN GEREKLİ ═════════════════════════════════════════════════════════
 *
 * Bu ürünün başka hiçbir ucu bir DIŞ SAĞLAYICIYA para harcamıyor. Asistan
 * harcıyor: her soru Anthropic API'sine gidiyor ve araç döngüsü tek soruda
 * birkaç çağrı yapabiliyor. Sınırsız bir uç, elinde geçerli jetonu olan tek bir
 * kişinin (ya da o jetonu taşıyan hatalı bir istemci döngüsünün) faturayı
 * istediği kadar büyütmesi demektir. Sınır bir kötüye kullanım önlemi değil,
 * öncelikle bir MALİYET TAVANI.
 *
 * ═══ NEDEN YENİ TABLO YOK ══════════════════════════════════════════════════
 *
 * `login_attempts` (migration 012) zaten ÜÇ kiracıda da kurulu ve tam olarak
 * bu şekli taşıyor: `identifier` birincil anahtar, `attempts` sayaç,
 * `first_attempt_at` pencere başlangıcı, `last_attempt_at` tazelik. Yeni bir
 * tablo açmak bir migration, üç kiracıda çalıştırma turu ve `lint:install-sql`
 * güncellemesi demekti — hepsi, var olan bir sayaç tablosunu kullanmamak için.
 *
 * ⚠️ ÇAKIŞMA YOK, VE BU TESADÜF DEĞİL. Giriş yolu satırlarını `<ip>|<telefon>`
 * biçiminde yazıyor ve onları HEP `identifier LIKE '%|<kanonik telefon>'`
 * kalıbıyla arıyor (lib/login-lock.ts `suffixPattern`). Buradaki anahtarda
 * BORU İŞARETİ HİÇ YOK (`asistan:<workerId>`), dolayısıyla o kalıba hiçbir
 * koşulda uymaz:
 *   • yönetici panelindeki "Giriş kilidini kaldır" düğmesi bu satırları SİLMEZ
 *   • giriş sayacı bu satırları GÖRMEZ
 *   • asistan sayacı bir kimseyi giriş yapmaktan alıkoyamaz
 * Ayraç seçimi bu yüzden kuralın kendisidir; `asistan|<id>` yazsaydık iki
 * mekanizma sessizce birbirine karışabilirdi.
 *
 * ═══ HATA = KAPALI ═════════════════════════════════════════════════════════
 *
 * Sayaç OKUNAMAZSA istek REDDEDİLİR. `getLoginLockState` tersini yapıyor
 * (okunamayan kilit "kilit yok" sayılır) ve orada doğru: kilidin KENDİSİ giriş
 * akışında ayrıca denetleniyor, o okuma yalnız düğmeyi çizmek için. Burada
 * İKİNCİ BİR HAT YOK — açık düşersek tavan tamamen kalkar ve bunu kimse fark
 * etmez. Pratikte de bedeli yok: sayaç aynı Supabase'de yaşıyor, o okunamıyorsa
 * asistanın araçları da zaten veri döndüremez.
 *
 * ⚠️ YAZMA hatası aynı şey DEĞİLDİR ve isteği düşürmez: okuma başarılıysa sayı
 * bilinmektedir, yalnız artırılamamıştır. Kaybedilen tek şey bir kredidir.
 */

/** Pencere uzunluğu (ms) — "saatte 30 soru"nun saati. */
export const ASISTAN_PENCERE_MS = 60 * 60 * 1000;

/** Bir kişinin bir pencerede sorabileceği en fazla soru. */
export const ASISTAN_SORU_TAVANI = 30;

/**
 * `login_attempts.identifier` — giriş kilidinin ASLA eşleşemeyeceği ad alanı.
 * Boru işareti yok; gerekçe dosya başlığında.
 */
export function asistanAnahtari(workerId: string): string {
  return `asistan:${workerId}`;
}

export type HizKarari =
  /** Kredi düşüldü (ya da düşülemedi ama sayı biliniyordu). */
  | { ok: true; kalan: number; pencereBitis: string }
  /** Tavan doldu — `retryAfter` saniye sonra yeniden. */
  | { ok: false; kod: "hiz_siniri"; retryAfter: number; pencereBitis: string }
  /** Sayaç okunamadı — fail-closed (bkz. başlık). */
  | { ok: false; kod: "hiz_sayaci_okunamadi" };

type Satir = { attempts: number | null; first_attempt_at: string | null };

/**
 * Bir soruyu KREDİ OLARAK DÜŞER ve karar döner.
 *
 * Kredi model çağrısından ÖNCE düşülür, sonra değil: sonra düşseydik iptal
 * edilen, zaman aşımına uğrayan ya da hata veren her istek bedava olurdu ve
 * tavan tam olarak en çok gereken durumda (döngüye girmiş istemci) çalışmazdı.
 *
 * ⚠️ YARIŞ ZARARSIZ VE BİLİNÇLİ: iki eşzamanlı istek aynı sayıyı okuyup aynı
 * değeri yazabilir, yani pencerede bir kredi fazla harcanabilir. `bumpTokenVersion`
 * ile aynı sınıf ve aynı gerekçe (PostgREST `col = col + 1` yazamıyor).
 * 30'luk bir tavanda bir-iki fazlanın anlamı yok; kilit almanın bedeli var.
 */
export async function hizKrediDus(workerId: string): Promise<HizKarari> {
  const identifier = asistanAnahtari(workerId);
  const simdi = Date.now();

  const { data, error } = await supabaseAdmin
    .from("login_attempts")
    .select("attempts, first_attempt_at")
    .eq("identifier", identifier)
    .maybeSingle();

  if (error) return { ok: false, kod: "hiz_sayaci_okunamadi" };

  const satir = (data ?? null) as Satir | null;
  const basIso = satir?.first_attempt_at ?? null;
  const bas = basIso ? new Date(basIso).getTime() : NaN;
  /** Pencere yoksa, bozuksa ya da dolmuşsa yeni pencere açılır. */
  const yeniPencere = !satir || !Number.isFinite(bas) || simdi - bas >= ASISTAN_PENCERE_MS;

  const pencereBas = yeniPencere ? simdi : bas;
  const kullanilan = yeniPencere ? 0 : satir?.attempts ?? 0;
  const pencereBitis = new Date(pencereBas + ASISTAN_PENCERE_MS).toISOString();

  if (kullanilan >= ASISTAN_SORU_TAVANI) {
    const kalanMs = pencereBas + ASISTAN_PENCERE_MS - simdi;
    return {
      ok: false,
      kod: "hiz_siniri",
      retryAfter: Math.max(1, Math.ceil(kalanMs / 1000)),
      pencereBitis,
    };
  }

  const simdiIso = new Date(simdi).toISOString();
  await supabaseAdmin.from("login_attempts").upsert(
    {
      identifier,
      attempts: kullanilan + 1,
      first_attempt_at: new Date(pencereBas).toISOString(),
      last_attempt_at: simdiIso,
      /**
       * ⚠️ HER ZAMAN null. Bu sütun giriş akışının KİLİDİ; asistan satırında
       * dolu bırakmak, iki mekanizmayı tek alanda buluşturmak olurdu.
       * Asistanın "kilidi" pencerenin kendisidir.
       */
      locked_until: null,
    },
    { onConflict: "identifier" }
  );

  return {
    ok: true,
    kalan: ASISTAN_SORU_TAVANI - kullanilan - 1,
    pencereBitis,
  };
}
