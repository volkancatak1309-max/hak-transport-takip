import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { pointInCircleM } from "@/lib/geo";
import { turMemo } from "@/lib/query-counter";

/**
 * MÜŞTERİ BÖLGESİ ZİYARETLERİ (FAZ C, migration 064).
 *
 * "Bölgede geçirilen süre raporu (faturalama kanıtı)" — GOLD paketinde zaten
 * satılan özelliğin motoru.
 *
 * ═══ BİR BÖLGE NE ZAMAN ÖLÇÜLÜR ═══
 * `purpose = 'customer'` ise. `category` DEĞİL (Volkan kararı B, 19.08.2026):
 *   "Ölçüm davranıştır, rozet değil; fatura kanıtı telefon menüsünden
 *    değişemez."
 * `category` mobilden serbestçe yazılıyor; ona bağlasaydık telefondaki bir
 * menü dokunuşu faturalama kanıtını sessizce durdururdu. `purpose`u mobil
 * yazamıyor (lib/geofences-db.ts), yani ölçüm yalnız panelden bilerek açılır.
 *
 * ═══ GÖZLEMLENMEMİŞ SÜRE ASLA SAYILMAZ ═══
 * Süre daima `ended_at - started_at`. "Şu an - started_at" HİÇBİR YERDE
 * hesaplanmaz. Sinyal kesilirse ziyaret `last_seen_at` ile kapanır
 * (`gap_timeout`) — sinyalsiz geçen süre faturaya girmez ve rapor o satırı
 * işaretler. `idle_episodes`'un (024) birebir aynı ilkesi.
 *
 * ═══ EŞİK NEREDE UYGULANIR — ÖLÇÜMLE DÜZELTİLDİ (19.08.2026) ═══
 * İlk sürüm eşiği TUR İÇİNDE arıyordu: "aynı turun noktaları arasında
 * kesintisiz `min_dwell_s` geçtiyse aç". Cron 2 dakikada bir koştuğu için bir
 * turun taşıdığı pencere ~120 sn; 120 sn'lik eşik kıl payı, 180 sn'lik eşik
 * ise ASLA dolmuyordu — özellik sessizce hiç ziyaret üretmezdi.
 *
 * Doğrusu: ziyaret **ilk içeri noktada AÇILIR**, eşik **kapanışta TOPLAM
 * süreye** uygulanır. Eşiğin amacı ("bölgenin yanından geçen araç faturaya
 * girmesin") tam olarak budur ve tur penceresinden bağımsızdır. Eşiği
 * dolduramadan kapanan ziyaret SİLİNİR; aynı turda girip çıkan kısa geçiş
 * hiç yazılmaz bile. Açık ama henüz eşiği doldurmamış ziyaret raporda
 * GÖRÜNMEZ (bkz. lib/zone-visit-report.ts).
 */

/** Bölge içinde sayılmak için kesintisiz kalınması gereken süre — bölge başına. */
export type MusteriBolgesi = {
  id: string;
  name: string;
  center_lat: number;
  center_lng: number;
  radius_m: number;
  min_dwell_s: number;
  customer_name: string | null;
};

export type AcikZiyaret = {
  id: string;
  vehicle_id: string;
  zone_id: string;
  /** Ziyaret anında donmuş şoför — güncelleme partisi TAM satır yazsın diye. */
  worker_id: string | null;
  started_at: string;
  last_seen_at: string;
};

/** Bir aracın bu turda işlenecek noktaları (yalnız konumlu olanlar). */
export type ZiyaretNoktasi = {
  latitude: number;
  longitude: number;
  recorded_at: string;
};

/**
 * Aktif müşteri bölgeleri — TUR İÇİNDE TEK SORGU.
 *
 * `activeDepotZones` ile AYNI `turMemo` mantığı ama AYRI anahtar: depo okuması
 * yalnız `purpose='depot'` çekiyor, bu ise `purpose='customer'`. İki ayrı dar
 * sorgu, tek geniş sorgudan daha ucuz ve her biri kendi indeksini kullanıyor.
 *
 * Arşivli bölge otomatik olarak `active=false` oluyor (063 kuralı), yani
 * `active=true` filtresi arşivliyi zaten eliyor — ek filtre gerekmez.
 */
export async function aktifMusteriBolgeleri(): Promise<MusteriBolgesi[]> {
  return turMemo("aktifMusteriBolgeleri", async () => {
    try {
      const { data, error } = await supabaseAdmin
        .from("geofences")
        .select("id, name, center_lat, center_lng, radius_m, min_dwell_s, customer_name")
        .eq("active", true)
        .eq("purpose", "customer");
      if (error || !data) return [];
      return data as MusteriBolgesi[];
    } catch {
      return [];
    }
  });
}

