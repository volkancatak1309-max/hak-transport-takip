import type { NextRequest } from "next/server";
import { verifyMobileRequest, mobileError } from "@/lib/mobile-auth";
import { getManagedFleet, getFleetScope, UNRESTRICTED } from "@/lib/fleet-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { workedMs, kmDiff } from "@/lib/format";
import { isKmMeasured } from "@/lib/km-quality";
import {
  listVehicleEventsInWindow,
  listVehicleIdleEpisodesInWindow,
  listVehicleTrack,
  IDLE_TRIGGER_S,
} from "@/lib/telemetry";
import { eventTone, alarmKademe } from "@/lib/event-ui";
import { fuelConsumedPct, pctToLiters } from "@/lib/fuel-math";
import { classifyRpcError } from "@/lib/reports";
import type { TimeEntry } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/shifts/[id] — TEK vardiyanın hikâyesi.
 *
 * Bugüne dek tek bir vardiyayı çekmenin yolu yoktu (liste ucunda `?id=` bile
 * yok); mobilde kapanmış vardiyaya dokunulunca KİŞİ detayı açılıyordu. Bu uç o
 * boşluğu kapatır ve panelin arşiv çekmecesinden (AdminClient ShiftDetail) daha
 * zengindir: panelde alarm/yakıt/rota HİÇ yok, kopyalanacak hazır görünüm de
 * yok. Vardiyanın kendi alanları yine de panelin çekmecesiyle aynı kaynaktan
 * (`time_entries` + workedMs/kmDiff).
 *
 * ── YETKİ ─────────────────────────────────────────────────────────────────
 *   patron    → her vardiya
 *   filo şefi → yalnız kendi filosunun şoförleri (liste ucuyla aynı kapsam)
 *   şoför     → YALNIZ kendi vardiyası
 * 404 döner, 403 DEĞİL: 403 kaydın var olduğunu doğrular (workers/[id]'nin
 * patron-dosyası kuralıyla aynı gerekçe).
 *
 * ── TELEMETRİ BLOKLARI YALNIZ PATRONDA ────────────────────────────────────
 * `alarmlar`, `yakit`, `rota` şefte ve şoförde **null** — 0/boş dizi DEĞİL.
 * Panel paritesi: /admin/alarmlar, /admin/araclar/[id]/rota ve yakıt raporu
 * requireAdmin ile korunuyor, şef oralara giremiyor. Boş dizi "bu vardiyada
 * alarm yok" derdi; null "bu veriyi görme yetkin yok" der (panonun şef kuralı).
 *
 * ── VARDİYA↔ARAÇ BAĞI PENCEREDİR ──────────────────────────────────────────
 * `vehicle_events` ve `idle_episodes` tablolarında `time_entry_id`/`worker_id`
 * YOK ve eklenmesi gerekmiyor: (araç, [başlangıç, bitiş]) penceresi vardiyayı
 * seçer. Vardiyanın aracı yoksa (`vehicle_id` null) üç blok da null kalır ve
 * SEBEBİ söylenir — sessiz boşluk yok.
 *
 * Açık vardiyada pencerenin sonu "şimdi"dir; yanıt `pencere.acikVardiya: true`
 * ile bunu söyler, yoksa istemci rakamların neden büyüdüğünü anlayamaz.
 */

/** Rota nokta tavanı — telefon önizlemesi için. Panelin replay tavanı 900;
 *  mobil şerit bunun yarısını bile çizemez, ama örneklendiğini SÖYLER. */
const ROTA_MAX_POINTS = 500;

type Pt = { lat: number; lng: number; an: string; hizKmh: number | null };

/** Eşit aralıklı seyreltme; İLK ve SON nokta her zaman korunur
 *  (lib/route-history.ts `sample()` deseninin aynısı). */
