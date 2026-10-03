import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { startOfDayVienna } from "@/lib/format";
import { ROTA_GUNLUK_TAVAN } from "@/lib/tenant";

/**
 * GÜNLÜK OPTİMİZASYON TAVANI — şirket (kiracı) başına.
 *
 * ═══ NEDEN YENİ TABLO YOK ═══
 *
 * lib/asistan-hiz.ts'in kararı aynen: `login_attempts` (012) ÜÇ kiracıda da
 * kurulu ve tam bu biçimi taşıyor — `identifier` birincil anahtar, `attempts`
 * sayaç, `first_attempt_at` pencere başı. Her kiracının veritabanı ayrı, yani
 * tek satır = "bu şirketin bugünkü sayacı".
 *
 * ⚠️ AYRAÇ KURALDIR: anahtarda BORU İŞARETİ YOK (`rota:gunluk`). Giriş kilidi
 * satırları `<ip>|<telefon>` biçiminde ve hep `LIKE '%|<telefon>'` ile
 * aranıyor; bu satır o kalıba hiçbir koşulda uymaz — "Giriş kilidini kaldır"
 * düğmesi bu sayacı silemez, giriş sayacı onu göremez.
 *
 * ═══ HATA = KAPALI ═══
 *
 * Sayaç okunamazsa istek REDDEDİLİR (asistanla aynı gerekçe: ikinci bir hat
 * yok, açık düşersek tavan kalkar ve kimse fark etmez).
 *
 * Kredi sağlayıcı çağrısından ÖNCE düşülür: sonra düşseydik hata veren ya da
 * zaman aşımına uğrayan her istek bedava olurdu ve tavan tam da en çok gereken
 * durumda (döngüye girmiş bir istemci) çalışmazdı.
 *
 * ⚠️ YARIŞ ZARARSIZ: iki eşzamanlı istek aynı sayıyı okuyup aynı değeri
 * yazabilir; 100'lük tavanda bir fazla krediye kilit almaya değmez
 * (bumpTokenVersion / asistan sayacı ile aynı sınıf).
 */

export const ROTA_KOTA_ANAHTARI = "rota:gunluk";

export type KotaKarari =
  | { ok: true; kullanilan: number; tavan: number }
  | { ok: false; kod: "kota_doldu"; tavan: number }
  | { ok: false; kod: "kota_okunamadi" };

type Satir = { attempts: number | null; first_attempt_at: string | null };

export async function rotaKotaDus(
  tavan: number = ROTA_GUNLUK_TAVAN,
  simdi: Date = new Date()
): Promise<KotaKarari> {
  // Gün sınırı KİRACI saat diliminde — çağıran önce kiraciAyarlari() okur.
  const gunBasi = startOfDayVienna(simdi);

  const { data, error } = await supabaseAdmin
    .from("login_attempts")
    .select("attempts, first_attempt_at")
    .eq("identifier", ROTA_KOTA_ANAHTARI)
    .maybeSingle();
  if (error) return { ok: false, kod: "kota_okunamadi" };

  const satir = (data ?? null) as Satir | null;
  const bas = satir?.first_attempt_at ? new Date(satir.first_attempt_at).getTime() : NaN;
  const yeniGun = !satir || !Number.isFinite(bas) || bas < gunBasi.getTime();
  const kullanilan = yeniGun ? 0 : (satir?.attempts ?? 0);

  if (kullanilan >= tavan) return { ok: false, kod: "kota_doldu", tavan };

  await supabaseAdmin.from("login_attempts").upsert(
    {
      identifier: ROTA_KOTA_ANAHTARI,
      attempts: kullanilan + 1,
      first_attempt_at: yeniGun ? gunBasi.toISOString() : satir!.first_attempt_at,
      last_attempt_at: simdi.toISOString(),
      // HER ZAMAN null — bu sütun giriş akışının kilidi (asistan sayacıyla aynı).
      locked_until: null,
    },
    { onConflict: "identifier" }
  );

  return { ok: true, kullanilan: kullanilan + 1, tavan };
}