/** Tur başındaki TÜM açık ziyaretler — tek sorgu, araç sayısından bağımsız. */
export async function acikZiyaretler(): Promise<AcikZiyaret[] | null> {
  const { data, error } = await supabaseAdmin
    .from("zone_visits")
    .select("id, vehicle_id, zone_id, worker_id, started_at, last_seen_at")
    .is("ended_at", null);
  if (error) {
    console.warn(
      `[zone-visits] açık ziyaretler okunamadı (${error.message}) — bu turda ziyaret ölçümü atlanıyor`
    );
    return null;
  }
  return (data ?? []) as AcikZiyaret[];
}

/** Yeni satır — `ended_at` null ise araç hâlâ içeride. */
type YeniZiyaret = {
  vehicle_id: string;
  zone_id: string;
  worker_id: string | null;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  end_reason: string | null;
};
/** Mevcut satırın TAM hâli — parti upsert'inde bütün kolonlar aynı olmalı. */
type GuncelZiyaret = {
  id: string;
  vehicle_id: string;
  zone_id: string;
  worker_id: string | null;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  end_reason: string | null;
};

export type ZiyaretPlani = {
  /** Yeni satırlar (açık veya aynı turda tamamlanmış). */
  yeni: YeniZiyaret[];
  /** Mevcut satırın yeni hâli (kapanış ya da last_seen ilerlemesi). */
  guncel: GuncelZiyaret[];
  /** Eşiği dolduramadan kapanan ziyaretler — faturaya girmemeli, silinir. */
  silinecek: string[];
};

const bosPlan = (): ZiyaretPlani => ({ yeni: [], guncel: [], silinecek: [] });
const ms = (iso: string) => new Date(iso).getTime();

/**
 * SAF HESAP — HİÇBİR SORGU ATMAZ (#84 sıfır-döngü-sorgusu kuralı).
 *
 * Bir aracın bu turdaki noktalarını zaman sırasıyla gezer ve ne açılacağını,
 * neyin kapanacağını, neyin silineceğini belirler. Noktalar
 * `fetchDeviceMessages`ten zaten bellekte; bölgeler tur başında bir kez
 * okundu. Test edilebilir olsun diye tamamen yan etkisiz.
 *
 * ── ZİYARETİN BAŞLANGICI ───────────────────────────────────────────────────
 * `started_at` = **içeri girilen ilk nokta**. Müşteri sahasında geçen süre
 * kapıda başlar; eşiğin dolduğu anı başlangıç saymak müşteriye her ziyarette
 * `min_dwell_s` kadar eksik fatura keserdi.
 *
 * ── AYNI TURDA YENİDEN GİRİŞ ───────────────────────────────────────────────
 * Çıkıştan sonra döngü KIRILMAZ: araç aynı turda tekrar girerse ikinci ziyaret
 * de yakalanır. (İlk sürüm burada `break` ediyordu ve turun kalanını kördü.)
 */
