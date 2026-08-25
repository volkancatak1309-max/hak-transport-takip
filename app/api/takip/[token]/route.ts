import { NextResponse } from "next/server";
import { readTakipByToken, takipVurusKaydet } from "@/lib/takip-db";
import { sinirDenetle } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/takip/[token] — GİRİŞSİZ yoklama ucu.
 *
 * Sayfa ilk hâlini sunucudan alır; bu uç yalnız TAZELEME içindir. İkisi de aynı
 * okuma fonksiyonunu (readTakipByToken) çağırır — "sayfada gösterilen" ile
 * "yoklamayla gelen" iki farklı gerçek olamaz.
 *
 * ── KİMLİK YOK, KAPI TOKEN'IN KENDİSİ ─────────────────────────────────────
 * Oturum, çerez, başlık aranmaz. Yetki taşıyıcıdadır: doğru token = erişim.
 * Bu yüzden token'ın entropisi (256 bit) ve ömrü (varsayılan 2 saat) güvenliğin
 * TAMAMI değil, ilk katmanıdır; ikinci katman dönen verinin AZLIĞIDIR.
 *
 * ── HIZ SINIRI — İKİ EKSEN ────────────────────────────────────────────────
 * TOKEN ekseni: link bir gruba yayılırsa tek link tüm sunucuyu meşgul etmesin.
 * IP ekseni: tek bir istemci farklı token'lar deneyerek (kaba kuvvet) sınırı
 * atlamasın.
 *
 * Tavanlar sayfanın kendi ritmine göre: sayfa 20 saniyede bir yokluyor, yani
 * dakikada 3 istek. Token başına 30/dk, aynı linke bakan ~10 eşzamanlı
 * müşteriye yer bırakır; IP başına 60/dk, bir ofisten bakan birden çok kişiyi
 * kesmez ama tarayıcı döngüsünü durdurur.
 *
 * ── 404 mü 410 mu ─────────────────────────────────────────────────────────
 * "Token yok" ile "süresi doldu" ekranda AYRI cümlelerdir (sayfa sunucuda
 * ayrımı biliyor), ama bu uçta ikisi de 410/404 döner ve gövde SEBEBİ taşır.
 * Var olmayan token'a 404, VAR OLUP ÖLMÜŞE 410: müşteri "link ölmüş" ile
 * "linki yanlış kopyalamışım" ayrımını yapabilsin.
 *
 * ⚠️ ÖLÜ SEBEPLERİ TEK KAYNAKTAN (083'te ölçülerek yakalandı): dördüncü ölüm
 * yolu `durak_kapandi` eklendiğinde bu liste güncellenmeyi UNUTMUŞTU ve uç 404
 * dönüyordu — yani kapanmış bir durağın müşterisine "böyle bir link yok"
 * deniyordu ve o kişi linki yanlış kopyaladığını sanırdı. Liste artık
 * `OLU_SEBEPLER` sabitinde; yeni bir ölüm yolu eklendiğinde tek yer değişir.
 */

/**
 * VAR OLUP ÖLMÜŞ link sebepleri → HTTP 410 Gone.
 * Buraya girmeyen her sebep 404'tür ("böyle bir link yok").
 */
const OLU_SEBEPLER = new Set(["suresi_doldu", "iptal_edildi", "sefer_kapandi", "durak_kapandi"]);

/** Token başına pencere: 30 istek / 60 sn. */
const TOKEN_TAVAN = 30;
/** IP başına pencere: 60 istek / 60 sn. */
const IP_TAVAN = 60;
const PENCERE_SN = 60;

/** İstemci IP'si — Vercel'de `x-forwarded-for` ilk değeri. */
function istemciIp(h: Headers): string {
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return h.get("x-real-ip")?.trim() || "bilinmiyor";
}

function sinirCevabi(tekrarSn: number) {
  return NextResponse.json(
    { ok: false, sebep: "cok_fazla_istek" },
    {
      status: 429,
      headers: {
        "retry-after": String(tekrarSn),
        "cache-control": "no-store",
      },
    }
  );
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;

  // Biçim denetimi ÖNCE: veritabanına gitmeden eleyebileceğimiz her istek,
  // gitmeyen bir istektir. Kısıt 079'daki CHECK ile aynı alfabe.
  if (!/^[A-Za-z0-9_-]{32,86}$/.test(token)) {
    return NextResponse.json(
      { ok: false, sebep: "bulunamadi" },
      { status: 404, headers: { "cache-control": "no-store" } }
    );
  }

  const ip = istemciIp(req.headers);
  const ipSinir = sinirDenetle(`takip:ip:${ip}`, IP_TAVAN, PENCERE_SN);
  if (!ipSinir.ok) return sinirCevabi(ipSinir.tekrarSn);
  const tokenSinir = sinirDenetle(`takip:tok:${token}`, TOKEN_TAVAN, PENCERE_SN);
  if (!tokenSinir.ok) return sinirCevabi(tokenSinir.tekrarSn);

  const sonuc = await readTakipByToken(token);
  if (!sonuc.ok) {
    const olu = OLU_SEBEPLER.has(sonuc.sebep);
    return NextResponse.json(
      { ok: false, sebep: sonuc.sebep },
      { status: olu ? 410 : 404, headers: { "cache-control": "no-store" } }
    );
  }

  // Sayaç KISILMIŞ yazılır ve beklenmez: cevabı geciktirmesin.
  void takipVurusKaydet(token);

  return NextResponse.json(
    { ok: true, ...sonuc.gorunum },
    {
      status: 200,
      headers: {
        // Girişsiz ve kişiye özel: ara katmanlar KESİNLİKLE saklamamalı.
        "cache-control": "no-store, private",
        // Arama motoru bu ucu indekslemesin (sayfa da noindex).
        "x-robots-tag": "noindex, nofollow",
      },
    }
  );
}
