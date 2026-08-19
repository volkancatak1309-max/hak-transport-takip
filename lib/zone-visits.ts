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
    .select("id, vehicle_id, zone_id, started_at, last_seen_at")
    .is("ended_at", null);
  if (error) {
    console.warn(
      `[zone-visits] açık ziyaretler okunamadı (${error.message}) — bu turda ziyaret ölçümü atlanıyor`
    );
    return null;
  }
  return (data ?? []) as AcikZiyaret[];
}

type Acilacak = {
  vehicle_id: string;
  zone_id: string;
  worker_id: string | null;
  started_at: string;
  last_seen_at: string;
};
type Kapanacak = { id: string; ended_at: string; end_reason: string };
type Ilerletilecek = { id: string; last_seen_at: string };

export type ZiyaretPlani = {
  acilacak: Acilacak[];
  kapanacak: Kapanacak[];
  ilerletilecek: Ilerletilecek[];
};

/**
 * SAF HESAP — HİÇBİR SORGU ATMAZ (#84 sıfır-döngü-sorgusu kuralı).
 *
 * Bir aracın bu turdaki noktalarını zaman sırasıyla gezer ve ne açılacağını,
 * neyin kapanacağını, hangi açık ziyaretin `last_seen_at`inin ilerleyeceğini
 * belirler. Noktalar `fetchDeviceMessages`ten zaten bellekte; bölgeler tur
 * başında bir kez okundu. Bu fonksiyon test edilebilir olsun diye tamamen
 * yan etkisiz.
 *
 * ── HİSTEREZİS ─────────────────────────────────────────────────────────────
 * Bölgeye giren araç hemen "ziyaret" saymaz: içeride kesintisiz `min_dwell_s`
 * geçmesi gerekir (varsayılan 120 sn). Yoksa bölgenin yanından geçen her araç
 * faturaya girerdi. Ziyaretin başlangıcı eşiğin dolduğu an DEĞİL, **içeri
 * girilen ilk nokta**dır — müşteri sahasında geçen süre kapıda başlar.
 */
export function ziyaretPlaniHesapla(
  vehicleId: string,
  workerId: string | null,
  noktalar: ZiyaretNoktasi[],
  bolgeler: MusteriBolgesi[],
  acik: AcikZiyaret[]
): ZiyaretPlani {
  const plan: ZiyaretPlani = { acilacak: [], kapanacak: [], ilerletilecek: [] };
  if (bolgeler.length === 0 || noktalar.length === 0) return plan;

  const sirali = [...noktalar].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const acikHarita = new Map(acik.map((z) => [z.zone_id, z]));

  for (const b of bolgeler) {
    const mevcut = acikHarita.get(b.id) ?? null;
    // Bu bölge için noktaların içeride/dışarıda dizisi
    let girisAni: string | null = null; // eşik beklerken ilk içeri nokta
    let sonIceri: string | null = null; // içerideki en son doğrulanmış an
    let acildi = false; // bu turda açtık mı (aynı bölgede ikinci açılış olmasın)

    for (const n of sirali) {
      const icerde = pointInCircleM(n.latitude, n.longitude, b.center_lat, b.center_lng, b.radius_m);

      if (icerde) {
        if (mevcut && !acildi) {
          // Zaten açık ziyaret: yalnız son görülme ilerler.
          sonIceri = n.recorded_at;
          continue;
        }
        if (girisAni === null) girisAni = n.recorded_at;
        sonIceri = n.recorded_at;
        if (!acildi) {
          const gecen =
            (new Date(n.recorded_at).getTime() - new Date(girisAni).getTime()) / 1000;
          if (gecen >= b.min_dwell_s) {
            plan.acilacak.push({
              vehicle_id: vehicleId,
              zone_id: b.id,
              worker_id: workerId,
              // Başlangıç = KAPIDAN GİRİŞ anı, eşiğin dolduğu an değil.
              started_at: girisAni,
              last_seen_at: n.recorded_at,
            });
            acildi = true;
          }
        }
      } else {
        // Dışarı çıkıldı.
        if (mevcut && !acildi) {
          plan.kapanacak.push({
            id: mevcut.id,
            ended_at: n.recorded_at,
            end_reason: "exit",
          });
          acikHarita.delete(b.id);
          sonIceri = null;
          break; // bu bölge için bu turda işimiz bitti
        }
        // Eşik dolmadan çıktı → yoldan geçiş, hiçbir şey yazılmaz.
        girisAni = null;
      }
    }

    // Hâlâ içerideyse açık ziyaretin son görülmesi ilerler.
    if (mevcut && !acildi && sonIceri && sonIceri > mevcut.last_seen_at) {
      plan.ilerletilecek.push({ id: mevcut.id, last_seen_at: sonIceri });
    }
  }

  return plan;
}

/**
 * Planı YAZAR — tur başına en fazla 2 sorgu (toplu insert + toplu güncelleme).
 *
 * Güncellemeler tek `upsert` ile gider: kapanışlar ve `last_seen_at`
 * ilerletmeleri aynı partide birleşir. `id` birincil anahtar olduğu için
 * upsert güvenle günceller.
 *
 * Hiçbir hata turu düşürmez — ziyaret ölçümü GPS akışının önüne geçemez.
 */
export async function ziyaretPlaniniYaz(planlar: ZiyaretPlani[]): Promise<{
  acilan: number;
  kapanan: number;
  ilerleyen: number;
}> {
  const acilacak = planlar.flatMap((p) => p.acilacak);
  const kapanacak = planlar.flatMap((p) => p.kapanacak);
  const ilerletilecek = planlar.flatMap((p) => p.ilerletilecek);
  const sonuc = { acilan: 0, kapanan: 0, ilerleyen: 0 };

  if (acilacak.length > 0) {
    // Yarış koruması: uq_zone_visit_open (araç+bölge başına tek açık ziyaret).
    // İki ingest yolu çakışırsa DB reddeder; tur düşmez, satır atlanır.
    const { data, error } = await supabaseAdmin
      .from("zone_visits")
      .upsert(acilacak, { onConflict: "vehicle_id,zone_id", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.error(`[zone-visits] ziyaret açılamadı: ${error.message}`);
    } else {
      sonuc.acilan = data?.length ?? 0;
    }
  }

  const guncellemeler = [
    ...kapanacak.map((k) => ({ id: k.id, ended_at: k.ended_at, end_reason: k.end_reason })),
    ...ilerletilecek.map((i) => ({ id: i.id, last_seen_at: i.last_seen_at })),
  ];
  if (guncellemeler.length > 0) {
    const { error } = await supabaseAdmin
      .from("zone_visits")
      .upsert(guncellemeler, { onConflict: "id" });
    if (error) {
      console.error(`[zone-visits] ziyaret güncellenemedi: ${error.message}`);
    } else {
      sonuc.kapanan = kapanacak.length;
      sonuc.ilerleyen = ilerletilecek.length;
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
 * aynı deseni. Tur başına TEK sorgu, açık ziyaret listesinden beslenir.
 */
export function gapTimeoutKapanislari(
  acik: AcikZiyaret[],
  simdiMs: number = Date.now()
): Kapanacak[] {
  return acik
    .filter((z) => simdiMs - new Date(z.last_seen_at).getTime() > ZIYARET_GAP_MS)
    .map((z) => ({ id: z.id, ended_at: z.last_seen_at, end_reason: "gap_timeout" }));
}