export function ziyaretPlaniHesapla(
  vehicleId: string,
  workerId: string | null,
  noktalar: ZiyaretNoktasi[],
  bolgeler: MusteriBolgesi[],
  acik: AcikZiyaret[]
): ZiyaretPlani {
  const plan = bosPlan();
  if (bolgeler.length === 0 || noktalar.length === 0) return plan;

  const sirali = [...noktalar].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));

  for (const b of bolgeler) {
    const esikMs = Math.max(1, b.min_dwell_s) * 1000;
    // DB'de duran açık ziyaret (varsa) — bu tur onu sürdürür ya da kapatır.
    let acikSatir: AcikZiyaret | null = acik.find((z) => z.zone_id === b.id) ?? null;
    // Bu turda başlayan, henüz DB'de olmayan ziyaretin başlangıcı.
    let yerelBaslangic: string | null = null;
    let sonIceri: string | null = null;

    for (const n of sirali) {
      const icerde = pointInCircleM(
        n.latitude,
        n.longitude,
        b.center_lat,
        b.center_lng,
        b.radius_m
      );

      if (icerde) {
        if (!acikSatir && yerelBaslangic === null) yerelBaslangic = n.recorded_at;
        sonIceri = n.recorded_at;
        continue;
      }

      // ── DIŞARI ÇIKILDI ──
      if (acikSatir) {
        const sure = ms(n.recorded_at) - ms(acikSatir.started_at);
        if (sure >= esikMs) {
          plan.guncel.push({
            id: acikSatir.id,
            vehicle_id: acikSatir.vehicle_id,
            zone_id: acikSatir.zone_id,
            worker_id: acikSatir.worker_id,
            started_at: acikSatir.started_at,
            last_seen_at: sonIceri ?? acikSatir.last_seen_at,
            ended_at: n.recorded_at,
            end_reason: "exit",
          });
        } else {
          // Eşiği dolduramadı → yoldan geçiş. Satır faturaya girmemeli ve
          // "0 dk'lık ziyaret" olarak raporda da durmamalı: silinir.
          plan.silinecek.push(acikSatir.id);
        }
        acikSatir = null;
        sonIceri = null;
      } else if (yerelBaslangic !== null) {
        // Bu turda girip çıktı: hiç yazılmadan karar verilir.
        const sure = ms(n.recorded_at) - ms(yerelBaslangic);
        if (sure >= esikMs) {
          plan.yeni.push({
            vehicle_id: vehicleId,
            zone_id: b.id,
            worker_id: workerId,
            started_at: yerelBaslangic,
            last_seen_at: sonIceri ?? yerelBaslangic,
            ended_at: n.recorded_at,
            end_reason: "exit",
          });
        }
        // Eşik dolmadıysa HİÇBİR ŞEY yazılmaz — yazıp silmek yerine hiç yazma.
        yerelBaslangic = null;
        sonIceri = null;
      }
    }

    // ── TUR SONU: araç hâlâ içeride ──
    if (acikSatir) {
      if (sonIceri && sonIceri > acikSatir.last_seen_at) {
        plan.guncel.push({
          id: acikSatir.id,
          vehicle_id: acikSatir.vehicle_id,
          zone_id: acikSatir.zone_id,
          worker_id: acikSatir.worker_id,
          started_at: acikSatir.started_at,
          last_seen_at: sonIceri,
          ended_at: null,
          end_reason: null,
        });
      }
    } else if (yerelBaslangic !== null) {
      plan.yeni.push({
        vehicle_id: vehicleId,
        zone_id: b.id,
        worker_id: workerId,
        started_at: yerelBaslangic,
        last_seen_at: sonIceri ?? yerelBaslangic,
        ended_at: null,
        end_reason: null,
      });
    }
  }

  return plan;
}

/**
 * Planı YAZAR — tur başına EN FAZLA 3 sorgu (insert + upsert + delete),
 * her biri yalnız işi varsa.
 *
 * ── NEDEN `upsert(onConflict:"vehicle_id,zone_id")` DEĞİL ──────────────────
 * `uq_zone_visit_open` KISMİ bir tekil indeks (`where ended_at is null`).
 * PostgREST `on_conflict`e WHERE cümlesi ekleyemediği için Postgres o indeksi
 * arbiter olarak seçemez ve istek 42P10 ile döner. Bu yüzden düz `insert` +
 * 23505 yakalama kullanılıyor — `saveIdleEpisodes`in (024) aynı deseni.
 *
 * ── NEDEN GÜNCELLEMELER TAM SATIR ──────────────────────────────────────────
 * PostgREST bir partideki tüm satırlarda AYNI kolon kümesini bekler; eksik
 * kolon null'a düşer. Kapanışlar `ended_at`, ilerlemeler `last_seen_at`
 * yazıyor — kısmi satırlar karıştırılırsa `last_seen_at` (NOT NULL) null'a
 * çekilir ve parti tümden reddedilir. Açık ziyaretin bütün alanları elimizde
 * olduğu için TAM satır gönderiliyor ve arbiter birincil anahtar (`id`).
 *
 * Hiçbir hata turu düşürmez — ziyaret ölçümü GPS akışının önüne geçemez.
 */
