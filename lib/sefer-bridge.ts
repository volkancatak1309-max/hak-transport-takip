import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { viennaDayKey, startOfDayViennaFromYmd, endOfDayViennaFromYmd } from "@/lib/format";
import { pointInCircleM } from "@/lib/geo";
import { ACIK_DURUMLAR, type SeferDurum } from "@/lib/sefer-db";
import { listDuraklarBatch, ilerletDurak, type DurakRow } from "@/lib/sefer-duraklari";

/**
 * SEFER OTOMATİK KÖPRÜLERİ (Tur 3, migration 070 — canlıda 069 olarak koştu;
 * DURAK EKSENİNE taşındı, migration 082).
 *
 * İki köprü, iki ayrı tetikleyici:
 *   1. VARIŞ  → `seferVarisKoprusu()`  · telemetri turunun sonunda (flespi/sync)
 *   2. PAKET  → `seferePaketBagla()`   · paket kayıt yolunda (vardiya kapanışı)
 *
 * ⚠️ HER İKİSİ DE YALNIZ `seferler` VE `sefer_duraklari` TABLOLARINA YAZAR.
 * `zone_visits`, `time_entries` ve `shift_packages` SALT OKUNUR — ziyaret
 * motoruna (diğer zincir) ne yazılır ne de davranışı değiştirilir.
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
  /** Damgalanan DURAK sayısı (082). Durak listesi yoksa 0. */
  durakYazilan?: number;
  /** Hata mesajı — yoksa null. Sessiz başarısızlık YASAK. */
  hata: string | null;
};

const BOS: KopruOzeti = { bakilan: 0, yazilan: 0, durakYazilan: 0, hata: null };

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

/** Flespi turunun bellekteki noktaları — araç kimliğine göre. */
export type TurNoktasi = { latitude: number; longitude: number; recorded_at: string };

type Ziyaret = { id: string; vehicle_id: string; zone_id: string; started_at: string };
type Vardiya = {
  worker_id: string;
  vehicle_id: string | null;
  started_at: string;
  ended_at: string | null;
};

// ══════════════════════════════════════════════════════════════════════════
// KÖPRÜ 1 — OTOMATİK "VARDI"
// ══════════════════════════════════════════════════════════════════════════

/**
 * Hedefe varış damgası — DURAK EKSENİNDE.
 *
 * ── NEREDE ÇALIŞIR ────────────────────────────────────────────────────────
 * `app/api/flespi/sync` turunun sonunda, ziyaretler YAZILDIKTAN sonra.
 * Ziyaretleri açan tek yer o tur; damga ziyaretin açıldığı turda düşer ve
 * YENİ ALTYAPI GEREKMEZ.
 *
 * ── İKİ HEDEF BİÇİMİ, İKİ ÖLÇÜM YOLU (082) ────────────────────────────────
 *   a) `zone_id`li durak → `zone_visits` motoru. Tek satır bile yazılmaz,
 *      yalnız okunur. Histerezis (min_dwell_s) zaten orada uygulanmış: yoldan
 *      geçiş ziyaret sayılmaz, dolayısıyla varış da sayılmaz.
 *   b) koordinatlı durak → turun BELLEKTEKİ noktalarıyla dairesel test.
 *      EK SORGU YOK; noktalar zaten çekilmiş durumda.
 *
 * ⚠️ (b)'DE HİSTEREZİS YOK — BİLİNEN VE KABUL EDİLEN FARK. Serbest hedefli bir
 * durakta "içeriden geçen ilk nokta" varış sayılır. Bölgeli durakta 120 sn
 * eşiği vardır, burada yoktur; bu yüzden serbest hedefin varsayılan yarıçapı
 * daha DAR (150 m, bölge varsayılanı 200-250 m) ve alt sınırı 50 m. Eşiği
 * buraya da taşımak, tur penceresi kadar (~2 dk) veri tutmayı gerektirirdi ve
 * `zone_visits`in ikinci bir kopyasını doğururdu — 064'ün öğrettiği hata.
 *
 * ── ⚠️ NEDEN `zone_visits.worker_id`'YE GÜVENİLMİYOR ──────────────────────
 * Ziyaret satırındaki şoför `vehicles.assigned_worker_id`den donduruluyor
 * (app/api/flespi/sync/route.ts) — yani KAĞIT ÜZERİNDEKİ atama. Bu, 15.08'de
 * güvenlik skorunda kapatılan eksen uyuşmazlığının ta kendisi. Köprü bu alanı
 * KİMLİK OLARAK KULLANMAZ; "o anda direksiyonda kimdi" sorusunu VARDİYADAN
 * (`time_entries`) sorar. Aynı kural koordinatlı durakta da geçerli.
 *
 * ── EŞLEŞME KURALI (üçü de şart) ──────────────────────────────────────────
 *   a) hedef aynı (bölge kimliği ya da daire içinde nokta),
 *   b) gözlem, seferin GÜNÜ içinde ve DURAĞIN AÇILDIĞI andan sonra — sefer ya
 *      da durak yokken olmuş bir geçiş o durağın varışı değildir,
 *   c) VARDİYA KİMLİK KONTROLÜ: seferin şoförü, o anda o ARAÇTA açık bir
 *      vardiyadaydı.
 *
 * ── SIRA ZORUNLU DEĞİL — GÖZLEM ATILMAZ ───────────────────────────────────
 * Damga "sıradaki" durakla sınırlı DEĞİL: araç 5. durağın sahasına girdiyse
 * 2. durak hâlâ beklerken de damgalanır. Sebep: bu bir GÖZLEMDİR, plan değil.
 * Şoför sırayı değiştirmiş olabilir; gerçekten olmuş bir varışı "plana uymadı"
 * diye atmak, sistemin gördüğü şeyi yok saymak olurdu. Sıra bilgisi zaten
 * ekranda duruyor ve şoför atlanan durağı sebebiyle kapatıyor.
 *
 * ── DAMGA BİR KEZ ─────────────────────────────────────────────────────────
 * Durak geçişi `.eq("durum", 'bekliyor')` yarış emniyetiyle yazılır: aynı turda
 * iki kez koşsa da, şoför aynı anda elle bassa da ikinci kez yazılmaz.
 * `seferler.vardi_at` de `.is("vardi_at", null)` koşuluyla yazılır.
 *
 * @param now  Kiracı gününü çözmek için an
 * @param aracNoktalari Flespi turunun noktaları (araç kimliğine göre). VERİLMEZSE
 *   koordinatlı duraklar bu turda ATLANIR — bölgeli duraklar ve eski tek hedef
 *   yolu normal çalışır.
 */
