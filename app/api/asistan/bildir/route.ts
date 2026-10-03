import { sesliKapi } from "@/lib/asistan-sesli";
import { KAYIT_ACIK, bildirimYaz, jetonImzali } from "@/lib/asistan-sesli-kayit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORU_TAVANI = 2_000;
const CEVAP_TAVANI = 4_000;
const ARAC_TAVANI = 20;

/**
 * POST /api/asistan/bildir `{ oturumJetonu?, motor, model?, dil?, soru, cevap?, araclar? }`
 * — "BİLDİR" (karar 5; Faz 2a, `ASISTAN_SESLI_KAYIT=1`; kapalıyken 404 → istemci konsol +
 * JSON indirmeye devam eder).
 *
 * Kullanıcının bildirdiği TEK soru-cevap `asistan_bildirimleri`ne yazılır, 90 gün saklanır
 * (`/api/cron/asistan-kayit-temizle`). Araçlardan yalnız ad, süre ve önbellek etiketi
 * tutulur; araç SONUCU tutulmaz. Jeton verilirse kayıt oturuma bağlanır (imza denetlenir,
 * süre denetlenmez — oturum bittikten sonra da bildirilebilir).
 */
export async function POST(req: Request) {
  const kapi = await sesliKapi();
  if (!kapi.ok) return kapi.response;
  if (!KAYIT_ACIK) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

  const g = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const motor = g.motor;
  if (motor !== "realtime" && motor !== "live" && motor !== "yazi") {
    return Response.json({ ok: false, error: "invalid", alan: "motor" }, { status: 400 });
  }
  const soru = typeof g.soru === "string" ? g.soru.trim() : "";
  if (!soru || soru.length > SORU_TAVANI) {
    return Response.json({ ok: false, error: "invalid", alan: "soru", tavan: SORU_TAVANI }, { status: 400 });
  }
  const cevap = typeof g.cevap === "string" ? g.cevap.trim().slice(0, CEVAP_TAVANI) : null;
  const dil = g.dil === "tr" || g.dil === "de" || g.dil === "en" ? g.dil : null;
  const model = typeof g.model === "string" && g.model.trim() ? g.model.trim().slice(0, 60) : null;
  const araclar = (Array.isArray(g.araclar) ? g.araclar : []).slice(0, ARAC_TAVANI).flatMap((a) => {
    const x = (a ?? {}) as Record<string, unknown>;
    if (typeof x.ad !== "string" || !x.ad) return [];
    return [
      {
        ad: x.ad.slice(0, 60),
        sureMs: typeof x.sureMs === "number" && Number.isFinite(x.sureMs) ? Math.max(0, Math.round(x.sureMs)) : null,
        onbellek: typeof x.onbellek === "string" ? x.onbellek.slice(0, 10) : null,
      },
    ];
  });
  const jeton = g.oturumJetonu ? jetonImzali(g.oturumJetonu, kapi.workerId) : null;

  const r = await bildirimYaz({
    workerId: kapi.workerId,
    kullanimId: jeton?.ok ? jeton.jeton.k : null,
    motor,
    model,
    dil,
    soru: soru.slice(0, SORU_TAVANI),
    cevap: cevap || null,
    araclar,
  });
  if (!r.ok) return Response.json({ ok: false, error: r.kod }, { status: r.durum });
  return Response.json({ ok: true, id: r.id }, { headers: { "Cache-Control": "no-store" } });
}
