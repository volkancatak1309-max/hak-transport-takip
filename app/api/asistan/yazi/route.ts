import { sesliKapi, aracYetkiBasligi, yaziCevapla, type YaziGecmisi } from "@/lib/asistan-sesli";
import { sesliAracBul, sesliAracSemalari, sesliAracYurut } from "@/lib/asistan-sesli-araclar";
import { YAZI_MODEL } from "@/lib/asistan-sesli-sabitler";
import { TENANT } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METIN_TAVANI = 1_000;
const GECMIS_TAVANI = 12;
const GECMIS_METIN_TAVANI = 2_000;

/**
 * POST /api/asistan/yazi `{ metin, gecmis? }` — YAZILI YOL (Faz 1c).
 *
 * GPT-Live'da yazılı giriş belgelenmediği için yazılı sorular ayrı bir metin yoluyla
 * cevaplanır: OpenAI Responses API, `gpt-6-luna` (GPT-Live'ın önerilen arka modeliyle
 * aynı), sesli asistanla AYNI talimat ve AYNI araçlar. Cevap yazı olarak döner.
 *
 * Kapılar `/api/asistan/oturum` ile aynı. Araçlar `/api/asistan/arac` ile aynı yürütücüden
 * (`sesliAracYurut`) ve aynı önbellekten geçer. `gecmis` istemcinin belleğinden gelir (en
 * fazla 12 kısa mesaj); sunucu sohbeti saklamaz (karar 5). Veritabanına bir şey yazılmaz.
 */
export async function POST(req: Request) {
  const kapi = await sesliKapi();
  if (!kapi.ok) return kapi.response;

  const govde = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const metin = typeof govde.metin === "string" ? govde.metin.trim() : "";
  if (!metin || metin.length > METIN_TAVANI) {
    return Response.json({ ok: false, error: "invalid", alan: "metin", tavan: METIN_TAVANI }, { status: 400 });
  }
  const gecmisHam = govde.gecmis === undefined ? [] : govde.gecmis;
  if (!Array.isArray(gecmisHam) || gecmisHam.length > GECMIS_TAVANI) {
    return Response.json({ ok: false, error: "invalid", alan: "gecmis", tavan: GECMIS_TAVANI }, { status: 400 });
  }
  const gecmis: YaziGecmisi = [];
  for (const g of gecmisHam as Record<string, unknown>[]) {
    const rol = g?.rol;
    const gMetin = g?.metin;
    if ((rol !== "kullanici" && rol !== "asistan") || typeof gMetin !== "string" || gMetin.length > GECMIS_METIN_TAVANI) {
      return Response.json({ ok: false, error: "invalid", alan: "gecmis" }, { status: 400 });
    }
    if (gMetin.trim()) gecmis.push({ rol, metin: gMetin });
  }

  const yetkiBasligi = await aracYetkiBasligi(kapi.workerId);
  if (!yetkiBasligi) return Response.json({ ok: false, error: "db_error" }, { status: 503 });
  const taban = new URL(req.url).origin;
  const kimlik = `${TENANT}|${kapi.workerId}`;

  const baslangic = Date.now();
  const araclar: { ad: string; sureMs: number; onbellek: string }[] = [];
  const r = await yaziCevapla({
    metin,
    gecmis,
    workerId: kapi.workerId,
    araclar: sesliAracSemalari(),
    aracCalistir: async (ad, argumanlar) => {
      const arac = sesliAracBul(ad);
      if (!arac) return { hata: "bilinmeyen_arac" };
      const y = await sesliAracYurut(arac, argumanlar, { yetkiBasligi, taban, kimlik, iz: [] });
      araclar.push({ ad: y.ad, sureMs: y.sureMs, onbellek: y.onbellek });
      return y.sonuc;
    },
  });
  if (!r.ok) {
    return Response.json(
      {
        ok: false,
        error: r.kod,
        ...(r.saglayiciDurum !== undefined ? { saglayiciDurum: r.saglayiciDurum } : {}),
        ...(r.saglayiciKod ? { saglayiciKod: r.saglayiciKod } : {}),
        ...(r.mesaj ? { mesaj: r.mesaj } : {}),
      },
      { status: r.durum }
    );
  }

  return Response.json(
    { ok: true, metin: r.metin, model: YAZI_MODEL, kullanim: r.kullanim, araclar, sureMs: Date.now() - baslangic },
    { headers: { "Cache-Control": "no-store" } }
  );
}