export async function seferVarisKoprusu(
  now: Date = new Date(),
  aracNoktalari?: Map<string, TurNoktasi[]>
): Promise<KopruOzeti> {
  try {
    const bugun = viennaDayKey(now);

    /**
     * 1) GÜNÜN AÇIK SEFERLERİ.
     *
     * ⚠️ 070'te burada `.is("vardi_at", null)` ve `.not("zone_id","is",null)`
     * filtreleri vardı. İkisi de KALKTI: hedefi olmayan bir seferin DURAKLARI
     * olabilir ve `vardi_at` dolu bir seferin daha damgalanmamış durakları
     * kalabilir. Filtreler artık satır bazında, aşağıda.
     * Maliyet: gün başına ~30 satır (ölçüm: 30 şoför, 20 vardiya/gün).
     */
    const { data: seferler, error: e1 } = await supabaseAdmin
      .from("seferler")
      .select(SEFER_COLS)
      .eq("tarih", bugun)
      .in("durum", VARIS_DURUMLARI);
    if (e1) return { ...BOS, hata: `sefer_okuma:${e1.code}:${e1.message}` };

    const aday = (seferler ?? []) as SeferSatiri[];
    // Sefersiz gün: tek ucuz sorgu ve çık. Turun geri kalanına yük yok.
    if (aday.length === 0) return BOS;

    const gunBas = startOfDayViennaFromYmd(bugun);
    const gunSon = endOfDayViennaFromYmd(bugun);
    if (!gunBas || !gunSon) return { ...BOS, bakilan: aday.length, hata: "gun_penceresi_cozulemedi" };

    // 2) DURAKLAR — tek toplu sorgu. 082 yoksa `tabloYok` gelir ve tüm akış
    //    ESKİ tek hedefli yola düşer (kademeli düşüş).
    const { harita: durakHarita, tabloYok: durakTabloYok } = await listDuraklarBatch(
      aday.map((s) => s.id)
    );

    // 3) İLGİLENİLEN BÖLGELER — eski tek hedef + bölgeli duraklar.
    const zoneIds = new Set<string>();
    for (const s of aday) {
      const duraklar = durakHarita.get(s.id) ?? [];
      if (duraklar.length === 0) {
        if (s.zone_id && s.vardi_at === null) zoneIds.add(s.zone_id);
        continue;
      }
      for (const d of duraklar) {
        if (d.durum === "bekliyor" && d.zone_id) zoneIds.add(d.zone_id);
      }
    }

    let ziyaret: Ziyaret[] = [];
    if (zoneIds.size > 0) {
      const { data: ziyaretler, error: e2 } = await supabaseAdmin
        .from("zone_visits")
        .select("id, vehicle_id, zone_id, started_at")
        .in("zone_id", [...zoneIds])
        .gte("started_at", gunBas.toISOString())
        .lte("started_at", gunSon.toISOString())
        .order("started_at", { ascending: true });
      if (e2) return { ...BOS, bakilan: aday.length, hata: `ziyaret_okuma:${e2.code}:${e2.message}` };
      ziyaret = (ziyaretler ?? []) as Ziyaret[];
    }

    // 4) VARDİYA KİMLİĞİ — o günle kesişen vardiyalar. Tek sorgu; eşleşme JS'te.
    const workerIds = [...new Set(aday.map((s) => s.worker_id))];
    // test-visible: KİMLİK DOĞRULAMA yolu, liste değil. Sorgu zaten günün
    // seferlerinin şoförleriyle anahtarlı (`in worker_id`); test hesabını
    // elemek köprüyü test şoföründe ÇALIŞMAZ hâle getirir ve QA'nın kanıt
    // üretmesini imkânsız kılardı — 028'in kuralı: yazma/anahtarlı okuma
    // yollarına test filtresi KONMAZ. Sonuç hiçbir yönetici yüzeyine akmıyor;
    // yalnız varış damgalarına dönüşüyor.
    const { data: vardiyalar, error: e3 } = await supabaseAdmin
      .from("time_entries")
      .select("worker_id, vehicle_id, started_at, ended_at")
      .in("worker_id", workerIds)
      .lte("started_at", gunSon.toISOString())
      .or(`ended_at.is.null,ended_at.gte.${gunBas.toISOString()}`);
    if (e3) return { ...BOS, bakilan: aday.length, hata: `vardiya_okuma:${e3.code}:${e3.message}` };
    const vardiya = (vardiyalar ?? []) as Vardiya[];

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

    /**
     * Seferin adayı olan ARAÇLAR.
     *
     * Sefere araç yazılmışsa yalnız o. Yazılmamışsa (066 bilerek nullable) o
     * günün vardiyalarından şoförün gerçekten kullandığı araçlar — kimliği
     * yine vardiya kuruyor, kağıt üzerindeki atama değil.
     */
    const seferAraclari = (s: SeferSatiri): string[] =>
      s.vehicle_id
        ? [s.vehicle_id]
        : [
            ...new Set(
              vardiya
                .filter((v) => v.worker_id === s.worker_id && v.vehicle_id)
                .map((v) => v.vehicle_id as string)
            ),
          ];

    let yazilan = 0;
    let durakYazilan = 0;

    for (const sefer of aday) {
      const duraklar = (durakHarita.get(sefer.id) ?? []).slice().sort((a, b) => a.sira - b.sira);

      // ── A) DURAK LİSTESİ YOKSA: ESKİ TEK HEDEF YOLU (070, aynen) ──────
      if (duraklar.length === 0 || durakTabloYok) {
        if (!sefer.zone_id || sefer.vardi_at !== null) continue;
        const acildi = Date.parse(sefer.atandi_at);
        const eslesen = ziyaret.find((z) => {
          if (z.zone_id !== sefer.zone_id) return false;
          const zt = Date.parse(z.started_at);
          if (Number.isNaN(zt) || (!Number.isNaN(acildi) && zt < acildi)) return false;
          if (sefer.vehicle_id && z.vehicle_id !== sefer.vehicle_id) return false;
          return vardiyadaMi(sefer.worker_id, z.vehicle_id, z.started_at);
        });
        if (!eslesen) continue;
        const yazildi = await seferVardiYaz(sefer.id, eslesen.started_at);
        if (yazildi === "hata") return { bakilan: aday.length, yazilan, durakYazilan, hata: "damga" };
        if (yazildi === "yazildi") yazilan++;
        continue;
      }

      // ── B) DURAK EKSENİ (082) ─────────────────────────────────────────
      const araclar = seferAraclari(sefer);
      /** Bu turda damgalanan varışların EN ERKENİ — seferin `vardi_at`i olur. */
      let enErkenVaris: string | null = null;

      for (const durak of duraklar) {
        if (durak.durum !== "bekliyor") continue;
        const an = durakVarisAni(durak, sefer, araclar, ziyaret, aracNoktalari, vardiyadaMi);
        if (!an) continue;

        const r = await ilerletDurak(durak.id, "varildi", { kaynak: "otomatik", an });
        if (!r.ok) {
          // Yarış: şoför az önce elle bastı ya da durak kapandı. Sessiz geç —
          // hata DEĞİL, beklenen bir sonuç.
          if (r.sebep === "hata") {
            console.error(`[sefer-bridge] durak damgası yazılamadı (${durak.id}): ${r.mesaj}`);
          }
          continue;
        }
        durakYazilan++;
        if (enErkenVaris === null || an < enErkenVaris) enErkenVaris = an;
      }

      /**
       * SEFERİN `vardi_at`i ANLAMINI KORUYOR: seferin İLK varışı.
       * Yalnız boşsa yazılır; ikinci durağın varışı damgayı akşama kaydırmaz
       * (070'in "damga bir kez düşer" gerekçesi).
       */
      if (enErkenVaris && sefer.vardi_at === null) {
        const yazildi = await seferVardiYaz(sefer.id, enErkenVaris);
        if (yazildi === "yazildi") yazilan++;
      }
    }

    return { bakilan: aday.length, yazilan, durakYazilan, hata: null };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error("[sefer-bridge] varış köprüsü başarısız:", m);
    return { ...BOS, hata: m.slice(0, 160) };
  }
}

