import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { safeEqual } from "@/lib/secure-compare";

// Service-role Supabase → Node, asla edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SESLİ ASİSTAN KAYIT TEMİZLİĞİ (migration 110) — günde bir.
 *
 * Kararlar 5 ve 9: kullanım kaydı (`asistan_kullanim`) 2 AY, "Bildir" kayıtları
 * (`asistan_bildirimleri`) 90 GÜN saklanır. Süreler SQL fonksiyonunun GÖVDESİNDE sabit
 * (`asistan_kayit_temizle`): bu rota süre de tablo da seçemez — yalnız tur atar.
 *
 * `demo-retention` deseni: CRON_SECRET (`?secret=` ya da Bearer, zamanlama-güvenli
 * karşılaştırma), parça parça silme (tur × 5.000, tavan 20 tur). Tur 0 dönerse iş bitti;
 * yarıda kesilmek zararsız.
 *
 * Kiracı kilidi YOK, bilinçli: bu tablolar Galzura'nın kendi işletim kaydı ve migration
 * 110'un uygulandığı HER kiracıda temizlenmeli. Migration yoksa fonksiyon da yoktur →
 * 503 `migration_110_yok` (raporsuz cron, çalışmayan cron demektir).
 */
const BATCH = 5_000;
const MAX_ROUNDS = 20;

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const qs = req.nextUrl.searchParams.get("secret");
  if (safeEqual(qs, expected)) return true;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return safeEqual(auth.slice(7), expected);
  return false;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let bildirim = 0;
  let kullanim = 0;
  let tur = 0;
  for (; tur < MAX_ROUNDS; tur++) {
    const { data, error } = await supabaseAdmin.rpc("asistan_kayit_temizle", { p_limit: BATCH });
    if (error) {
      const yok = error.code === "PGRST202" || /asistan_kayit_temizle/.test(error.message ?? "");
      return NextResponse.json(
        { ok: false, error: yok ? "migration_110_yok" : "db_error", bildirim, kullanim, tur },
        { status: 503 }
      );
    }
    const d = (data ?? {}) as { bildirim?: number; kullanim?: number };
    const b = Number(d.bildirim ?? 0);
    const k = Number(d.kullanim ?? 0);
    bildirim += b;
    kullanim += k;
    if (b < BATCH && k < BATCH) {
      tur++;
      break;
    }
  }
  return NextResponse.json({ ok: true, bildirim, kullanim, tur });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
