import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { flespiAuthorized } from "@/lib/flespi-auth";
import { fetchDeviceMessages } from "@/lib/flespi";
import {
  idleCursorsBatch,
  lastRecordedAt,
  lastRecordedAtBatch,
  maybeBackfillVin,
  reconcileDtc,
  reconcileIdleEpisodes,
  saveDtc,
  saveIdleEpisodes,
  saveTelemetry,
  saveTelemetryBatch,
  saveVehicleEvents,
} from "@/lib/telemetry";
import { processAutoShifts, type AutoShiftSummary } from "@/lib/auto-shift";
import { sayacIle } from "@/lib/query-counter";

// Service-role Supabase + outbound flespi fetch → must run on Node, never edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// First sync for a device with no prior rows: look back this far so we don't
// pull the device's entire stored history.
const FIRST_WINDOW_MS = 60 * 60 * 1000; // 1 h

/**
 * flespi → device_telemetry sync. Polls every vehicle that has a flespi_device_id,
 * pulls messages since that vehicle's last stored point, and upserts them.
 * Meant to be hit by an external scheduler (cron-job.org / GitHub Actions /
 * Vercel cron) every ~30–60 s, mirroring the shift-watchdog cron.
 *
 * Phone GPS (driver_locations / recordLocation) is NOT involved here.
 *
 * Auth: requires FLESPI_SYNC_SECRET, accepted as `?secret=` (external cron) or
 * `Authorization: Bearer <secret>` (Vercel cron). Comparison is timing-safe.
 * The auth check is shared with /api/flespi/ingest via lib/flespi-auth.
 */
type VehRow = { id: string; plate: string; flespi_device_id: number };

