import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { viennaDayKey, startOfDayViennaFromYmd, endOfDayViennaFromYmd } from "@/lib/format";
import { ACIK_DURUMLAR, type SeferDurum } from "@/lib/sefer-db";

/**
 * SEFER OTOMATİK KÖPRÜLERİ (Tur 3, migration 070 — canlıda 069 olarak koştu).
 *
 * İki köprü, iki ayrı tetikleyici:
 *   1. VARIŞ  → `seferVarisKoprusu()`  · telemetri turunun sonunda (flespi/sync)
 *   2. PAKET  → `seferePaketBagla()`   · paket kayıt yolunda (vardiya kapanışı)
 *
 * ⚠️ HER İKİSİ DE YALNIZ `seferler` TABLOSUNA YAZAR. `zone_visits`,
 * `time_entries` ve `shift_packages` SALT OKUNUR — ziyaret motoruna
 * (diğer zincir) ne yazılır ne de davranışı değiştirilir.
 *
 * ⚠️ HİÇBİRİ THROW ETMEZ. Köprü bir yan görevdir: GPS turunu da vardiya
 * kapanışını da hiçbir koşulda düşürmemeli. Hata `console.error`'a yazılır ve
 * özet `hata` alanıyla döner — sessizce yutulmaz.
 */

export type KopruOzeti = {
  /** Bakılan sefer sayısı. */
  bakilan: number;
  /** Yazılan (damgalanan / bağlanan) sefer sayısı. */
  yazilan: number;
  /** Hata mesajı — yoksa null. Sessiz başarısızlık YASAK. */
  hata: string | null;
};

const BOS: KopruOzeti = { bakilan: 0, yazilan: 0, hata: null };

/** Varış köprüsünün baktığı durumlar — Volkan kararı: kabul ve yolda. */
const VARIS_DURUMLARI: SeferDurum[] = ["kabul", "yolda"];

type SeferSatiri = {
  id: string;
  tarih: string;
  worker_id: string;
  vehicle_id: string | null;
  zone_id: string | null;
  durum: SeferDurum;
  atandi_at: string;
  tamamlandi_at: string | null;
  vardi_at: string | null;
  paket_gerceklesen: number | null;
};

const SEFER_COLS =
  "id, tarih, worker_id, vehicle_id, zone_id, durum, atandi_at, tamamlandi_at, vardi_at, paket_gerceklesen";

// ══════════════════════════════════════════════════════════════════════════
// KÖPRÜ 1 — OTOMATİK "VARDI"
// ══════════════════════════════════════════════════════════════════════════

/**
 * Hedef bölgeye varış damgası.
 *
 * ── NEREDE ÇALIŞIR ────────────────────────────────────────────────────────
 * `app/api/flespi/sync` turunun sonunda, ziyaretler YAZILDIKTAN sonra.
 * Ziyaretleri açan tek yer o tur; damga ziyaretin açıldığı turda düşer ve
 * YENİ ALTYAPI GEREKMEZ. Periyodik bir iş, bu repoda dış zamanlayıcı kaydı
 * (cron-job.org) açmayı gerektirir ve sync'ten HER ZAMAN geç kalırdı.
 *
 * ── 🔴 NEDEN `zone_visits.worker_id`'YE GÜVENİLMİYOR ──────────────────────
 * Ziyaret satırındaki şoför `vehicles.assigned_worker_id`den donduruluyor
 * (app/api/flespi/sync/route.ts) — yani KAĞIT ÜZERİNDEKİ atama. Bu, 15.08'de
 * güvenlik skorunda kapatılan eksen uyuşmazlığının ta kendisi: şoför atandığı
 * araçtan başkasını sürdüğünde ziyaret yanlış kişiye yazılır. Köprü bu alanı
 * KİMLİK OLARAK KULLANMAZ; "o anda direksiyonda kimdi" sorusunu VARDİYADAN
 * (`time_entries`) sorar. Ölçüm gerekçesi: skor tarafında aynı varsayım
 * canlıda yanlış çıktı (bkz. lib/analytics.ts eksen notu).
 *
 * ── EŞLEŞME KURALI ────────────────────────────────────────────────────────
 * Bir ziyaret, bir sefere şu üç koşulun HEPSİ sağlanırsa yazılır:
 *   a) `zone_id` aynı,
 *   b) ziyaret, seferin GÜNÜ içinde ve seferin AÇILDIĞI andan sonra başlamış
 *      (sefer yokken olmuş bir varış o seferin varışı değildir),
 *   c) VARDİYA KİMLİK KONTROLÜ: seferin şoförü, ziyaretin başladığı anda
 *      ziyaretin ARACINDA açık bir vardiyadaydı.
 * Seferin `vehicle_id`si doluysa ek olarak ziyaretin aracıyla eşleşmesi
 * beklenir; boşsa (066 bilerek nullable) kimliği tek başına (c) kurar.
 *
 * ── DAMGA BİR KEZ ─────────────────────────────────────────────────────────
 * Yalnız `vardi_at is null` olan seferler okunur ve yazma `.is("vardi_at", null)`
 * koşuluyla yapılır: aynı turda iki kez koşsa da, araç bölgeye üç kez girse de
 * ikinci kez yazılmaz. En ERKEN ziyaret kazanır (ilk varış).
 */
