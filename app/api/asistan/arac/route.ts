import { sesliKapi, aracYetkiBasligi, argumanCoz } from "@/lib/asistan-sesli";
import { sesliAracBul } from "@/lib/asistan-sesli-araclar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Araç başına süre tavanı (tasarım belgesi §1.4). Aşılırsa model bunu duyar. */
const ARAC_ZAMAN_ASIMI_MS = 20_000;
/** Sonuç modele metin olarak gider; bağlam pahalı (belge §5.3). */
const SONUC_TAVANI_KARAKTER = 12_000;

/**
 * POST /api/asistan/arac `{ ad, girdi }` — modelin istediği aracı SUNUCUDA çalıştırır.
 *
 * Kapılar `/api/asistan/oturum` ile aynı. Yalnız `SESLI_ARACLAR` listesindeki salt
 * okunur araçlar çalışır; araç, ilgili mobil ucun `GET`ini kullanıcının kendi yetkisiyle
 * çağırır (kapsam ucun kapısından). Yeni SQL yok, yazma yok.
 *
 * Argüman hatası, zaman aşımı ve uç hataları 200 + `sonuc.hata` olarak döner: bunlar
 * modelin duyması gereken bilgiler, tarayıcının hatası değil.
 */
export async function POST(req: Request) {
  const kapi = await sesliKapi();
  if (!kapi.ok) return kapi.response;

  const govde = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!govde || typeof govde.ad !== "string") {
    return Response.json({ ok: false, error: "invalid", alan: "ad" }, { status: 400 });
  }
  const arac = sesliAracBul(govde.ad);
  if (!arac) return Response.json({ ok: false, error: "bilinmeyen_arac" }, { status: 400 });

  const a = argumanCoz(arac.sema, govde.girdi);
  if (!a.ok) return Response.json({ ok: true, ad: arac.ad, sonuc: a.hata });

  const yetkiBasligi = await aracYetkiBasligi(kapi.workerId);
  if (!yetkiBasligi) return Response.json({ ok: false, error: "db_error" }, { status: 503 });

  const baslangic = Date.now();
  let zamanlayici: ReturnType<typeof setTimeout> | undefined;
  const zamanAsimi = new Promise<Record<string, unknown>>((coz) => {
    zamanlayici = setTimeout(() => coz({ hata: "zaman_asimi", sureMs: ARAC_ZAMAN_ASIMI_MS }), ARAC_ZAMAN_ASIMI_MS);
  });
  let sonuc: unknown;
  try {
    sonuc = await Promise.race([
      arac.calistir(a.girdi, { yetkiBasligi, taban: new URL(req.url).origin }),
      zamanAsimi,
    ]);
  } catch {
    sonuc = { hata: "arac_calismadi" };
  } finally {
    clearTimeout(zamanlayici);
  }

  const metin = JSON.stringify(sonuc ?? null);
  if (metin.length > SONUC_TAVANI_KARAKTER) {
    sonuc = { hata: "sonuc_cok_buyuk", karakter: metin.length, oneri: "daha dar bir süzgeçle tekrar sor" };
  }

  return Response.json(
    { ok: true, ad: arac.ad, sureMs: Date.now() - baslangic, sonuc },
    { headers: { "Cache-Control": "no-store" } }
  );
}
