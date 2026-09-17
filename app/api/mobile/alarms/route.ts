import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import {
  listEventsInRange,
  listIdleEpisodesInRange,
  IDLE_TRIGGER_S,
} from "@/lib/telemetry";
import { olaySoforuCozucu } from "@/lib/event-driver";
import { parsePage, pageInfo, parseRange } from "@/lib/mobile-list";
import { eventTone, alarmKademe, type AlarmKademe } from "@/lib/event-ui";
import { listActiveSnoozes, ERTELEME_LISTE_TAVANI } from "@/lib/action-snoozes-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/alarms — alarm listesi.
 *
 * KAPI: requireMobileAdmin ↔ /admin/alarmlar sayfasının requireAdmin()'i.
 * (Panel o sayfada filo kapsamı UYGULAMIYOR — mobil de uygulamıyor; parite.)
 *
 * ── 1000 SATIR TUZAĞI ─────────────────────────────────────────────────────
 * Ham `.limit()`/`.range()` YAZILMIYOR. listEventsInRange ve
 * listIdleEpisodesInRange içeride `fetchAllRows` ile 1000'lik sayfalarla
 * sonuna kadar okuyor (lib/supabase.ts) — panelin kullandığı yöntemin aynısı.
 * Sayfalama bu tam kümenin ÜZERİNDE yapılıyor, yani `total` gerçek sayı;
 * PostgREST'in sessiz kesmesi devreye girmiyor.
 *
 * ── BİRLEŞTİRME ───────────────────────────────────────────────────────────
 * Nokta-olaylar (vehicle_events) + rölanti EPİZODLARI (idle_episodes) tek
 * listede. Epizod → satır dönüşümü ve süre formülü
 * (span + IDLE_TRIGGER_S) app/admin/alarmlar/page.tsx:143-160 ile BİREBİR aynı;
 * sabit oradan değil kaynağından (lib/telemetry.ts) okunuyor.
 *
 * ── GERİYE UYUMLULUK (11.08.2026 — erteleme, migration 058) ───────────────
 * YALNIZ ALAN EKLENDİ: `ertelemeler`, `ertelemeDurumu`, `ertelemeToplam`,
 * `ertelemeKirpildi`. Mevcut alanların adı, tipi ya da değeri DEĞİŞMEDİ ve
 * `alarmlar` dizisi SÜZÜLMEDİ — süzmeyi istemci yapıyor.
 *
 * ── NEDEN SUNUCU SÜZMÜYOR ────────────────────────────────────────────────
 * Mobildeki Aksiyon Merkezi üç kaynağı (alarm + dikkat kalemi + izin) TEK
 * listede birleştiriyor ve erteleme kalem kimliğine bağlı. Tek bir
 * `ertelemeler[]` bloğu üç kaynağı birden besler; sunucuda süzmek aynı
 * süzgeci üç ayrı uca kopyalamak olurdu. Ayrıca ham liste elde kalır:
 * "Ertelenen" sekmesi ertelenmiş kalemin KENDİSİNİ göstermek zorunda ve
 * sunucu onu atmış olsaydı gösterecek bir şey kalmazdı.
 *
 * `sayfa`/`page` ertelemelerden ETKİLENMEZ: sayfalama ham küme üzerinde,
 * `page.total` gerçek alarm sayısı. Ertelenmişleri düşen bir toplam,
 * istemcinin süzgecini sunucunun yarım yapması olurdu.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const page = parsePage(url);
  const range = parseRange(url);
  const turFiltre = url.searchParams.get("tur");
  // ?kademe=kritik|uyari|rutin (10.08.2026) — Özet'teki "Kritik N" hapı bu
  // süzgeçle açılır. Tek kaynak lib/event-ui.ts ALARM_KADEME; `tur` süzgeciyle
  // BİRLİKTE uygulanır (kesişim). Tanınmayan değer yok sayılır (süzgeçsiz liste).
  const kademeParam = url.searchParams.get("kademe");
  const kademeFiltre: AlarmKademe | null =
    kademeParam === "kritik" || kademeParam === "uyari" || kademeParam === "rutin"
      ? kademeParam
      : null;

  /**
   * ══ ŞOFÖR ARTIK OLAY ANINDAN (17.09.2026) ══════════════════════
   *
   * ÖNCEDEN: `vehicles.driver_name` — aracın BUGÜNKÜ atanmış şoförü. Araç el
   * değiştirdiğinde geçen ayın ihlali bu ay o aracı devralan kişiye yazılıyordu.
   * Şimdi olay anında O ARAÇTA açık olan vardiyanın şoförü yazılıyor; eşleşen
   * vardiya yoksa **null** — bugünkü atanana DÜŞÜLMÜYOR.
   *
   * Kural ve çözücü TEK YERDE: `lib/event-driver.ts`. Panel
   * (`app/admin/alarmlar/page.tsx`) aynı çekirdeği çağırıyor — iki yüzey aynı
   * alarma farklı isim yazamaz.
   *
   * ⚠️ `listVehiclesWithStatus()` DA KALKTI: tek işi şoför adını aracın
   * bugünkü atamasından vermekti. Plaka zaten olay satırlarında ve rölanti
   * epizodlarında geliyor — bir sorgu eksildi, davranış aynı.
   */
  const [events, episodes, ertelemeler, sofor] = await Promise.all([
    listEventsInRange(range.start.toISOString(), range.end.toISOString()),
    listIdleEpisodesInRange(range.start.toISOString(), range.end.toISOString()),
    listActiveSnoozes(),
    olaySoforuCozucu(range.start.toISOString(), range.end.toISOString()),
  ]);

  type Row = {
    id: string;
    vehicle_id: string;
    event_type: string;
    event_value: number | null;
    latitude: number | null;
    longitude: number | null;
    speed_kmh: number | null;
    occurred_at: string;
    plate: string | null;
    duration_ms?: number;
    ongoing?: boolean;
  };

  const idleRows: Row[] = episodes.map((e) => {
    const startMs = new Date(e.started_at).getTime();
    const endMs = new Date(e.ended_at ?? e.last_seen_at).getTime();
    return {
      id: e.id,
      vehicle_id: e.vehicle_id,
      event_type: "idling",
      event_value: null,
      latitude: e.latitude,
      longitude: e.longitude,
      speed_kmh: 0,
      occurred_at: e.started_at,
      plate: e.plate,
      duration_ms: Math.max(0, endMs - startMs) + IDLE_TRIGGER_S * 1000,
      ongoing: e.ended_at === null,
    };
  });

  let rows: Row[] = [...(events as unknown as Row[]), ...idleRows].sort((a, b) =>
    b.occurred_at.localeCompare(a.occurred_at)
  );
  if (turFiltre) {
    const set = new Set(turFiltre.split(",").map((s) => s.trim()).filter(Boolean));
    rows = rows.filter((r) => set.has(r.event_type));
  }
  if (kademeFiltre) {
    rows = rows.filter((r) => alarmKademe(r.event_type) === kademeFiltre);
  }

  const slice = rows.slice(page.offset, page.offset + page.limit);

  // Tür kırılımı TAM küme üzerinden — sayfa değişince rakam oynamasın.
  const turDagilim: Record<string, number> = {};
  for (const r of rows) turDagilim[r.event_type] = (turDagilim[r.event_type] ?? 0) + 1;

  return Response.json({
    ok: true,
    aralik: { start: range.start.toISOString(), end: range.end.toISOString() },
    page: pageInfo(page, rows.length),
    turDagilim,
    // ── ETKİN ERTELEMELER (migration 058) ──────────────────────────────────
    // ÜÇ KAYNAĞIN TAMAMI burada: alarm ucundan dönse de blok yalnız alarm
    // ertelemelerini taşımıyor. Sebebi Aksiyon Merkezi'nin tek liste olması —
    // istemci dikkat kalemlerini ve izin taleplerini de bu blokla süzüyor ve
    // ikinci bir istek atmak zorunda kalmıyor.
    ertelemeler: ertelemeler.satirlar,
    /** `var` · `tablo_yok` (058 uygulanmamış) · `hata` — boş liste üç ayrı şey. */
    ertelemeDurumu: ertelemeler.durum,
    ertelemeToplam: ertelemeler.toplam,
    ertelemeTavani: ERTELEME_LISTE_TAVANI,
    ertelemeKirpildi: ertelemeler.kirpildi,
    alarmlar: slice.map((r) => {
      const s = sofor.bul(r.vehicle_id, r.occurred_at);
      return {
      id: r.id,
      tur: r.event_type,
      siddet: eventTone(r.event_type),
      aracId: r.vehicle_id,
      plaka: r.plate,
      /** OLAY ANINDAKİ şoför; eşleşen vardiya yoksa null (uydurulmaz). */
      sofor: s.name,
      /** Şoförün geldiği vardiya kaydı — "hangi vardiya" sorusunun cevabı. */
      vardiyaId: s.shiftId,
      soforId: s.workerId,
      an: r.occurred_at,
      deger: r.event_value,
      hizKmh: r.speed_kmh,
      konum:
        r.latitude != null && r.longitude != null
          ? { lat: r.latitude, lng: r.longitude }
          : null,
      sureMs: r.duration_ms ?? null,
      devamEdiyor: r.ongoing ?? false,
      };
    }),
  });
}
