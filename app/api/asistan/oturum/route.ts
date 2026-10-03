import { sesliKapi, istemciSirriUret } from "@/lib/asistan-sesli";
import { sesliAracSemalari } from "@/lib/asistan-sesli-araclar";
import {
  SESLI_MODELLER,
  SESLI_OTURUM_SINIRI_SN,
  SESLI_SES,
  SESLI_TRANSKRIPSIYON_MODELLERI,
  SESLI_VARSAYILAN_MODEL,
  SESLI_VARSAYILAN_TRANSKRIPSIYON,
} from "@/lib/asistan-sesli-sabitler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/asistan/oturum `{ model?, transkripsiyon? }` — sesli asistan için kısa ömürlü
 * OpenAI Realtime anahtarı (Faz 1 web prototipi; döküm modeli seçimi Faz 1b). Ses SABİT
 * (Faz 1c, Volkan: `marin`) — istemciden ses alınmaz, gövdedeki `ses` yok sayılır.
 *
 * Kapı sırası: `ASISTAN_SESLI=1` değil → 404 · kiracı galzura-demo değil → 404 ·
 * oturum yok → 401 · yönetici değil (şoför, filo şefi) → 403. Sonra izin listesi:
 * model listede değilse 400 (sessizce varsayılana düşülmez — ölçüm yapan kişi hangi
 * modeli dinlediğini bilmeli).
 *
 * Yanıtta yalnız 60 sn yaşayan anahtar var; `OPENAI_API_KEY` hiçbir gövdeye girmez.
 * Veritabanına bir şey yazılmaz.
 */
export async function POST(req: Request) {
  const kapi = await sesliKapi();
  if (!kapi.ok) return kapi.response;

  const govde = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const model = govde.model === undefined ? SESLI_VARSAYILAN_MODEL : govde.model;

  if (typeof model !== "string" || !SESLI_MODELLER.some((m) => m.id === model)) {
    return Response.json(
      { ok: false, error: "invalid", alan: "model", gecerli: SESLI_MODELLER.map((m) => m.id) },
      { status: 400 }
    );
  }
  const transkripsiyon = govde.transkripsiyon === undefined ? SESLI_VARSAYILAN_TRANSKRIPSIYON : govde.transkripsiyon;
  if (
    typeof transkripsiyon !== "string" ||
    !(SESLI_TRANSKRIPSIYON_MODELLERI as readonly string[]).includes(transkripsiyon)
  ) {
    return Response.json(
      { ok: false, error: "invalid", alan: "transkripsiyon", gecerli: SESLI_TRANSKRIPSIYON_MODELLERI },
      { status: 400 }
    );
  }

  const r = await istemciSirriUret({
    model,
    transkripsiyon,
    workerId: kapi.workerId,
    araclar: sesliAracSemalari(),
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
    {
      ok: true,
      istemciSirri: r.deger,
      bitis: r.bitis,
      model,
      ses: SESLI_SES,
      transkripsiyon: r.transkripsiyon,
      dokumSade: r.dokumSade,
      // Talimat sır değil: tarayıcı kullanıcının dili değişince "Current user language"
      // satırını ekleyip `session.update` ile tazeler (Faz 1b ek güvence).
      talimat: r.talimat,
      sinirSn: SESLI_OTURUM_SINIRI_SN,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
