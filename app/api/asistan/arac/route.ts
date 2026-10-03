import { sesliKapi, aracYetkiBasligi } from "@/lib/asistan-sesli";
import { sesliAracBul, sesliAracYurut, sesliIsit, type SesliBaglam } from "@/lib/asistan-sesli-araclar";
import { TENANT } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/asistan/arac — iki biçim:
 *   `{ ad, girdi }`        modelin istediği aracı SUNUCUDA çalıştırır;
 *   `{ isit: true, ilk? }` ÖN ISITMA (Faz 1c): ağır araçları sırayla çalıştırıp 60 sn'lik
 *                          önbelleği doldurur; araç başına süre ve önbellek durumu döner.
 *
 * Kapılar `/api/asistan/oturum` ile aynı. Yalnız `SESLI_ARACLAR` listesindeki salt
 * okunur araçlar çalışır; araç, ilgili mobil ucun `GET`ini kullanıcının kendi yetkisiyle
 * çağırır (kapsam ucun kapısından). Yeni SQL yok, yazma yok.
 *
 * Önbellek anahtarı kiracı + kullanıcı: bir yöneticinin ısıttığı veri başka birine
 * dönmez. Argüman hatası, zaman aşımı ve uç hataları 200 + `sonuc.hata` olarak döner.
 */
export async function POST(req: Request) {
  const kapi = await sesliKapi();
  if (!kapi.ok) return kapi.response;

  const govde = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const isitma = govde?.isit === true;
  if (!govde || (!isitma && typeof govde.ad !== "string")) {
    return Response.json({ ok: false, error: "invalid", alan: "ad" }, { status: 400 });
  }
  const arac = isitma ? null : sesliAracBul(String(govde.ad));
  if (!isitma && !arac) return Response.json({ ok: false, error: "bilinmeyen_arac" }, { status: 400 });

  const yetkiBasligi = await aracYetkiBasligi(kapi.workerId);
  if (!yetkiBasligi) return Response.json({ ok: false, error: "db_error" }, { status: 503 });

  const ctx: SesliBaglam = {
    yetkiBasligi,
    taban: new URL(req.url).origin,
    kimlik: `${TENANT}|${kapi.workerId}`,
    iz: [],
  };

  if (!arac) {
    const baslangic = Date.now();
    const isitmaSonucu = await sesliIsit(ctx, govde.ilk === true);
    return Response.json(
      { ok: true, isitma: isitmaSonucu, sureMs: Date.now() - baslangic },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const r = await sesliAracYurut(arac, govde.girdi, ctx);
  return Response.json(
    { ok: true, ad: r.ad, sureMs: r.sureMs, onbellek: r.onbellek, sonuc: r.sonuc },
    { headers: { "Cache-Control": "no-store" } }
  );
}