export async function seferVarisKoprusu(now: Date = new Date()): Promise<KopruOzeti> {
  try {
    const bugun = viennaDayKey(now);

    // 1) Günün damgalanmamış, hedefi olan, kabul|yolda seferleri.
    const { data: seferler, error: e1 } = await supabaseAdmin
      .from("seferler")
      .select(SEFER_COLS)
      .eq("tarih", bugun)
      .is("vardi_at", null)
      .not("zone_id", "is", null)
      .in("durum", VARIS_DURUMLARI);
    if (e1) return { ...BOS, hata: `sefer_okuma:${e1.code}:${e1.message}` };

    const aday = (seferler ?? []) as SeferSatiri[];
    // Sefersiz gün: tek ucuz sorgu ve çık. Turun geri kalanına yük yok.
    if (aday.length === 0) return BOS;

    const gunBas = startOfDayViennaFromYmd(bugun);
    const gunSon = endOfDayViennaFromYmd(bugun);
    if (!gunBas || !gunSon) return { ...BOS, bakilan: aday.length, hata: "gun_penceresi_cozulemedi" };

    // 2) O bölgelerde, o gün başlamış ziyaretler. SALT OKUMA.
    const zoneIds = [...new Set(aday.map((s) => s.zone_id!))];
    const { data: ziyaretler, error: e2 } = await supabaseAdmin
      .from("zone_visits")
      .select("id, vehicle_id, zone_id, started_at")
      .in("zone_id", zoneIds)
      .gte("started_at", gunBas.toISOString())
      .lte("started_at", gunSon.toISOString())
      .order("started_at", { ascending: true });
    if (e2) return { ...BOS, bakilan: aday.length, hata: `ziyaret_okuma:${e2.code}:${e2.message}` };
    const ziyaret = (ziyaretler ?? []) as {
      id: string;
      vehicle_id: string;
      zone_id: string;
      started_at: string;
    }[];
    if (ziyaret.length === 0) return { ...BOS, bakilan: aday.length };

    // 3) VARDİYA KİMLİĞİ — o günle kesişen vardiyalar. Tek sorgu; eşleşme JS'te.
    const workerIds = [...new Set(aday.map((s) => s.worker_id))];
    // test-visible: KİMLİK DOĞRULAMA yolu, liste değil. Sorgu zaten günün
    // seferlerinin şoförleriyle anahtarlı (`in worker_id`); test hesabını
    // elemek köprüyü test şoföründe ÇALIŞMAZ hâle getirir ve QA'nın kanıt
    // üretmesini imkânsız kılardı — 028'in kuralı: yazma/anahtarlı okuma
    // yollarına test filtresi KONMAZ. Sonuç hiçbir yönetici yüzeyine akmıyor;
    // yalnız `seferler.vardi_at` damgasına dönüşüyor.
    const { data: vardiyalar, error: e3 } = await supabaseAdmin
      .from("time_entries")
      .select("worker_id, vehicle_id, started_at, ended_at")
      .in("worker_id", workerIds)
      .lte("started_at", gunSon.toISOString())
      .or(`ended_at.is.null,ended_at.gte.${gunBas.toISOString()}`);
    if (e3) return { ...BOS, bakilan: aday.length, hata: `vardiya_okuma:${e3.code}:${e3.message}` };
    const vardiya = (vardiyalar ?? []) as {
      worker_id: string;
      vehicle_id: string | null;
      started_at: string;
      ended_at: string | null;
    }[];

    /** "Bu kişi, bu araçta, bu anda vardiyada mıydı?" — açık vardiya (ended_at null) sürüyor sayılır. */
    const vardiyadaMi = (workerId: string, vehicleId: string, atISO: string): boolean => {
      const t = Date.parse(atISO);
      if (Number.isNaN(t)) return false;
      return vardiya.some((v) => {
        if (v.worker_id !== workerId || v.vehicle_id !== vehicleId) return false;
        const b = Date.parse(v.started_at);
        if (Number.isNaN(b) || b > t) return false;
        if (v.ended_at === null) return true;
        const s = Date.parse(v.ended_at);
        return !Number.isNaN(s) && t <= s;
      });
    };

    let yazilan = 0;
    for (const sefer of aday) {
      const acildi = Date.parse(sefer.atandi_at);
      const eslesen = ziyaret.find((z) => {
        if (z.zone_id !== sefer.zone_id) return false;
        // Sefer henüz yokken olmuş varış, o seferin varışı değildir.
        const zt = Date.parse(z.started_at);
        if (Number.isNaN(zt) || (!Number.isNaN(acildi) && zt < acildi)) return false;
        // Sefere araç yazılmışsa ziyaretin aracı o olmalı.
        if (sefer.vehicle_id && z.vehicle_id !== sefer.vehicle_id) return false;
        // VARDİYA KİMLİK KONTROLÜ — atama değil, direksiyon.
        return vardiyadaMi(sefer.worker_id, z.vehicle_id, z.started_at);
      });
      if (!eslesen) continue;

      // `.is("vardi_at", null)`: yarış emniyeti + damganın bir kez düşmesi.
      const { data: yazildi, error: e4 } = await supabaseAdmin
        .from("seferler")
        .update({ vardi_at: eslesen.started_at })
        .eq("id", sefer.id)
        .is("vardi_at", null)
        .select("id")
        .maybeSingle();
      if (e4) return { bakilan: aday.length, yazilan, hata: `damga:${e4.code}:${e4.message}` };
      if (yazildi) yazilan++;
    }

    return { bakilan: aday.length, yazilan, hata: null };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error("[sefer-bridge] varış köprüsü başarısız:", m);
    return { ...BOS, hata: m.slice(0, 160) };
  }
}