function sample(points: Pt[], max: number): Pt[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: Pt[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  out[out.length - 1] = points[points.length - 1];
  return out;
}

/** RPC satırı — migration 052 `report_fuel_stats_vehicle`. */
type FuelStatRow = {
  sample_count: number;
  avg_pct: number | null;
  min_pct: number | null;
  max_pct: number | null;
  first_pct: number | null;
  last_pct: number | null;
  refill_count: number;
  refill_pct: number;
  drop_count: number;
  drop_pct: number;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyMobileRequest(req);
  if (!auth.ok) return mobileError(auth.status, auth.code);

  const { id } = await params;
  const { data: eData } = await supabaseAdmin
    .from("time_entries")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!eData) return mobileError(404, "not_found");
  // 037/038 kolonları TimeEntry tipinde yok (best-effort, kurulumda olmayabilir).
  const e = eData as TimeEntry & {
    vehicle_id: string | null;
    location_unverified?: boolean | null;
    start_time_estimated?: boolean | null;
    started_by?: string | null;
    start_source?: string | null;
  };

  // Km ölçüm bayrağı: cihazı sessiz vardiyada `km` null döner, 0 değil.
  const kmMeasured = await isKmMeasured(e);

  const isAdmin = auth.worker.is_admin;
  const isSelf = e.worker_id === auth.worker.id;
  const fleet = isAdmin ? null : await getManagedFleet(auth.worker.id);
  const isChief = !isAdmin && fleet !== null;
  if (!isAdmin && !isSelf) {
    // Şef: kapsam FAIL-CLOSED (çözülemezse boş küme) — liste ucuyla aynı kapı.
    const scope = isChief ? await getFleetScope(fleet) : UNRESTRICTED;
    if (!isChief || !scope.isFleetWorker(e.worker_id)) {
      return mobileError(404, "not_found");
    }
  }

  const acik = e.ended_at === null;
  const winStart = e.started_at;
  const winEnd = e.ended_at ?? new Date().toISOString();

  // Şoför adı — anahtarlı küçük sorgu; çözülemezse null, satır düşmez.
  const { data: wData } = await supabaseAdmin
    .from("workers")
    .select("id, name")
    .eq("id", e.worker_id)
    .maybeSingle();

  // ── TELEMETRİ BLOKLARI ────────────────────────────────────────────────────
  const vehicleId = e.vehicle_id;
  let alarmlar: unknown = null;
  let yakit: unknown = null;
  let rota: unknown = null;
  /**
   * Yakıt bloğu neden boş: "rpc yok" ≠ "zaman aşımı" ≠ "okuma yok". Üçü
   * yöneticiye FARKLI şey yaptırır (migration çalıştır / aralık daralt /
   * sensör bak) ve `report_fuel_stats_vehicle` (052) yeni kurulumların
   * install SQL'inde YOK — Sendigo/Galzura'da bu blok gerçekten boş döner,
   * sebebini söylemezsek "bu vardiyada yakıt harcanmamış" gibi okunur.
   */
  let yakitSebep: "var" | "veri_yok" | "rpc_yok" | "zaman_asimi" | "hata" = "veri_yok";

  if (!isAdmin) {
    // null kalır (yetki) — aşağıdaki `bloklar` alanı sebebi söyler.
  } else if (!vehicleId) {
    // null kalır (araç bağı yok) — bu vardiya bir araca bağlanmamış.
  } else {
    const [events, episodes, fuelRes, vehRes, track] = await Promise.all([
      listVehicleEventsInWindow(vehicleId, winStart, winEnd),
      listVehicleIdleEpisodesInWindow(vehicleId, winStart, winEnd),
      supabaseAdmin.rpc("report_fuel_stats_vehicle", {
        p_from: winStart,
        p_to: winEnd,
        p_vehicle_id: vehicleId,
      }),
      supabaseAdmin
        .from("vehicles")
        .select("tank_capacity_l")
        .eq("id", vehicleId)
        .maybeSingle(),
      listVehicleTrack(vehicleId, winStart, winEnd),
    ]);

    // ALARMLAR — nokta olaylar + rölanti epizodları tek listede, /alarmlar
    // ucundaki dönüşümün aynısı (süre = span + IDLE_TRIGGER_S).
    const rows = [
      ...events.map((r) => ({
        id: r.id,
        tur: r.event_type,
        an: r.occurred_at,
        deger: r.event_value,
        hizKmh: r.speed_kmh,
        konum:
          r.latitude != null && r.longitude != null
            ? { lat: r.latitude, lng: r.longitude }
            : null,
        sureMs: null as number | null,
        devamEdiyor: false,
      })),
      ...episodes.map((x) => {
        const s = new Date(x.started_at).getTime();
        const f = new Date(x.ended_at ?? x.last_seen_at).getTime();
        return {
          id: x.id,
          tur: "idling",
          an: x.started_at,
          deger: null,
          hizKmh: 0 as number | null,
          konum:
            x.latitude != null && x.longitude != null
              ? { lat: x.latitude, lng: x.longitude }
              : null,
          sureMs: Math.max(0, f - s) + IDLE_TRIGGER_S * 1000,
          devamEdiyor: x.ended_at === null,
        };
      }),
    ].sort((a, b) => a.an.localeCompare(b.an));

    const turDagilim: Record<string, number> = {};
    for (const r of rows) turDagilim[r.tur] = (turDagilim[r.tur] ?? 0) + 1;
    alarmlar = {
      adet: rows.length,
      kritikAdet: rows.filter((r) => alarmKademe(r.tur) === "kritik").length,
      turDagilim,
      kalemler: rows.map((r) => ({
        ...r,
        siddet: eventTone(r.tur),
        kademe: alarmKademe(r.tur),
      })),
    };

    // YAKIT — RPC yoksa/hata verirse blok null + sebep (052 uygulanmamış
    // kurulumda uç çökmez, ama "yakıt yok" da demez).
    const stat = ((fuelRes.data ?? []) as FuelStatRow[])[0];
    if (fuelRes.error) {
      const kind = classifyRpcError(fuelRes.error);
      yakitSebep =
        kind === "missing_function"
          ? "rpc_yok"
          : kind === "timeout"
            ? "zaman_asimi"
            : "hata";
    } else if (!fuelRes.error && stat && Number(stat.sample_count) > 0) {
      yakitSebep = "var";
      const cap =
        (vehRes.data as { tank_capacity_l: number | null } | null)?.tank_capacity_l ??
        null;
      const first = stat.first_pct != null ? Number(stat.first_pct) : 0;
      const last = stat.last_pct != null ? Number(stat.last_pct) : 0;
      const refillPct = Number(stat.refill_pct) || 0;
      const dropPct = Number(stat.drop_pct) || 0;
      const tuketimPct = fuelConsumedPct(first, last, refillPct);
      yakit = {
        okumaSayisi: Number(stat.sample_count),
        baslangicPct: stat.first_pct != null ? Number(stat.first_pct) : null,
        bitisPct: stat.last_pct != null ? Number(stat.last_pct) : null,
        enDusukPct: stat.min_pct != null ? Number(stat.min_pct) : null,
        enYuksekPct: stat.max_pct != null ? Number(stat.max_pct) : null,
        tuketimPct,
        // Depo hacmi girilmemiş araçta litre YOK (null) — uydurma çevrim yok.
        tuketimLitre: pctToLiters(tuketimPct, cap),
        depoLitre: cap,
        dolumAdet: Number(stat.refill_count) || 0,
        dolumPct: refillPct,
        dolumLitre: pctToLiters(refillPct, cap),
        supheliDususAdet: Number(stat.drop_count) || 0,
        supheliDususPct: dropPct,
        supheliDususLitre: pctToLiters(dropPct, cap),
      };
    }

    // ROTA — ham çizgi. OSRM yol eşlemesi BİLEREK yok: 6 sn'lik dış bağımlılık,
    // telefon önizlemesi için gereksiz (keşif belgesi, madde 3).
    const pts: Pt[] = track.map((p) => ({
      lat: p.latitude,
      lng: p.longitude,
      an: p.recorded_at,
      hizKmh: p.speed_kmh,
    }));
    const drawn = sample(pts, ROTA_MAX_POINTS);
    rota = {
      toplamNokta: pts.length,
      nokta: drawn.length,
      // Seyreltme SESSİZ DEĞİL: istemci "500 nokta" gördüğünde bunun tam seri
      // mi örnek mi olduğunu bilmeli (kırpma söylenmeli kuralı).
      orneklendi: drawn.length < pts.length,
      baslangic: pts[0] ?? null,
      bitis: pts.length ? pts[pts.length - 1] : null,
      noktalar: drawn,
    };
  }

  return Response.json({
    ok: true,
    kapsam: { rol: isAdmin ? "admin" : isChief ? "fleet_chief" : "driver", fleet },
    vardiya: {
      id: e.id,
      soforId: e.worker_id,
      sofor: (wData as { name: string } | null)?.name ?? null,
      aracId: e.vehicle_id,
      plaka: e.plate,
      baslangic: e.started_at,
      bitis: e.ended_at,
      acik,
      sureMs: workedMs(e),
      molaDk: e.break_minutes ?? 0,
      molaBasladi: e.break_started_at,
      baslangicKm: e.start_km,
      bitisKm: e.end_km,
      km: kmDiff({ ...e, km_measured: kmMeasured }),
      paketAlinan: e.start_package_count,
      paketTeslim: e.cargo_count,
      paketTeslimEdilemeyen: e.undelivered_count,
      onayDurumu: e.confirmation_status,
      onayAni: e.confirmed_at,
      bitisSebebi: e.end_reason,
      otomatikBasladi: e.auto_started,
      otomatikBitti: e.auto_ended,
      ozetImzaAni: e.summary_confirmed_at,
      notlar: e.notes,
      // 037/038 — kolon yoksa undefined yerine null (istemci tek şey okur).
      konumDogrulanmadi: e.location_unverified ?? null,
      baslangicSaatiTahmini: e.start_time_estimated ?? null,
      baslatan: e.started_by ?? null,
      baslatmaKaynagi: e.start_source ?? null,
    },
    pencere: { baslangic: winStart, bitis: winEnd, acikVardiya: acik },
    /**
     * Telemetri bloklarının NEDEN null olduğu. `null` üç ayrı şey demek
     * olabilirdi (yetki yok / araç bağı yok / veri yok); ekran hangisini
     * yazacağını bilmeli.
     */
    bloklar: {
      alarmlar: !isAdmin ? "yetki_yok" : !vehicleId ? "arac_yok" : "var",
      yakit: !isAdmin ? "yetki_yok" : !vehicleId ? "arac_yok" : yakitSebep,
      rota: !isAdmin ? "yetki_yok" : !vehicleId ? "arac_yok" : "var",
    },
    alarmlar,
    yakit,
    rota,
  });
}
