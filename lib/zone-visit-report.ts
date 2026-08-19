import "server-only";
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import type { DateRange } from "@/lib/analytics-shared";

/**
 * BÖLGE SÜRELERİ RAPORU — "faturalama kanıtı" (FAZ C, migration 064).
 *
 * GOLD paketinde satılan özelliğin çıktısı: hangi araç, hangi müşteri
 * sahasında, ne zamandan ne zamana, kaç dakika kaldı.
 *
 * ═══ DÜRÜSTLÜK SÜTUNU — BU RAPORUN OMURGASI ═══
 * Bu rapor müşteri faturasına EK olarak gidiyor. Ölçülemeyeni ölçülmüş gibi
 * göstermek burada, başka her yerden daha pahalı. Bu yüzden:
 *
 *   • Süre daima `ended_at - started_at`. "Şu an - started_at" HİÇBİR YERDE
 *     hesaplanmaz — açık ziyaretin süresi YOKTUR, `null` gösterilir.
 *   • `gap_timeout` ile kapanmış ziyaret İŞARETLENİR: cihaz sustuğu için
 *     ziyaret son doğrulanmış anda kapandı, GERÇEK süre bundan UZUN olabilir.
 *     Yakıt raporundaki `fuel_reason_*` deseninin aynısı.
 *
 * Sayfalama `fetchAllRows` ile: PostgREST 1000 satırda sessizce keser ve
 * eksik bir fatura eki, hiç fatura ekinden kötüdür.
 */

export type ZoneVisitRow = {
  id: string;
  zoneName: string;
  customerName: string | null;
  plate: string;
  driverName: string | null;
  startedAt: string;
  endedAt: string | null;
  /** ms — açık ziyarette null (gözlemlenmemiş süre sayılmaz). */
  durationMs: number | null;
  endReason: string | null;
  /** Sinyal kesildiği için kapandı → süre EKSİK olabilir. */
  belirsiz: boolean;
};

export type ZoneVisitSummary = {
  zoneId: string;
  zoneName: string;
  customerName: string | null;
  visits: number;
  totalMs: number;
  /** Bu müşterideki ziyaretlerden kaçı sinyal kesintisiyle kapandı. */
  belirsizVisits: number;
};

export type ZoneVisitReport = {
  rows: ZoneVisitRow[];
  summary: ZoneVisitSummary[];
  totalMs: number;
  visits: number;
  belirsizVisits: number;
  /** Hiç müşteri bölgesi tanımlı değil → "veri yok" ile karıştırma. */
  bolgeTanimliMi: boolean;
};

type HamZiyaret = {
  id: string;
  zone_id: string;
  vehicle_id: string;
  worker_id: string | null;
  started_at: string;
  ended_at: string | null;
  last_seen_at: string;
  end_reason: string | null;
};

