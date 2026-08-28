import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/secure-compare";
import { ayOzetiYaz } from "@/lib/saklama-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * AYLIK METRİK — gece cron'u (S4). `vehicle_month_metrics` (migration 090).
 *
 * ═══ 🔴 NE YAZAR, NE YAZMAZ ════════════════════════════════════════════════
 *
 * YAZAR : `vehicle_month_metrics` — araç × ay özeti (litre, km, ölçülemedi
 *         sebebi, kapsama sayaçları). Yazma **upsert**, `(vehicle_id, ay)`.
 * YAZMAZ: ham telemetriye, yakıt raporuna, CO₂ ayarına DOKUNMAZ. Hiçbir şey
 *         SİLMEZ. `ham_silindi_at` dolu satırlara dokunulmaz (`ayOzetiYaz`
 *         kendi içinde koruyor) — ham'ı silinmiş bir ay yeniden üretilemez.
 *
 * ═══ NEDEN VAR — ÖLÇÜLDÜ ══════════════════════════════════════════════════
 *
 * CO₂ panosunun aylık serisi son 6 ayı `buildFuelReport` ile TEK TEK
 * hesaplıyordu. HAK61 canlı ölçümü (28.08.2026):
 *
 *     2026-03   2,45 sn · 178 sorgu · ölçülen araç 0    ← BOŞ
 *     2026-04   2,15 sn · 178 sorgu · ölçülen araç 0    ← BOŞ
 *     2026-05   2,29 sn · 178 sorgu · ölçülen araç 0    ← BOŞ
 *     2026-06   2,06 sn · 178 sorgu · ölçülen araç 0    ← BOŞ
 *     2026-07   6,32 sn · 201 sorgu · ölçülen araç 24
 *     2026-08   8,30 sn · 199 sorgu · ölçülen araç 22   ← AÇIK AY
 *     ─────────────────────────────────────────────────
 *     TOPLAM   23,58 sn · 1.112 sorgu
 *
 * Telemetri 13.07.2026'da başlıyor, yani **altı ayın dördü tamamen boş** ve
 * 712 sorgu / ~8,95 sn sıfır bilgi için harcanıyordu. Ayrıntı ve tasarım:
 * `docs/AYLIK-METRIK.md`.
 *
 * ═══ AÇIK AY BU CRON'UN İŞİ DEĞİL ═════════════════════════════════════════
 *
 * İçinde bulunulan ay **YAZILMAZ**. Sebebi basit: o ayın değeri her gün
 * değişir; gece yazılan satır sabaha bayat olur ve ekran bayat sayıyı
 * "hesaplanmış" diye gösterir. Açık ay okuma anında CANLI hesaplanır
 * (`lib/co2-db.ts` → `aylikSeri`). Bu cron yalnız KAPANMIŞ ayları yazar.
 *
 * ═══ GEÇ GELEN TELEMETRİ ══════════════════════════════════════════════════
 *
 * flespi kesinti sonrası geriye yazabiliyor — 28.08'de 4 saatlik kesintiden
 * sonra 11.455 satır geç düştü. Bu yüzden bir ay **kapandığı gece
 * yazılmaz**: `?gecikme=` gün kadar beklenir (varsayılan 2). İki gün, ölçülen
 * en uzun telafi penceresinin (4 saat) çok üstünde ve bir ayın özetini iki
 * gün geç yazmak hiçbir ekranı bekletmiyor — o ay zaten canlı yoldan okunur.
 *
 * `?tazele=1` ile mevcut satırlar YENİDEN yazılır (upsert): geç veri geldiği
 * bilinen bir ayı elle tazelemek için.
 *
 * ═══ KULLANIM ═════════════════════════════════════════════════════════════
 *
 *   GET  /api/cron/aylik-metrik?secret=<CRON_SECRET>
 *        → gecikmeyi geçmiş, satırı OLMAYAN kapanmış ayları yazar
 *   &geri=6      → son 6 kapanmış ayı kapsa (varsayılan 6)
 *   &gecikme=2   → ay kapandıktan sonra kaç gün beklensin (varsayılan 2)
 *   &tazele=1    → satırı olan ayları da yeniden yaz
 *   &kuru=1      → HİÇBİR ŞEY YAZMAZ, ne yapacağını söyler
 *
 * Sıklık: **günde 1, gece.** 03:30 öneriliyor — saklama cron'u 03:00'te
 * koşuyor, ikisi aynı dakikaya binmesin.
 *
 * ⚠️ Bu iş İDEMPOTENTTİR: aynı gün ikinci kez çağırmak, `tazele` verilmedikçe
 * zaten yazılmış ayları atlar ve `{yazilan: 0}` döner.
 */

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const qs = req.nextUrl.searchParams.get("secret");
  if (safeEqual(qs, expected)) return true;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return safeEqual(auth.slice(7), expected);
  return false;
}

