import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase";
import type { VehicleFleet } from "@/lib/types";

/**
 * FİLO KAPSAMI (migration 029) — filo şefi ne görür?
 *
 * Filo şefi kendi filosunun ARAÇLARINI ve o araçlara atanmış ŞOFÖRLERİ görür.
 * Patron (is_admin) her şeyi görür; onun kapsamı `null`'dır ve hiçbir sorgu
 * daraltılmaz.
 *
 * ── Filo–şoför bağı neden TÜRETİLİYOR ──────────────────────────────────────
 * Şoförün filosu `workers` üzerinde ayrı bir kolonda TUTULMUYOR; araçtan
 * türetiliyor:  vehicles.fleet → vehicles.assigned_worker_id.
 * Gerekçe: şoför↔araç ilişkisinin tek kaynağı zaten vehicles.assigned_worker_id
 * (workers.plate bile ondan türetilen bir ayna). İkinci bir filo kolonu koymak,
 * araç filosu değiştiğinde sessizce eskiyen bir kopya üretirdi.
 *
 * SONUCU — bilinçli boşluk: ATANMIŞ ARACI OLMAYAN şoförün filosu yoktur ve
 * HİÇBİR şefin kapsamına girmez. Bu bir kayıp değil, karar: o kişiler patronun
 * panosunda ayrı bir "filosuz personel" grubunda gösterilir (Volkan onayı,
 * 22.07.2026). Şefe göstermek, iki şefin de aynı kişiyi kendi listesinde
 * görmesi demek olurdu.
 *
 * ── Neden çerezden değil, DB'den ───────────────────────────────────────────
 * `is_admin` oturum çerezine giriş anında yazılıyor ve çerez 30 gün yaşıyor.
 * Rolü çereze koysaydık, bir şefin yetkisi kaldırıldığında bu bir ay boyunca
 * etkisiz kalırdı. Bu yüzden rol HER İSTEKTE id ile okunur (tek indeksli
 * sorgu). Aynı gerekçeyle app/actions/shift.ts de is_active'i yeniden okuyor.
 *
 * ── Migration öncesi ───────────────────────────────────────────────────────
 * `managed_fleet` kolonu yoksa sorgu hata döner ve "şef değil" kabul edilir →
 * uygulama bugünkü davranışını korur. lib/test-data.ts ile aynı fail-safe.
 */

export type FleetScope = {
  /** Görülebilir filo; `null` = kısıt yok (patron). */
  fleet: VehicleFleet | null;
  /** Kapsamdaki araç id'leri. `fleet` null ise boş (kısıt uygulanmaz). */
  vehicleIds: string[];
  /** Kapsamdaki şoför id'leri (o araçlara atanmış olanlar). */
  workerIds: string[];
  /** Kısıt uygulanacak mı? `fleet !== null` ile aynı; okunurluk için. */
  restricted: boolean;
  isFleetVehicle: (id: string | null | undefined) => boolean;
  isFleetWorker: (id: string | null | undefined) => boolean;
};

/** Kısıtsız kapsam — patron ve migration öncesi durum. */
export const UNRESTRICTED: FleetScope = {
  fleet: null,
  vehicleIds: [],
  workerIds: [],
  restricted: false,
  isFleetVehicle: () => true,
  isFleetWorker: () => true,
};

/** Bir çalışanın yönettiği filo; şef değilse (ya da kolon yoksa) null. */
export const getManagedFleet = cache(
  async (workerId: string): Promise<VehicleFleet | null> => {
    const { data, error } = await supabaseAdmin
      .from("workers")
      .select("managed_fleet, is_active")
      .eq("id", workerId)
      .maybeSingle();
    // Kolon yok (migration öncesi) ya da sorgu hatası → şef değil.
    if (error || !data) return null;
    // İşten ayrılmış birinin şeflik yetkisi de düşer.
    if (data.is_active !== true) return null;
    const f = data.managed_fleet as string | null;
    return f === "bordo" || f === "mavi" ? (f as VehicleFleet) : null;
  }
);