export async function buildZoneVisitReport(range: DateRange): Promise<ZoneVisitReport> {
  const bos: ZoneVisitReport = {
    rows: [], summary: [], totalMs: 0, visits: 0, belirsizVisits: 0, bolgeTanimliMi: false,
  };

  // Müşteri bölgeleri — ölçüm `purpose='customer'`e bağlı (karar B).
  const { data: zoneData, error: zoneErr } = await supabaseAdmin
    .from("geofences")
    .select("id, name, customer_name, min_dwell_s")
    .eq("purpose", "customer");
  if (zoneErr) return bos;
  const zones = (zoneData ?? []) as {
    id: string;
    name: string;
    customer_name: string | null;
    min_dwell_s: number | null;
  }[];
  if (zones.length === 0) return bos;
  bos.bolgeTanimliMi = true;
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  // Ziyaretler — SAYFALI (1000 satır tavanı fatura ekini sessizce kırpmasın).
  const { data: visitData, error: visitErr } = await fetchAllRows<HamZiyaret>(
    (from, to) =>
      supabaseAdmin
        .from("zone_visits")
        .select("id, zone_id, vehicle_id, worker_id, started_at, ended_at, last_seen_at, end_reason")
        .in("zone_id", [...zoneById.keys()])
        .gte("started_at", range.start.toISOString())
        .lte("started_at", range.end.toISOString())
        .order("started_at", { ascending: false })
        .order("id")
        .range(from, to),
    "zone_visits"
  );
  if (visitErr) return { ...bos, bolgeTanimliMi: true };
  /**
   * HENÜZ ZİYARET SAYILMAYAN AÇIK SATIRLAR ELENİR.
   *
   * Motor ziyareti içeri girilen İLK noktada açar; eşik (min_dwell_s)
   * kapanışta toplam süreye uygulanır ve dolduramayan satır SİLİNİR
   * (lib/zone-visits.ts). Arada kalan tek durum: araç şu an içeride ve daha
   * eşiği doldurmadı. Onu raporda "ziyaret" diye göstermek, bölgenin
   * kenarında 20 saniye duran aracı müşteri ziyareti gibi sayardı.
   * Kapanmış satırlar zaten eşiği geçmiştir — onlara dokunulmaz.
   */
  const esik = new Map(zones.map((z) => [z.id, (z.min_dwell_s ?? 120) * 1000]));
  const visits = (visitData ?? []).filter((v) => {
    if (v.ended_at) return true;
    const gorulen = new Date(v.last_seen_at).getTime() - new Date(v.started_at).getTime();
    return gorulen >= (esik.get(v.zone_id) ?? 120_000);
  });
  if (visits.length === 0) return { ...bos, bolgeTanimliMi: true };

  // Plaka + şoför adı sözlüğü — iki toplu sorgu, ziyaret başına değil.
  const vehicleIds = [...new Set(visits.map((v) => v.vehicle_id))];
  const workerIds = [...new Set(visits.map((v) => v.worker_id).filter(Boolean))] as string[];
  const [{ data: vData }, { data: wData }] = await Promise.all([
    supabaseAdmin.from("vehicles").select("id, plate").in("id", vehicleIds),
    workerIds.length
      ? supabaseAdmin.from("workers").select("id, name").in("id", workerIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const plateById = new Map(((vData ?? []) as { id: string; plate: string }[]).map((v) => [v.id, v.plate]));
  const nameById = new Map(((wData ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));

  const rows: ZoneVisitRow[] = visits.map((v) => {
    const z = zoneById.get(v.zone_id);
    const belirsiz = v.end_reason === "gap_timeout";
    return {
      id: v.id,
      zoneName: z?.name ?? "—",
      customerName: z?.customer_name ?? null,
      plate: plateById.get(v.vehicle_id) ?? "—",
      driverName: v.worker_id ? nameById.get(v.worker_id) ?? null : null,
      startedAt: v.started_at,
      endedAt: v.ended_at,
      // AÇIK ziyaretin süresi YOKTUR. "Şu an - started_at" hesaplanmaz.
      durationMs: v.ended_at
        ? new Date(v.ended_at).getTime() - new Date(v.started_at).getTime()
        : null,
      endReason: v.end_reason,
      belirsiz,
    };
  });

  const byZone = new Map<string, ZoneVisitSummary>();
  for (const r of rows) {
    const z = visits.find((v) => v.id === r.id)!.zone_id;
    const cur = byZone.get(z) ?? {
      zoneId: z, zoneName: r.zoneName, customerName: r.customerName,
      visits: 0, totalMs: 0, belirsizVisits: 0,
    };
    cur.visits++;
    cur.totalMs += r.durationMs ?? 0;
    if (r.belirsiz) cur.belirsizVisits++;
    byZone.set(z, cur);
  }

  return {
    rows,
    summary: [...byZone.values()].sort((a, b) => b.totalMs - a.totalMs),
    totalMs: rows.reduce((a, r) => a + (r.durationMs ?? 0), 0),
    visits: rows.length,
    belirsizVisits: rows.filter((r) => r.belirsiz).length,
    bolgeTanimliMi: true,
  };
}