// ══════════════════════════════════════════════════════════════════════════
// KÖPRÜ 2 — PAKET BAĞLAMA
// ══════════════════════════════════════════════════════════════════════════

/**
 * O günün teslim sayısını günün seferine bağlar.
 *
 * ── NEREDE ÇALIŞIR ────────────────────────────────────────────────────────
 * PAKET KAYIT YOLUNDA: sayının kesinleştiği her noktada çağrılır (vardiya
 * kapanışı, çevrimdışı kuyruk, yönetici düzeltmesi, +1 sayacı senkronu).
 * Giriş akışının kendisine DOKUNULMAZ — çağrı sonuca bakmaz, hata fırlatmaz;
 * bağlama olmasa da paket girişi aynen tamamlanır.
 *
 * ── HEDEF SEFERİN SEÇİMİ (Volkan kuralı) ──────────────────────────────────
 *   1. O günün TAMAMLANMIŞ seferlerinden EN SON tamamlanan,
 *   2. yoksa AÇIK olan (atandi|kabul|yolda),
 *   3. ikisi de yoksa BAĞLAMA YOK — zorla eşleştirme yapılmaz.
 * İptal edilen sefer hedef değildir: iptal "bu iş yapılmadı" demek, üstüne
 * teslim sayısı yazmak kaydı yalanlardı.
 *
 * ── NEDEN HER ÇAĞRIDA YAZILIYOR (dondurulmuyor) ───────────────────────────
 * Yönetici `cargo_count`u sonradan düzeltebiliyor (shift_edit_log). Bağlamayı
 * ilk yazımda dondursaydık sefer, düzeltilmiş vardiyanın YANLIŞ sayısını
 * taşımaya devam ederdi. Çözüm noktası aynı kaldığı sürece değer tazelenir;
 * BAŞKA hiçbir seferin değeri elle sürülmez.
 * (⚠️ 070'in başlık yorumu ilk taslakta "dondurulur" diyordu — DDL aynı, yorum
 * bu davranışa göre düzeltildi.)
 *
 * @param workerId Paketi girilen vardiyanın şoförü
 * @param gun      Vardiyanın Viyana takvim günü (YYYY-MM-DD)
 * @param teslim   time_entries.cargo_count — null ise bağlama yapılmaz
 */