/**
 * Bir filonun araç + şoför kimlikleri. İstek başına tek sorgu (React cache):
 * pano on ayrı yerde çağırsa da Supabase'e bir kez gidilir.
 */
export const getFleetScope = cache(
  async (fleet: VehicleFleet | null): Promise<FleetScope> => {
    if (!fleet) return UNRESTRICTED;

    // test-visible: kapsamin KENDISI — filoyu tanimlayan sorgu bu.
    // Test araclari BURADA elenir (savunma katmani): TEST-001 fleet='mavi'
    // oldugu icin kapsama girerdi; asagi akista test filtresi zaten var ama
    // kaynakta elemek, o filtrenin unutuldugu bir yerde de korur.
    const { data, error } = await supabaseAdmin
      .from("vehicles")
      .select("id, assigned_worker_id")
      .eq("fleet", fleet)
      .not("is_test", "is", true);

    if (error) {
      // Kapsam çözülemedi. FAIL-CLOSED: kısıtsız kapsama DÜŞMEYİZ — o, şefe
      // tüm filoyu açardı. Boş kümeyle devam ederiz: şef veri göremez, ama
      // başkasının verisini de asla görmez.
      return {
        fleet,
        vehicleIds: [],
        workerIds: [],
        restricted: true,
        isFleetVehicle: () => false,
        isFleetWorker: () => false,
      };
    }

    const rows = (data ?? []) as { id: string; assigned_worker_id: string | null }[];
    const vehicleIds = rows.map((v) => v.id);
    const workerIds = [
      ...new Set(rows.map((v) => v.assigned_worker_id).filter(Boolean) as string[]),
    ];
    const vSet = new Set(vehicleIds);
    const wSet = new Set(workerIds);

    return {
      fleet,
      vehicleIds,
      workerIds,
      restricted: true,
      isFleetVehicle: (id) => (id ? vSet.has(id) : false),
      isFleetWorker: (id) => (id ? wSet.has(id) : false),
    };
  }
);

/** `.in(col, ...)` uygulayabilen her PostgREST builder'ı. */
type Filterable = {
  in(column: string, values: readonly string[]): unknown;
};

/**
 * SORGU DÜZEYİNDE daraltma: satırlar hiç taşınmaz.
 *
 * Kapsam kısıtsızsa (patron) sorguya DOKUNMAZ. Kısıtlıysa ve id listesi BOŞSA
 * bile `.in(col, [])` uygulanır — sonuç boş küme olur. Bu bilinçlidir: boş
 * listede filtreyi atlamak, şefe TÜM filoyu açardı.
 *
 *   onlyFleet(<time_entries sorgusu>, "vehicle_id", scope.vehicleIds, scope)
 */
export function onlyFleet<Q>(
  query: Q,
  column: string,
  ids: readonly string[],
  scope: FleetScope
): Q {
  if (!scope.restricted) return query;
  return (query as Filterable).in(column, ids) as Q;
}

/**
 * SATIR DÜZEYİNDE daraltma: veri zaten çekilmişse ya da eleme birden çok alana
 * bakıyorsa (hem araç hem şoför).
 *
 *   dropOtherFleets(rows, (r) => ({ vehicle: r.vehicle_id, worker: r.worker_id }), scope)
 *
 * `worker` VE `vehicle` birlikte verilirse İKİSİNDEN BİRİ kapsamdaysa satır
 * kalır: vardiya kaydında araç kapsamdaysa şoför geçici de olsa o filoda
 * çalışıyordur.
 */
export function dropOtherFleets<Row>(
  rows: Row[],
  pick: (row: Row) => { worker?: string | null; vehicle?: string | null },
  scope: FleetScope
): Row[] {
  if (!scope.restricted) return rows;
  return rows.filter((row) => {
    const k = pick(row);
    const hasVehicle = k.vehicle !== undefined && k.vehicle !== null;
    const hasWorker = k.worker !== undefined && k.worker !== null;
    if (hasVehicle && scope.isFleetVehicle(k.vehicle)) return true;
    if (hasWorker && scope.isFleetWorker(k.worker)) return true;
    return false;
  });
}