export async function ziyaretPlaniniYaz(planlar: ZiyaretPlani[]): Promise<{
  acilan: number;
  kapanan: number;
  ilerleyen: number;
  silinen: number;
}> {
  const yeni = planlar.flatMap((p) => p.yeni);
  const sonuc = { acilan: 0, kapanan: 0, ilerleyen: 0, silinen: 0 };

  /**
   * AYNI SATIR İKİ KEZ GİRERSE PARTİ TÜMDEN DÜŞER.
   *
   * Gerçek senaryo: bir ziyaretin `last_seen_at`i 40 dakika eskimişken bu tur
   * aracın çıkış noktasını getirir. Aynı `id` hem araç planında (`exit`) hem
   * gap bekçisinde (`gap_timeout`) belirir. Postgres bunu
   * "ON CONFLICT DO UPDATE command cannot affect row a second time" ile
   * REDDEDER ve partideki DİĞER ziyaretler de yazılamaz.
   *
   * Çözüm sırayla: araç planları listede gap bekçisinden ÖNCE geldiği için ilk
   * kayıt kazanır — gözlenmiş çıkış, tahmini sinyal kesintisinden daha
   * doğrudur. Silme listesi de aynı mantıkla güncellenenleri dışlar: bir satır
   * hem kapanıp hem silinemez.
   */
  const guncelHarita = new Map<string, GuncelZiyaret>();
  for (const g of planlar.flatMap((p) => p.guncel)) {
    if (!guncelHarita.has(g.id)) guncelHarita.set(g.id, g);
  }
  const guncel = [...guncelHarita.values()];
  const silinecek = [
    ...new Set(planlar.flatMap((p) => p.silinecek).filter((id) => !guncelHarita.has(id))),
  ];

  if (yeni.length > 0) {
    const { data, error } = await supabaseAdmin.from("zone_visits").insert(yeni).select("id");
    if (!error) {
      sonuc.acilan = data?.length ?? 0;
    } else if (error.code === "23505") {
      // Araç+bölge başına tek-açık yarışı: karşı taraf az önce yazmış. Parti
      // tümden düşmesin diye satır satır denenir, çakışan atlanır.
      for (const y of yeni) {
        const { error: e2 } = await supabaseAdmin.from("zone_visits").insert(y);
        if (!e2) sonuc.acilan++;
        else if (e2.code !== "23505") {
          console.error(`[zone-visits] ziyaret açılamadı: ${e2.message}`);
        }
      }
    } else {
      console.error(`[zone-visits] ziyaret açılamadı: ${error.message}`);
    }
  }

  if (guncel.length > 0) {
    const { error } = await supabaseAdmin
      .from("zone_visits")
      .upsert(guncel, { onConflict: "id" });
    if (error) {
      console.error(`[zone-visits] ziyaret güncellenemedi: ${error.message}`);
    } else {
      sonuc.kapanan = guncel.filter((g) => g.ended_at !== null).length;
      sonuc.ilerleyen = guncel.length - sonuc.kapanan;
    }
  }

  if (silinecek.length > 0) {
    const { error } = await supabaseAdmin.from("zone_visits").delete().in("id", silinecek);
    if (error) {
      console.error(`[zone-visits] kısa ziyaret silinemedi: ${error.message}`);
    } else {
      sonuc.silinen = silinecek.length;
    }
  }

  return sonuc;
}

/** Sinyali kesilmiş açık ziyaretleri kapatan eşik. */
const ZIYARET_GAP_MS = 30 * 60 * 1000;

/**
 * BEKÇİ — sinyali kesilmiş açık ziyaretleri kapatır.
 *
 * `ended_at = last_seen_at`, `end_reason='gap_timeout'`: GÖZLEMLENMEMİŞ SÜRE
 * ASLA SAYILMAZ. Cihaz susmuşsa aracın hâlâ müşteride olduğunu bilmiyoruz;
 * bildiğimiz son an neyse süre orada durur. `reconcileIdleEpisodes`in birebir
 * aynı deseni. EK SORGU YOK: açık ziyaretlerin tamamı tur başında okundu.
 *
 * Eşiği dolduramadan susan ziyaret kapatılmaz, SİLİNİR — 40 saniyelik bir
 * yaklaşma, cihaz sustuğu için "40 sn'lik müşteri ziyareti" diye faturaya
 * ek olamaz.
 */
export function gapTimeoutKapanislari(
  acik: AcikZiyaret[],
  bolgeler: MusteriBolgesi[],
  simdiMs: number = Date.now()
): ZiyaretPlani {
  const plan = bosPlan();
  const esikSn = new Map(bolgeler.map((b) => [b.id, Math.max(1, b.min_dwell_s)]));
  for (const z of acik) {
    if (simdiMs - ms(z.last_seen_at) <= ZIYARET_GAP_MS) continue;
    const sure = ms(z.last_seen_at) - ms(z.started_at);
    if (sure >= (esikSn.get(z.zone_id) ?? 120) * 1000) {
      plan.guncel.push({
        id: z.id,
        vehicle_id: z.vehicle_id,
        zone_id: z.zone_id,
        worker_id: z.worker_id,
        started_at: z.started_at,
        last_seen_at: z.last_seen_at,
        ended_at: z.last_seen_at,
        end_reason: "gap_timeout",
      });
    } else {
      plan.silinecek.push(z.id);
    }
  }
  return plan;
}