/** `seferler.vardi_at` — yalnız boşken yazılır (yarış emniyeti + tek damga). */
async function seferVardiYaz(
  seferId: string,
  an: string
): Promise<"yazildi" | "atlandi" | "hata"> {
  const { data, error } = await supabaseAdmin
    .from("seferler")
    .update({ vardi_at: an })
    .eq("id", seferId)
    .is("vardi_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error(`[sefer-bridge] sefer damgası yazılamadı (${seferId}): ${error.message}`);
    return "hata";
  }
  return data ? "yazildi" : "atlandi";
}

/**
 * BİR DURAĞIN VARIŞ ANI — SAF HESAP, SORGU YOK.
 *
 * Bölgeli durakta `zone_visits`in en erken uygun ziyareti; koordinatlı durakta
 * turun noktalarından daire içine düşen İLK nokta. Bulunamazsa null.
 *
 * ⚠️ `durak.created_at` alt sınır: durak eklenmeden önce oradan geçmiş olmak o
 * durağın varışı değildir. `seferler.atandi_at` yerine DURAĞIN kendi doğum anı
 * kullanılıyor — sefer sabah açılıp durak öğlen eklenmiş olabilir.
 */
function durakVarisAni(
  durak: DurakRow,
  sefer: SeferSatiri,
  araclar: string[],
  ziyaret: Ziyaret[],
  aracNoktalari: Map<string, TurNoktasi[]> | undefined,
  vardiyadaMi: (workerId: string, vehicleId: string, atISO: string) => boolean
): string | null {
  const dogum = Date.parse(durak.created_at);
  const sonraMi = (iso: string) => {
    const t = Date.parse(iso);
    return !Number.isNaN(t) && (Number.isNaN(dogum) || t >= dogum);
  };

  // ── a) BÖLGELİ DURAK → zone_visits
  if (durak.zone_id) {
    const eslesen = ziyaret.find(
      (z) =>
        z.zone_id === durak.zone_id &&
        sonraMi(z.started_at) &&
        (araclar.length === 0 || araclar.includes(z.vehicle_id)) &&
        vardiyadaMi(sefer.worker_id, z.vehicle_id, z.started_at)
    );
    return eslesen ? eslesen.started_at : null;
  }

  // ── b) KOORDİNATLI DURAK → turun noktaları
  if (durak.latitude === null || durak.longitude === null) return null;
  if (!aracNoktalari) return null;

  let enErken: string | null = null;
  for (const aracId of araclar) {
    for (const n of aracNoktalari.get(aracId) ?? []) {
      if (!sonraMi(n.recorded_at)) continue;
      if (!pointInCircleM(n.latitude, n.longitude, durak.latitude, durak.longitude, durak.yaricap_m)) {
        continue;
      }
      if (!vardiyadaMi(sefer.worker_id, aracId, n.recorded_at)) continue;
      if (enErken === null || n.recorded_at < enErken) enErken = n.recorded_at;
    }
  }
  return enErken;
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
 *
 * ⚠️ 082 SONRASI DEĞİŞMEDİ — BİLEREK. Paket sayısı VARDİYA ekseninden gelir
 * (`time_entries.cargo_count`), durak ekseninden değil: şoför paketi durak
 * durak saymıyor, gün sonunda toplam giriyor. Sayıyı duraklara bölüştürmek
 * ölçülmemiş bir dağılım uydurmak olurdu. Durak başına gerçek kanıt zaten
 * AYRI ve ölçülmüş: teslimat kanıtı (080).
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