export async function seferePaketBagla(
  workerId: string | null | undefined,
  gun: string | null | undefined,
  teslim: number | null | undefined
): Promise<KopruOzeti> {
  try {
    if (!workerId || !gun || teslim === null || teslim === undefined) return BOS;
    if (!Number.isInteger(teslim) || teslim < 0) return BOS;

    const { data, error } = await supabaseAdmin
      .from("seferler")
      .select(SEFER_COLS)
      .eq("tarih", gun)
      .eq("worker_id", workerId);
    if (error) return { ...BOS, hata: `sefer_okuma:${error.code}:${error.message}` };

    const seferler = (data ?? []) as SeferSatiri[];
    if (seferler.length === 0) return BOS;

    const tamamlanan = seferler
      .filter((s) => s.durum === "tamamlandi" && s.tamamlandi_at)
      .sort((a, b) => Date.parse(b.tamamlandi_at!) - Date.parse(a.tamamlandi_at!));
    const acik = seferler.filter((s) => ACIK_DURUMLAR.includes(s.durum));

    const hedef = tamamlanan[0] ?? acik[0] ?? null;
    if (!hedef) return { bakilan: seferler.length, yazilan: 0, hata: null };
    // Değer zaten doğruysa yazma — gereksiz UPDATE üretmeyelim.
    if (hedef.paket_gerceklesen === teslim) {
      return { bakilan: seferler.length, yazilan: 0, hata: null };
    }

    const { error: e2 } = await supabaseAdmin
      .from("seferler")
      .update({ paket_gerceklesen: teslim })
      .eq("id", hedef.id);
    if (e2) return { bakilan: seferler.length, yazilan: 0, hata: `bagla:${e2.code}:${e2.message}` };

    return { bakilan: seferler.length, yazilan: 1, hata: null };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error("[sefer-bridge] paket köprüsü başarısız:", m);
    return { ...BOS, hata: m.slice(0, 160) };
  }
}

/**
 * Paket köprüsünün ÇAĞRI KOLAYLIĞI — `time_entries` kimliğinden yola çıkar.
 *
 * Paket yazan dört yol da elinde `time_entry_id` tutuyor; şoförü, günü ve
 * teslim sayısını burada TEK yerde okumak, dört çağrı noktasında aynı üç
 * alanı toplamaktan hem kısa hem de kuralın tek yerde kalmasını sağlıyor.
 *
 * Günün kaynağı `started_at`: vardiya gece yarısını geçse bile sefer, işin
 * BAŞLADIĞI güne aittir (066: sefer bir GÜN birimi).
 */
export async function seferePaketBaglaVardiyadan(timeEntryId: string): Promise<KopruOzeti> {
  try {
    const { data, error } = await supabaseAdmin
      .from("time_entries")
      .select("worker_id, started_at, cargo_count")
      .eq("id", timeEntryId)
      .maybeSingle();
    if (error || !data) return { ...BOS, hata: error ? `vardiya_okuma:${error.code}` : null };
    const gun = viennaDayKey(new Date(data.started_at as string));
    return await seferePaketBagla(
      data.worker_id as string | null,
      gun,
      data.cargo_count as number | null
    );
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error("[sefer-bridge] paket köprüsü (vardiyadan) başarısız:", m);
    return { ...BOS, hata: m.slice(0, 160) };
  }
}