/** `YYYY-MM` — UTC. `aySiniri()` ve `aylikSeri` ile AYNI ay tanımı. */
function ayAnahtari(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

type AySatiri = {
  ay: string;
  durum: "yazildi" | "atlandi_var" | "atlandi_gecikme" | "hata";
  arac?: number;
  olculen?: number;
  olculemeyen?: number;
  litre?: number | null;
  sebep?: string;
};

async function run(o: { geri: number; gecikmeGun: number; tazele: boolean; kuru: boolean }) {
  const simdi = new Date();
  const acikAy = new Date(Date.UTC(simdi.getUTCFullYear(), simdi.getUTCMonth(), 1));

  /** Aday aylar: açık aydan geriye `geri` adet KAPANMIŞ ay. */
  const adaylar: { ay: string; kapanis: Date }[] = [];
  for (let i = 1; i <= o.geri; i++) {
    const bas = new Date(Date.UTC(acikAy.getUTCFullYear(), acikAy.getUTCMonth() - i, 1));
    const kapanis = new Date(Date.UTC(acikAy.getUTCFullYear(), acikAy.getUTCMonth() - i + 1, 1));
    adaylar.push({ ay: ayAnahtari(bas), kapanis });
  }

  // Hangi ayların satırı zaten var? Tek sorgu.
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data: mevcut, error: okuHata } = await supabaseAdmin
    .from("vehicle_month_metrics")
    .select("ay")
    .in("ay", adaylar.map((a) => `${a.ay}-01`));
  if (okuHata) {
    return {
      status: 503,
      body: { ok: false, error: "migration_090_yok", hint: "db/migrations/090_saklama_politikasi.sql çalıştırılmadı" },
    };
  }
  const yazilmis = new Set(
    ((mevcut ?? []) as { ay: string }[]).map((r) => String(r.ay).slice(0, 7))
  );

  const sonuc: AySatiri[] = [];
  let yazilan = 0;
  for (const a of adaylar) {
    const gecenGun = (simdi.getTime() - a.kapanis.getTime()) / 86_400_000;
    if (gecenGun < o.gecikmeGun) {
      sonuc.push({ ay: a.ay, durum: "atlandi_gecikme" });
      continue;
    }
    if (yazilmis.has(a.ay) && !o.tazele) {
      sonuc.push({ ay: a.ay, durum: "atlandi_var" });
      continue;
    }
    if (o.kuru) {
      sonuc.push({ ay: a.ay, durum: "yazildi", sebep: "kuru" });
      continue;
    }
    const r = await ayOzetiYaz(a.ay);
    if (!r.ok) {
      sonuc.push({ ay: a.ay, durum: "hata", sebep: r.hata });
      continue;
    }
    yazilan++;
    sonuc.push({
      ay: a.ay,
      durum: "yazildi",
      arac: r.sonuc?.arac,
      olculen: r.sonuc?.olculen,
      olculemeyen: r.sonuc?.olculemeyen,
      litre: r.sonuc?.litre ?? null,
    });
  }

  return {
    status: 200,
    body: {
      ok: true,
      kuru: o.kuru,
      /** 🔴 Açık ay BİLEREK yazılmaz — gövdeyi okuyan yanılmasın. */
      acikAyYazilmadi: ayAnahtari(acikAy),
      gecikmeGun: o.gecikmeGun,
      yazilan,
      aylar: sonuc,
    },
  };
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const say = (ad: string, varsayilan: number, enAz: number, enCok: number) => {
    const n = Number(sp.get(ad));
    return Number.isFinite(n) && n >= enAz && n <= enCok ? n : varsayilan;
  };
  const { status, body } = await run({
    geri: say("geri", 6, 1, 24),
    gecikmeGun: say("gecikme", 2, 0, 30),
    tazele: sp.get("tazele") === "1",
    kuru: sp.get("kuru") === "1",
  });
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
