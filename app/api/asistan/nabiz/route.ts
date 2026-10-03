import { sesliKapi } from "@/lib/asistan-sesli";
import { KAYIT_ACIK, jetonImzali, nabiz } from "@/lib/asistan-sesli-kayit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/asistan/nabiz `{ oturumJetonu, bitti?, sebep?, tahminiMaliyetUsd?, arkaToken? }`
 * — SES OTURUMUNUN KALP ATIŞI (Faz 2a, `ASISTAN_SESLI_KAYIT=1`; kapalıyken 404).
 *
 * İstemci ~15 sn'de bir ve bitişte çağırır. Saniyeyi SUNUCU sayar (başlangıçtan bu yana
 * geçen süre, oturumun sınırıyla kırpılı); istemcinin süresi okunmaz. Maliyet: sunucu
 * tabanı ile istemcinin tahmininin büyüğü. Sınır dolduysa kayıt kapanır ve `bitir: true`
 * döner — istemci görüşmeyi kapatır; kapatmasa da araç ucu jetonun süresi dolduğu için
 * veri vermez.
 *
 * Kapılar diğer asistan uçlarıyla aynı (`sesliKapi`). Jeton imzalı ve bu kullanıcının
 * olmalı; süresi dolmuş jetonla son atış kaydı kapatabilir (saniye zaten sınırda).
 */
export async function POST(req: Request) {
  const kapi = await sesliKapi();
  if (!kapi.ok) return kapi.response;
  if (!KAYIT_ACIK) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

  const govde = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const j = jetonImzali(govde.oturumJetonu, kapi.workerId);
  if (!j.ok) return Response.json({ ok: false, error: j.kod }, { status: j.durum });

  const r = await nabiz({
    jeton: j.jeton,
    bitti: govde.bitti === true,
    sebep: govde.sebep,
    istemciMaliyetUsd: govde.tahminiMaliyetUsd,
    arkaToken: govde.arkaToken,
  });
  if (!r.ok) return Response.json({ ok: false, error: r.kod }, { status: r.durum });
  return Response.json(
    { ok: true, kalanSn: r.kalanSn, bitir: r.bitir },
    { headers: { "Cache-Control": "no-store" } }
  );
}