async function runSync() {
  // test-visible: YAZMA yolu — cron'un telemetri çekeceği cihazlı araçlar.
  // Test aracının flespi_device_id'si NULL, yani aşağıdaki filtre onu zaten
  // dışarıda bırakıyor. Eleme koymak ileride gerçek bir araç test işaretlenirse
  // o aracın telemetrisini sessizce durdururdu.
  const { data, error } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate, flespi_device_id")
    .not("flespi_device_id", "is", null);
  if (error) {
    // Don't swallow a vehicles-query failure as a silent { ok:true, vehicles:0 }:
    // log it and throw so GET() returns 500 and the cron surfaces the failure.
    console.error("[flespi/sync] vehicles sorgusu başarısız:", error.message);
    throw new Error(`vehicles query failed: ${error.message}`);
  }
  const vehicles = (data ?? []) as VehRow[];

  const perVehicle: {
    plate: string;
    device: number;
    fetched: number;
    saved: number;
    events?: number;
    error?: string;
  }[] = [];
  let totalSaved = 0;

  /**
   * İMLEÇLER — DÖNGÜDEN ÖNCE, TEK SORGUDA (#84 Adım 1, 18.08.2026).
   *
   * Eskiden döngü içinde araç başına `lastRecordedAt(v.id)` çağrılıyordu:
   * 29 araç = 29 gidiş-dönüş. Ölçüldü (Adım 0 sayacı): tur başına 169 sorgu,
   * 92'si `device_telemetry` ve büyük kısmı buydu.
   *
   * GERİ DÜŞÜŞ KORUNDU (Adım 5): toplu okuma `null` dönerse (migration 060
   * koşmamış ya da RPC hata verdi) `imlecler` null kalır ve döngü aynen eski
   * yola, araç-araç `lastRecordedAt`'e döner. Tur davranışı DEĞİŞMEZ, yalnız
   * kazanç gerçekleşmez — yani bu deploy migration'dan ÖNCE de güvenli.
   */
  const imlecler = await lastRecordedAtBatch(vehicles.map((v) => v.id));

  /**
   * RÖLANTİ İMLEÇLERİ — DÖNGÜDEN ÖNCE, TEK SORGUDA (#84 Adım 2, migration 061).
   *
   * `saveIdleEpisodes` araç başına İKİ okuma yapıyordu (açık epizod + son
   * kapalının bitişi): 29 araçta 58 gidiş-dönüş. Adım 1'den sonra bu, turun
   * en büyük kalemiydi (141 sorgunun 59'u).
   *
   * ⚠️ 23505 YARIŞ KORUMASI ETKİLENMEZ: `saveIdleEpisodes` içindeki tekil
   * ihlal sonrası yeniden okuma CANLI kalır (bkz. lib/telemetry.ts). Burada
   * toplanan yalnız TUR BAŞINDAKİ ilk okumadır.
   *
   * GERİ DÜŞÜŞ (Adım 5): null dönerse `seed` verilmez ve `saveIdleEpisodes`
   * araç-araç eski yola düşer — davranış birebir aynı.
   */
  const rolantiImlecleri = await idleCursorsBatch(vehicles.map((v) => v.id));

  /**
   * İKİ GEÇİŞ (#84 Adım 3). Geçiş 1 flespi'den çeker ve telemetri DIŞINDAKİ
   * yazmaları yapar; sonra telemetri TEK partide yazılır; Geçiş 2 yalnız
   * telemetriye BAĞIMLI işleri (DTC) yapar.
   */
  const toplananlar: {
    v: VehRow;
    points: Awaited<ReturnType<typeof fetchDeviceMessages>>["points"];
    dtc: Awaited<ReturnType<typeof fetchDeviceMessages>>["dtc"];
    dtcNumber: number | null;
  }[] = [];

  for (const v of vehicles) {
    try {
      // Map'te YOKLUK "bu aracın hiç kaydı yok" demektir (RPC kaydı olmayan
      // araç için satır döndürmez) → aşağıdaki ilk-pencere dalı çalışır.
      // Map'in KENDİSİ null ise toplu okuma başarısız olmuştur → tekil sorgu.
      const last = imlecler
        ? imlecler.get(v.id) ?? null
        : await lastRecordedAt(v.id);
      // Inclusive at the exact last timestamp (sub-second precision kept): the
      // single boundary message is re-fetched but dropped by the upsert, so no
      // point is ever skipped between polls.
      const sinceTs = last
        ? new Date(last).getTime() / 1000
        : (Date.now() - FIRST_WINDOW_MS) / 1000;

      const { points, events, dtc, idle } = await fetchDeviceMessages(
        v.flespi_device_id,
        sinceTs
      );
      /**
       * TELEMETRİ YAZMASI ERTELENDİ (#84 Adım 3).
       *
       * Noktalar burada yalnız TOPLANIR; yazma döngüden sonra tek partide
       * yapılır. `saved` bu yüzden şimdilik 0; gerçek sayı toplu yazmadan
       * sonra `perVehicle`e işlenir.
       *
       * ⚠️ SIRA KORUNDU: `saveDtc` en güncel km'yi `device_telemetry`den
       * OKUYOR ve kendi yorumunda "saveTelemetry bu batch'i ÖNCE yazdığı için
       * güncel km zaten DB'de" diyor. Bu yüzden DTC işleri (saveDtc +
       * reconcileDtc) BU DÖNGÜDE KALMADI, toplu yazmadan SONRAKİ ikinci
       * geçişe alındı. Yazmayı ertelemek DTC'yi bayat km'yle beslerdi.
       */
      const saved = 0;
      // Rölanti epizodu (migration 024) — kendi try/catch'inde; GPS senkronunu
      // ASLA düşürmez.
      if (idle.length > 0) {
        try {
          await saveIdleEpisodes(v.id, idle, rolantiImlecleri?.get(v.id));
        } catch (err) {
          console.error(
            `[flespi/sync] ${v.plate}: idle_episodes yazılamadı:`,
            err instanceof Error ? err.message : err
          );
        }
      }
      // Olay kaydı GPS akışını ASLA düşürmesin (örn. migration 018 henüz
      // çalıştırılmadıysa): kendi try/catch'i var, hata sadece loglanır.
      let savedEvents = 0;
      if (events.length > 0) {
        try {
          savedEvents = await saveVehicleEvents(v.id, events);
        } catch (err) {
          console.error(
            `[flespi/sync] ${v.plate}: vehicle_events yazılamadı:`,
            err instanceof Error ? err.message : err
          );
        }
      }
      // DTC işleri BU DÖNGÜDE DEĞİL — telemetri yazıldıktan sonraki ikinci
      // geçişte (#84 Adım 3, sıra bağımlılığı yukarıda anlatıldı). Girdileri
      // burada toplanır.
      // VIN tek seferlik backfill — kendi try/catch'inde; GPS akışını düşürmez.
      const vin = points.find((p) => p.vin)?.vin ?? null;
      if (vin) {
        try {
          await maybeBackfillVin(v.id, vin);
        } catch (err) {
          console.error(
            `[flespi/sync] ${v.plate}: VIN backfill başarısız:`,
            err instanceof Error ? err.message : err
          );
        }
      }
      // DTC bekçisinin girdisi: bu batch'in EN YENİ dtc_number değeri.
      // Kullanımı ikinci geçişte (telemetri yazıldıktan sonra).
      let dtcNumber: number | null = null;
      for (let i = points.length - 1; i >= 0; i--) {
        if (points[i].dtc_number !== null) {
          dtcNumber = points[i].dtc_number;
          break;
        }
      }
      // Toplu yazma + ikinci geçiş için taşınan iş
      toplananlar.push({ v, points, dtc, dtcNumber });
      perVehicle.push({
        plate: v.plate,
        device: v.flespi_device_id,
        fetched: points.length,
        saved,
        events: savedEvents,
      });
    } catch (e) {
      perVehicle.push({
        plate: v.plate,
        device: v.flespi_device_id,
        fetched: 0,
        saved: 0,
        error: e instanceof Error ? e.message : "error",
      });
    }
  }

  /**
   * TELEMETRİ TEK PARTİDE YAZILIR (#84 Adım 3) — döngüden sonra, DTC'den önce.
   *
   * GERİ DÜŞÜŞ (Adım 5): toplu yazma `null` dönerse araç-araç `saveTelemetry`
   * çalışır. Kısmen yazılmış parti zarar vermez — upsert idempotent, tekrar
   * yazmak no-op.
   */
  const yazilanlar = await saveTelemetryBatch(
    toplananlar.map((t) => ({ vehicleId: t.v.id, points: t.points }))
  );
  for (const t of toplananlar) {
    let saved: number;
    if (yazilanlar) {
      saved = yazilanlar.get(t.v.id) ?? 0;
    } else {
      try {
        saved = await saveTelemetry(t.v.id, t.points);
      } catch (err) {
        console.error(
          `[flespi/sync] ${t.v.plate}: telemetri yazılamadı:`,
          err instanceof Error ? err.message : err
        );
        saved = 0;
      }
    }
    totalSaved += saved;
    const satir = perVehicle.find((p) => p.plate === t.v.plate);
    if (satir) satir.saved = saved;
  }

  /**
   * GEÇİŞ 2 — YALNIZ TELEMETRİYE BAĞIMLI İŞLER.
   *
   * `saveDtc` en güncel km'yi `device_telemetry`den okuyor ve kendi yorumunda
   * "saveTelemetry bu batch'i ÖNCE yazdığı için güncel km zaten DB'de" diyor.
   * `reconcileDtc` de sonunda `saveDtc` çağırıyor. Bu yüzden ikisi de toplu
   * yazmadan SONRAYA alındı — sıra bağımlılığı korundu.
   * Her ikisi de kendi try/catch'inde: GPS akışını ASLA düşürmezler.
   */
  for (const t of toplananlar) {
    if (t.dtc.length > 0) {
      try {
        await saveDtc(t.v.id, t.dtc);
      } catch (err) {
        console.error(
          `[flespi/sync] ${t.v.plate}: vehicle_dtc yazılamadı:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    if (t.dtcNumber !== null) {
      try {
        await reconcileDtc(t.v.id, t.v.flespi_device_id, t.dtcNumber);
      } catch (err) {
        console.error(
          `[flespi/sync] ${t.v.plate}: DTC bekçisi başarısız:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  // Rölanti bekçisi (migration 024): sinyali kesilmiş açık epizodları
  // last_seen_at ile kapat. throw etmez — GPS senkronunu düşürmez.
  let idleClosed = 0;
  try {
    idleClosed = await reconcileIdleEpisodes();
  } catch (err) {
    console.error(
      "[flespi/sync] idle bekçisi başarısız:",
      err instanceof Error ? err.message : err
    );
  }

  // Otomatik vardiya (İş 1): telemetri yazıldıktan sonra kontak-temelli
  // başlat/bitir değerlendirmesi. processAutoShifts asla throw etmez —
  // GPS senkronunu hiçbir koşulda düşürmez.
  const autoShifts: AutoShiftSummary = await processAutoShifts();

  return {
    ok: true,
    vehicles: vehicles.length,
    totalSaved,
    perVehicle,
    idleClosed,
    autoShifts,
  };
}

/**
 * Turu SORGU SAYACI kabında koşturur (#84 Adım 0, 18.08.2026).
 *
 * Sayaç yalnız ölçer; turun davranışına dokunmaz. Cevaba `sorgu` alanı eklenir:
 * `{ toplam, kaynak: { tablo: adet } }`. Kaynak dökümü şart — hangi adımın
 * neyi düşürdüğünü toplam rakam söylemez, tablo bazlı döküm söyler.
 *
 * ⚠️ Sayılan şey PostgREST ÇAĞRISI, satır değil. Sayfalı okumalar her sayfa
 * için ayrı sayılır; maliyeti yaratan da o.
 */
async function turuOlc() {
  return sayacIle(async (oku) => {
    const sonuc = await runSync();
    const sorgu = oku();
    // Ölçüm loga da düşer: cevap gövdesi cron tarafından okunmuyor, ama
    // Vercel logundan geçmişe dönük karşılaştırma yapılabilsin.
    console.log(
      `[flespi/sync] SORGU toplam=${sorgu.toplam} kaynak=${JSON.stringify(sorgu.kaynak)}`
    );
    return { ...sonuc, sorgu };
  });
}

export async function GET(req: NextRequest) {
  if (!flespiAuthorized(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    return NextResponse.json(await turuOlc());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 }
    );
  }
}

// Allow POST too (some schedulers default to POST).
export async function POST(req: NextRequest) {
  return GET(req);
}
