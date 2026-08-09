import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { safeEqual } from "@/lib/secure-compare";
import { TENANT } from "@/lib/brand";

// Service-role Supabase → Node, asla edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DEMO TELEMETRİ TEMİZLİĞİ — yalnız galzura-demo.
 *
 * galzura-demo günde ~50 bin device_telemetry satırı alıyor (300 bin+ birikti).
 * Demo kurulumunun ham akışı süresiz saklaması için sebep yok; gerçek
 * müşterilerde ise saklama süresi hukuki bir konudur (§ 132 BAO).
 *
 * ═══ ÜÇ BAĞIMSIZ KAPI ═══
 *
 * 1. TENANT KİLİDİ — `TENANT !== "galzura-demo"` ise 403 ve HİÇBİR sorgu
 *    çalışmaz. Kilit, silme çağrısından ÖNCE ve sırlardan BAĞIMSIZ: doğru
 *    CRON_SECRET'i HAK61 dağıtımına gönderen biri bile veri silemez.
 * 2. CRON_SECRET — shift-watchdog ile aynı desen (?secret= veya Bearer),
 *    zamanlama-güvenli karşılaştırma.
 * 3. FONKSİYON YOKLUĞU — migration 054 yalnız demo veritabanında çalıştırılır.
 *    HAK61/Sendigo'da `purge_old_telemetry` HİÇ VAR OLMAZ, çağrı PGRST202 ile
 *    düşer. Kod hatası kilidi delse bile veritabanı reddeder.
 *
 * ═══ NEYE DOKUNULMAZ ═══
 *
 * Yalnız `device_telemetry`. Vardiya (time_entries), alarm (vehicle_events),
 * rölanti (idle_episodes) ve sefer (shift_packages / driver_reports) kayıtları
 * ham akıştan TÜRETİLMİŞ ama BAĞIMSIZ satırlardır — telemetri silinince olduğu
 * gibi kalırlar. Tablo adı SQL fonksiyonunun gövdesinde sabittir; bu rota hangi
 * tablonun silineceğini seçemez.
 *
 * ═══ NEDEN TUR TUR ═══
 *
 * Tek `delete` 300 bin satırda statement timeout yer ve hiçbir şey silinmez.
 * Fonksiyon parça parça siler; burada MAX_ROUNDS × BATCH tavanına kadar tur
 * atılır. Bir tur 0 dönerse silinecek bir şey kalmamıştır ve döngü biter.
 * Yarıda kesilmek zararsız: her tur kendi başına tamamlanmış bir iştir.
 */
const DEMO_TENANT = "galzura-demo";
const RETENTION_DAYS = 14;
const BATCH = 20_000;
const MAX_ROUNDS = 25; // tavan: 500 bin satır/çağrı

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const qs = req.nextUrl.searchParams.get("secret");
  if (safeEqual(qs, expected)) return true;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return safeEqual(auth.slice(7), expected);
  return false;
}

async function purge() {
  let total = 0;
  let rounds = 0;
  for (; rounds < MAX_ROUNDS; rounds++) {
    const { data, error } = await supabaseAdmin.rpc("purge_old_telemetry", {
      p_days: RETENTION_DAYS,
      p_limit: BATCH,
    });
    if (error) {
      // Migration 054 uygulanmamışsa burası normaldir — sessizce başarısız
      // olmak yerine SEBEBİYLE döner (raporsuz cron, çalışmayan cron demektir).
      return { ok: false as const, deleted: total, rounds, error: error.message };
    }
    const n = Number(data ?? 0);
    total += n;
    if (n < BATCH) {
      rounds++;
      break;
    }
  }
  return { ok: true as const, deleted: total, rounds };
}

async function handle(req: NextRequest) {
  // 1. TENANT KİLİDİ — her şeyden önce, sırdan bağımsız.
  if (TENANT !== DEMO_TENANT) {
    return NextResponse.json(
      { ok: false, error: "tenant_locked", tenant: TENANT },
      { status: 403 }
    );
  }
  // 2. CRON_SECRET
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const before = await supabaseAdmin
    .from("device_telemetry")
    .select("id", { count: "exact", head: true });
  const res = await purge();
  const after = await supabaseAdmin
    .from("device_telemetry")
    .select("id", { count: "exact", head: true });

  return NextResponse.json(
    {
      ok: res.ok,
      tenant: TENANT,
      retentionDays: RETENTION_DAYS,
      deleted: res.deleted,
      rounds: res.rounds,
      rowsBefore: before.count ?? null,
      rowsAfter: after.count ?? null,
      ...(res.ok ? {} : { error: res.error }),
    },
    { status: res.ok ? 200 : 500 }
  );
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
