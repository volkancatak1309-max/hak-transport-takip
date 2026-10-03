import { sesliKapi, canliOturumAc } from "@/lib/asistan-sesli";
import { sesliAracSemalari } from "@/lib/asistan-sesli-araclar";
import { CANLI_ARKA_MODEL, CANLI_MODEL, CANLI_SES, SESLI_OTURUM_SINIRI_SN } from "@/lib/asistan-sesli-sabitler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tarayıcının SDP teklifi birkaç KB; çok büyük gövde bir kötüye kullanım belirtisi. */
const SDP_TAVANI = 100_000;

/**
 * POST /api/asistan/canli `{ sdp }` — GPT-Live (gpt-live-1) motoru, Faz 1b kıyası. Ses SABİT
 * (Faz 1c, Volkan: `gleam`) — istemciden ses alınmaz.
 *
 * Realtime'dan farkı: tarayıcıya kısa ömürlü anahtar VERİLMEZ. Sunucu, tarayıcının WebRTC
 * teklifini proje anahtarıyla OpenAI `POST /v1/live/sessions`'a iletir ve cevap SDP'sini
 * döndürür (live WebRTC rehberi). Akıl ve araçlar Responses delegation ile arka modelde
 * (`gpt-6-luna`); araç çağrıları tarayıcıya veri kanalından gelir ve yine
 * `/api/asistan/arac`'tan geçer (aynı kapı, aynı yetki).
 *
 * Kapılar `/api/asistan/oturum` ile aynı. Veritabanına bir şey yazılmaz.
 */
export async function POST(req: Request) {
  const kapi = await sesliKapi();
  if (!kapi.ok) return kapi.response;

  const govde = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const sdp = govde.sdp;
  if (typeof sdp !== "string" || !sdp.startsWith("v=") || sdp.length > SDP_TAVANI) {
    return Response.json({ ok: false, error: "invalid", alan: "sdp" }, { status: 400 });
  }
  const r = await canliOturumAc({ sdp, workerId: kapi.workerId, araclar: sesliAracSemalari() });
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
    {
      ok: true,
      sdp: r.sdp,
      oturumId: r.oturumId,
      model: CANLI_MODEL,
      arkaModel: CANLI_ARKA_MODEL,
      ses: CANLI_SES,
      sinirSn: SESLI_OTURUM_SINIRI_SN,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
