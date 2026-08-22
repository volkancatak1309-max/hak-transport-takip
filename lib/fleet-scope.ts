import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase";
import { startOfTodayVienna } from "@/lib/format";
import type { VehicleFleet } from "@/lib/types";

/**
 * FİLO KAPSAMI (migration 029) — filo şefi ne görür?
 *
 * Filo şefi kendi filosunun ARAÇLARINI ve o araçlara atanmış ŞOFÖRLERİ görür.
 * Patron (is_admin) her şeyi görür; onun kapsamı `null`'dır ve hiçbir sorgu
 * daraltılmaz.
 *
 * ── Filo–şoför bağı: İKİ KAYNAK (22.08.2026'da değişti) ────────────────────
 * Şoförün filosu ÖNCE yalnız araçtan türetiliyordu
 * (vehicles.fleet → vehicles.assigned_worker_id). Artık İKİ kaynak var:
 *   1. araç ataması (eskisi gibi)
 *   2. `workers.fleet` — AÇIK bağlılık, araçtan bağımsız (migration 072)
 *
 * İkincisi neden eklendi: türetme, aracı olmayan şoförü hiçbir filoya
 * koyamıyordu (aşağıya bakın). `workers.fleet` araç filosu değiştiğinde
 * eskiyen bir kopya DEĞİL, bağımsız bir olgudur: kişi depoya/filoya bağlıdır,
 * bugün hangi araca bindiğine değil.
 *
 * ── GEÇİCİ ARAÇ (22.07.2026) ───────────────────────────────────────────────
 * Şoför bozulma/izin gibi durumlarda BAŞKA FİLODAN araç seçebilir
 * (app/actions/shift.ts, startShiftManualAction). Bu yüzden kapsam iki
 * eksenlidir ve ikisi FARKLI sorulara cevap verir:
 *
 *   workerIds  → "benim şoförüm kim?"  — VARDİYA verisi bununla daraltılır.
 *                Şoför hangi aracı kullanırsa kullansın şefinin listesinde
 *                kalır (kural 7). Araçla daraltılsaydı ödünç araç kullanan
 *                şoför kendi şefinden düşer, karşı şefe görünürdü.
 *   vehicleIds → "benim aracım hangisi?" — ARAÇ verisi (konum, ceza, araç
 *                listesi) bununla daraltılır. Filo araçlarına EK OLARAK
 *                şoförlerimin bugün kullandığı yabancı araçlar da girer;
 *                yoksa şef şoförünü listede görür ama haritada göremezdi.
 *
 * Bilinçli ÖRTÜŞME (Volkan onayı): ödünç verilen araçta bordo şef ARACI,
 * mavi şef ŞOFÖRÜ ve o aracın konumunu görür. İkisinin de meşru menfaati var.
 *
 * ── 🔴 KARAR DEĞİŞTİ (Volkan, 22.08.2026) ─────────────────────────────────
 * ESKİ KURAL (Volkan onayı, 22.07.2026): "atanmış aracı olmayan şoförün
 * filosu yoktur ve hiçbir şefin kapsamına girmez; şefe göstermek iki şefin de
 * aynı kişiyi listesinde görmesi demek olurdu."
 *
 * NEDEN DEĞİŞTİ: kural sessiz bir kör nokta üretiyordu. 22.08.2026 canlı
 * ölçümü — 28 şoförün 2'si hiçbir şefin kapsamında değildi ve BİRİ O AN AÇIK
 * VARDİYADAYDI (son kullandığı araç bordo). Şefi onu göremiyor, izin talebini
 * onaylayamıyor, raporunda bulamıyordu.
 *
 * Ayrıca varsayım dar: dünya ölçeğinde araçsız şoför istisna değil KURAL —
 * havuz filosu, yeni işe giren, aracı serviste olan, yalnız römork çeken.
 *
 * YENİ KURAL: araçsız şoför de şefin kapsamındadır. Bağlılık `workers.fleet`
 * ile AÇIKÇA tutulur; bilinmiyorsa (yeni giren, hiç geçmişi yok) kişi HER
 * şefe görünür. Eski kuralın kaçındığı çift görünme kabul edildi, çünkü bu
 * depoda sessiz eksik yasaktır (lib/km-quality.ts, partialVehicles):
 * görünmeyen şoför sessiz bir eksiktir, iki listede görünen şoför gürültülü
 * ve düzeltilebilir bir fazladır.
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
    const workerIds = [
      ...new Set(rows.map((v) => v.assigned_worker_id).filter(Boolean) as string[]),
    ];

    // ── ARAÇSIZ ŞOFÖR DE KAPSAMDA (migration 072, 22.08.2026) ───────────────
    //
    // Kapsam bugüne kadar YALNIZ `vehicles.assigned_worker_id`'den türüyordu.
    // Bunun sessiz sonucu şuydu: aracı atanmamış bir şoför HİÇBİR şefin
    // kapsamına girmiyor, yani şefi onu göremiyor, izin talebini onaylayamıyor,
    // raporunda bulamıyor. CANLIDA ÖLÇÜLDÜ (22.08.2026): 28 şoförün 2'si bu
    // durumdaydı ve biri O AN AÇIK VARDİYADAYDI — son kullandığı araç bordo.
    // Yani delik teorik değil, o gün ısırıyordu.
    //
    // Dünya ölçeğinde araçsız şoför istisna değil kural: havuz filosu, yeni
    // işe giren, aracı serviste olan, sadece römork çeken. "Araç = kimlik"
    // varsayımı HAK61'in tesadüfi durumuydu, bir tasarım kararı değil.
    //
    // ── NEDEN YENİ KOLON ────────────────────────────────────────────────────
    // Şoförü filoya bağlayan bir alan YOKTU. Araçsızları düpedüz TÜM şeflere
    // göstermek de çözerdi ama çift sayım üretirdi: o kişinin vardiyası, km'si
    // ve olayı iki filonun raporunda birden görünürdü. `workers.fleet`
    // bağlılığı AÇIKÇA tutar; çift görünme yalnız bağlılığın BİLİNMEDİĞİ
    // durumda kalır (aşağıda "İKİ KATMAN").
    //
    // ── MIGRATION ÇALIŞMAMIŞ KURULUMDA ─────────────────────────────────────
    // Kolon yoksa sorgu hata verir ve kapsam BUGÜNKÜ hâliyle devam eder —
    // davranış birebir aynı. Bu yüzden kod migration'dan ÖNCE güvenle
    // yayınlanabilir; 072 koştuğunda kendiliğinden devreye girer.
    // (Aynı desen: lib/mobile-auth.ts token_version, app/actions/geofences.ts.)
    // ── İKİ KATMAN ──────────────────────────────────────────────────────────
    // (1) `fleet = <bu filo>`  → o filonun insanı, aracı olsun olmasın.
    // (2) `fleet IS NULL` ve HİÇBİR araca atanmamış → HER şefin kapsamında.
    //
    // (2) neden var: geri dolgu bağlılığı geçmişten okuyor, ama HİÇ geçmişi
    // olmayan biri (bugün işe giren, henüz aracı ve vardiyası yok) NULL kalır.
    // Onu dışarıda bırakmak, kapatmaya çalıştığımız deliğin aynısını yeni
    // personel için açık tutmak olurdu.
    //
    // Çift sayım kabul edildi ve GÖRÜNÜR: bu depoda sessiz eksik yasak
    // (lib/km-quality.ts, partialVehicles). Görünmez şoför sessiz bir
    // eksiktir; iki listede birden görünen şoför gürültülü ve düzeltilebilir
    // bir fazladır. NULL kalan kişi zaten araçsız ve geçmişsizdir, yani
    // bugün toplanacak verisi de yoktur.
    //
    // ⚠️ Aracı OLAN ama fleet'i NULL olan kişi (2)'ye GİRMEZ: o zaten araç
    // yolundan kendi filosunda; ikinci filoya da eklemek onu gerçekten iki
    // yere yazardı.
    // test-filtered: is_test satirlari sorguda ELENIYOR (.not("is_test","is",true)).
    // Yardimci (withoutTestRows) kullanilmadi cunku bu sorgu KAPSAMIN KENDISI —
    // yardimci lib/test-data.ts'ten kapsam okuyor, kapsam kurulurken cagirmak
    // dongu olurdu. Ayni gerekce ustteki vehicles sorgusunda da gecerli.
    const ek = await supabaseAdmin
      .from("workers")
      .select("id, fleet, is_admin, counts_as_driver")
      .or(`fleet.eq.${fleet},fleet.is.null`)
      .eq("is_active", true)
      .not("is_test", "is", true);

    if (!ek.error) {
      // Herhangi bir filoda araca atanmış olan HERKES — (2)'den elenecekler.
      // test-filtered: TEST-001 elenir (.not("is_test","is",true)); yardimci
      // kullanilmama gerekcesi yukaridakiyle ayni (kapsamin kendisi).
      const { data: tumAtanmis } = await supabaseAdmin
        .from("vehicles")
        .select("assigned_worker_id")
        .not("assigned_worker_id", "is", null)
        .not("is_test", "is", true);
      const atanmisSet = new Set(
        ((tumAtanmis ?? []) as { assigned_worker_id: string }[]).map(
          (v) => v.assigned_worker_id
        )
      );

      type EkSatir = {
        id: string;
        fleet: string | null;
        is_admin: boolean | null;
        counts_as_driver: boolean | null;
      };
      for (const w of (ek.data ?? []) as EkSatir[]) {
        if (w.fleet === null) {
          // Yalnız GERÇEKTEN ŞOFÖR olanlar — kardeş kapıların aynı cümlesi
          // (migration 041 muafiyeti). Aksi hâlde filosuz her yönetici
          // hesabı her şefin kapsamına düşerdi.
          if (w.is_admin === true && w.counts_as_driver !== true) continue;
          if (atanmisSet.has(w.id)) continue;
        }
        if (!workerIds.includes(w.id)) workerIds.push(w.id);
      }
    }

    // GEÇİCİ ARAÇLAR: şoförlerimin BUGÜN fiilen kullandığı araçlar kapsama
    // eklenir (başka filodan olsa bile). Yalnız bugün — dünkü ödünç araç
    // bugünün kapsamına girmez, seçim vardiya satırında yaşar ve ertesi gün
    // kendiliğinden düşer.
    const borrowed: string[] = [];
    if (workerIds.length > 0) {
      // ⚠️ ASİMETRİ, BİLİNÇLİ: `workers.fleet` yolu `is_active=true` süzer, araç
      // yolu süzmez. Araç yoluna eklemek BUGÜNKÜ davranışı değiştirirdi (pasif
      // ama aracı üstünde duran kişi bugün kapsamda) ve bu ayrı bir karardır.
      //
      // test-visible: workerIds İKİ kaynaktan gelir — filo araçlarına atanmış
      // şoförler ve `workers.fleet` bağlılığı (072). İKİSİ DE test kaydını eler
      // (vehicles.is_test / workers.is_test), yani buradan test vardiyası
      // çekilemez.
      const { data: used } = await supabaseAdmin
        .from("time_entries")
        .select("vehicle_id")
        .in("worker_id", workerIds)
        .gte("started_at", startOfTodayVienna().toISOString())
        .not("vehicle_id", "is", null);
      for (const r of (used ?? []) as { vehicle_id: string }[]) {
        borrowed.push(r.vehicle_id);
      }
    }

    const vehicleIds = [...new Set([...rows.map((v) => v.id), ...borrowed])];
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
