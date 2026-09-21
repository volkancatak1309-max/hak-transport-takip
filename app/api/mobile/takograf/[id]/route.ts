import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { DEFAULT_LIMIT, MAX_LIMIT } from "@/lib/mobile-list";
import { audit } from "@/lib/security-log";
import {
  dosya,
  altSayim,
  faaliyetlerSayfali,
  olaylarSayfali,
} from "@/lib/takograf-db";
import { muhurSebepKodu, olayMetinAnahtari } from "@/lib/takograf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/takograf/[id] — KÜNYE + faaliyetler + olaylar.
 *
 * Panelin künye sayfasının (`app/admin/takograf/[id]`) okuduğu ÇEKİRDEĞİ
 * kullanır: `dosya()` aynı fonksiyon. Faaliyet ve olaylar ise SAYFALI okunur
 * ve sebebi ölçülmüş bir kusur:
 *
 * ═══ 🔴 PostgREST 1000 SATIR TAVANI — PANELİN BUGÜNKÜ SESSİZ KUSURU ═══
 *
 * ÖLÇÜLDÜ (21.09.2026, galzura-demo): 1.270.885 satırlık bir tabloda limitsiz
 * `select` 1000 satır döndü; `.limit(40000)` de 1000 döndü. Tavan istemci
 * tarafından AŞILAMIYOR.
 *
 * Panelin `faaliyetler(dosyaId, limit = 5000)` çağrısı bu yüzden 1000'de
 * sessizce kırpıyor. 091 başlığı "Bir VU dosyası 3.430 faaliyet satırı üretir
 * (365 günlükte ≈13.000)" diyor — yani kırpma GERÇEK, yalnız demo dosyası 155
 * satırlık olduğu için bugüne dek görülmemiş.
 *
 * Bu uç o tuzağa düşmüyor: satırlar `.range()` ile sayfalanıyor, TOPLAM ise
 * `count: "exact"` ile AYRI okunuyor (tavandan bağımsız — gövde hiç dönmez,
 * yalnız `Content-Range` okunur). Böylece istemci "155 satırın 50'sini
 * görüyorum" diyebiliyor; "hepsi bu" sanmıyor.
 *
 * ⚠️ PANELİN KUSURU BU TURDA DÜZELTİLMEDİ — panel kodu hiç değişmedi ve
 * değiştirmek görünmeyen bir davranış değişikliği olurdu. Açık kalem olarak
 * `docs/TAKOGRAF-UCLARI.md`de duruyor.
 *
 * Sayfalama: `?fLimit`/`?fOffset` (faaliyet) · `?oLimit`/`?oOffset` (olay).
 * Varsayılan 50, tavan 200 — `lib/mobile-list.ts` ile aynı sınırlar.
 *
 * ═══ KAPI ═══ `requireMobileAdmin` — şef ve şoför 403.
 *
 * HATA KODLARI: 401 · 403 admin_required · 404 not_found · 400 invalid
 */

type Yol = { params: Promise<{ id: string }> };

function sayfa(url: URL, ad: string, varsayilan = DEFAULT_LIMIT) {
  const ham = Number(url.searchParams.get(`${ad}Limit`) ?? varsayilan);
  const hamOfs = Number(url.searchParams.get(`${ad}Offset`) ?? 0);
  return {
    limit: Number.isFinite(ham) ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(ham))) : varsayilan,
    offset: Number.isFinite(hamOfs) ? Math.max(0, Math.floor(hamOfs)) : 0,
  };
}

export async function GET(req: NextRequest, { params }: Yol) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const d = await dosya(id);
  if (!d) return mobileError(404, "not_found");

  const url = new URL(req.url);
  const fs = sayfa(url, "f");
  const os = sayfa(url, "o");

  const [sayim, f, o] = await Promise.all([
    altSayim(id),
    faaliyetlerSayfali(id, fs),
    olaylarSayfali(id, os),
  ]);

  await audit(guard.actor.worker.id, "page_view", `takograf:${id} kaynak=mobil`);

  return Response.json({
    ok: true,
    kunye: {
      id: d.id,
      dosyaAdi: d.dosyaAdi,
      tur: d.tur,
      bayt: d.bayt,
      sha256: d.sha256,
      nesil: d.nesil,
      kartNo: d.kartNo,
      aracPlaka: d.aracPlaka,
      aracVin: d.aracVin,
      donem: d.donemBas || d.donemBit ? { bas: d.donemBas, bit: d.donemBit } : null,
      /**
       * Ham `muhur_sebep` GÖVDEYE KONMUYOR: serbest metin, kütüphaneden gelen
       * bir istisna mesajı ve kişisel/teknik ayrıntı taşıyabilir. İstemciye
       * KAPALI KÜME bir kod veriliyor (`lib/takograf.ts` `muhurSebepKodu`) —
       * çevrilebilir ve ekranda karşılığı garanti.
       */
      muhur: { durum: d.muhurDurumu, sebepKodu: muhurSebepKodu(d.muhurSebep) },
      ayristirma: {
        durum: d.ayristirmaDurumu,
        hata: d.ayristirmaHata,
        surum: d.ayristiriciSurum,
      },
      yukleyenAd: d.yukleyenAd,
      yuklendiAt: d.yuklendiAt,
    },
    /** GERÇEK toplamlar — `count: "exact"`, 1000 tavanından bağımsız. */
    sayim,
    faaliyet: {
      toplam: f.toplam,
      satirlar: f.satirlar,
      page: { ...fs, total: f.toplam, hasMore: fs.offset + fs.limit < f.toplam },
    },
    olay: {
      toplam: o.toplam,
      satirlar: o.satirlar.map((x) => ({
        ...x,
        /** Ham kod KORUNUYOR + çevrilebilir anahtar yanına ekleniyor. */
        metinAnahtari: olayMetinAnahtari(x.tur),
      })),
      page: { ...os, total: o.toplam, hasMore: os.offset + os.limit < o.toplam },
    },
  });
}
