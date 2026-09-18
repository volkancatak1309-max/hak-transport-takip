import "server-only";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * MOLA ÇEKİRDEĞİ — PANEL VE MOBİL AYNI İKİ FONKSİYON (19.09.2026).
 *
 * ═══ PANELDE İKİ EYLEM VAR, İKİSİ DE TAŞINDI ══════════════════════════════
 *
 * Şoför panelinde mola tek düğme gibi görünüyor ama arkasında AYRI iki yazma
 * var ve ikisi AYNI satırın FARKLI kolonlarına dokunuyor:
 *
 *   başlat  → `break_started_at = now`   "şu an molada" bayrağı. Harita ve
 *             yönetici panosu bunu canlı gösteriyor. Süreyi SAYMAZ.
 *   ekle    → `break_minutes += N` ve `break_started_at = null`
 *             Panel mola düğmesini KAPATIRKEN geçen süreyi buraya yazıyor.
 *
 * Süreyi panelin kendi sayacı ölçüyor ve sunucuya DAKİKA olarak veriyor; yani
 * "başlat" ile "ekle" arasında sunucu tarafında bir bağ YOK ve olmamalı —
 * telefon uçakta kalırsa `break_started_at` açık kalır ama dakika yazılmaz.
 * Bu bilinçli: yasal kayda (AZG) giren alan `break_minutes` ve oraya yalnız
 * ÖLÇÜLMÜŞ bir süre yazılır, tahmin değil.
 *
 * ═══ NEDEN AYRI DOSYA ═════════════════════════════════════════════════════
 *
 * İkisi de `app/actions/shift.ts`te oturum tabanlıydı (`requireWorker()` →
 * kendi aktif vardiyası). Mobil uç aynı işi ŞU FARKLA yapıyor: vardiya
 * kimliği YOLDAN geliyor ve yönetici BAŞKASININ vardiyasına da ekleyebiliyor.
 * Oturumdan kimlik türeten bir gövde bunu yapamaz.
 *
 * Çözüm çekirdeği ayırmak: yetki kararı ÇAĞIRANDA (panelde oturum, mobilde
 * uç kapısı), yazma kuralı burada. Kopyalansaydı bir gün biri
 * `break_started_at`i temizlemeyi unuturdu ve "sürekli molada" görünen bir
 * şoför doğardı — 22.07.2026'da tam olarak bu yaşandı (bkz. offline.ts:144).
 *
 * ⚠️ AZG ALANI TEK: `break_minutes`. İkinci bir mola sayacı YOK ve olmamalı;
 * § 26 AZG raporu, vardiya özeti ve yönetici düzeltmesi hep bu kolonu okuyor.
 */

export type MolaSonucu = { ok: true; molaDk: number } | { ok: false; error: string };

/**
 * "ŞU AN MOLADA" BAYRAĞI — süre YAZMAZ.
 *
 * `break_started_at` zaten doluysa hiçbir şey yapmaz (koşul sorguda):
 * ikinci kez basmak molayı BAŞTAN başlatmamalı, yoksa ilk bölüm kaybolurdu.
 */
export async function molaBaslat(
  workerId: string,
  entryId?: string | null
): Promise<MolaSonucu> {
  const q = supabaseAdmin
    .from("time_entries")
    .update({ break_started_at: new Date().toISOString() })
    .eq("worker_id", workerId)
    .is("ended_at", null)
    .is("break_started_at", null);
  const { error } = await (entryId ? q.eq("id", entryId) : q);
  if (error) return { ok: false, error: error.message };
  return { ok: true, molaDk: 0 };
}

/**
 * MOLA DAKİKASI EKLE — `break_minutes += dakika`, bayrağı temizle.
 *
 * `entryId` verilirse O vardiya, verilmezse şoförün AÇIK vardiyası. İkisi de
 * `ended_at is null` şartına tabidir: kapanmış bir vardiyaya mola eklemek
 * yasal kaydı geriye dönük değiştirmektir ve o iş yöneticinin `duzelt`
 * eylemidir (sebep zorunlu, iz bırakır — `shift_edit_log`).
 *
 * ⚠️ DAKİKA TOPLANIR, ATANMAZ. İki mola veren şoförün ikincisi birincisini
 * ezmemeli. Tavan `SINIR_DK`: tek seferde bir günden uzun mola bir veri
 * girişi hatasıdır ve AZG raporuna öyle girmemeli.
 */
export const MOLA_TEK_SEFER_MAX_DK = 1440;

export async function molaDakikaEkle(
  workerId: string,
  dakika: number,
  entryId?: string | null
): Promise<MolaSonucu> {
  if (!Number.isFinite(dakika)) return { ok: false, error: "errBreakInvalid" };
  const ekle = Math.floor(dakika);
  if (ekle < 0) return { ok: false, error: "errBreakNeg" };
  if (ekle > MOLA_TEK_SEFER_MAX_DK) return { ok: false, error: "errBreakRange" };

  // test-visible: vardiya kimliğine/şoföre ANAHTARLI tek satır; liste değil.
  const q = supabaseAdmin
    .from("time_entries")
    .select("id, break_minutes")
    .eq("worker_id", workerId)
    .is("ended_at", null);
  const { data: aktif } = await (entryId ? q.eq("id", entryId) : q).maybeSingle();
  if (!aktif) return { ok: false, error: "no_active" };

  const yeni = (aktif.break_minutes ?? 0) + ekle;
  const { error } = await supabaseAdmin
    .from("time_entries")
    .update({ break_minutes: yeni })
    .eq("id", aktif.id)
    .eq("worker_id", workerId);
  if (error) return { ok: false, error: error.message };

  /**
   * BAYRAK AYRI YAZILIR ve hatası YUTULUR (panelin bugünkü davranışı).
   * `break_started_at` migration 009 öncesi kurulumda yok; dakika yazıldıktan
   * sonra bayrak yüzünden istek düşerse şoför "mola eklenmedi" sanır ve
   * ikinci kez basar — dakika iki kez yazılırdı.
   */
  await supabaseAdmin
    .from("time_entries")
    .update({ break_started_at: null })
    .eq("id", aktif.id)
    .then(
      () => {},
      () => {}
    );

  return { ok: true, molaDk: yeni };
}
