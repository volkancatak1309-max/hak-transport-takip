import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * TEST KAYITLARININ GİZLENMESİ (migration 028).
 *
 * Kalıcı bir test şoförü + test aracı var (bkz. db/migrations/028). İkisi de
 * gerçek kayıt gibi davranır — giriş yapar, vardiya açar, mola verir, paket
 * girer, kapatır — ama HAK61'in hiçbir yönetici yüzeyinde görünmezler.
 *
 * ── Neden burada, tek yerde ────────────────────────────────────────────────
 * Sorgulara tek tek `.eq("is_test", false)` serpiştirmek işe yarar ama ileride
 * yazılacak SORGUDA unutulur ve test verisi sessizce sızar. Bunun yerine:
 *   1. Test kayıtlarının kimlikleri istek başına BİR KEZ okunur (getTestScope).
 *   2. Her çağrı noktası aynı iki yardımcıdan birini kullanır — greplenebilir.
 *   3. scripts/check-test-filters.mjs, `vehicles`/`workers` üzerinde ANAHTARSIZ
 *      liste okuması yapıp bu yardımcıları çağırmayan her yeni sorguda derlemeyi
 *      kırar. Asıl koruma odur; kolonun kendisi değil.
 *
 * ── Neden kimlik kümesi, doğrudan SQL filtresi değil ───────────────────────
 * Migration henüz uygulanmamışsa `is_test` kolonu yoktur. Sorgulara doğrudan
 * `.eq("is_test", false)` yazsaydık kolon gelene kadar HER yönetici sorgusu
 * hata döndürür, panel boşalırdı. Burada tek bir sorgu hata alır, boş kümeye
 * düşeriz ve uygulama migration öncesi hâliyle çalışmaya devam eder — test
 * kaydı yalnızca gizlenmemiş olur. Deploy penceresi kimseyi kilitlemez.
 *
 * ── Nereye filtre KONMAZ ───────────────────────────────────────────────────
 * Şoför paneli, giriş, vardiya başlat/bitir ve tüm yazma yolları ANAHTARLI
 * okuma yapar (id / phone / assigned_worker_id). Oralara filtre koymak test
 * hesabını çalışmaz hâle getirir — kuralın amacı tam tersi.
 */

export type TestScope = {
  /** Test şoförlerinin id'leri (çoğunlukla tek eleman). */
  workerIds: string[];
  /** Test araçlarının id'leri. */
  vehicleIds: string[];
  /**
   * Test araçlarının plakaları. fuel_entries / vehicle_maintenance / CO₂
   * raporu araca vehicle_id ile DEĞİL, `vehicle_plate` TEXT'i ile bağlanıyor
   * (FK yok) — o tablolarda eleme plaka üzerinden yapılmak zorunda.
   */
  plates: string[];
  isTestWorker: (id: string | null | undefined) => boolean;
  isTestVehicle: (id: string | null | undefined) => boolean;
  isTestPlate: (plate: string | null | undefined) => boolean;
  /** Gizlenecek en az bir kayıt var mı (migration uygulanmadıysa false). */
  active: boolean;
};

const EMPTY: TestScope = {
  workerIds: [],
  vehicleIds: [],
  plates: [],
  isTestWorker: () => false,
  isTestVehicle: () => false,
  isTestPlate: () => false,
  active: false,
};

/**
 * Test kayıtlarının kimlikleri. React `cache()` ile istek başına tek sorgu:
 * bir sayfa on ayrı yerde çağırsa da Supabase'e bir kez gidilir.
 *
 * Kolon yoksa (migration 028 uygulanmamış) sessizce boş kümeye düşer.
 */
export const getTestScope = cache(async (): Promise<TestScope> => {
  const [wRes, vRes] = await Promise.all([
    // test-visible: elemenin KENDİSİ — test kayıtlarını bulan sorgu bu.
    supabaseAdmin.from("workers").select("id").eq("is_test", true),
    // test-visible: elemenin KENDİSİ — test kayıtlarını bulan sorgu bu.
    supabaseAdmin.from("vehicles").select("id, plate").eq("is_test", true),
  ]);

  // Migration öncesi: 42703 undefined_column → bugünkü davranış korunur.
  if (wRes.error || vRes.error) return EMPTY;

  const workerIds = ((wRes.data ?? []) as { id: string }[]).map((w) => w.id);
  const vehicleRows = (vRes.data ?? []) as { id: string; plate: string }[];
  const vehicleIds = vehicleRows.map((v) => v.id);
  const plates = vehicleRows.map((v) => v.plate);

  const wSet = new Set(workerIds);
  const vSet = new Set(vehicleIds);
  const pSet = new Set(plates);

  return {
    workerIds,
    vehicleIds,
    plates,
    isTestWorker: (id) => (id ? wSet.has(id) : false),
    isTestVehicle: (id) => (id ? vSet.has(id) : false),
    isTestPlate: (plate) => (plate ? pSet.has(plate) : false),
    active: workerIds.length > 0 || vehicleIds.length > 0,
  };
});

/**
 * `.not(col, "in", ...)` uygulayabilen her PostgREST builder'ı.
 *
 * Q'ya `Q extends Excludable<Q>` biçiminde ÖZYİNELİ kısıt VERİLMEZ: Supabase'in
 * builder tipleri zaten çok katmanlı, özyineli kısıt eklenince TypeScript
 * "Type instantiation is excessively deep" ile derlemeyi kırıyor (azg-report.ts
 * sayfalama sarmalayıcısında yakalandı). Bunun yerine giriş tipi aynen
 * döndürülür, `.not` çağrısı tek noktada cast edilir.
 */
type Excludable = {
  not(column: string, operator: string, value: unknown): unknown;
};

/**
 * SORGU DÜZEYİNDE eleme: satırlar hiç taşınmaz. Büyük tablolarda (time_entries)
 * tercih edilen yol.
 *
 * `ids` boşsa sorguya DOKUNMAZ — migration öncesi ve "hiç test kaydı yok"
 * durumlarında davranış birebir bugünküyle aynı kalır.
 *
 *   withoutTestRows(supabaseAdmin.from("time_entries").select(...), "worker_id", scope.workerIds)
 */
export function withoutTestRows<Q>(
  query: Q,
  column: string,
  ids: readonly string[]
): Q {
  if (ids.length === 0) return query;
  return (query as Excludable).not(column, "in", `(${ids.join(",")})`) as Q;
}

/**
 * SATIR DÜZEYİNDE eleme: sorgu zaten çekilmiş olduğunda ya da eleme birden çok
 * alana bakıyorsa (hem worker hem vehicle). Test kaydı sayısı avuç içi kadar
 * olduğu için bellekte elemenin maliyeti yok.
 *
 *   dropTestRows(rows, (r) => ({ worker: r.worker_id, vehicle: r.vehicle_id }), scope)
 */
export function dropTestRows<Row>(
  rows: Row[],
  pick: (row: Row) => {
    worker?: string | null;
    vehicle?: string | null;
    plate?: string | null;
  },
  scope: TestScope
): Row[] {
  if (!scope.active) return rows;
  return rows.filter((row) => {
    const k = pick(row);
    if (scope.isTestWorker(k.worker)) return false;
    if (scope.isTestVehicle(k.vehicle)) return false;
    if (scope.isTestPlate(k.plate)) return false;
    return true;
  });
}
